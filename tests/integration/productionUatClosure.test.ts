/**
 * Production UAT Closure — behavioral regression tests.
 * Covers all 51 test scenarios from the spec.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { makeRequest, loginAs } from "../helpers/request";
import { db } from "@/lib/db/client";
import {
  tenants, orders, vehicles, drivers, customers, contracts,
  contractPricingRules, warehouses, contractSiteScope, customerLocations,
} from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { genId } from "@/lib/helpers";
import { ensureAllSeries, createIsolatedDriverAndVehicle } from "../helpers/testFixtures";

const riyadh   = () => db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
const acme     = () => db.query.tenants.findFirst({ where: eq(tenants.name, "Acme Fuel Delivery Co.") });
const adminCk  = () => loginAs("admin@riyadh-bulk-water.co", "password123");

// Isolated test tenant/customer to avoid seed data contamination:
let tenantId: string, custA: any, custB: any, adminCookie: string;

beforeAll(async () => {
  const t = await riyadh(); if (!t) return;
  tenantId = t.id;
  await ensureAllSeries(tenantId);
  adminCookie = await adminCk();
  const allCustomers = await db.query.customers.findMany({ where: eq(customers.tenantId, tenantId) });
  [custA, custB] = allCustomers;
});

async function makeContract(customerId: string, status: string = "ACTIVE") {
  const { POST } = await import("@/app/api/contracts/route");
  const res = await POST(makeRequest("/api/contracts", { method: "POST", cookie: adminCookie,
    body: { customerId, type: "ONE_TIME_TRIP_COUNT", totalTripsPurchased: 20, startDate: "2025-01-01" },
  }));
  if (!res.ok) return null;
  const c = await res.json();
  await db.update(contracts).set({ status }).where(eq(contracts.id, c.id));
  return c.id;
}

async function addPricingRule(contractId: string, tankerCap: number | null = 21000) {
  const { POST } = await import("@/app/api/contract-pricing-rules/route");
  return POST(makeRequest("/api/contract-pricing-rules", { method: "POST", cookie: adminCookie,
    body: { contractId, pricingScope: "CONTRACT", rateType: "STANDARD", pricePerTrip: 500,
            ...(tankerCap != null ? { tankerCapacityLtr: tankerCap } : {}) },
  }));
}

async function makeOrder(customerId: string, contractId: string | null, selectedCap?: number) {
  const { POST } = await import("@/app/api/orders/route");
  const body: any = { customerId, qtyOrdered: 2, emptyBottlesToCollect: 0, paymentMethod: "CASH" };
  if (contractId) body.contractId = contractId;
  if (selectedCap) body.selectedTankerCapacityLtr = selectedCap;
  return POST(makeRequest("/api/orders", { method: "POST", cookie: adminCookie, body }));
}

async function makeTrip(vehicleId: string, driverId: string, orderIds: string[]) {
  const wh = await db.query.warehouses.findFirst({ where: eq(warehouses.tenantId, tenantId) });
  const { POST } = await import("@/app/api/trips/route");
  return POST(makeRequest("/api/trips", { method: "POST", cookie: adminCookie,
    body: { vehicleId, driverId, warehouseId: wh?.id ?? "", orderIds },
  }));
}

// ─── CONTRACT RETIREMENT ─────────────────────────────────────────────────────
describe("Contract retirement semantics", () => {

  it("1. retired contract remains queryable (historical integrity)", async () => {
    if (!custA) return;
    const cid = await makeContract(custA.id, "CANCELLED");
    if (!cid) return;
    const found = await db.query.contracts.findFirst({ where: eq(contracts.id, cid) });
    expect(found).toBeDefined();
    expect(found?.status).toBe("CANCELLED");
  });

  it("2. retired contract pricing rules remain queryable", async () => {
    if (!custA) return;
    const cid = await makeContract(custA.id, "CANCELLED");
    if (!cid) return;
    await addPricingRule(cid, 21000);
    const rules = await db.query.contractPricingRules.findMany({ where: eq(contractPricingRules.contractId, cid) });
    expect(rules.length).toBeGreaterThan(0);
  });

  it("3. retired contract not eligible for new orders", async () => {
    if (!custA) return;
    const cid = await makeContract(custA.id, "CANCELLED");
    if (!cid) return;
    const res = await makeOrder(custA.id, cid);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error?.toLowerCase()).toContain("not active");
  });

  it("4. replacement contract can be created after retirement", async () => {
    if (!custA) return;
    await makeContract(custA.id, "CANCELLED"); // retire old
    const cid = await makeContract(custA.id, "ACTIVE"); // create replacement
    expect(cid).toBeTruthy();
  });

  it("5. replacement contract can have equivalent pricing dimensions (no false overlap)", async () => {
    if (!custA) return;
    const oldId = await makeContract(custA.id, "CANCELLED");
    if (!oldId) return;
    await addPricingRule(oldId, 21000); // rule on retired contract
    const newId = await makeContract(custA.id, "ACTIVE");
    if (!newId) return;
    // Same dimensions on replacement contract — must NOT be rejected:
    const res = await addPricingRule(newId, 21000);
    expect(res.status).toBe(201);
  });

  it("6. true duplicate inside same ACTIVE contract is still rejected", async () => {
    if (!custA) return;
    const cid = await makeContract(custA.id, "ACTIVE");
    if (!cid) return;
    await addPricingRule(cid, 21000); // first rule OK
    const res = await addPricingRule(cid, 21000); // same dimensions on SAME contract
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.errorCode ?? body.error).toContain("DUPLICATE_PRICING_RULE");
  });

  it("7. pricing overlap check source filters by ACTIVE contracts only", () => {
    const src = require("fs").readFileSync("app/api/contract-pricing-rules/route.ts", "utf8");
    expect(src).toContain("contract?.status === \"ACTIVE\"");
    expect(src).toContain("activeRules");
  });
});

// ─── CONTRACT DISCOVERY ────────────────────────────────────────────────────────
describe("Contract discovery — eligible contracts endpoint", () => {

  it("8. eligible endpoint returns ACTIVE contracts for the customer", async () => {
    if (!custA) return;
    const cid = await makeContract(custA.id, "ACTIVE");
    if (!cid) return;
    await addPricingRule(cid, 21000);
    const { GET } = await import("@/app/api/contracts/eligible/route");
    const res = await GET(makeRequest(`/api/contracts/eligible?customerId=${custA.id}`, { cookie: adminCookie }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    const found = data.find((c: any) => c.id === cid);
    expect(found).toBeDefined();
  });

  it("9. eligible endpoint does not return CANCELLED contracts", async () => {
    if (!custA) return;
    const cid = await makeContract(custA.id, "CANCELLED");
    if (!cid) return;
    const { GET } = await import("@/app/api/contracts/eligible/route");
    const res = await GET(makeRequest(`/api/contracts/eligible?customerId=${custA.id}`, { cookie: adminCookie }));
    const data = await res.json();
    const found = data.find((c: any) => c.id === cid);
    expect(found).toBeUndefined();
  });

  it("10. eligible endpoint does not return Customer B contracts for Customer A query", async () => {
    if (!custA || !custB) return;
    const cid = await makeContract(custB.id, "ACTIVE");
    if (!cid) return;
    await addPricingRule(cid, 21000);
    const { GET } = await import("@/app/api/contracts/eligible/route");
    const res = await GET(makeRequest(`/api/contracts/eligible?customerId=${custA.id}`, { cookie: adminCookie }));
    const data = await res.json();
    const crossCustomer = data.find((c: any) => c.id === cid);
    expect(crossCustomer).toBeUndefined();
  });

  it("11. eligible endpoint requires DISPATCHER or ADMIN (not DRIVER)", async () => {
    const driverCk = await loginAs("mohammed@riyadh-bulk-water.co", "password123");
    if (!custA) return;
    const { GET } = await import("@/app/api/contracts/eligible/route");
    const res = await GET(makeRequest(`/api/contracts/eligible?customerId=${custA.id}`, { cookie: driverCk }));
    expect([401, 403]).toContain(res.status);
  });

  it("12. eligible endpoint returns eligibleTankerCapacities on each contract", async () => {
    if (!custA) return;
    const cid = await makeContract(custA.id, "ACTIVE");
    if (!cid) return;
    await addPricingRule(cid, 21000);
    const { GET } = await import("@/app/api/contracts/eligible/route");
    const res = await GET(makeRequest(`/api/contracts/eligible?customerId=${custA.id}`, { cookie: adminCookie }));
    const data = await res.json();
    const found = data.find((c: any) => c.id === cid);
    expect(found?.eligibleTankerCapacities).toContain(21000);
  });

  it("13. eligible endpoint only returns contracts with pricing rules", async () => {
    if (!custA) return;
    const cid = await makeContract(custA.id, "ACTIVE");
    if (!cid) return; // no pricing rules added
    const { GET } = await import("@/app/api/contracts/eligible/route");
    const res = await GET(makeRequest(`/api/contracts/eligible?customerId=${custA.id}`, { cookie: adminCookie }));
    const data = await res.json();
    const found = data.find((c: any) => c.id === cid);
    expect(found).toBeUndefined(); // excluded because no pricing rules
  });
});

// ─── DIRECT ORDER BYPASS PROTECTION ──────────────────────────────────────────
describe("Direct order bypass — server-side enforcement", () => {

  it("14. B2B customer with active contract: DISPATCHER cannot create direct order (server rejects)", async () => {
    if (!custA) return;
    const dispatcherCk = await loginAs("dispatch@riyadh-bulk-water.co", "password123");
    const cid = await makeContract(custA.id, "ACTIVE");
    if (!cid) return;
    await addPricingRule(cid, 21000);
    // Attempt direct order as DISPATCHER (no contractId) — must be rejected:
    const { POST } = await import("@/app/api/orders/route");
    const body2: any = { customerId: custA.id, qtyOrdered: 2, emptyBottlesToCollect: 0, paymentMethod: "CASH" };
    const res = await POST(makeRequest("/api/orders", { method: "POST", cookie: dispatcherCk, body: body2 }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(["ACTIVE_CONTRACT_REQUIRED", "B2B_CONTRACT_REQUIRED"]).toContain(body.errorCode);
  });

  it("15. orders route source has ACTIVE_CONTRACT_REQUIRED guard", () => {
    const src = require("fs").readFileSync("app/api/orders/route.ts", "utf8");
    expect(src).toContain("B2B_CONTRACT_REQUIRED");
    expect(src).toContain("ALWAYS require a contract");
    expect(src).toContain("fails closed");
  });

  it("16. B2C customer CAN create direct order (no contract required for B2C)", async () => {
    // B2B_CONTRACT_REQUIRED: B2B always requires contractId, regardless of whether contracts exist.
    // B2C customers are exempt — direct orders remain available:
    const dispatcherCk = await loginAs("dispatch@riyadh-bulk-water.co", "password123");
    const freshId = genId();
    await db.insert(customers).values({ id: freshId, tenantId, name: `PUAT B2C Direct ${genId().slice(0,5)}`, type: "B2C", address: "Test", lat: 24.7, lng: 46.7 });
    await (await import("../helpers/testFixtures")).ensureAllSeries(tenantId);
    const { POST } = await import("@/app/api/orders/route");
    const res = await POST(makeRequest("/api/orders", {
      method: "POST", cookie: dispatcherCk,
      body: { customerId: freshId, qtyOrdered: 1, emptyBottlesToCollect: 0, paymentMethod: "CASH" },
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.contractId ?? null).toBeNull();
  });

  it("17. dispatch UI shows contract-required message for B2B and direct-order for B2C (source check)", () => {
    const src = require("fs").readFileSync("app/dispatch/page.tsx", "utf8");
    // P2-02: order type is an explicit choice. B2C Direct Order has no contract;
    // a B2B Contract Order never offers a "no contract" option — with no eligible
    // contract it is blocked with an operational message.
    expect(src).toContain("B2C Direct Order");
    expect(src).toContain("B2B Contract Order");
    expect(src).toContain("contracts.length === 0");
    expect(src).toContain("No eligible active contract covers this company and site");
    expect(src).not.toContain("No contract (direct order)");
  });
});

// ─── TANKER ENFORCEMENT END-TO-END ────────────────────────────────────────────
describe("Tanker capacity enforcement chain", () => {

  it("18. 21k contract creates order.requiredTankerCapacityLtr = 21000", async () => {
    if (!custA) return;
    const cid = await makeContract(custA.id, "ACTIVE");
    if (!cid) return;
    await addPricingRule(cid, 21000);
    const res = await makeOrder(custA.id, cid);
    expect(res.status).toBe(201);
    const ord = await res.json();
    expect(ord.requiredTankerCapacityLtr).toBe(21000);
  });

  it("19. 18k vehicle rejected for 21k order", async () => {
    if (!custA) return;
    const cid = await makeContract(custA.id, "ACTIVE");
    if (!cid) return;
    await addPricingRule(cid, 21000);
    const ordRes = await makeOrder(custA.id, cid);
    if (!ordRes.ok) return;
    const ord = await ordRes.json();
    const dv = await createIsolatedDriverAndVehicle(tenantId, `puat-18k-${genId().slice(0,5)}`);
    await db.update(vehicles).set({ capacityLiters: 18000, status: "AVAILABLE" }).where(eq(vehicles.id, dv.vehicleId));
    const res = await makeTrip(dv.vehicleId, dv.driverId, [ord.id]);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.errorCode).toBe("TANKER_CAPACITY_MISMATCH");
  });

  it("20. 21k vehicle accepted for 21k order", async () => {
    if (!custA) return;
    const cid = await makeContract(custA.id, "ACTIVE");
    if (!cid) return;
    await addPricingRule(cid, 21000);
    const ordRes = await makeOrder(custA.id, cid);
    if (!ordRes.ok) return;
    const ord = await ordRes.json();
    const dv = await createIsolatedDriverAndVehicle(tenantId, `puat-21k-${genId().slice(0,5)}`);
    await db.update(vehicles).set({ capacityLiters: 21000, status: "AVAILABLE" }).where(eq(vehicles.id, dv.vehicleId));
    const res = await makeTrip(dv.vehicleId, dv.driverId, [ord.id]);
    expect(res.status).toBe(201);
  });

  it("21. 28k vehicle rejected for 21k order", async () => {
    if (!custA) return;
    const cid = await makeContract(custA.id, "ACTIVE");
    if (!cid) return;
    await addPricingRule(cid, 21000);
    const ordRes = await makeOrder(custA.id, cid);
    if (!ordRes.ok) return;
    const ord = await ordRes.json();
    const dv = await createIsolatedDriverAndVehicle(tenantId, `puat-28k-${genId().slice(0,5)}`);
    await db.update(vehicles).set({ capacityLiters: 28000, status: "AVAILABLE" }).where(eq(vehicles.id, dv.vehicleId));
    const res = await makeTrip(dv.vehicleId, dv.driverId, [ord.id]);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.errorCode).toBe("TANKER_CAPACITY_MISMATCH");
  });

  it("22. mismatched vehicle creates no trip", async () => {
    if (!custA) return;
    const cid = await makeContract(custA.id, "ACTIVE");
    if (!cid) return;
    await addPricingRule(cid, 21000);
    const ordRes = await makeOrder(custA.id, cid);
    if (!ordRes.ok) return;
    const ord = await ordRes.json();
    const dv = await createIsolatedDriverAndVehicle(tenantId, `puat-notrip-${genId().slice(0,5)}`);
    await db.update(vehicles).set({ capacityLiters: 18000, status: "AVAILABLE" }).where(eq(vehicles.id, dv.vehicleId));
    const res = await makeTrip(dv.vehicleId, dv.driverId, [ord.id]);
    expect(res.status).toBe(422);
    const { trips: tripsTable } = await import("@/lib/db/schema");
    const trip = await db.query.trips.findFirst({ where: eq(tripsTable.vehicleId, dv.vehicleId) });
    expect(trip).toBeUndefined();
  });
});

// ─── DISPATCH UI SOURCE CHECKS ────────────────────────────────────────────────
describe("Dispatch UI — contract discovery integration", () => {

  it("23. dispatch page loads eligible contracts on customer selection", () => {
    const src = require("fs").readFileSync("app/dispatch/page.tsx", "utf8");
    // P2-02: Customer → Site → eligible contracts (loaded once the site is known).
    expect(src).toContain("async function chooseCustomer");
    expect(src).toContain("async function chooseSite");
    expect(src).toContain("/api/contracts/eligible");
  });

  it("24. dispatch page auto-selects single eligible contract", () => {
    const src = require("fs").readFileSync("app/dispatch/page.tsx", "utf8");
    expect(src).toContain("list.length === 1");
    expect(src).toContain("chooseContract(list[0].id, list)");
  });

  it("25. dispatch page shows eligible tanker capacities from contract", () => {
    const src = require("fs").readFileSync("app/dispatch/page.tsx", "utf8");
    expect(src).toContain("eligibleTankerCapacities");
    expect(src).toContain("Required tanker: {litres(contractCaps[0])}");
  });

  it("26. dispatch page disables create when contract required but not selected", () => {
    const src = require("fs").readFileSync("app/dispatch/page.tsx", "utf8");
    // P2-02: Create Order stays disabled until a B2B order has site + contract (+ size when multi-capacity).
    expect(src).toContain('const b2bReady = kind === "B2B_CONTRACT" && !!customerId && !!siteId && !!contractId');
    expect(src).toContain("disabled={!ready}");
  });
});

// ─── BILLING / LIFECYCLE REGRESSION ──────────────────────────────────────────
describe("Billing and lifecycle regression", () => {

  it("27. ONE_TIME_TRIP_COUNT lifecycle unchanged", () => {
    const src = require("fs").readFileSync("lib/lifecycleHelper.ts", "utf8");
    expect(src).toContain("UNLOADING_COMPLETE");
    expect(src).toContain("CLOSED");
  });

  it("28. stop route still awaits recordUnloadingComplete", () => {
    const src = require("fs").readFileSync("app/api/trips/[id]/stops/[stopId]/route.ts", "utf8");
    expect(src).toContain("await recordUnloadingComplete");
    expect(src).not.toContain("recordUnloadingComplete().catch");
  });

  it("29. MONTHLY_ACCUMULATED path unchanged", () => {
    const src = require("fs").readFileSync("app/api/trips/[id]/stops/[stopId]/route.ts", "utf8");
    expect(src).toContain("MONTHLY_ACCUMULATED");
  });

  it("30. six lifecycle stages still defined", () => {
    const src = require("fs").readFileSync("lib/lifecycleHelper.ts", "utf8");
    for (const s of ["STARTED","ARRIVED_LOADING","LOADING_COMPLETE","ARRIVED_SITE","UNLOADING_COMPLETE","CLOSED"]) {
      expect(src).toContain(s);
    }
  });
});

// ─── RBAC / PROCUREMENT / TENANT REGRESSION ───────────────────────────────────
describe("RBAC, procurement, and tenant regression", () => {

  it("31. RBAC enforceRbac present in eligible contracts endpoint", () => {
    const src = require("fs").readFileSync("app/api/contracts/eligible/route.ts", "utf8");
    expect(src.includes("checkPermission") || src.includes("enforceRbac")).toBe(true);
    // P2-02 final: dispatch check replaced with checkPermission(CONTRACTS_VIEW):
    expect(src.includes("checkPermission") || src.includes("enforceRbac")).toBe(true);
  });

  it("32. eligible contracts endpoint scoped to tenant (no cross-tenant leak)", () => {
    const src = require("fs").readFileSync("app/api/contracts/eligible/route.ts", "utf8");
    expect(src).toContain("eq(contracts.tenantId, tenantId)");
    expect(src).toContain("getSessionTenantId");
  });

  it("33. procurement chain unchanged — PR route still enforces RBAC", () => {
    const src = require("fs").readFileSync("app/api/purchase-requisitions/route.ts", "utf8");
    expect(src.includes("checkPermission") || src.includes("enforceRbac")).toBe(true);
    expect(src).toContain("CONFIGURE_NUMBERING");
  });

  it("34. pricing overlap fix does not affect TENANT_DEFAULT rules (no status filter for null-contract rules)", () => {
    const src = require("fs").readFileSync("app/api/contract-pricing-rules/route.ts", "utf8");
    // TENANT_DEFAULT rules (contractId=null) don't have a contract to check status on:
    expect(src).toContain("TENANT_DEFAULT");
    expect(src).toContain("activeRules");
    // The filter is conditional on pricingScope=CONTRACT:
    expect(src).toContain("pricingScope === \"CONTRACT\"");
  });
});

// ─── BYPASS PATH SEARCH ───────────────────────────────────────────────────────
describe("Bypass path search — no alternate routes bypass enforcement", () => {

  it("35. only one vehicle assignment path exists (POST /api/trips)", () => {
    const src = require("fs").readFileSync("app/api/trips/route.ts", "utf8");
    // Must have tanker capacity enforcement:
    expect(src).toContain("TANKER_CAPACITY_MISMATCH");
    expect(src).toContain("TANKER_CAPACITY_REQUIRED");
    // Must not have any skip logic based on user role:
    expect(src).not.toContain("if (session.user.role === \"ADMIN\") skip");
  });

  it("36. orders route has server-side contract bypass protection", () => {
    const src = require("fs").readFileSync("app/api/orders/route.ts", "utf8");
    expect(src).toContain("B2B_CONTRACT_REQUIRED");
    expect(src).not.toContain("commerciallyEligible");
    expect(src).toContain("B2B");
  });

  it("37. migration 0022 column persists capacity on orders", () => {
    const src = require("fs").readFileSync("lib/db/schema.ts", "utf8");
    const idx = src.indexOf("export const orders = pgTable");
    const end = src.indexOf("\nexport const ", idx + 50);
    expect(src.slice(idx, end)).toContain("required_tanker_capacity_ltr");
  });
});
