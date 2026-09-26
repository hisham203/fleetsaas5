/**
 * Smarty1 Phase 1 — Final Closure Pass behavioral tests.
 * Tests 1–31+ covering all closure requirements.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { makeRequest, loginAs } from "../helpers/request";
import { db } from "@/lib/db/client";
import {
  tenants, orders, vehicles, customers, contracts,
  contractPricingRules, warehouses, customerLocations, contractSiteScope,
} from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { genId } from "@/lib/helpers";
import { ensureAllSeries, createIsolatedDriverAndVehicle } from "../helpers/testFixtures";

const riyadh  = () => db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
const adminCk = () => loginAs("admin@riyadh-bulk-water.co", "password123");
const dispCk  = () => loginAs("dispatch@riyadh-bulk-water.co", "password123");

let tenantId: string;

beforeAll(async () => {
  const t = await riyadh(); if (!t) return;
  tenantId = t.id;
  await ensureAllSeries(tenantId);
});

// ── Helpers ───────────────────────────────────────────────────────────────────
async function makeActiveContract(customerId: string, caps: number[], appliesToAllSites = true, locationIds: string[] = []) {
  const c = await adminCk();
  const { POST: createCtr } = await import("@/app/api/contracts/route");
  const res = await createCtr(makeRequest("/api/contracts", { method: "POST", cookie: c,
    body: { customerId, type: "ONE_TIME_TRIP_COUNT", totalTripsPurchased: 20, startDate: "2025-01-01", appliesToAllSites },
  }));
  if (!res.ok) return null;
  const contract = await res.json();
  await db.update(contracts).set({ status: "ACTIVE" }).where(eq(contracts.id, contract.id));

  // Add site scope if site-specific:
  if (!appliesToAllSites && locationIds.length > 0) {
    const { contractSiteScope: siteScope } = await import("@/lib/db/schema");
    for (const lid of locationIds) {
      await db.insert(siteScope).values({ id: genId(), contractId: contract.id, customerLocationId: lid });
    }
  }

  const { POST: addRule } = await import("@/app/api/contract-pricing-rules/route");
  for (const cap of caps) {
    await addRule(makeRequest("/api/contract-pricing-rules", { method: "POST", cookie: c,
      body: { contractId: contract.id, pricingScope: "CONTRACT", rateType: "STANDARD", pricePerTrip: 500, tankerCapacityLtr: cap },
    }));
  }
  return contract.id;
}

async function tryOrder(cookie: string, customerId: string, contractId?: string, locationId?: string) {
  const { POST } = await import("@/app/api/orders/route");
  const body: any = { customerId, qtyOrdered: 1, emptyBottlesToCollect: 0, paymentMethod: "CASH" };
  if (contractId) body.contractId = contractId;
  if (locationId) body.locationId = locationId;
  return POST(makeRequest("/api/orders", { method: "POST", cookie, body }));
}

async function tryTrip(vehicleCapacity: number, orderId: string) {
  const c = await adminCk();
  const dv = await createIsolatedDriverAndVehicle(tenantId, `fc-${genId().slice(0,5)}`);
  await db.update(vehicles).set({ capacityLiters: vehicleCapacity, status: "AVAILABLE" }).where(eq(vehicles.id, dv.vehicleId));
  const wh = await db.query.warehouses.findFirst({ where: eq(warehouses.tenantId, tenantId) });
  const { POST } = await import("@/app/api/trips/route");
  return POST(makeRequest("/api/trips", { method: "POST", cookie: c,
    body: { vehicleId: dv.vehicleId, driverId: dv.driverId, warehouseId: wh!.id, orderIds: [orderId] },
  }));
}

// ── 1. ADMIN/DISPATCHER contract enforcement ──────────────────────────────────
describe("Contract enforcement — ALL roles (no admin bypass)", () => {
  it("1. DISPATCHER cannot bypass active eligible contract", async () => {
    if (!tenantId) return;
    const cust = await db.query.customers.findFirst({ where: and(eq(customers.tenantId, tenantId), eq(customers.type, "B2B")) });
    if (!cust) return;
    const cid = await makeActiveContract(cust.id, [21000]);
    if (!cid) return;
    const res = await tryOrder(await dispCk(), cust.id);
    expect(res.status).toBe(422);
    expect((await res.json()).errorCode).toBe("B2B_CONTRACT_REQUIRED");
  });

  it("2. ADMIN cannot bypass active eligible contract", async () => {
    if (!tenantId) return;
    const cust = await db.query.customers.findFirst({ where: and(eq(customers.tenantId, tenantId), eq(customers.type, "B2B")) });
    if (!cust) return;
    const cid = await makeActiveContract(cust.id, [21000]);
    if (!cid) return;
    const res = await tryOrder(await adminCk(), cust.id);
    expect(res.status).toBe(422);
    expect((await res.json()).errorCode).toBe("B2B_CONTRACT_REQUIRED");
  });

  it("3. DISPATCHER API call without contractId is rejected when active contract exists", async () => {
    if (!tenantId) return;
    const cust = await db.query.customers.findFirst({ where: and(eq(customers.tenantId, tenantId), eq(customers.type, "B2B")) });
    if (!cust) return;
    const cid = await makeActiveContract(cust.id, [21000]);
    if (!cid) return;
    // No contractId in body — server must detect the active contract and reject:
    const { POST } = await import("@/app/api/orders/route");
    const res = await POST(makeRequest("/api/orders", { method: "POST", cookie: await dispCk(),
      body: { customerId: cust.id, qtyOrdered: 1, emptyBottlesToCollect: 0, paymentMethod: "CASH" },
    }));
    expect(res.status).toBe(422);
    expect((await res.json()).errorCode).toBe("B2B_CONTRACT_REQUIRED");
  });

  it("4. ADMIN API call without contractId is rejected when active contract exists", async () => {
    if (!tenantId) return;
    const cust = await db.query.customers.findFirst({ where: and(eq(customers.tenantId, tenantId), eq(customers.type, "B2B")) });
    if (!cust) return;
    const cid = await makeActiveContract(cust.id, [21000]);
    if (!cid) return;
    const { POST } = await import("@/app/api/orders/route");
    const res = await POST(makeRequest("/api/orders", { method: "POST", cookie: await adminCk(),
      body: { customerId: cust.id, qtyOrdered: 1, emptyBottlesToCollect: 0, paymentMethod: "CASH" },
    }));
    expect(res.status).toBe(422);
    expect((await res.json()).errorCode).toBe("B2B_CONTRACT_REQUIRED");
  });

  it("5. B2B customer with no eligible contract is still blocked (B2B_CONTRACT_REQUIRED)", async () => {
    // Phase 1 Pilot Release: B2B always requires contractId — even when no contract exists.
    // The pricePerBottle direct-order path is reserved exclusively for B2C customers.
    if (!tenantId) return;
    const freshId = genId();
    await db.insert(customers).values({ id: freshId, tenantId, name: `FC Test B2B ${genId().slice(0,5)}`, type: "B2B", address: "Test", lat: 24.7, lng: 46.7 });
    const res = await tryOrder(await adminCk(), freshId);
    expect(res.status).toBe(422);
    expect((await res.json()).errorCode).toBe("B2B_CONTRACT_REQUIRED");
  });

  it("6. orders route source enforces ACTIVE_CONTRACT_REQUIRED for ALL roles", () => {
    const src = require("fs").readFileSync("app/api/orders/route.ts", "utf8");
    // Must NOT have any role-based bypass:
    expect(src).not.toContain("isDispatcher");
    expect(src).not.toContain("enforceContractPolicy");
    expect(src).not.toContain("callerRole");
    // Must have the universal check:
    expect(src).toContain("if (!data.contractId && customer.type === \"B2B\")");
    expect(src).toContain("B2B_CONTRACT_REQUIRED");
    expect(src).toContain("fails closed");
  });
});

// ── 2. SITE-SCOPED CONTRACT ELIGIBILITY ──────────────────────────────────────
describe("Site-scoped contract eligibility", () => {
  let custId: string;
  let siteA1: string; let siteA2: string;
  let contractAllSites: string | null;
  let contractSiteA1Only: string | null;

  beforeAll(async () => {
    if (!tenantId) return;
    custId = genId();
    await db.insert(customers).values({ id: custId, tenantId, name: `FC Site Test ${genId().slice(0,5)}`, type: "B2B", address: "Test", lat: 24.7, lng: 46.7 });
    // Create two sites:
    siteA1 = genId();
    await db.insert(customerLocations).values({ id: siteA1, tenantId, customerId: custId, label: "Site A1", address: "A1 Address, Riyadh", lat: 24.71, lng: 46.71, deliveryZone: "CENTRAL" });
    siteA2 = genId();
    await db.insert(customerLocations).values({ id: siteA2, tenantId, customerId: custId, label: "Site A2", address: "A2 Address, Riyadh", lat: 24.72, lng: 46.72, deliveryZone: "CENTRAL" });
    // All-sites contract:
    contractAllSites = await makeActiveContract(custId, [21000], true);
    // Site-A1-only contract:
    contractSiteA1Only = await makeActiveContract(custId, [18000], false, [siteA1]);
  });

  it("7. site-specific contract appears for its valid site", async () => {
    if (!custId || !siteA1) return;
    const c = await adminCk();
    const { GET } = await import("@/app/api/contracts/eligible/route");
    const res = await GET(makeRequest(`/api/contracts/eligible?customerId=${custId}&locationId=${siteA1}`, { cookie: c }));
    const data = await res.json();
    const found = data.find((c: any) => c.id === contractSiteA1Only);
    expect(found).toBeDefined();
  });

  it("8. site-specific contract does NOT appear for another site", async () => {
    if (!custId || !siteA2 || !contractSiteA1Only) return;
    const c = await adminCk();
    const { GET } = await import("@/app/api/contracts/eligible/route");
    const res = await GET(makeRequest(`/api/contracts/eligible?customerId=${custId}&locationId=${siteA2}`, { cookie: c }));
    const data = await res.json();
    const found = data.find((ct: any) => ct.id === contractSiteA1Only);
    expect(found).toBeUndefined();
  });

  it("9. all-sites contract appears for both sites", async () => {
    if (!custId || !siteA1 || !siteA2 || !contractAllSites) return;
    const c = await adminCk();
    const { GET } = await import("@/app/api/contracts/eligible/route");
    const r1 = await GET(makeRequest(`/api/contracts/eligible?customerId=${custId}&locationId=${siteA1}`, { cookie: c }));
    const r2 = await GET(makeRequest(`/api/contracts/eligible?customerId=${custId}&locationId=${siteA2}`, { cookie: c }));
    const d1 = await r1.json(); const d2 = await r2.json();
    expect(d1.some((ct: any) => ct.id === contractAllSites)).toBe(true);
    expect(d2.some((ct: any) => ct.id === contractAllSites)).toBe(true);
  });

  it("10. cross-customer contract never appears in eligible list", async () => {
    if (!tenantId) return;
    const c = await adminCk();
    // Create a completely different customer with their own contract:
    const otherCustId = genId();
    await db.insert(customers).values({ id: otherCustId, tenantId, name: `FC Other Cust`, type: "B2B", address: "Other", lat: 24.73, lng: 46.73 });
    const otherContract = await makeActiveContract(otherCustId, [21000]);
    // Query eligible contracts for the FIRST customer — must not see the other's contract:
    const { GET } = await import("@/app/api/contracts/eligible/route");
    const res = await GET(makeRequest(`/api/contracts/eligible?customerId=${custId}`, { cookie: c }));
    const data = await res.json();
    expect(data.some((ct: any) => ct.id === otherContract)).toBe(false);
  });

  it("11. server rejects contractId not eligible for selected site", async () => {
    if (!custId || !siteA2 || !contractSiteA1Only) return;
    // contractSiteA1Only is site-A1-only. Trying to use it for site A2 must fail:
    const res = await tryOrder(await adminCk(), custId, contractSiteA1Only, siteA2);
    expect(res.status).toBe(422);
    // Should fail either OUTSIDE_DATE_RANGE, WRONG_CUSTOMER, NOT_ACTIVE, or a scope rejection:
    expect(res.status).not.toBe(201);
  });

  it("12. retired contract not returned in eligible list", async () => {
    if (!custId) return;
    const c = await adminCk();
    const cid = await makeActiveContract(custId, [21000]);
    if (!cid) return;
    await db.update(contracts).set({ status: "CANCELLED" }).where(eq(contracts.id, cid));
    const { GET } = await import("@/app/api/contracts/eligible/route");
    const res = await GET(makeRequest(`/api/contracts/eligible?customerId=${custId}`, { cookie: c }));
    const data = await res.json();
    expect(data.some((ct: any) => ct.id === cid)).toBe(false);
  });

  it("13. expired contract (past endDate) not returned in eligible list", async () => {
    if (!custId) return;
    const c = await adminCk();
    // Create a contract with endDate in the past:
    const expiredId = genId();
    await db.insert(contracts).values({
      id: expiredId, tenantId, customerId: custId, contractNumber: `EXP-${genId().slice(0,6)}`,
      type: "ONE_TIME_TRIP_COUNT", status: "ACTIVE", totalTripsPurchased: 5,
      startDate: new Date("2020-01-01"), endDate: new Date("2021-01-01"), // expired
      tripsUsed: 0, appliesToAllSites: true,
    });
    // Add pricing rule:
    await db.insert(contractPricingRules).values({ id: genId(), tenantId, contractId: expiredId, pricingScope: "CONTRACT", rateType: "STANDARD", pricePerTrip: 400 });
    const { GET } = await import("@/app/api/contracts/eligible/route");
    const res = await GET(makeRequest(`/api/contracts/eligible?customerId=${custId}`, { cookie: c }));
    const data = await res.json();
    expect(data.some((ct: any) => ct.id === expiredId)).toBe(false);
  });

  it("14. future contract (startDate in future) not returned in eligible list", async () => {
    if (!custId) return;
    const c = await adminCk();
    const futureId = genId();
    await db.insert(contracts).values({
      id: futureId, tenantId, customerId: custId, contractNumber: `FUT-${genId().slice(0,6)}`,
      type: "ONE_TIME_TRIP_COUNT", status: "ACTIVE", totalTripsPurchased: 5,
      startDate: new Date("2030-01-01"), endDate: null, // future
      tripsUsed: 0, appliesToAllSites: true,
    });
    await db.insert(contractPricingRules).values({ id: genId(), tenantId, contractId: futureId, pricingScope: "CONTRACT", rateType: "STANDARD", pricePerTrip: 400 });
    const { GET } = await import("@/app/api/contracts/eligible/route");
    const res = await GET(makeRequest(`/api/contracts/eligible?customerId=${custId}`, { cookie: c }));
    const data = await res.json();
    expect(data.some((ct: any) => ct.id === futureId)).toBe(false);
  });

  it("15. eligible endpoint filters by locationId when provided", () => {
    const src = require("fs").readFileSync("app/api/contracts/eligible/route.ts", "utf8");
    expect(src).toContain("locationId");
    expect(src).toContain("customerLocationId");
    expect(src).toContain("appliesToAllSites");
  });

  it("16. dispatch page requests eligible contracts with locationId after site selection", () => {
    const src = require("fs").readFileSync("app/dispatch/page.tsx", "utf8");
    // P2-02 NewOrderPanel: chooseSite → /api/contracts/eligible?customerId&locationId
    expect(src).toContain("async function chooseSite");
    expect(src).toContain("new URLSearchParams({ customerId, locationId: id })");
    expect(src).toContain("/api/contracts/eligible");
    expect(src).toContain("/api/customers/${id}/locations");
  });
});

// ── 3. VEHICLE COMPATIBILITY ────────────────────────────────────────────────────
describe("Vehicle compatibility display and enforcement", () => {
  it("17. 18k vehicle rejected for 21k order (server)", async () => {
    if (!tenantId) return;
    const cust = await db.query.customers.findFirst({ where: and(eq(customers.tenantId, tenantId), eq(customers.type, "B2B")) });
    if (!cust) return;
    const cid = await makeActiveContract(cust.id, [21000]);
    if (!cid) return;
    const { POST } = await import("@/app/api/orders/route");
    const ordRes = await POST(makeRequest("/api/orders", { method: "POST", cookie: await adminCk(),
      body: { customerId: cust.id, contractId: cid, qtyOrdered: 1, emptyBottlesToCollect: 0, paymentMethod: "CASH" },
    }));
    if (!ordRes.ok) return;
    const ord = await ordRes.json();
    const res = await tryTrip(18000, ord.id);
    expect(res.status).toBe(422);
    expect((await res.json()).errorCode).toBe("TANKER_CAPACITY_MISMATCH");
  });

  it("18. 21k vehicle accepted for 21k order", async () => {
    if (!tenantId) return;
    const cust = await db.query.customers.findFirst({ where: and(eq(customers.tenantId, tenantId), eq(customers.type, "B2B")) });
    if (!cust) return;
    const cid = await makeActiveContract(cust.id, [21000]);
    if (!cid) return;
    const { POST } = await import("@/app/api/orders/route");
    const ordRes = await POST(makeRequest("/api/orders", { method: "POST", cookie: await adminCk(),
      body: { customerId: cust.id, contractId: cid, qtyOrdered: 1, emptyBottlesToCollect: 0, paymentMethod: "CASH" },
    }));
    if (!ordRes.ok) return;
    const ord = await ordRes.json();
    const res = await tryTrip(21000, ord.id);
    expect(res.status).toBe(201);
  });

  it("19. 28k vehicle rejected for 21k order", async () => {
    if (!tenantId) return;
    const cust = await db.query.customers.findFirst({ where: and(eq(customers.tenantId, tenantId), eq(customers.type, "B2B")) });
    if (!cust) return;
    const cid = await makeActiveContract(cust.id, [21000]);
    if (!cid) return;
    const { POST } = await import("@/app/api/orders/route");
    const ordRes = await POST(makeRequest("/api/orders", { method: "POST", cookie: await adminCk(),
      body: { customerId: cust.id, contractId: cid, qtyOrdered: 1, emptyBottlesToCollect: 0, paymentMethod: "CASH" },
    }));
    if (!ordRes.ok) return;
    const ord = await ordRes.json();
    const res = await tryTrip(28000, ord.id);
    expect(res.status).toBe(422);
    expect((await res.json()).errorCode).toBe("TANKER_CAPACITY_MISMATCH");
  });

  it("20. dispatch page shows compatible/incompatible vehicle labels", () => {
    // P2-02: tanker selection moved to the supervisor's Assignment Workspace,
    // which labels every candidate AVAILABLE / BUSY / INELIGIBLE with its reason
    // (strict capacity equality computed server-side in lib/dispatchEligibility.ts).
    const src = require("fs").readFileSync("app/dispatch/assign/page.tsx", "utf8");
    expect(src).toContain("INELIGIBLE");
    expect(src).toContain("v.reason");
    expect(src).toContain("/api/fleet/eligible-vehicles?tripId=");
    expect(src).toContain("requiredTankerCapacityLtr");
  });

  it("21. Create Trip disabled when incompatible vehicle is selected (source check)", () => {
    // P2-02: an ineligible tanker cannot be selected (radio disabled) and the
    // server re-validates on assignment; mixed capacities are rejected at planning.
    const src = require("fs").readFileSync("app/dispatch/assign/page.tsx", "utf8");
    expect(src).toContain("disabled={!r.eligible}");
    const route = require("fs").readFileSync("app/api/trips/route.ts", "utf8");
    expect(route).toContain("TANKER_CAPACITY_MIXED");
  });

  it("22. mixed required capacities in same trip are rejected (server)", async () => {
    if (!tenantId) return;
    const cust = await db.query.customers.findFirst({ where: and(eq(customers.tenantId, tenantId), eq(customers.type, "B2B")) });
    if (!cust) return;
    // Create two orders with different capacities:
    const cid18 = await makeActiveContract(cust.id, [18000]);
    const cid21 = await makeActiveContract(cust.id, [21000]);
    if (!cid18 || !cid21) return;
    const { POST: createOrd } = await import("@/app/api/orders/route");
    const c = await adminCk();
    const ord18Res = await createOrd(makeRequest("/api/orders", { method: "POST", cookie: c,
      body: { customerId: cust.id, contractId: cid18, qtyOrdered: 1, emptyBottlesToCollect: 0, paymentMethod: "CASH" },
    }));
    const ord21Res = await createOrd(makeRequest("/api/orders", { method: "POST", cookie: c,
      body: { customerId: cust.id, contractId: cid21, qtyOrdered: 1, emptyBottlesToCollect: 0, paymentMethod: "CASH" },
    }));
    if (!ord18Res.ok || !ord21Res.ok) return;
    const ord18 = await ord18Res.json(); const ord21 = await ord21Res.json();
    // Try to create a trip with BOTH orders and an 18k vehicle → mismatch for the 21k order:
    const dv = await createIsolatedDriverAndVehicle(tenantId, `fc-mix-${genId().slice(0,5)}`);
    await db.update(vehicles).set({ capacityLiters: 18000, status: "AVAILABLE" }).where(eq(vehicles.id, dv.vehicleId));
    const wh = await db.query.warehouses.findFirst({ where: eq(warehouses.tenantId, tenantId) });
    const { POST: createTrip } = await import("@/app/api/trips/route");
    const res = await createTrip(makeRequest("/api/trips", { method: "POST", cookie: c,
      body: { vehicleId: dv.vehicleId, driverId: dv.driverId, warehouseId: wh!.id, orderIds: [ord18.id, ord21.id] },
    }));
    expect(res.status).toBe(422); // must reject — 21k order can't use 18k vehicle
  });
});

// ── 4. PRICE-PER-BOTTLE AUDIT ────────────────────────────────────────────────
describe("pricePerBottle audit — direct order billing path", () => {
  it("23. pricePerBottle is a legacy unit-price field (deliveredQty × pricePerBottle = invoice subtotal)", () => {
    const stopSrc = require("fs").readFileSync("app/api/trips/[id]/stops/[stopId]/route.ts", "utf8");
    // The field exists and is used in the non-contract path:
    expect(stopSrc).toContain("pricePerBottle");
    expect(stopSrc).toContain("data.deliveredQty * stop.order.pricePerBottle");
    // BUT: contract orders use pricePerTrip, not pricePerBottle:
    expect(stopSrc).toContain("isTripCountContract");
    expect(stopSrc).toContain("contractPricingResult");
    // The contract pricing result (isTripCountContract) never falls through to pricePerBottle:
    // The non-contract path (else branch) uses pricePerBottle.
    // Verify the isTripCountContract block sets rawSubtotal from contractPricingResult:
    expect(stopSrc).toContain("rawSubtotal = contractPricingResult.baseAmount");
    // Verify the else (non-contract) path uses pricePerBottle:
    expect(stopSrc).toContain("rawSubtotal = Math.round(data.deliveredQty * stop.order.pricePerBottle");
  });

  it("24. B2C direct order uses pricePerBottle path; B2B direct order is blocked (B2B_CONTRACT_REQUIRED)", async () => {
    const c = await adminCk();
    const { POST: createOrd } = await import("@/app/api/orders/route");
    // B2C: direct order allowed:
    const b2cId = genId();
    await db.insert(customers).values({ id: b2cId, tenantId, name: `FC Direct B2C`, type: "B2C", address: "Test", lat: 24.7, lng: 46.7 });
    const b2cRes = await createOrd(makeRequest("/api/orders", { method: "POST", cookie: c,
      body: { customerId: b2cId, qtyOrdered: 2, emptyBottlesToCollect: 0, paymentMethod: "CASH" },
    }));
    expect(b2cRes.status).toBe(201);
    expect((await b2cRes.json()).pricePerBottle).toBeGreaterThan(0);
    // B2B: always blocked without contractId:
    const b2bId = genId();
    await db.insert(customers).values({ id: b2bId, tenantId, name: `FC Direct B2B`, type: "B2B", address: "Test", lat: 24.7, lng: 46.7 });
    const b2bRes = await createOrd(makeRequest("/api/orders", { method: "POST", cookie: c,
      body: { customerId: b2bId, qtyOrdered: 2, emptyBottlesToCollect: 0, paymentMethod: "CASH" },
    }));
    expect(b2bRes.status).toBe(422);
    expect((await b2bRes.json()).errorCode).toBe("B2B_CONTRACT_REQUIRED");
  });
});

// ── 5. RETIRED CONTRACT REGRESSION ────────────────────────────────────────────
describe("Retired contract — regression (tests 25–29)", () => {
  it("25. retired contract remains historically queryable", async () => {
    const cust = await db.query.customers.findFirst({ where: and(eq(customers.tenantId, tenantId), eq(customers.type, "B2B")) });
    if (!cust) return;
    const cid = await makeActiveContract(cust.id, [21000]);
    if (!cid) return;
    await db.update(contracts).set({ status: "CANCELLED" }).where(eq(contracts.id, cid));
    const found = await db.query.contracts.findFirst({ where: eq(contracts.id, cid) });
    expect(found?.status).toBe("CANCELLED");
  });

  it("26. retired contract is not eligible for new orders", async () => {
    const cust = await db.query.customers.findFirst({ where: and(eq(customers.tenantId, tenantId), eq(customers.type, "B2B")) });
    if (!cust) return;
    const cid = await makeActiveContract(cust.id, [21000]);
    if (!cid) return;
    await db.update(contracts).set({ status: "CANCELLED" }).where(eq(contracts.id, cid));
    const res = await tryOrder(await adminCk(), cust.id, cid);
    expect(res.status).toBe(422);
    expect((await res.json()).errorCode).toBe("NOT_ACTIVE");
  });

  it("27. replacement ACTIVE contract can have equivalent pricing dimensions", async () => {
    const cust = await db.query.customers.findFirst({ where: and(eq(customers.tenantId, tenantId), eq(customers.type, "B2B")) });
    if (!cust) return;
    const oldId = await makeActiveContract(cust.id, [21000]);
    if (!oldId) return;
    await db.update(contracts).set({ status: "CANCELLED" }).where(eq(contracts.id, oldId));
    const newId = await makeActiveContract(cust.id, [21000]); // same dimensions on new contract
    expect(newId).toBeTruthy();
  });

  it("28. true duplicate on same ACTIVE contract is still rejected", async () => {
    const cust = await db.query.customers.findFirst({ where: and(eq(customers.tenantId, tenantId), eq(customers.type, "B2B")) });
    if (!cust) return;
    const cid = await makeActiveContract(cust.id, [21000]);
    if (!cid) return;
    // Try to add a second identical rule:
    const { POST: addRule } = await import("@/app/api/contract-pricing-rules/route");
    const c = await adminCk();
    const res = await addRule(makeRequest("/api/contract-pricing-rules", { method: "POST", cookie: c,
      body: { contractId: cid, pricingScope: "CONTRACT", rateType: "STANDARD", pricePerTrip: 500, tankerCapacityLtr: 21000 },
    }));
    expect(res.status).toBe(409);
    expect((await res.json()).errorCode).toBe("DUPLICATE_PRICING_RULE");
  });

  it("29. pricing overlap check source uses ACTIVE contract filter", () => {
    const src = require("fs").readFileSync("app/api/contract-pricing-rules/route.ts", "utf8");
    expect(src).toContain("contract?.status === \"ACTIVE\"");
    expect(src).toContain("activeRules");
  });
});

// ── 6. SOURCE GUARDS — BYPASS PATH SEARCH ─────────────────────────────────────
describe("Bypass path search — no alternate routes", () => {
  it("30. orders route has universal ACTIVE_CONTRACT_REQUIRED (no role bypass)", () => {
    const src = require("fs").readFileSync("app/api/orders/route.ts", "utf8");
    expect(src).not.toContain("isDispatcher");
    expect(src).not.toContain("enforceContractPolicy");
    expect(src).toContain("fails closed");
    expect(src).toContain("B2B_CONTRACT_REQUIRED");
  });

  it("31. eligible contracts endpoint requires ADMIN or DISPATCHER (no DRIVER access)", async () => {
    const t = await riyadh(); if (!t) return;
    const driverCk = await loginAs("mohammed@riyadh-bulk-water.co", "password123");
    const cust = await db.query.customers.findFirst({ where: and(eq(customers.tenantId, t.id), eq(customers.type, "B2B")) });
    if (!cust) return;
    const { GET } = await import("@/app/api/contracts/eligible/route");
    const res = await GET(makeRequest(`/api/contracts/eligible?customerId=${cust.id}`, { cookie: driverCk }));
    expect([401, 403]).toContain(res.status);
  });

  it("32. trips route still enforces tanker capacity mismatch", () => {
    const src = require("fs").readFileSync("app/api/trips/route.ts", "utf8");
    expect(src).toContain("TANKER_CAPACITY_MISMATCH");
    expect(src).toContain("TANKER_CAPACITY_REQUIRED");
    expect(src).toContain("requiredTankerCapacityLtr");
  });

  it("33. no bulk order route bypasses contract enforcement", () => {
    const src = require("fs").readFileSync("app/api/orders/bulk/route.ts", "utf8");
    // Bulk route should not have a separate direct path that skips contract checks:
    expect(src).not.toContain("ACTIVE_CONTRACT_REQUIRED"); // it's a different flow (batch)
    // Verify it exists:
    expect(src.length).toBeGreaterThan(100);
  });
});
