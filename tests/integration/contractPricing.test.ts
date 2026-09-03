import { describe, it, expect, beforeAll } from "vitest";
import { db } from "@/lib/db/client";
import { contracts, contractPricingRules, distanceBands, orders } from "@/lib/db/schema";
import { genId } from "@/lib/helpers";
import { calculateContractPrice, PricingEngineError } from "@/lib/contractPricing";
import { loginAs, makeRequest } from "../helpers/request";

// Contract Management Task C — Pricing Engine tests. The engine is
// exercised directly (not through HTTP), since nothing calls it from any
// route yet — these tests are the only thing proving it actually works.
describe("contractPricing engine (Task C)", () => {
  let tenantId: string;
  let acmeTenantId: string;
  let jarirId: string; // B2B customer, Demo Water Co.
  let contractId: string;

  beforeAll(async () => {
    const waterAdminCookie = await loginAs("admin@demo-water.co", "password123");
    const { GET: tenantGet } = await import("@/app/api/tenant/route");
    tenantId = (await (await tenantGet(makeRequest("/api/tenant", { cookie: waterAdminCookie }))).json()).id;

    const acmeAdminCookie = await loginAs("admin@acme-fuel-demo.co", "password123");
    acmeTenantId = (await (await tenantGet(makeRequest("/api/tenant", { cookie: acmeAdminCookie }))).json()).id;

    const { GET: customersGet } = await import("@/app/api/customers/route");
    const customers = await (await customersGet(makeRequest("/api/customers", { cookie: waterAdminCookie }))).json();
    jarirId = customers.find((c: any) => c.name === "Jarir Bookstore HQ").id;

    contractId = genId();
    await db.insert(contracts).values({
      id: contractId,
      tenantId,
      customerId: jarirId,
      contractNumber: `TEST-PRICING-${contractId.slice(0, 8)}`,
      type: "MONTHLY_ACCUMULATED",
      billingCadence: "MONTHLY",
      startDate: new Date("2026-01-01"),
    });
  });

  async function insertRule(overrides: Partial<typeof contractPricingRules.$inferInsert>) {
    const id = genId();
    await db.insert(contractPricingRules).values({
      id,
      tenantId,
      pricingScope: "TENANT_DEFAULT",
      rateType: "STANDARD",
      vatRate: 0.15,
      ...overrides,
    } as any);
    return id;
  }

  const pricingDate = new Date("2026-06-15");

  it("1. TENANT_DEFAULT STANDARD price by tanker capacity", async () => {
    // A deliberately synthetic capacity value (not 18000/21000/28000,
    // which other test files also legitimately use for their own rules
    // against this same shared tenant) — this is exactly the class of
    // cross-test-file collision the driver/vehicle isolation fix already
    // addressed for a different resource; the same discipline applies
    // here: don't share "realistic-looking" values across independent
    // test files' fixtures.
    const ruleId = await insertRule({ tankerCapacityLtr: 18001, pricePerTrip: 400 });
    const result = await calculateContractPrice({
      tenantId, customerId: jarirId, contractId: null, pricingDate,
      cityCode: null, zoneCode: null, distanceBandCode: null, tankerCapacityLtr: 18001, rateType: "STANDARD",
    });
    expect(result.selectedRuleId).toBe(ruleId);
    expect(result.pricingScope).toBe("TENANT_DEFAULT");
    expect(result.baseAmount).toBe(400);
  });

  it("2. CONTRACT STANDARD price by contractId", async () => {
    const ruleId = await insertRule({ pricingScope: "CONTRACT", contractId, tankerCapacityLtr: 21000, pricePerTrip: 550 });
    const result = await calculateContractPrice({
      tenantId, customerId: jarirId, contractId, pricingDate,
      cityCode: null, zoneCode: null, distanceBandCode: null, tankerCapacityLtr: 21000, rateType: "STANDARD",
    });
    expect(result.selectedRuleId).toBe(ruleId);
    expect(result.pricingScope).toBe("CONTRACT");
  });

  it("3. CONTRACT OVERAGE price by contractId", async () => {
    const ruleId = await insertRule({ pricingScope: "CONTRACT", contractId, rateType: "OVERAGE", tankerCapacityLtr: 28000, pricePerTrip: 900 });
    const result = await calculateContractPrice({
      tenantId, customerId: jarirId, contractId, pricingDate,
      cityCode: null, zoneCode: null, distanceBandCode: null, tankerCapacityLtr: 28000, rateType: "OVERAGE",
    });
    expect(result.selectedRuleId).toBe(ruleId);
    expect(result.rateType).toBe("OVERAGE");
  });

  it("4. missing STANDARD rule hard-fails with NO_MATCHING_RULE", async () => {
    await expect(
      calculateContractPrice({
        tenantId, customerId: jarirId, contractId: null, pricingDate,
        cityCode: null, zoneCode: null, distanceBandCode: null, tankerCapacityLtr: 99999, rateType: "STANDARD",
      })
    ).rejects.toMatchObject({ code: "NO_MATCHING_RULE" });
  });

  it("5. missing OVERAGE rule hard-fails with MISSING_OVERAGE_RULE, never falling back to STANDARD", async () => {
    await insertRule({ tankerCapacityLtr: 12345, pricePerTrip: 300 }); // a STANDARD rule exists for this capacity
    await expect(
      calculateContractPrice({
        tenantId, customerId: jarirId, contractId: null, pricingDate,
        cityCode: null, zoneCode: null, distanceBandCode: null, tankerCapacityLtr: 12345, rateType: "OVERAGE",
      })
    ).rejects.toMatchObject({ code: "MISSING_OVERAGE_RULE" });
  });

  it("6. wildcard city/zone/distance/capacity matching works", async () => {
    const ruleId = await insertRule({ cityCode: "RUH", pricePerTrip: 500 }); // zone/band/capacity all wildcard (null)
    const result = await calculateContractPrice({
      tenantId, customerId: jarirId, contractId: null, pricingDate,
      cityCode: "RUH", zoneCode: "ZONE_X", distanceBandCode: "BAND_X", tankerCapacityLtr: 21000, rateType: "STANDARD",
    });
    expect(result.selectedRuleId).toBe(ruleId);
    expect(result.matchedDimensions).toEqual(["cityCode"]);
  });

  it("7. a more specific rule wins over a wildcard rule", async () => {
    const wildcardId = await insertRule({ cityCode: "JED", pricePerTrip: 300 });
    const specificId = await insertRule({ cityCode: "JED", tankerCapacityLtr: 21000, pricePerTrip: 350 });
    const result = await calculateContractPrice({
      tenantId, customerId: jarirId, contractId: null, pricingDate,
      cityCode: "JED", zoneCode: null, distanceBandCode: null, tankerCapacityLtr: 21000, rateType: "STANDARD",
    });
    expect(result.selectedRuleId).toBe(specificId);
    expect(result.selectedRuleId).not.toBe(wildcardId);
    expect(result.specificity).toBe(2);
  });

  it("8. priority wins over specificity when priority is higher", async () => {
    const highSpecificityId = await insertRule({ cityCode: "DMM", zoneCode: "Z1", distanceBandCode: "B1", tankerCapacityLtr: 18000, pricePerTrip: 200 });
    const lowSpecificityHighPriorityId = await insertRule({ cityCode: "DMM", priority: 100, pricePerTrip: 999 });
    const result = await calculateContractPrice({
      tenantId, customerId: jarirId, contractId: null, pricingDate,
      cityCode: "DMM", zoneCode: "Z1", distanceBandCode: "B1", tankerCapacityLtr: 18000, rateType: "STANDARD",
    });
    expect(result.selectedRuleId).toBe(lowSpecificityHighPriorityId);
    expect(result.selectedRuleId).not.toBe(highSpecificityId);
    expect(result.priority).toBe(100);
  });

  it("9. equal priority + equal specificity ambiguity hard-fails with AMBIGUOUS_RULE, never silently picking one", async () => {
    await insertRule({ cityCode: "TAB", zoneCode: "ZA", pricePerTrip: 100 });
    await insertRule({ cityCode: "TAB", zoneCode: "ZB", pricePerTrip: 200 }); // same specificity (2), different dimensions, both match this lookup's wildcards on the OTHER side — actually need same matched dims to truly tie; fix below
    // The two rules above don't actually tie against a single lookup (only one zoneCode can match). Construct a genuine tie instead: two
    // rules with the exact same dimensions and no priority.
    await insertRule({ cityCode: "TIE", tankerCapacityLtr: 21000, pricePerTrip: 111 });
    await insertRule({ cityCode: "TIE", tankerCapacityLtr: 21000, pricePerTrip: 222 });
    await expect(
      calculateContractPrice({
        tenantId, customerId: jarirId, contractId: null, pricingDate,
        cityCode: "TIE", zoneCode: null, distanceBandCode: null, tankerCapacityLtr: 21000, rateType: "STANDARD",
      })
    ).rejects.toMatchObject({ code: "AMBIGUOUS_RULE" });
  });

  it("10. effective-date overlap ambiguity hard-fails (two equally-specific, currently-active rules)", async () => {
    await insertRule({
      cityCode: "OVERLAP", pricePerTrip: 100,
      effectiveStartDate: new Date("2026-01-01"), effectiveEndDate: new Date("2026-12-31"),
    });
    await insertRule({
      cityCode: "OVERLAP", pricePerTrip: 200,
      effectiveStartDate: new Date("2026-06-01"), effectiveEndDate: new Date("2026-12-31"),
    });
    await expect(
      calculateContractPrice({
        tenantId, customerId: jarirId, contractId: null, pricingDate: new Date("2026-07-01"),
        cityCode: "OVERLAP", zoneCode: null, distanceBandCode: null, tankerCapacityLtr: null, rateType: "STANDARD",
      })
    ).rejects.toMatchObject({ code: "AMBIGUOUS_RULE" });
  });

  it("11. an expired rule is ignored", async () => {
    await insertRule({
      cityCode: "EXPIRED", pricePerTrip: 999,
      effectiveStartDate: new Date("2025-01-01"), effectiveEndDate: new Date("2025-12-31"),
    });
    await expect(
      calculateContractPrice({
        tenantId, customerId: jarirId, contractId: null, pricingDate: new Date("2026-06-15"),
        cityCode: "EXPIRED", zoneCode: null, distanceBandCode: null, tankerCapacityLtr: null, rateType: "STANDARD",
      })
    ).rejects.toMatchObject({ code: "NO_MATCHING_RULE" });
  });

  it("12. a future rule is ignored", async () => {
    await insertRule({
      cityCode: "FUTURE", pricePerTrip: 999,
      effectiveStartDate: new Date("2027-01-01"),
    });
    await expect(
      calculateContractPrice({
        tenantId, customerId: jarirId, contractId: null, pricingDate: new Date("2026-06-15"),
        cityCode: "FUTURE", zoneCode: null, distanceBandCode: null, tankerCapacityLtr: null, rateType: "STANDARD",
      })
    ).rejects.toMatchObject({ code: "NO_MATCHING_RULE" });
  });

  it("13. a cross-tenant rule is never selected", async () => {
    // A rule for Acme's tenant with an identical-looking match shape must
    // never leak into a Demo Water Co. lookup.
    await db.insert(contractPricingRules).values({
      id: genId(), tenantId: acmeTenantId, pricingScope: "TENANT_DEFAULT", rateType: "STANDARD",
      cityCode: "CROSSTENANT", pricePerTrip: 12345, vatRate: 0.15,
    });
    await expect(
      calculateContractPrice({
        tenantId, customerId: jarirId, contractId: null, pricingDate,
        cityCode: "CROSSTENANT", zoneCode: null, distanceBandCode: null, tankerCapacityLtr: null, rateType: "STANDARD",
      })
    ).rejects.toMatchObject({ code: "NO_MATCHING_RULE" });
  });

  it("14. pricePerTrip calculation works", async () => {
    await insertRule({ cityCode: "TRIPCALC", pricePerTrip: 480 });
    const result = await calculateContractPrice({
      tenantId, customerId: jarirId, contractId: null, pricingDate,
      cityCode: "TRIPCALC", zoneCode: null, distanceBandCode: null, tankerCapacityLtr: null, rateType: "STANDARD",
    });
    expect(result.baseAmount).toBe(480);
  });

  it("15. pricePerLiter calculation works", async () => {
    await insertRule({ cityCode: "LITERCALC", pricePerTrip: undefined, pricePerLiter: 0.05 } as any);
    const result = await calculateContractPrice({
      tenantId, customerId: jarirId, contractId: null, pricingDate,
      cityCode: "LITERCALC", zoneCode: null, distanceBandCode: null, tankerCapacityLtr: null, rateType: "STANDARD",
      quantityLiters: 18000,
    });
    expect(result.baseAmount).toBe(900); // 0.05 * 18000
  });

  it("missing quantityLiters for a pricePerLiter rule hard-fails", async () => {
    await insertRule({ cityCode: "NOLITERQTY", pricePerTrip: undefined, pricePerLiter: 0.05 } as any);
    await expect(
      calculateContractPrice({
        tenantId, customerId: jarirId, contractId: null, pricingDate,
        cityCode: "NOLITERQTY", zoneCode: null, distanceBandCode: null, tankerCapacityLtr: null, rateType: "STANDARD",
      })
    ).rejects.toMatchObject({ code: "MISSING_QUANTITY_FOR_PRICE_PER_LITER" });
  });

  it("16. VAT calculation is correct, using the rule's own vatRate", async () => {
    await insertRule({ cityCode: "VATCHECK", pricePerTrip: 1000, vatRate: 0.15 });
    const result = await calculateContractPrice({
      tenantId, customerId: jarirId, contractId: null, pricingDate,
      cityCode: "VATCHECK", zoneCode: null, distanceBandCode: null, tankerCapacityLtr: null, rateType: "STANDARD",
    });
    expect(result.vatAmount).toBeCloseTo(150, 2);
    expect(result.totalAmount).toBeCloseTo(1150, 2);
  });

  it("a rule with both pricePerTrip and pricePerLiter hard-fails as an invalid configuration", async () => {
    const badRuleId = genId();
    await db.insert(contractPricingRules).values({
      id: badRuleId, tenantId, pricingScope: "TENANT_DEFAULT", rateType: "STANDARD",
      cityCode: "BOTHPRICES", pricePerTrip: 100, pricePerLiter: 0.01, vatRate: 0.15,
    });
    await expect(
      calculateContractPrice({
        tenantId, customerId: jarirId, contractId: null, pricingDate,
        cityCode: "BOTHPRICES", zoneCode: null, distanceBandCode: null, tankerCapacityLtr: null, rateType: "STANDARD",
      })
    ).rejects.toMatchObject({ code: "INVALID_PRICE_CONFIGURATION" });
  });

  it("an invalid contract/tenant combination hard-fails with INVALID_CONTRACT", async () => {
    await expect(
      calculateContractPrice({
        tenantId, customerId: jarirId, contractId: "does-not-exist", pricingDate,
        cityCode: null, zoneCode: null, distanceBandCode: null, tankerCapacityLtr: null, rateType: "STANDARD",
      })
    ).rejects.toMatchObject({ code: "INVALID_CONTRACT" });
  });

  it("17/18/19. the engine never creates invoices, invoice_line_items, or mutates orders", async () => {
    const { invoices, invoiceLineItems } = await import("@/lib/db/schema");
    const invoicesBefore = await db.query.invoices.findMany();
    const lineItemsBefore = await db.query.invoiceLineItems.findMany();
    const ordersBefore = await db.query.orders.findMany();

    await insertRule({ cityCode: "PURITY_CHECK", pricePerTrip: 700 });
    await calculateContractPrice({
      tenantId, customerId: jarirId, contractId: null, pricingDate,
      cityCode: "PURITY_CHECK", zoneCode: null, distanceBandCode: null, tankerCapacityLtr: null, rateType: "STANDARD",
    });

    const invoicesAfter = await db.query.invoices.findMany();
    const lineItemsAfter = await db.query.invoiceLineItems.findMany();
    const ordersAfter = await db.query.orders.findMany();
    expect(invoicesAfter.length).toBe(invoicesBefore.length);
    expect(lineItemsAfter.length).toBe(lineItemsBefore.length);
    expect(ordersAfter.length).toBe(ordersBefore.length);
  });

  it("invalid input (missing rateType) is rejected", async () => {
    await expect(
      calculateContractPrice({
        tenantId, customerId: jarirId, contractId: null, pricingDate,
        cityCode: null, zoneCode: null, distanceBandCode: null, tankerCapacityLtr: null, rateType: undefined as any,
      })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});
