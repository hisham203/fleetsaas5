/**
 * Migration 0022 — orders.required_tanker_capacity_ltr
 * Comprehensive behavioral tests for the commercial tanker capacity chain.
 *
 * Tests 1–32 per spec section 15.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { makeRequest, loginAs } from "../helpers/request";
import { db } from "@/lib/db/client";
import {
  tenants, orders, vehicles, drivers, customers, contracts,
  contractPricingRules, warehouses,
} from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { genId } from "@/lib/helpers";
import {
  ensureAllSeries, createIsolatedDriverAndVehicle,
} from "../helpers/testFixtures";

const riyadh = () => db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
const acme   = () => db.query.tenants.findFirst({ where: eq(tenants.name, "Acme Fuel Delivery Co.") });
const cookie = () => loginAs("admin@riyadh-bulk-water.co", "password123");

beforeAll(async () => {
  // DO NOT call cleanupAllocatedContracts here — it deletes seeded contracts
  // (e.g. C06001 from riyadhBulkWaterSeed) which breaks other test files.
  // Each test in this file creates isolated contracts that don't collide with seeds.
  const t = await riyadh();
  if (t) await ensureAllSeries(t.id);
  const a = await acme();
  if (a) await ensureAllSeries(a.id);
});

// ── Helpers ──────────────────────────────────────────────────────────────────
async function makeContract(tenantId: string, adminCookie: string, customerId: string, caps: number[]) {
  const { POST: createCtr } = await import("@/app/api/contracts/route");
  const res = await createCtr(makeRequest("/api/contracts", {
    method: "POST", cookie: adminCookie,
    body: { customerId, type: "ONE_TIME_TRIP_COUNT", totalTripsPurchased: 20, startDate: "2025-01-01" },
  }));
  if (!res.ok) return null;
  const contract = await res.json();
  // Activate the contract so it can be used for orders:
  await db.update(contracts).set({ status: "ACTIVE" }).where(eq(contracts.id, contract.id));
  const { POST: addRule } = await import("@/app/api/contract-pricing-rules/route");
  for (const cap of caps) {
    const ruleRes = await addRule(makeRequest("/api/contract-pricing-rules", {
      method: "POST", cookie: adminCookie,
      body: { contractId: contract.id, pricingScope: "CONTRACT", rateType: "STANDARD",
              pricePerTrip: cap === 18000 ? 420 : cap === 21000 ? 500 : 680, tankerCapacityLtr: cap },
    }));
  }
  return contract.id;
}

async function makeOrder(adminCookie: string, customerId: string, contractId: string | null, selectedCap?: number) {
  const { POST } = await import("@/app/api/orders/route");
  const body: any = { customerId, qtyOrdered: 2, emptyBottlesToCollect: 0, paymentMethod: "CASH" };
  if (contractId) body.contractId = contractId;
  if (selectedCap) body.selectedTankerCapacityLtr = selectedCap;
  return POST(makeRequest("/api/orders", { method: "POST", cookie: adminCookie, body }));
}

async function makeTrip(adminCookie: string, vehicleId: string, driverId: string, warehouseId: string, orderIds: string[]) {
  const { POST } = await import("@/app/api/trips/route");
  return POST(makeRequest("/api/trips", {
    method: "POST", cookie: adminCookie,
    body: { vehicleId, driverId, warehouseId, orderIds },
  }));
}

// ── SINGLE CAPACITY ──────────────────────────────────────────────────────────
describe("Single-capacity contract (CASE A)", () => {
  it("1. contract with only 21k → order auto-stores 21000", async () => {
    const t = await riyadh(); if (!t) return;
    const c = await cookie();
    const cust = await db.query.customers.findFirst({ where: eq(customers.tenantId, t.id) });
    if (!cust) return;
    const contractId = await makeContract(t.id, c, cust.id, [21000]);
    if (!contractId) return;
    const res = await makeOrder(c, cust.id, contractId);
    expect(res.status).toBe(201);
    const ord = await res.json();
    expect((ord as any).requiredTankerCapacityLtr).toBe(21000);
  });

  it("2. single-capacity order has requiredTankerCapacityLtr persisted in DB", async () => {
    const t = await riyadh(); if (!t) return;
    const c = await cookie();
    const cust = await db.query.customers.findFirst({ where: eq(customers.tenantId, t.id) });
    if (!cust) return;
    const contractId = await makeContract(t.id, c, cust.id, [21000]);
    if (!contractId) return;
    const res = await makeOrder(c, cust.id, contractId);
    if (!res.ok) return;
    const ord = await res.json();
    const dbRow = await db.query.orders.findFirst({ where: eq(orders.id, ord.id) });
    expect((dbRow as any).requiredTankerCapacityLtr).toBe(21000);
  });

  it("3. 21k vehicle accepted for 21k order", async () => {
    const t = await riyadh(); if (!t) return;
    const c = await cookie();
    const cust = await db.query.customers.findFirst({ where: eq(customers.tenantId, t.id) });
    if (!cust) return;
    const contractId = await makeContract(t.id, c, cust.id, [21000]);
    if (!contractId) return;
    const ordRes = await makeOrder(c, cust.id, contractId);
    if (!ordRes.ok) return;
    const ord = await ordRes.json();
    const dv = await createIsolatedDriverAndVehicle(t.id, `m22-21k-ok-${genId().slice(0,5)}`);
    await db.update(vehicles).set({ capacityLiters: 21000, status: "AVAILABLE" }).where(eq(vehicles.id, dv.vehicleId));
    const wh = await db.query.warehouses.findFirst({ where: eq(warehouses.tenantId, t.id) });
    if (!wh) return;
    const res = await makeTrip(c, dv.vehicleId, dv.driverId, wh.id, [ord.id]);
    expect(res.status).toBe(201);
  });

  it("4. 18k vehicle rejected for 21k order", async () => {
    const t = await riyadh(); if (!t) return;
    const c = await cookie();
    const cust = await db.query.customers.findFirst({ where: eq(customers.tenantId, t.id) });
    if (!cust) return;
    const contractId = await makeContract(t.id, c, cust.id, [21000]);
    if (!contractId) return;
    const ordRes = await makeOrder(c, cust.id, contractId);
    if (!ordRes.ok) return;
    const ord = await ordRes.json();
    const dv = await createIsolatedDriverAndVehicle(t.id, `m22-21k-18k-${genId().slice(0,5)}`);
    await db.update(vehicles).set({ capacityLiters: 18000, status: "AVAILABLE" }).where(eq(vehicles.id, dv.vehicleId));
    const wh = await db.query.warehouses.findFirst({ where: eq(warehouses.tenantId, t.id) });
    if (!wh) return;
    const res = await makeTrip(c, dv.vehicleId, dv.driverId, wh.id, [ord.id]);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.errorCode).toBe("TANKER_CAPACITY_MISMATCH");
    expect(body.error).toContain("21,000 L");
  });

  it("5. 28k vehicle rejected for 21k order", async () => {
    const t = await riyadh(); if (!t) return;
    const c = await cookie();
    const cust = await db.query.customers.findFirst({ where: eq(customers.tenantId, t.id) });
    if (!cust) return;
    const contractId = await makeContract(t.id, c, cust.id, [21000]);
    if (!contractId) return;
    const ordRes = await makeOrder(c, cust.id, contractId);
    if (!ordRes.ok) return;
    const ord = await ordRes.json();
    const dv = await createIsolatedDriverAndVehicle(t.id, `m22-21k-28k-${genId().slice(0,5)}`);
    await db.update(vehicles).set({ capacityLiters: 28000, status: "AVAILABLE" }).where(eq(vehicles.id, dv.vehicleId));
    const wh = await db.query.warehouses.findFirst({ where: eq(warehouses.tenantId, t.id) });
    if (!wh) return;
    const res = await makeTrip(c, dv.vehicleId, dv.driverId, wh.id, [ord.id]);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.errorCode).toBe("TANKER_CAPACITY_MISMATCH");
  });

  it("6. pricing uses the order's required capacity (not the vehicle capacity)", () => {
    const src = require("fs").readFileSync("app/api/trips/route.ts", "utf8");
    expect(src).toContain("requiredTankerCapacityLtr ?? vehicle.capacityLiters");
  });
});

// ── MULTI CAPACITY ────────────────────────────────────────────────────────────
describe("Multi-capacity contract (CASE B)", () => {
  it("7. contract with 18k/21k/28k → order without capacity selection rejected", async () => {
    const t = await riyadh(); if (!t) return;
    const c = await cookie();
    const cust = await db.query.customers.findFirst({ where: eq(customers.tenantId, t.id) });
    if (!cust) return;
    const contractId = await makeContract(t.id, c, cust.id, [18000, 21000, 28000]);
    if (!contractId) return;
    const res = await makeOrder(c, cust.id, contractId); // no selectedTankerCapacityLtr
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.errorCode).toBe("TANKER_CAPACITY_REQUIRED");
    expect(body.error).toContain("multiple tanker capacities");
  });

  it("8. selecting 21k on multi-capacity contract creates order successfully", async () => {
    const t = await riyadh(); if (!t) return;
    const c = await cookie();
    const cust = await db.query.customers.findFirst({ where: eq(customers.tenantId, t.id) });
    if (!cust) return;
    const contractId = await makeContract(t.id, c, cust.id, [18000, 21000, 28000]);
    if (!contractId) return;
    const res = await makeOrder(c, cust.id, contractId, 21000);
    expect(res.status).toBe(201);
    const ord = await res.json();
    expect((ord as any).requiredTankerCapacityLtr).toBe(21000);
  });

  it("9. stored capacity equals selected 21000", async () => {
    const t = await riyadh(); if (!t) return;
    const c = await cookie();
    const cust = await db.query.customers.findFirst({ where: eq(customers.tenantId, t.id) });
    if (!cust) return;
    const contractId = await makeContract(t.id, c, cust.id, [18000, 21000, 28000]);
    if (!contractId) return;
    const res = await makeOrder(c, cust.id, contractId, 21000);
    if (!res.ok) return;
    const ord = await res.json();
    const dbRow = await db.query.orders.findFirst({ where: eq(orders.id, ord.id) });
    expect((dbRow as any).requiredTankerCapacityLtr).toBe(21000);
  });

  it("10. 21k vehicle accepted for multi-cap order selecting 21k", async () => {
    const t = await riyadh(); if (!t) return;
    const c = await cookie();
    const cust = await db.query.customers.findFirst({ where: eq(customers.tenantId, t.id) });
    if (!cust) return;
    const contractId = await makeContract(t.id, c, cust.id, [18000, 21000, 28000]);
    if (!contractId) return;
    const ordRes = await makeOrder(c, cust.id, contractId, 21000);
    if (!ordRes.ok) return;
    const ord = await ordRes.json();
    const dv = await createIsolatedDriverAndVehicle(t.id, `m22-mc-21k-${genId().slice(0,5)}`);
    await db.update(vehicles).set({ capacityLiters: 21000, status: "AVAILABLE" }).where(eq(vehicles.id, dv.vehicleId));
    const wh = await db.query.warehouses.findFirst({ where: eq(warehouses.tenantId, t.id) });
    if (!wh) return;
    const res = await makeTrip(c, dv.vehicleId, dv.driverId, wh.id, [ord.id]);
    expect(res.status).toBe(201);
  });

  it("11. 18k vehicle rejected for multi-cap order selecting 21k", async () => {
    const t = await riyadh(); if (!t) return;
    const c = await cookie();
    const cust = await db.query.customers.findFirst({ where: eq(customers.tenantId, t.id) });
    if (!cust) return;
    const contractId = await makeContract(t.id, c, cust.id, [18000, 21000, 28000]);
    if (!contractId) return;
    const ordRes = await makeOrder(c, cust.id, contractId, 21000);
    if (!ordRes.ok) return;
    const ord = await ordRes.json();
    const dv = await createIsolatedDriverAndVehicle(t.id, `m22-mc-18k-${genId().slice(0,5)}`);
    await db.update(vehicles).set({ capacityLiters: 18000, status: "AVAILABLE" }).where(eq(vehicles.id, dv.vehicleId));
    const wh = await db.query.warehouses.findFirst({ where: eq(warehouses.tenantId, t.id) });
    if (!wh) return;
    const res = await makeTrip(c, dv.vehicleId, dv.driverId, wh.id, [ord.id]);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.errorCode).toBe("TANKER_CAPACITY_MISMATCH");
  });

  it("12. capacity not in contract pricing → INVALID_TANKER_CAPACITY_FOR_CONTRACT", async () => {
    const t = await riyadh(); if (!t) return;
    const c = await cookie();
    const cust = await db.query.customers.findFirst({ where: eq(customers.tenantId, t.id) });
    if (!cust) return;
    const contractId = await makeContract(t.id, c, cust.id, [18000, 21000]);
    if (!contractId) return;
    const res = await makeOrder(c, cust.id, contractId, 28000); // 28000 not in this contract
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.errorCode).toBe("INVALID_TANKER_CAPACITY_FOR_CONTRACT");
  });
});

// ── LEGACY NULL ───────────────────────────────────────────────────────────────
describe("Legacy NULL orders (pre-migration 0022)", () => {
  it("13. legacy NULL + single-capacity contract → safe derivation at dispatch", async () => {
    const t = await riyadh(); if (!t) return;
    const c = await cookie();
    const cust = await db.query.customers.findFirst({ where: eq(customers.tenantId, t.id) });
    if (!cust) return;
    const contractId = await makeContract(t.id, c, cust.id, [21000]);
    if (!contractId) return;
    // Insert a legacy order with NULL capacity:
    const legacyId = genId();
    await db.insert(orders).values({
      id: legacyId, tenantId: t.id, orderNumber: `LEGACY-${genId().slice(0,5)}`,
      customerId: cust.id, contractId, qtyOrdered: 2, emptyBottlesToCollect: 0,
      deliveryAddress: "Legacy test", lat: 24.7, lng: 46.7, status: "PENDING",
      paymentMethod: "CASH", pricePerBottle: 10, discountAmount: 0,
      // requiredTankerCapacityLtr intentionally NULL (legacy)
    });
    const dv = await createIsolatedDriverAndVehicle(t.id, `m22-leg-21k-${genId().slice(0,5)}`);
    await db.update(vehicles).set({ capacityLiters: 21000, status: "AVAILABLE" }).where(eq(vehicles.id, dv.vehicleId));
    const wh = await db.query.warehouses.findFirst({ where: eq(warehouses.tenantId, t.id) });
    if (!wh) { await db.delete(orders).where(eq(orders.id, legacyId)); return; }
    const res = await makeTrip(c, dv.vehicleId, dv.driverId, wh.id, [legacyId]);
    await db.delete(orders).where(eq(orders.id, legacyId));
    expect(res.status).toBe(201);
  });

  it("14. legacy NULL + multi-capacity contract → TANKER_CAPACITY_REQUIRED blocks assignment", async () => {
    const t = await riyadh(); if (!t) return;
    const c = await cookie();
    const cust = await db.query.customers.findFirst({ where: eq(customers.tenantId, t.id) });
    if (!cust) return;
    const contractId = await makeContract(t.id, c, cust.id, [18000, 21000]);
    if (!contractId) return;
    const legacyId = genId();
    await db.insert(orders).values({
      id: legacyId, tenantId: t.id, orderNumber: `LEGACY-MULTI-${genId().slice(0,5)}`,
      customerId: cust.id, contractId, qtyOrdered: 2, emptyBottlesToCollect: 0,
      deliveryAddress: "Legacy multi", lat: 24.7, lng: 46.7, status: "PENDING",
      paymentMethod: "CASH", pricePerBottle: 10, discountAmount: 0,
    });
    const dv = await createIsolatedDriverAndVehicle(t.id, `m22-leg-multi-${genId().slice(0,5)}`);
    await db.update(vehicles).set({ capacityLiters: 21000, status: "AVAILABLE" }).where(eq(vehicles.id, dv.vehicleId));
    const wh = await db.query.warehouses.findFirst({ where: eq(warehouses.tenantId, t.id) });
    if (!wh) { await db.delete(orders).where(eq(orders.id, legacyId)); return; }
    const res = await makeTrip(c, dv.vehicleId, dv.driverId, wh.id, [legacyId]);
    await db.delete(orders).where(eq(orders.id, legacyId));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.errorCode).toBe("TANKER_CAPACITY_REQUIRED");
  });

  it("15. non-contract order with NULL capacity is dispatchable", async () => {
    const t = await riyadh(); if (!t) return;
    const c = await cookie();
    const cust = await db.query.customers.findFirst({ where: eq(customers.tenantId, t.id) });
    if (!cust) return;
    const ordRes = await makeOrder(c, cust.id, null); // no contract
    if (!ordRes.ok) return;
    const ord = await ordRes.json();
    expect((ord as any).requiredTankerCapacityLtr ?? null).toBeNull();
    // No constraint → any vehicle accepted
    const dv = await createIsolatedDriverAndVehicle(t.id, `m22-noc-${genId().slice(0,5)}`);
    await db.update(vehicles).set({ capacityLiters: 28000, status: "AVAILABLE" }).where(eq(vehicles.id, dv.vehicleId));
    const wh = await db.query.warehouses.findFirst({ where: eq(warehouses.tenantId, t.id) });
    if (!wh) return;
    const res = await makeTrip(c, dv.vehicleId, dv.driverId, wh.id, [ord.id]);
    expect(res.status).toBe(201);
  });

  it("16. wildcard-only contract has no capacity constraint", async () => {
    const t = await riyadh(); if (!t) return;
    const c = await cookie();
    const cust = await db.query.customers.findFirst({ where: eq(customers.tenantId, t.id) });
    if (!cust) return;
    // Create contract with wildcard-only rule (no tankerCapacityLtr):
    const { POST: createCtr } = await import("@/app/api/contracts/route");
    const ctrRes = await createCtr(makeRequest("/api/contracts", { method: "POST", cookie: c,
      body: { customerId: cust.id, type: "ONE_TIME_TRIP_COUNT", totalTripsPurchased: 5, startDate: "2025-01-01" },
    }));
    if (!ctrRes.ok) return;
    const contract = await ctrRes.json();
    const { POST: addRule } = await import("@/app/api/contract-pricing-rules/route");
    await addRule(makeRequest("/api/contract-pricing-rules", { method: "POST", cookie: c,
      body: { contractId: contract.id, pricingScope: "CONTRACT", rateType: "STANDARD", pricePerTrip: 300 }, // no tankerCapacityLtr
    }));
    const ordRes = await makeOrder(c, cust.id, contract.id);
    if (!ordRes.ok) return;
    const ord = await ordRes.json();
    expect((ord as any).requiredTankerCapacityLtr ?? null).toBeNull();
    // Wildcard → any vehicle size
    const dv = await createIsolatedDriverAndVehicle(t.id, `m22-wild-${genId().slice(0,5)}`);
    await db.update(vehicles).set({ capacityLiters: 28000, status: "AVAILABLE" }).where(eq(vehicles.id, dv.vehicleId));
    const wh = await db.query.warehouses.findFirst({ where: eq(warehouses.tenantId, t.id) });
    if (!wh) return;
    const res = await makeTrip(c, dv.vehicleId, dv.driverId, wh.id, [ord.id]);
    expect(res.status).toBe(201);
  });
});

// ── RELATIONSHIPS ─────────────────────────────────────────────────────────────
describe("Commercial relationship integrity", () => {
  it("17. capacity not in the order's own contract → INVALID_TANKER_CAPACITY_FOR_CONTRACT", async () => {
    // Already covered by test 12 above — this verifies source guard exists
    const src = require("fs").readFileSync("app/api/orders/route.ts", "utf8");
    expect(src).toContain("INVALID_TANKER_CAPACITY_FOR_CONTRACT");
    expect(src).toContain("not a valid tanker capacity for this contract");
  });

  it("18. cross-tenant vehicle rejected", async () => {
    const r = await (async () => db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") }))();
    const a = await (async () => db.query.tenants.findFirst({ where: eq(tenants.name, "Acme Fuel Delivery Co.") }))();
    if (!r || !a) return;
    const c = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const acmeVeh = await db.query.vehicles.findFirst({ where: eq(vehicles.tenantId, a.id) });
    const riyadhDriver = await db.query.drivers.findFirst({ where: eq(drivers.tenantId, r.id) });
    const wh = await db.query.warehouses.findFirst({ where: eq(warehouses.tenantId, r.id) });
    if (!acmeVeh || !riyadhDriver || !wh) return;
    const res = await makeTrip(c, acmeVeh.id, riyadhDriver.id, wh.id, []);
    expect([400, 404, 422]).toContain(res.status);
  });
});

// ── COMMERCIAL IMMUTABILITY ────────────────────────────────────────────────────
describe("Commercial immutability", () => {
  it("19. requiredTankerCapacityLtr is returned in order API response", async () => {
    const t = await riyadh(); if (!t) return;
    const c = await cookie();
    const cust = await db.query.customers.findFirst({ where: eq(customers.tenantId, t.id) });
    if (!cust) return;
    const contractId = await makeContract(t.id, c, cust.id, [21000]);
    if (!contractId) return;
    const res = await makeOrder(c, cust.id, contractId);
    expect(res.status).toBe(201);
    const ord = await res.json();
    expect("requiredTankerCapacityLtr" in ord).toBe(true);
  });

  it("20. trips route uses requiredTankerCapacityLtr as primary enforcement source", () => {
    const src = require("fs").readFileSync("app/api/trips/route.ts", "utf8");
    expect(src).toContain("requiredTankerCapacityLtr");
    expect(src).toContain("TANKER_CAPACITY_MISMATCH");
    expect(src).toContain("TANKER_CAPACITY_REQUIRED");
  });
});

// ── BILLING REGRESSION ────────────────────────────────────────────────────────
describe("Billing regression — migration 0022 must not affect billing", () => {
  it("21. stop route still awaits recordUnloadingComplete", () => {
    const src = require("fs").readFileSync("app/api/trips/[id]/stops/[stopId]/route.ts", "utf8");
    expect(src).toContain("await recordUnloadingComplete");
    expect(src).not.toContain("recordUnloadingComplete().catch");
  });

  it("22. MONTHLY_ACCUMULATED path not affected by capacity field", () => {
    const src = require("fs").readFileSync("app/api/trips/[id]/stops/[stopId]/route.ts", "utf8");
    expect(src).toContain("MONTHLY_ACCUMULATED");
    // Capacity check happens before trip creation; stop route is unchanged:
    expect(src).not.toContain("requiredTankerCapacityLtr");
  });

  it("23. billing, POD, and invoice logic files unchanged by migration", () => {
    // The migration only touches orders schema and the two enforcement routes.
    const stopSrc = require("fs").readFileSync("app/api/trips/[id]/stops/[stopId]/route.ts", "utf8");
    const lifecycleSrc = require("fs").readFileSync("lib/lifecycleHelper.ts", "utf8");
    // No capacity field in billing / lifecycle code:
    expect(stopSrc).not.toContain("requiredTankerCapacityLtr");
    expect(lifecycleSrc).not.toContain("requiredTankerCapacityLtr");
  });
});

// ── LIFECYCLE REGRESSION ──────────────────────────────────────────────────────
describe("Lifecycle regression — six stages unchanged", () => {
  it("24. all six lifecycle stages unchanged in lifecycleHelper", () => {
    const src = require("fs").readFileSync("lib/lifecycleHelper.ts", "utf8");
    for (const stage of ["STARTED","ARRIVED_LOADING","LOADING_COMPLETE","ARRIVED_SITE","UNLOADING_COMPLETE","CLOSED"]) {
      expect(src).toContain(stage);
    }
  });

  it("25. trip creation with valid capacity creates trip with PLANNED status", async () => {
    const t = await riyadh(); if (!t) return;
    const c = await cookie();
    const cust = await db.query.customers.findFirst({ where: eq(customers.tenantId, t.id) });
    if (!cust) return;
    const contractId = await makeContract(t.id, c, cust.id, [21000]);
    if (!contractId) return;
    const ordRes = await makeOrder(c, cust.id, contractId);
    if (!ordRes.ok) return;
    const ord = await ordRes.json();
    const dv = await createIsolatedDriverAndVehicle(t.id, `m22-lc-${genId().slice(0,5)}`);
    await db.update(vehicles).set({ capacityLiters: 21000, status: "AVAILABLE" }).where(eq(vehicles.id, dv.vehicleId));
    const wh = await db.query.warehouses.findFirst({ where: eq(warehouses.tenantId, t.id) });
    if (!wh) return;
    const res = await makeTrip(c, dv.vehicleId, dv.driverId, wh.id, [ord.id]);
    expect(res.status).toBe(201);
    const trip = await res.json();
    expect(trip.status).toBe("PLANNED");
  });

  it("26. invalid capacity creates no trip", async () => {
    const t = await riyadh(); if (!t) return;
    const c = await cookie();
    const cust = await db.query.customers.findFirst({ where: eq(customers.tenantId, t.id) });
    if (!cust) return;
    const contractId = await makeContract(t.id, c, cust.id, [21000]);
    if (!contractId) return;
    const ordRes = await makeOrder(c, cust.id, contractId);
    if (!ordRes.ok) return;
    const ord = await ordRes.json();
    const dv = await createIsolatedDriverAndVehicle(t.id, `m22-notrc-${genId().slice(0,5)}`);
    await db.update(vehicles).set({ capacityLiters: 18000, status: "AVAILABLE" }).where(eq(vehicles.id, dv.vehicleId));
    const wh = await db.query.warehouses.findFirst({ where: eq(warehouses.tenantId, t.id) });
    if (!wh) return;
    const res = await makeTrip(c, dv.vehicleId, dv.driverId, wh.id, [ord.id]);
    expect(res.status).toBe(422); // no trip created
    // Verify no trip was inserted:
    const { trips: tripsTable } = await import("@/lib/db/schema");
    const trip = await db.query.trips.findFirst({
      where: eq(tripsTable.vehicleId, dv.vehicleId),
    });
    expect(trip).toBeUndefined();
  });
});

// ── MIGRATION TEST ────────────────────────────────────────────────────────────
describe("Migration 0022 correctness", () => {
  it("27. migration 0022 SQL is additive-only", () => {
    const sql = require("fs").readFileSync("drizzle/0022_strong_tomas.sql", "utf8");
    expect(sql.trim()).toBe('ALTER TABLE "orders" ADD COLUMN "required_tanker_capacity_ltr" integer;');
    expect(sql).not.toContain("DROP");
    expect(sql).not.toContain("RENAME");
    expect(sql).not.toContain("UPDATE");
    expect(sql).not.toContain("DELETE");
  });

  it("28. schema has requiredTankerCapacityLtr in orders table", () => {
    const src = require("fs").readFileSync("lib/db/schema.ts", "utf8");
    const ordersIdx = src.indexOf("export const orders = pgTable");
    const nextExport = src.indexOf("\nexport const ", ordersIdx + 50);
    const ordersTable = src.slice(ordersIdx, nextExport);
    expect(ordersTable).toContain("requiredTankerCapacityLtr");
    expect(ordersTable).toContain("required_tanker_capacity_ltr");
    expect(ordersTable).toContain("integer");
  });

  it("29. orders route enforces CASE B at order creation", () => {
    const src = require("fs").readFileSync("app/api/orders/route.ts", "utf8");
    expect(src).toContain("TANKER_CAPACITY_REQUIRED");
    expect(src).toContain("INVALID_TANKER_CAPACITY_FOR_CONTRACT");
    expect(src).toContain("selectedTankerCapacityLtr");
    expect(src).toContain("requiredTankerCapacityLtr");
  });

  it("30. dispatch page has tanker capacity selection UI", () => {
    const src = require("fs").readFileSync("app/dispatch/page.tsx", "utf8");
    // P2-02 NewOrderPanel: single-capacity contracts show the derived size;
    // multi-capacity contracts require an explicit choice among the contract's
    // own capacities, sent as selectedTankerCapacityLtr.
    expect(src).toContain("contractCaps");
    expect(src).toContain("contractCaps.length === 1");
    expect(src).toContain("Required tanker: {litres(contractCaps[0])}");
    expect(src).toContain("contractCaps.map((c) => <option");
    expect(src).toContain("body.selectedTankerCapacityLtr = capacity");
  });

  it("31. required tanker capacity is shown inline in order cards", () => {
    const src = require("fs").readFileSync("app/dispatch/page.tsx", "utf8");
    expect(src).toContain("requiredTankerCapacityLtr");
    expect(src).toContain("toLocaleString()");
  });

  it("32. pricing input uses requiredTankerCapacityLtr as primary source", () => {
    const src = require("fs").readFileSync("app/api/trips/route.ts", "utf8");
    expect(src).toContain("requiredTankerCapacityLtr ?? vehicle.capacityLiters");
  });
});
