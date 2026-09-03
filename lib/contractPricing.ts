// Contract Management Task C — Pricing Engine.
//
// PURE / READ-ONLY, by design: this module never creates invoices or
// invoice_line_items, never mutates orders, contracts, or pricing rules —
// it only reads contract_pricing_rules and computes a price. Wiring this
// into order creation, trip completion, or invoice generation is
// explicitly separate, later work (not started here).
//
// Design note on "pricingScope" as an input: the task's required-input
// list does not include pricingScope separately from contractId — it's
// derived: a caller who provides a contractId is asking for CONTRACT
// pricing; a caller who omits it is asking for TENANT_DEFAULT pricing.
// There is no mixing and no fallback between the two (see
// calculateContractPrice's docstring) — accepting pricingScope as a
// second, independent field would let a caller ask for a self-
// contradictory combination (e.g. contractId set but pricingScope
// TENANT_DEFAULT), which this design avoids entirely by construction.

import { db } from "./db/client";
import { contractPricingRules, contracts } from "./db/schema";
import { calcInvoiceTotals } from "./helpers";
import { eq, and, or, isNull, lte, gte } from "drizzle-orm";

export type RateType = "STANDARD" | "OVERAGE";
export type PricingScope = "TENANT_DEFAULT" | "CONTRACT";

export type PricingErrorCode =
  | "INVALID_INPUT"
  | "INVALID_CONTRACT"
  | "NO_MATCHING_RULE"
  | "MISSING_OVERAGE_RULE"
  | "AMBIGUOUS_RULE"
  | "MISSING_QUANTITY_FOR_PRICE_PER_LITER"
  | "INVALID_PRICE_CONFIGURATION";

export class PricingEngineError extends Error {
  code: PricingErrorCode;
  constructor(code: PricingErrorCode, message: string) {
    super(message);
    this.name = "PricingEngineError";
    this.code = code;
  }
}

export type PricingInput = {
  tenantId: string;
  customerId: string; // carried through into the result for audit/logging only — the engine does not query the customers table or validate against it; that's the caller's responsibility (e.g. Task B's Contract API already validates a contract's customer)
  contractId: string | null; // null = price against TENANT_DEFAULT rules; set = price against that contract's own CONTRACT rules only
  pricingDate: Date;
  cityCode: string | null;
  zoneCode: string | null;
  distanceBandCode: string | null;
  tankerCapacityLtr: number | null;
  rateType: RateType;
  quantityLiters?: number; // required only if the matched rule uses pricePerLiter
};

export type PricingResult = {
  selectedRuleId: string;
  baseAmount: number;
  vatAmount: number;
  totalAmount: number;
  currency: "SAR"; // the schema has no currency column anywhere yet (contracts, invoices, or pricing rules) — hardcoded to match this app's existing tenant-wide convention of an implicit Saudi Riyal / 15% VAT context (see VAT_RATE in lib/helpers.ts). Not a real multi-currency capability.
  pricingScope: PricingScope;
  rateType: RateType;
  matchedDimensions: string[]; // which of cityCode/zoneCode/distanceBandCode/tankerCapacityLtr were non-wildcard on the winning rule
  specificity: number; // matchedDimensions.length, surfaced directly since tests/logs asserting on "how specific was this match" is more convenient than recomputing it
  priority: number | null;
  explanation: string; // human-readable summary, safe for logs and test assertions
};

const DIMENSIONS = ["cityCode", "zoneCode", "distanceBandCode", "tankerCapacityLtr"] as const;

function dimensionMatches(ruleValue: string | number | null, inputValue: string | number | null): boolean {
  if (ruleValue == null) return true; // wildcard — always matches
  return ruleValue === inputValue;
}

/**
 * Calculates the price for a delivery against either a specific contract's
 * pricing rules (contractId provided) or a tenant's default rate card
 * (contractId omitted). Never mixes the two, and never falls back from one
 * to the other — a contract with no matching CONTRACT rule fails loudly
 * rather than silently pricing against the tenant default, and a missing
 * OVERAGE rule never silently prices at the STANDARD rate. See the
 * Contract Management Schema Design / Architecture Review documents for
 * why: a wrong, silently-guessed price on a real invoice is a financial
 * and trust problem, not a cosmetic one.
 */
export async function calculateContractPrice(input: PricingInput): Promise<PricingResult> {
  if (!input.tenantId || !input.customerId || !input.pricingDate || !input.rateType) {
    throw new PricingEngineError("INVALID_INPUT", "tenantId, customerId, pricingDate, and rateType are required");
  }
  if (input.rateType !== "STANDARD" && input.rateType !== "OVERAGE") {
    throw new PricingEngineError("INVALID_INPUT", `Unknown rateType "${input.rateType}"`);
  }

  const pricingScope: PricingScope = input.contractId != null ? "CONTRACT" : "TENANT_DEFAULT";

  if (pricingScope === "CONTRACT") {
    const contract = await db.query.contracts.findFirst({
      where: and(eq(contracts.id, input.contractId!), eq(contracts.tenantId, input.tenantId)),
    });
    if (!contract) {
      throw new PricingEngineError(
        "INVALID_CONTRACT",
        `Contract ${input.contractId} does not exist in tenant ${input.tenantId}`
      );
    }
    // Deliberately not checking contract.status here (e.g. rejecting a
    // DRAFT or CANCELLED contract) — whether a non-ACTIVE contract should
    // even be allowed to price a delivery is a business-workflow decision
    // for the (not-yet-built) order/contract attachment step, not this
    // pure calculation. Existence + tenant ownership is what this engine
    // itself needs to guarantee.
  }

  const candidates = await db.query.contractPricingRules.findMany({
    where: and(
      eq(contractPricingRules.tenantId, input.tenantId),
      eq(contractPricingRules.pricingScope, pricingScope),
      eq(contractPricingRules.rateType, input.rateType),
      pricingScope === "CONTRACT"
        ? eq(contractPricingRules.contractId, input.contractId!)
        : isNull(contractPricingRules.contractId),
      // Effective-date eligibility: a null bound is open-ended on that
      // side. This is purely a filter into/out of the candidate set —
      // any resulting ambiguity (two currently-active rules that also tie
      // on priority/specificity) is caught by the same generic tie
      // hard-fail below, not by special-cased date-overlap logic.
      or(isNull(contractPricingRules.effectiveStartDate), lte(contractPricingRules.effectiveStartDate, input.pricingDate)),
      or(isNull(contractPricingRules.effectiveEndDate), gte(contractPricingRules.effectiveEndDate, input.pricingDate))
    ),
  });

  const eligible = candidates.filter(
    (rule) =>
      dimensionMatches(rule.cityCode, input.cityCode) &&
      dimensionMatches(rule.zoneCode, input.zoneCode) &&
      dimensionMatches(rule.distanceBandCode, input.distanceBandCode) &&
      dimensionMatches(rule.tankerCapacityLtr, input.tankerCapacityLtr)
  );

  if (eligible.length === 0) {
    if (input.rateType === "OVERAGE") {
      throw new PricingEngineError(
        "MISSING_OVERAGE_RULE",
        `No OVERAGE pricing rule found for ${pricingScope}${pricingScope === "CONTRACT" ? ` contract ${input.contractId}` : ""} matching the given city/zone/distance-band/capacity — overage is never priced at the STANDARD rate as a fallback`
      );
    }
    throw new PricingEngineError(
      "NO_MATCHING_RULE",
      `No STANDARD pricing rule found for ${pricingScope}${pricingScope === "CONTRACT" ? ` contract ${input.contractId}` : ""} matching the given city/zone/distance-band/capacity`
    );
  }

  // Step 1: prefer highest priority, but only among rules that actually
  // set one — a rule with no priority never outranks or is outranked by
  // priority alone; it only competes on specificity.
  const prioritized = eligible.filter((r) => r.priority != null);
  let contest = eligible;
  if (prioritized.length > 0) {
    const maxPriority = Math.max(...prioritized.map((r) => r.priority!));
    contest = prioritized.filter((r) => r.priority === maxPriority);
  }

  // Step 2: among the surviving contest, prefer highest specificity
  // (fewest wildcards).
  const withSpecificity = contest.map((rule) => ({
    rule,
    matchedDimensions: DIMENSIONS.filter((d) => (rule as any)[d] != null),
  }));
  const maxSpecificity = Math.max(...withSpecificity.map((r) => r.matchedDimensions.length));
  const winners = withSpecificity.filter((r) => r.matchedDimensions.length === maxSpecificity);

  if (winners.length > 1) {
    throw new PricingEngineError(
      "AMBIGUOUS_RULE",
      `${winners.length} pricing rules tie on priority and specificity for this ${pricingScope} ${input.rateType} lookup (rule ids: ${winners
        .map((w) => w.rule.id)
        .join(", ")}) — configuration must be corrected, no rule is silently chosen`
    );
  }

  const { rule, matchedDimensions } = winners[0];

  const hasTrip = rule.pricePerTrip != null;
  const hasLiter = rule.pricePerLiter != null;
  if (hasTrip === hasLiter) {
    // Either both are set (ambiguous — which one applies?) or neither is
    // set (nothing to price with). Both are the same underlying problem:
    // the rule's own price configuration is invalid, not a lookup miss.
    throw new PricingEngineError(
      "INVALID_PRICE_CONFIGURATION",
      `Pricing rule ${rule.id} has ${hasTrip ? "both pricePerTrip and pricePerLiter" : "neither pricePerTrip nor pricePerLiter"} set — exactly one is required`
    );
  }

  let baseAmount: number;
  if (hasTrip) {
    baseAmount = rule.pricePerTrip!;
  } else {
    if (input.quantityLiters == null || input.quantityLiters <= 0) {
      throw new PricingEngineError(
        "MISSING_QUANTITY_FOR_PRICE_PER_LITER",
        `Pricing rule ${rule.id} is priced per liter but no positive quantityLiters was provided`
      );
    }
    baseAmount = Math.round(rule.pricePerLiter! * input.quantityLiters * 100) / 100;
  }

  const { vatAmount, total } = calcInvoiceTotals(baseAmount, rule.vatRate);

  return {
    selectedRuleId: rule.id,
    baseAmount,
    vatAmount,
    totalAmount: total,
    currency: "SAR",
    pricingScope,
    rateType: input.rateType,
    matchedDimensions,
    specificity: matchedDimensions.length,
    priority: rule.priority,
    explanation:
      `Matched ${pricingScope} ${input.rateType} rule ${rule.id} ` +
      `(specificity ${matchedDimensions.length}${matchedDimensions.length ? `: ${matchedDimensions.join(", ")}` : ""}` +
      `${rule.priority != null ? `, priority ${rule.priority}` : ""}) — ` +
      `${hasTrip ? `flat pricePerTrip ${rule.pricePerTrip}` : `pricePerLiter ${rule.pricePerLiter} × ${input.quantityLiters}L`} ` +
      `= ${baseAmount} + VAT ${vatAmount} (${rule.vatRate * 100}%) = ${total} SAR`,
  };
}
