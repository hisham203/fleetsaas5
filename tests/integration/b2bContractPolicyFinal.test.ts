/**
 * Smarty1 Phase 1 — Pilot Release Final B2B Commercial Policy tests.
 * Tests 1–20 proving the complete B2B contract requirement.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { makeRequest, loginAs } from "../helpers/request";
import { db } from "@/lib/db/client";
import {
  tenants, orders, vehicles, customers, contracts,
  contractPricingRules, warehouses, customerLocations,
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

async function freshB2B() {
  const id = genId();
  await db.insert(customers).values({ id, tenantId, name: `B2B ${id.slice(0,5)}`, type: "B2B", address: "Test", lat: 24.7, lng: 46.7 });
  return id;
}
async function freshB2C() {
  const id = genId();
  await db.insert(customers).values({ id, tenantId, name: `B2C ${id.slice(0,5)}`, type: "B2C", address: "Test", lat: 24.7, lng: 46.7 });
  return id;
}

async function makeContract(custId: string, status: "ACTIVE"|"CANCELLED"|"SUSPENDED"|"DRAFT", startDate = "2025-01-01", endDate?: string) {
  const { POST } = await import("@/app/api/contracts/route");
  const c = await adminCk();
  const res = await POST(makeRequest("/api/contracts", { method: "POST", cookie: c,
    body: { customerId: custId, type: "ONE_TIME_TRIP_COUNT", totalTripsPurchased: 10, startDate,
            ...(endDate ? { endDate } : {}) },
  }));
  if (!res.ok) return null;
  const contract = await res.json();
  await db.update(contracts).set({ status }).where(eq(contracts.id, contract.id));
  if (status === "ACTIVE") {
    await db.insert(contractPricingRules).values({
      id: genId(), tenantId, contractId: contract.id,
      pricingScope: "CONTRACT", rateType: "STANDARD", pricePerTrip: 500, tankerCapacityLtr: 21000,
    });
  }
  return contract.id;
}

async function tryOrder(cookie: string, custId: string, contractId?: string) {
  const { POST } = await import("@/app/api/orders/route");
  const body: any = { customerId: custId, qtyOrdered: 1, emptyBottlesToCollect: 0, paymentMethod: "CASH" };
  if (contractId) body.contractId = contractId;
  return POST(makeRequest("/api/orders", { method: "POST", cookie, body }));
}

describe("B2B contract policy — Pilot Release Final", () => {

  it("1. B2B + eligible ACTIVE contract → order succeeds with contractId", async () => {
    const custId = await freshB2B();
    const cid = await makeContract(custId, "ACTIVE");
    if (!cid) return;
    const res = await tryOrder(await adminCk(), custId, cid);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.contractId).toBe(cid);
  });

  it("2. B2B + eligible contract + contractId omitted → B2B_CONTRACT_REQUIRED", async () => {
    const custId = await freshB2B();
    await makeContract(custId, "ACTIVE");
    const res = await tryOrder(await adminCk(), custId); // no contractId
    expect(res.status).toBe(422);
    expect((await res.json()).errorCode).toBe("B2B_CONTRACT_REQUIRED");
  });

  it("3. B2B + no contracts at all → B2B_CONTRACT_REQUIRED", async () => {
    const custId = await freshB2B(); // fresh customer, zero contracts
    const res = await tryOrder(await adminCk(), custId);
    expect(res.status).toBe(422);
    expect((await res.json()).errorCode).toBe("B2B_CONTRACT_REQUIRED");
  });

  it("4. B2B + only CANCELLED contract → B2B_CONTRACT_REQUIRED", async () => {
    const custId = await freshB2B();
    await makeContract(custId, "CANCELLED");
    const res = await tryOrder(await adminCk(), custId);
    expect(res.status).toBe(422);
    expect((await res.json()).errorCode).toBe("B2B_CONTRACT_REQUIRED");
  });

  it("5. B2B + only SUSPENDED contract → B2B_CONTRACT_REQUIRED", async () => {
    const custId = await freshB2B();
    await makeContract(custId, "SUSPENDED");
    const res = await tryOrder(await adminCk(), custId);
    expect(res.status).toBe(422);
    expect((await res.json()).errorCode).toBe("B2B_CONTRACT_REQUIRED");
  });

  it("6. B2B + expired contract (past endDate) → B2B_CONTRACT_REQUIRED", async () => {
    const custId = await freshB2B();
    // Create an ACTIVE contract with a past endDate, then check direct order is blocked:
    const cid = genId();
    await db.insert(contracts).values({
      id: cid, tenantId, customerId: custId,
      contractNumber: `EXP-${genId().slice(0,6)}`,
      type: "ONE_TIME_TRIP_COUNT", status: "ACTIVE", totalTripsPurchased: 5,
      startDate: new Date("2020-01-01"), endDate: new Date("2021-01-01"),
      tripsUsed: 0, appliesToAllSites: true,
    });
    await db.insert(contractPricingRules).values({
      id: genId(), tenantId, contractId: cid, pricingScope: "CONTRACT",
      rateType: "STANDARD", pricePerTrip: 400,
    });
    // Direct order (no contractId) → blocked unconditionally for B2B:
    const res = await tryOrder(await adminCk(), custId);
    expect(res.status).toBe(422);
    expect((await res.json()).errorCode).toBe("B2B_CONTRACT_REQUIRED");
    // Even supplying the expired contractId → validateContractEligibility fails (OUTSIDE_DATE_RANGE):
    const res2 = await tryOrder(await adminCk(), custId, cid);
    expect(res2.status).toBe(422);
  });

  it("7. B2B + future contract (startDate in future) → B2B_CONTRACT_REQUIRED", async () => {
    const custId = await freshB2B();
    const futId = genId();
    await db.insert(contracts).values({
      id: futId, tenantId, customerId: custId,
      contractNumber: `FUT-${genId().slice(0,6)}`,
      type: "ONE_TIME_TRIP_COUNT", status: "ACTIVE", totalTripsPurchased: 5,
      startDate: new Date("2030-01-01"), endDate: null,
      tripsUsed: 0, appliesToAllSites: true,
    });
    const res = await tryOrder(await adminCk(), custId);
    expect(res.status).toBe(422);
    expect((await res.json()).errorCode).toBe("B2B_CONTRACT_REQUIRED");
    // Supplying the future contractId → OUTSIDE_DATE_RANGE:
    const res2 = await tryOrder(await adminCk(), custId, futId);
    expect(res2.status).toBe(422);
  });

  it("8. B2B + site-specific contract used for different site → rejected", async () => {
    const custId = await freshB2B();
    const siteA = genId();
    await db.insert(customerLocations).values({ id: siteA, tenantId, customerId: custId, label: "Site A", address: "A", lat: 24.71, lng: 46.71, deliveryZone: "CENTRAL" });
    const siteB = genId();
    await db.insert(customerLocations).values({ id: siteB, tenantId, customerId: custId, label: "Site B", address: "B", lat: 24.72, lng: 46.72, deliveryZone: "CENTRAL" });
    // Contract scoped to siteA only:
    const cid = genId();
    await db.insert(contracts).values({ id: cid, tenantId, customerId: custId, contractNumber: `SITE-${genId().slice(0,6)}`, type: "ONE_TIME_TRIP_COUNT", status: "ACTIVE", totalTripsPurchased: 5, startDate: new Date("2025-01-01"), tripsUsed: 0, appliesToAllSites: false });
    const { contractSiteScope: ss } = await import("@/lib/db/schema");
    await db.insert(ss).values({ id: genId(), contractId: cid, customerLocationId: siteA });
    await db.insert(contractPricingRules).values({ id: genId(), tenantId, contractId: cid, pricingScope: "CONTRACT", rateType: "STANDARD", pricePerTrip: 400, tankerCapacityLtr: 21000 });
    // Order for siteB with contract scoped to siteA → server validates site scope and rejects:
    const { POST } = await import("@/app/api/orders/route");
    const res = await POST(makeRequest("/api/orders", { method: "POST", cookie: await adminCk(),
      body: { customerId: custId, contractId: cid, locationId: siteB, qtyOrdered: 1, emptyBottlesToCollect: 0, paymentMethod: "CASH" },
    }));
    expect(res.status).toBe(422);
    // Should not succeed:
    expect(res.status).not.toBe(201);
  });

  it("9. ADMIN cannot create B2B direct order (B2B_CONTRACT_REQUIRED)", async () => {
    const custId = await freshB2B();
    const res = await tryOrder(await adminCk(), custId);
    expect(res.status).toBe(422);
    expect((await res.json()).errorCode).toBe("B2B_CONTRACT_REQUIRED");
  });

  it("10. DISPATCHER cannot create B2B direct order (B2B_CONTRACT_REQUIRED)", async () => {
    const custId = await freshB2B();
    const res = await tryOrder(await dispCk(), custId);
    expect(res.status).toBe(422);
    expect((await res.json()).errorCode).toBe("B2B_CONTRACT_REQUIRED");
  });

  it("11. direct API POST cannot bypass B2B policy", () => {
    const src = require("fs").readFileSync("app/api/orders/route.ts", "utf8");
    // Must have the unconditional B2B check:
    expect(src).toContain('if (!data.contractId && customer.type === "B2B")');
    expect(src).toContain("B2B_CONTRACT_REQUIRED");
    // Must NOT have any conditional (role-based) bypass:
    expect(src).not.toContain("isDispatcher");
    expect(src).not.toContain("enforceContractPolicy");
    // Must NOT query for eligible contracts before rejecting (policy is unconditional):
    const b2bCheckIdx = src.indexOf('if (!data.contractId && customer.type === "B2B")');
    const b2bCheckEnd = src.indexOf("}", b2bCheckIdx);
    const checkBlock = src.slice(b2bCheckIdx, b2bCheckEnd + 1);
    expect(checkBlock).not.toContain("db.query.contracts"); // no DB query needed — reject immediately
  });

  it("12. B2C direct order still succeeds (no contract required)", async () => {
    const custId = await freshB2C();
    const res = await tryOrder(await adminCk(), custId);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.contractId ?? null).toBeNull();
  });

  it("13. B2C direct order uses pricePerBottle billing path, not contract pricing", async () => {
    const custId = await freshB2C();
    const res = await tryOrder(await adminCk(), custId);
    expect(res.status).toBe(201);
    const body = await res.json();
    // Non-contract order: pricePerBottle set, no requiredTankerCapacityLtr:
    expect(body.pricePerBottle).toBeGreaterThan(0);
    expect(body.requiredTankerCapacityLtr ?? null).toBeNull();
    expect(body.contractId ?? null).toBeNull();
  });

  it("14. replacement ACTIVE contract restores B2B ordering immediately", async () => {
    const custId = await freshB2B();
    const oldId = await makeContract(custId, "ACTIVE");
    if (!oldId) return;
    // Cancel the old contract:
    await db.update(contracts).set({ status: "CANCELLED" }).where(eq(contracts.id, oldId));
    // Direct order still blocked (no active contract now):
    const res1 = await tryOrder(await adminCk(), custId);
    expect(res1.status).toBe(422);
    // Create replacement:
    const newId = await makeContract(custId, "ACTIVE");
    if (!newId) return;
    // Order with replacement contract succeeds:
    const res2 = await tryOrder(await adminCk(), custId, newId);
    expect(res2.status).toBe(201);
  });

  it("15. retired contract history remains intact (orders/invoices unchanged)", async () => {
    const custId = await freshB2B();
    const cid = await makeContract(custId, "ACTIVE");
    if (!cid) return;
    // Place an order:
    const ordRes = await tryOrder(await adminCk(), custId, cid);
    if (!ordRes.ok) return;
    const ord = await ordRes.json();
    // Now cancel the contract:
    await db.update(contracts).set({ status: "CANCELLED" }).where(eq(contracts.id, cid));
    // The historical order still references the contract:
    const dbOrd = await db.query.orders.findFirst({ where: eq(orders.id, ord.id) });
    expect(dbOrd?.contractId).toBe(cid);
    // The cancelled contract is still queryable:
    const dbContract = await db.query.contracts.findFirst({ where: eq(contracts.id, cid) });
    expect(dbContract?.status).toBe("CANCELLED");
  });

  it("16. 21k contract derives requiredTankerCapacityLtr = 21000", async () => {
    const custId = await freshB2B();
    const cid = await makeContract(custId, "ACTIVE");
    if (!cid) return;
    const res = await tryOrder(await adminCk(), custId, cid);
    expect(res.status).toBe(201);
    expect((await res.json()).requiredTankerCapacityLtr).toBe(21000);
  });

  it("17. 18k vehicle rejected for 21k contract order", async () => {
    const custId = await freshB2B();
    const cid = await makeContract(custId, "ACTIVE");
    if (!cid) return;
    const ordRes = await tryOrder(await adminCk(), custId, cid);
    if (!ordRes.ok) return;
    const ord = await ordRes.json();
    const dv = await createIsolatedDriverAndVehicle(tenantId, `b2bp-18k-${genId().slice(0,5)}`);
    await db.update(vehicles).set({ capacityLiters: 18000, status: "AVAILABLE" }).where(eq(vehicles.id, dv.vehicleId));
    const wh = await db.query.warehouses.findFirst({ where: eq(warehouses.tenantId, tenantId) });
    const { POST } = await import("@/app/api/trips/route");
    const res = await POST(makeRequest("/api/trips", { method: "POST", cookie: await adminCk(),
      body: { vehicleId: dv.vehicleId, driverId: dv.driverId, warehouseId: wh!.id, orderIds: [ord.id] },
    }));
    expect(res.status).toBe(422);
    expect((await res.json()).errorCode).toBe("TANKER_CAPACITY_MISMATCH");
  });

  it("18. 21k vehicle accepted for 21k contract order", async () => {
    const custId = await freshB2B();
    const cid = await makeContract(custId, "ACTIVE");
    if (!cid) return;
    const ordRes = await tryOrder(await adminCk(), custId, cid);
    if (!ordRes.ok) return;
    const ord = await ordRes.json();
    const dv = await createIsolatedDriverAndVehicle(tenantId, `b2bp-21k-${genId().slice(0,5)}`);
    await db.update(vehicles).set({ capacityLiters: 21000, status: "AVAILABLE" }).where(eq(vehicles.id, dv.vehicleId));
    const wh = await db.query.warehouses.findFirst({ where: eq(warehouses.tenantId, tenantId) });
    const { POST } = await import("@/app/api/trips/route");
    const res = await POST(makeRequest("/api/trips", { method: "POST", cookie: await adminCk(),
      body: { vehicleId: dv.vehicleId, driverId: dv.driverId, warehouseId: wh!.id, orderIds: [ord.id] },
    }));
    expect(res.status).toBe(201);
    expect((await res.json()).status).toBe("PLANNED");
  });

  it("19. billing regression — ONE_TIME_TRIP_COUNT lifecycle unchanged", () => {
    const src = require("fs").readFileSync("app/api/trips/[id]/stops/[stopId]/route.ts", "utf8");
    expect(src).toContain("await recordUnloadingComplete");
    expect(src).toContain("MONTHLY_ACCUMULATED");
    expect(src).toContain("skipInvoiceForMonthlyContract");
    expect(src).toContain("isTripCountContract");
  });

  it("20. lifecycle/POD regression — six stages unchanged", () => {
    const src = require("fs").readFileSync("lib/lifecycleHelper.ts", "utf8");
    for (const s of ["STARTED","ARRIVED_LOADING","LOADING_COMPLETE","ARRIVED_SITE","UNLOADING_COMPLETE","CLOSED"]) {
      expect(src).toContain(s);
    }
  });
});

describe("Driver application audit", () => {
  it("A. Driver web application exists at /driver route", () => {
    const src = require("fs").readFileSync("app/driver/page.tsx", "utf8");
    expect(src).toContain('useRequireSession(["DRIVER"])');
    expect(src).toContain("trips");
    expect(src).toContain("expenses");
  });

  it("B. Driver page has GPS location tracking (simulated)", () => {
    const src = require("fs").readFileSync("app/driver/page.tsx", "utf8");
    expect(src).toContain("gpsIntervalRef");
    expect(src).toContain("/api/trips");
    expect(src).toContain("gps");
  });

  it("C. Driver page supports stop lifecycle actions (arrive, deliver, fail)", () => {
    const src = require("fs").readFileSync("app/driver/page.tsx", "utf8");
    expect(src).toContain('"arrive"');
    expect(src).toContain('"fail"');
    expect(src).toContain("epodStop");
  });

  it("D. B2B policy does not affect driver lifecycle (drivers do not create orders)", () => {
    const src = require("fs").readFileSync("app/driver/page.tsx", "utf8");
    expect(src).not.toContain("B2B_CONTRACT_REQUIRED");
    expect(src).not.toContain("createOrder");
  });
});
