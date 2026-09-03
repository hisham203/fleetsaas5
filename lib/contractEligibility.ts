// Contract Management Task D — Order/Contract Attachment.
//
// Two responsibilities, kept separate: validateContractEligibility()
// decides whether a specific contract may be attached to a specific
// order (a real business-rule check that can REJECT order creation when
// an explicitly-requested contract is invalid); buildPricingPreview()
// wraps the pure pricing engine (lib/contractPricing.ts) into a
// never-throws, always-returns-an-object helper for the response body —
// a failed pricing lookup degrades the preview, it never blocks the
// order itself, per this task's explicit instruction.

import { db } from "./db/client";
import { contracts, contractSiteScope } from "./db/schema";
import { eq, and } from "drizzle-orm";
import { calculateContractPrice, PricingEngineError, type RateType } from "./contractPricing";

export type ContractEligibilityErrorCode =
  | "CONTRACT_NOT_FOUND"
  | "WRONG_CUSTOMER"
  | "NOT_ACTIVE"
  | "OUTSIDE_DATE_RANGE"
  | "SITE_NOT_IN_SCOPE";

export class ContractEligibilityError extends Error {
  code: ContractEligibilityErrorCode;
  constructor(code: ContractEligibilityErrorCode, message: string) {
    super(message);
    this.name = "ContractEligibilityError";
    this.code = code;
  }
}

/**
 * Validates that `contractId` may be attached to an order for the given
 * customer, on the given date, at the given site. Returns the contract
 * row if eligible; throws ContractEligibilityError otherwise. This is a
 * hard validation, not a preview — the caller (the orders route) rejects
 * order creation entirely when an explicitly-requested contract fails
 * this check, distinct from a pricing preview simply being unavailable.
 */
export async function validateContractEligibility(params: {
  tenantId: string;
  customerId: string;
  contractId: string;
  orderDate: Date;
  customerLocationId: string | null;
}) {
  const contract = await db.query.contracts.findFirst({
    where: and(eq(contracts.id, params.contractId), eq(contracts.tenantId, params.tenantId)),
  });
  if (!contract) {
    throw new ContractEligibilityError("CONTRACT_NOT_FOUND", `Contract ${params.contractId} not found`);
  }
  if (contract.customerId !== params.customerId) {
    // The contract genuinely exists in this tenant (an admin could read it
    // fine elsewhere) — it's just not this customer's, a business-rule
    // rejection rather than a "doesn't exist" one, distinct from the
    // cross-tenant case above.
    throw new ContractEligibilityError("WRONG_CUSTOMER", `Contract ${params.contractId} does not belong to this customer`);
  }
  if (contract.status !== "ACTIVE") {
    throw new ContractEligibilityError("NOT_ACTIVE", `Contract ${params.contractId} is ${contract.status}, not ACTIVE`);
  }
  if (params.orderDate < contract.startDate) {
    throw new ContractEligibilityError("OUTSIDE_DATE_RANGE", `Order date is before this contract's start date`);
  }
  if (contract.endDate != null && params.orderDate > contract.endDate) {
    throw new ContractEligibilityError("OUTSIDE_DATE_RANGE", `Order date is after this contract's end date`);
  }
  if (!contract.appliesToAllSites) {
    if (!params.customerLocationId) {
      throw new ContractEligibilityError(
        "SITE_NOT_IN_SCOPE",
        `Contract ${params.contractId} is restricted to specific sites, but this order has no site to check`
      );
    }
    const scoped = await db.query.contractSiteScope.findFirst({
      where: and(eq(contractSiteScope.contractId, contract.id), eq(contractSiteScope.customerLocationId, params.customerLocationId)),
    });
    if (!scoped) {
      throw new ContractEligibilityError("SITE_NOT_IN_SCOPE", `This site is not within contract ${params.contractId}'s scope`);
    }
  }
  // Contract type is not separately validated here — ONE_TIME_TRIP_COUNT
  // and MONTHLY_ACCUMULATED are the only values the schema/API allow to
  // exist at all (enforced at contract-creation time in Task B), so
  // there is no third value this check would ever need to reject.
  return contract;
}

/** ONE_TIME_TRIP_COUNT: OVERAGE once the purchased trip count is used up.
 * MONTHLY_ACCUMULATED: always STANDARD — there is no included-allowance
 * concept for that contract type to exceed, confirmed nowhere in this
 * design, and not invented here. tripsUsed is only ever READ, never
 * incremented — this task has no delivery/completion event to safely
 * hang that mutation on (order creation is not a delivery). */
export function determineRateType(contract: { type: string; tripsUsed: number; totalTripsPurchased: number | null }): RateType {
  if (contract.type === "ONE_TIME_TRIP_COUNT") {
    const limit = contract.totalTripsPurchased ?? Infinity;
    return contract.tripsUsed >= limit ? "OVERAGE" : "STANDARD";
  }
  return "STANDARD";
}

export type PricingPreview = {
  available: boolean;
  errorCode?: string;
  error?: string;
  selectedRuleId?: string;
  baseAmount?: string;
  vatAmount?: string;
  totalAmount?: string;
  currency?: string;
  rateType?: RateType;
  explanation?: string;
  // Task D correction: always present, regardless of available/error —
  // this is the direct, honest signal that capacity-based pricing may be
  // incomplete, rather than trying to infer "was capacity the cause of
  // failure" after the fact. A wildcard-capacity rule can still price
  // successfully even when capacityKnown is false — that's expected and
  // correct, not a contradiction; this field describes what was known
  // going in, not whether pricing ultimately succeeded.
  capacityKnown: boolean;
};

/**
 * Never throws — always returns a PricingPreview object, `available:
 * false` with a clear errorCode/error on any failure. This is the
 * boundary that keeps a pricing lookup failure from ever blocking order
 * creation: the orders route calls this and attaches whatever it
 * returns to the response, unconditionally.
 */
export async function buildPricingPreview(input: {
  tenantId: string;
  customerId: string;
  contractId: string;
  pricingDate: Date;
  cityCode: string | null;
  zoneCode: string | null;
  distanceBandCode: string | null;
  tankerCapacityLtr: number | null;
  rateType: RateType;
  quantityLiters?: number;
}): Promise<PricingPreview> {
  const capacityKnown = input.tankerCapacityLtr != null;
  try {
    const result = await calculateContractPrice(input);
    return {
      available: true,
      selectedRuleId: result.selectedRuleId,
      baseAmount: result.baseAmount.toFixed(2),
      vatAmount: result.vatAmount.toFixed(2),
      totalAmount: result.totalAmount.toFixed(2),
      currency: result.currency,
      rateType: result.rateType,
      explanation: result.explanation,
      capacityKnown,
    };
  } catch (err) {
    if (err instanceof PricingEngineError) {
      // Deliberately NOT relabeling the engine's own errorCode to
      // something capacity-specific (e.g. a guessed
      // "MISSING_PRICING_DIMENSION") when capacity happens to be
      // unknown — the real cause could just as easily be an unmatched
      // city/zone/band, and mislabeling it would be a worse, dishonestly
      // confident diagnosis than the accurate one the engine already
      // gives. Instead, capacityKnown carries that information directly
      // and truthfully, and the message below adds a clarifying note
      // without claiming certainty about causation.
      const note = !capacityKnown
        ? " (note: tanker capacity was not yet known at order time — a vehicle isn't assigned until trip creation — which may be a contributing factor if the relevant pricing rules are capacity-specific)"
        : "";
      return { available: false, errorCode: err.code, error: err.message + note, capacityKnown };
    }
    return {
      available: false,
      errorCode: "UNKNOWN_ERROR",
      error: err instanceof Error ? err.message : String(err),
      capacityKnown,
    };
  }
}

// Task D.5 — Vehicle Capacity Pricing Preview at Trip Assignment. The
// single entry point trip creation calls, once per contract-linked order
// on the trip, now that a real vehicle (and therefore its real capacity)
// is known. Deliberately re-runs the FULL eligibility check (not just a
// capacity lookup) — a contract that was ACTIVE at order-creation time
// could have been suspended or cancelled by trip-creation time, and this
// reuses the exact same, already-tested validateContractEligibility()
// rather than trusting the order's stored contractId blindly. Returns
// null (not a PricingPreview) when the order has no contract at all —
// the caller skips attaching anything in that case, leaving a
// non-contract order's stop completely unaffected, exactly as before.
export async function buildPricingPreviewForOrder(params: {
  tenantId: string;
  order: {
    id: string;
    customerId: string;
    contractId: string | null;
    locationId: string | null;
    qtyOrdered: number;
    requestedTime: Date | null;
  };
  tankerCapacityLtr: number | null;
}): Promise<PricingPreview | null> {
  if (!params.order.contractId) return null;

  let contract;
  try {
    contract = await validateContractEligibility({
      tenantId: params.tenantId,
      customerId: params.order.customerId,
      contractId: params.order.contractId,
      orderDate: params.order.requestedTime ?? new Date(),
      customerLocationId: params.order.locationId,
    });
  } catch (err) {
    if (err instanceof ContractEligibilityError) {
      return {
        available: false,
        errorCode: err.code,
        error: err.message,
        capacityKnown: params.tankerCapacityLtr != null,
      };
    }
    throw err;
  }

  const location = params.order.locationId
    ? await db.query.customerLocations.findFirst({ where: (l, { eq: eqOp }) => eqOp(l.id, params.order.locationId!) })
    : null;

  return buildPricingPreview({
    tenantId: params.tenantId,
    customerId: params.order.customerId,
    contractId: contract.id,
    pricingDate: params.order.requestedTime ?? new Date(),
    cityCode: location?.cityCode ?? null,
    zoneCode: location?.zoneCode ?? null,
    distanceBandCode: location?.distanceBandCode ?? null,
    tankerCapacityLtr: params.tankerCapacityLtr,
    rateType: determineRateType(contract),
    quantityLiters: params.order.qtyOrdered,
  });
}
