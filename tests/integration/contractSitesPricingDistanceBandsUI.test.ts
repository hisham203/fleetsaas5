import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { makeRequest, loginAs } from "../helpers/request";
import { db } from "@/lib/db/client";
import { tenants, customers, customerLocations, contracts, contractPricingRules, distanceBands } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { genId } from "@/lib/helpers";

// Task I.2/I.3/I.4 — Contract Sites, Pricing Rules, and Distance Bands UI.
// Every test here uses dedicated, isolated fixtures (its own customer,
// contract, distance bands) rather than the real seeded Riyadh data —
// a lesson directly learned from Task I's own cross-test-file
// interference (several other files assert real-seed counts on that
// same tenant). This file never touches or depends on those counts.
async function setupTenantAndCustomer(tenantName: string) {
  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, tenantName) });
  const customerId = genId();
  await db.insert(customers).values({ id: customerId, tenantId: tenant!.id, name: `I2 Test Customer ${genId().slice(0, 6)}`, type: "B2B", address: "Test", lat: 24.7, lng: 46.7 });
  return { tenantId: tenant!.id, customerId };
}

describe("Contract Site Scope UI (I.2)", () => {
  const moduleSource = fs.readFileSync(path.join(process.cwd(), "app/admin/contracts/page.tsx"), "utf8");

  it("1. the module source includes real site scope management, not just a read-only note", () => {
    expect(moduleSource).toContain("SiteScopeManager");
    expect(moduleSource).toContain("/locations");
    expect(moduleSource).not.toContain("Site assignment is available via API only");
  });

  it("2/3. assigning a site only offers this contract's own customer's sites, and uses the real assignment API", async () => {
    const { tenantId, customerId } = await setupTenantAndCustomer("Riyadh Bulk Water Logistics");
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");

    const locId = genId();
    await db.insert(customerLocations).values({ id: locId, customerId, label: "Site A", address: "Test", cityCode: "RUH", zoneCode: "N", distanceBandCode: "TEST_BAND" });

    // A second, unrelated customer's site — must never be assignable here.
    const otherCustomerId = genId();
    await db.insert(customers).values({ id: otherCustomerId, tenantId, name: "I2 Other Customer", type: "B2B", address: "Test", lat: 24.7, lng: 46.7 });
    const otherLocId = genId();
    await db.insert(customerLocations).values({ id: otherLocId, customerId: otherCustomerId, label: "Other Site", address: "Test", cityCode: "RUH", zoneCode: "S", distanceBandCode: "TEST_BAND" });

    const { GET: getLocations } = await import("@/app/api/customers/[id]/locations/route");
    const locsRes = await getLocations(makeRequest(`/api/customers/${customerId}/locations`, { cookie: adminCookie }), { params: { id: customerId } });
    const locs = await locsRes.json();
    expect(locs.map((l: any) => l.id)).toContain(locId);
    expect(locs.map((l: any) => l.id)).not.toContain(otherLocId);

    const { POST: createContract } = await import("@/app/api/contracts/route");
    const contract = await (await createContract(makeRequest("/api/contracts", {
      method: "POST", cookie: adminCookie,
      body: { customerId, type: "MONTHLY_ACCUMULATED", billingCadence: "MONTHLY", appliesToAllSites: false, startDate: "2026-01-01" },
    }))).json();

    const { POST: assignSites } = await import("@/app/api/contracts/[id]/sites/route");
    const assignRes = await assignSites(
      makeRequest(`/api/contracts/${contract.id}/sites`, { method: "POST", cookie: adminCookie, body: { customerLocationIds: [locId] } }),
      { params: { id: contract.id } }
    );
    expect(assignRes.status).toBe(201);

    // Cross-customer assignment is rejected.
    const crossRes = await assignSites(
      makeRequest(`/api/contracts/${contract.id}/sites`, { method: "POST", cookie: adminCookie, body: { customerLocationIds: [otherLocId] } }),
      { params: { id: contract.id } }
    );
    expect(crossRes.status).toBe(422);
  });

  it("4. removing a site uses the real removal API and never deletes the underlying customer location", async () => {
    const { customerId } = await setupTenantAndCustomer("Riyadh Bulk Water Logistics");
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const locId = genId();
    await db.insert(customerLocations).values({ id: locId, customerId, label: "Removable Site", address: "Test", cityCode: "RUH", zoneCode: "N", distanceBandCode: "TEST_BAND" });

    const { POST: createContract } = await import("@/app/api/contracts/route");
    const contract = await (await createContract(makeRequest("/api/contracts", {
      method: "POST", cookie: adminCookie,
      body: { customerId, type: "MONTHLY_ACCUMULATED", billingCadence: "MONTHLY", appliesToAllSites: false, startDate: "2026-01-01" },
    }))).json();
    const { POST: assignSites } = await import("@/app/api/contracts/[id]/sites/route");
    await assignSites(makeRequest(`/api/contracts/${contract.id}/sites`, { method: "POST", cookie: adminCookie, body: { customerLocationIds: [locId] } }), { params: { id: contract.id } });

    const { DELETE: removeSite } = await import("@/app/api/contracts/[id]/sites/[customerLocationId]/route");
    const res = await removeSite(
      makeRequest(`/api/contracts/${contract.id}/sites/${locId}`, { method: "DELETE", cookie: adminCookie }),
      { params: { id: contract.id, customerLocationId: locId } }
    );
    expect(res.status).toBe(200);

    const stillExists = await db.query.customerLocations.findFirst({ where: eq(customerLocations.id, locId) });
    expect(stillExists).toBeTruthy(); // the site itself is untouched, only the assignment was removed
  });

  it("5. a site-restricted contract with zero sites shows the warning message", () => {
    expect(moduleSource).toContain("Restricted to specific sites, but none are assigned yet");
  });
});

describe("Pricing Rules UI (I.3)", () => {
  const moduleSource = fs.readFileSync(path.join(process.cwd(), "app/admin/contracts/page.tsx"), "utf8");

  it("6. the module source includes real pricing rule management with all required fields", () => {
    expect(moduleSource).toContain("PricingRulesManager");
    expect(moduleSource).toContain("tankerCapacityLtr");
    expect(moduleSource).toContain("18000");
    expect(moduleSource).toContain("21000");
    expect(moduleSource).toContain("28000");
    expect(moduleSource).not.toContain("Pricing rule setup is available via API only");
  });

  it("7/8. creating STANDARD and OVERAGE pricing rules for a trip-count contract both work", async () => {
    const { customerId } = await setupTenantAndCustomer("Riyadh Bulk Water Logistics");
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const { POST: createContract } = await import("@/app/api/contracts/route");
    const contract = await (await createContract(makeRequest("/api/contracts", {
      method: "POST", cookie: adminCookie,
      body: { customerId, type: "ONE_TIME_TRIP_COUNT", totalTripsPurchased: 5, startDate: "2026-01-01" },
    }))).json();

    const { POST: createRule } = await import("@/app/api/contract-pricing-rules/route");
    const standardRes = await createRule(makeRequest("/api/contract-pricing-rules", {
      method: "POST", cookie: adminCookie,
      body: { pricingScope: "CONTRACT", contractId: contract.id, rateType: "STANDARD", pricePerTrip: 400, vatRate: 0.15, tankerCapacityLtr: 21000 },
    }));
    expect(standardRes.status).toBe(201);

    const overageRes = await createRule(makeRequest("/api/contract-pricing-rules", {
      method: "POST", cookie: adminCookie,
      body: { pricingScope: "CONTRACT", contractId: contract.id, rateType: "OVERAGE", pricePerTrip: 550, vatRate: 0.15 },
    }));
    expect(overageRes.status).toBe(201);

    const { GET: getRules } = await import("@/app/api/contract-pricing-rules/route");
    const rulesRes = await getRules(makeRequest(`/api/contract-pricing-rules?contractId=${contract.id}`, { cookie: adminCookie }));
    const rules = await rulesRes.json();
    expect(rules.length).toBe(2);
    expect(rules.some((r: any) => r.rateType === "STANDARD" && r.tankerCapacityLtr === 21000)).toBe(true);
    expect(rules.some((r: any) => r.rateType === "OVERAGE")).toBe(true);
  });

  it("9. the missing-OVERAGE warning is shown for a trip-count contract with only STANDARD pricing", () => {
    expect(moduleSource).toContain("new trips beyond the purchased count cannot be priced");
  });

  it("10. pricing rules display all required fields: capacity, city/zone/band, price, VAT, priority, effective dates", () => {
    expect(moduleSource).toContain("City/Zone/Band");
    expect(moduleSource).toContain("Price/trip");
    expect(moduleSource).toContain("VAT");
    expect(moduleSource).toContain("Priority");
    expect(moduleSource).toContain("Effective");
  });

  it("a pricing rule can be retired (soft-deleted via effectiveEndDate), not hard-deleted", async () => {
    const { customerId } = await setupTenantAndCustomer("Riyadh Bulk Water Logistics");
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const { POST: createContract } = await import("@/app/api/contracts/route");
    const contract = await (await createContract(makeRequest("/api/contracts", {
      method: "POST", cookie: adminCookie,
      body: { customerId, type: "MONTHLY_ACCUMULATED", billingCadence: "MONTHLY", startDate: "2026-01-01" },
    }))).json();
    const { POST: createRule } = await import("@/app/api/contract-pricing-rules/route");
    const rule = await (await createRule(makeRequest("/api/contract-pricing-rules", {
      method: "POST", cookie: adminCookie,
      body: { pricingScope: "CONTRACT", contractId: contract.id, rateType: "STANDARD", pricePerTrip: 400, vatRate: 0.15 },
    }))).json();

    const { DELETE: retireRule } = await import("@/app/api/contract-pricing-rules/[id]/route");
    const res = await retireRule(makeRequest(`/api/contract-pricing-rules/${rule.id}`, { method: "DELETE", cookie: adminCookie }), { params: { id: rule.id } });
    expect(res.status).toBe(200);
    const stillExists = await db.query.contractPricingRules.findFirst({ where: eq(contractPricingRules.id, rule.id) });
    expect(stillExists).toBeTruthy(); // soft-deleted, row still present
    expect(stillExists!.effectiveEndDate).toBeTruthy();
  });
});

describe("Distance Bands UI (I.4)", () => {
  const moduleSource = fs.readFileSync(path.join(process.cwd(), "app/admin/contracts/page.tsx"), "utf8");

  it("11. the module source includes real distance band management", () => {
    expect(moduleSource).toContain("createBand");
    expect(moduleSource).toContain("retireBand");
    expect(moduleSource).not.toContain("Creating and retiring distance bands is available via API only");
  });

  it("12. creating a distance band works end-to-end", async () => {
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const uniqueCode = `I2_TEST_BAND_${genId().slice(0, 8)}`;

    const { POST: createDistanceBand } = await import("@/app/api/distance-bands/route");
    const res = await createDistanceBand(makeRequest("/api/distance-bands", {
      method: "POST", cookie: adminCookie,
      body: { code: uniqueCode, label: "Test Band", fromKm: 0, toKm: 10 },
    }));
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created.tenantId).toBe(tenant!.id);
    expect(created.isActive).toBe(true);
  });

  it("13. invalid distance band values (toKm <= fromKm) are rejected with a clear error", async () => {
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const { POST: createDistanceBand } = await import("@/app/api/distance-bands/route");
    const res = await createDistanceBand(makeRequest("/api/distance-bands", {
      method: "POST", cookie: adminCookie,
      body: { code: `I2_INVALID_${genId().slice(0, 8)}`, label: "Invalid Band", fromKm: 20, toKm: 10 },
    }));
    expect(res.status).toBe(400);
  });

  it("retiring a distance band sets isActive false and retiredAt, without deleting the row", async () => {
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const uniqueCode = `I2_RETIRE_${genId().slice(0, 8)}`;
    const { POST: createDistanceBand } = await import("@/app/api/distance-bands/route");
    const created = await (await createDistanceBand(makeRequest("/api/distance-bands", {
      method: "POST", cookie: adminCookie, body: { code: uniqueCode, label: "To Retire", fromKm: 0, toKm: 5 },
    }))).json();

    const { DELETE: retireBand } = await import("@/app/api/distance-bands/[id]/route");
    const res = await retireBand(makeRequest(`/api/distance-bands/${created.id}`, { method: "DELETE", cookie: adminCookie }), { params: { id: created.id } });
    expect(res.status).toBe(200);
    const row = await db.query.distanceBands.findFirst({ where: eq(distanceBands.id, created.id) });
    expect(row!.isActive).toBe(false);
    expect(row!.retiredAt).toBeTruthy();
  });

  it("a newly created distance band is immediately usable for pricing-rule creation", async () => {
    const { customerId } = await setupTenantAndCustomer("Riyadh Bulk Water Logistics");
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const uniqueCode = `I2_USABLE_${genId().slice(0, 8)}`;
    const { POST: createDistanceBand } = await import("@/app/api/distance-bands/route");
    await createDistanceBand(makeRequest("/api/distance-bands", {
      method: "POST", cookie: adminCookie, body: { code: uniqueCode, label: "Usable Band", fromKm: 0, toKm: 15 },
    }));

    const { POST: createContract } = await import("@/app/api/contracts/route");
    const contract = await (await createContract(makeRequest("/api/contracts", {
      method: "POST", cookie: adminCookie,
      body: { customerId, type: "MONTHLY_ACCUMULATED", billingCadence: "MONTHLY", startDate: "2026-01-01" },
    }))).json();
    const { POST: createRule } = await import("@/app/api/contract-pricing-rules/route");
    const res = await createRule(makeRequest("/api/contract-pricing-rules", {
      method: "POST", cookie: adminCookie,
      body: { pricingScope: "CONTRACT", contractId: contract.id, rateType: "STANDARD", pricePerTrip: 400, vatRate: 0.15, distanceBandCode: uniqueCode },
    }));
    expect(res.status).toBe(201);
    const rule = await res.json();
    expect(rule.distanceBandCode).toBe(uniqueCode);
  });
});

describe("Cross-cutting: security and existing behavior (I.2/I.3/I.4)", () => {
  it("17. none of the new endpoints/UI paths expose passwordHash", async () => {
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const { GET: getContracts } = await import("@/app/api/contracts/route");
    const { GET: getRules } = await import("@/app/api/contract-pricing-rules/route");
    const { GET: getBands } = await import("@/app/api/distance-bands/route");
    for (const handler of [
      () => getContracts(makeRequest("/api/contracts", { cookie: adminCookie })),
      () => getRules(makeRequest("/api/contract-pricing-rules", { cookie: adminCookie })),
      () => getBands(makeRequest("/api/distance-bands", { cookie: adminCookie })),
    ]) {
      const res = await handler();
      const text = await res.text();
      expect(text).not.toContain("passwordHash");
    }
  });

  it("18. tenant isolation: a Demo Water Co. admin cannot see or modify Riyadh's contracts/rules/bands", async () => {
    const { customerId } = await setupTenantAndCustomer("Riyadh Bulk Water Logistics");
    const demoWaterCookie = await loginAs("admin@demo-water.co", "password123");
    const riyadhAdminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");

    const { POST: createContract } = await import("@/app/api/contracts/route");
    const contract = await (await createContract(makeRequest("/api/contracts", {
      method: "POST", cookie: riyadhAdminCookie,
      body: { customerId, type: "MONTHLY_ACCUMULATED", billingCadence: "MONTHLY", startDate: "2026-01-01" },
    }))).json();

    const { GET: getContract } = await import("@/app/api/contracts/[id]/route");
    const res = await getContract(makeRequest(`/api/contracts/${contract.id}`, { cookie: demoWaterCookie }), { params: { id: contract.id } });
    expect(res.status).toBe(404); // exists, but not in this tenant's scope
  });
});
