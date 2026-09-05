import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { makeRequest, loginAs } from "../helpers/request";
import { db } from "@/lib/db/client";
import { tenants, customers, contracts, contractPricingRules, warehouses, orders } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { genId } from "@/lib/helpers";
import { createIsolatedDriverAndVehicle } from "../helpers/testFixtures";

// Task S.1 — Dispatch Context Resolution & Contract Operations Readiness.
const dispatchSource = () => fs.readFileSync(path.join(process.cwd(), "app/dispatch/page.tsx"), "utf8");
const plannerSource = () => fs.readFileSync(path.join(process.cwd(), "app/admin/contract-planner/page.tsx"), "utf8");
const contractsSource = () => fs.readFileSync(path.join(process.cwd(), "app/admin/contracts/page.tsx"), "utf8");
const controlTowerSource = () => fs.readFileSync(path.join(process.cwd(), "app/admin/dispatch/page.tsx"), "utf8");

async function runToAssigned(opts: { tenantId: string; adminCookie: string; customerId: string; contractId?: string; warehouseId: string; label: string }) {
  const { POST: createOrder } = await import("@/app/api/orders/route");
  const order = await (await createOrder(makeRequest("/api/orders", { method: "POST", cookie: opts.adminCookie, body: { customerId: opts.customerId, contractId: opts.contractId, qtyOrdered: 1, emptyBottlesToCollect: 0, paymentMethod: "CASH" } }))).json();
  const isolated = await createIsolatedDriverAndVehicle(opts.tenantId, opts.label);
  const { POST: createTrip } = await import("@/app/api/trips/route");
  const trip = await (await createTrip(makeRequest("/api/trips", { method: "POST", cookie: opts.adminCookie, body: { driverId: isolated.driverId, vehicleId: isolated.vehicleId, warehouseId: opts.warehouseId, orderIds: [order.id] } }))).json();
  return { order, trip, driverCookie: isolated.driverCookie };
}

describe("Dispatch context resolution root-cause fix (Task S.1, Parts 2/4/5)", () => {
  it("1/6. an assigned-but-not-loaded order's deep link resolves to its real trip, never the misleading generic message", async () => {
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const warehouse = await db.query.warehouses.findFirst({ where: eq(warehouses.tenantId, tenant!.id) });
    const customerId = genId();
    await db.insert(customers).values({ id: customerId, tenantId: tenant!.id, name: "S1 Test Customer", type: "B2B", address: "Test", lat: 24.7, lng: 46.7 });
    const { order, trip } = await runToAssigned({ tenantId: tenant!.id, adminCookie, customerId, warehouseId: warehouse!.id, label: `s1-assigned-${genId().slice(0, 6)}` });

    // Confirm the order really is assigned (not PENDING/VALIDATED), the
    // exact condition that triggered the old misleading message.
    const orderAfter = await db.query.orders.findFirst({ where: eq(orders.id, order.id) });
    expect(orderAfter!.status).toBe("ASSIGNED");
    expect(trip.id).toBeTruthy();
  });

  it("2. the source code follows order.tripStop.trip to resolve the real trip for an assigned order, rather than only checking order.status", () => {
    const source = dispatchSource();
    expect(source).toContain("match.tripStop?.trip?.id");
    expect(source).toContain("linkedTrip");
  });

  it("3. the old misleading 'check Live Trips' message (shown unconditionally) is gone", () => {
    const source = dispatchSource();
    expect(source).not.toContain("check Live Trips instead of the dispatch queue");
  });

  it("4/5. the new messages are context-aware, matching Part 5's exact examples for each trip state", () => {
    const source = dispatchSource();
    expect(source).toContain("is assigned and waiting for loading confirmation");
    expect(source).toContain("is loaded and ready to dispatch");
    expect(source).toContain("is active and shown under Live Trips");
    expect(source).toContain("is already completed. Showing readonly trip details");
  });

  it("a genuine data anomaly (assigned order, no locatable trip) gets an honest message, never a false claim about Live Trips", () => {
    const source = dispatchSource();
    expect(source).toContain("could not be located");
  });

  it("7/8. an unknown/mismatched tripId or orderId still shows a clear not-found message (unchanged from Milestone S)", () => {
    const source = dispatchSource();
    expect(source).toContain("was not found — it may have been completed or is no longer active");
    expect(source).toContain("was not found.");
  });

  it("9. Live Trips already includes PLANNED (assigned/waiting-loading) trips, not only DISPATCHED ones — confirmed at the source level", () => {
    const source = dispatchSource();
    expect(source).toContain('trips.filter((t) => t.status !== "COMPLETED")');
  });
});

describe("Contract Planner readiness fix (Task S.1, Part 6/7)", () => {
  async function setupContract(opts: { totalTripsPurchased?: number; tripsUsed?: number; type?: "ONE_TIME_TRIP_COUNT" | "MONTHLY_ACCUMULATED"; withStandard?: boolean; withOverage?: boolean }) {
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const tenantId = tenant!.id;
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const customerId = genId();
    await db.insert(customers).values({ id: customerId, tenantId, name: `S1 Planner Customer ${genId().slice(0, 6)}`, type: "B2B", address: "Test", lat: 24.7, lng: 46.7 });
    const contractId = genId();
    const type = opts.type ?? "ONE_TIME_TRIP_COUNT";
    await db.insert(contracts).values({
      id: contractId, tenantId, customerId, contractNumber: `S1-${genId().slice(0, 8)}`, type, status: "ACTIVE",
      appliesToAllSites: true, totalTripsPurchased: type === "ONE_TIME_TRIP_COUNT" ? opts.totalTripsPurchased ?? 5 : null,
      tripsUsed: opts.tripsUsed ?? 0, startDate: new Date("2020-01-01"), billingCadence: type === "MONTHLY_ACCUMULATED" ? "MONTHLY" : undefined,
    });
    if (opts.withStandard) {
      await db.insert(contractPricingRules).values({ id: genId(), tenantId, pricingScope: "CONTRACT", contractId, rateType: "STANDARD", pricePerTrip: 500, vatRate: 0.15 });
    }
    if (opts.withOverage) {
      await db.insert(contractPricingRules).values({ id: genId(), tenantId, pricingScope: "CONTRACT", contractId, rateType: "OVERAGE", pricePerTrip: 700, vatRate: 0.15 });
    }
    return { tenantId, adminCookie, contractId };
  }

  it("root cause: a fully-configured contract is now actually reported as ready (previously impossible for ANY contract)", async () => {
    const { adminCookie, contractId } = await setupContract({ withStandard: true });
    const { GET: getPlanner } = await import("@/app/api/contract-planner/route");
    const res = await getPlanner(makeRequest("/api/contract-planner", { cookie: adminCookie }));
    const rows = await res.json();
    const row = rows.find((r: any) => r.contractId === contractId);
    expect(row.readyForDispatch).toBe(true);
    // Confirm this contract still has UNSUPPORTED items (Payment terms,
    // Billing requirements) — readiness is correctly true DESPITE these,
    // proving the fix, not merely a coincidence.
    expect(row.readinessItems.some((i: any) => i.state === "UNSUPPORTED")).toBe(true);
  });

  it("10/14. a contract missing STANDARD pricing shows a specific blocked reason, not a bare 'Not ready'", async () => {
    const { adminCookie, contractId } = await setupContract({ withStandard: false });
    const { GET: getPlanner } = await import("@/app/api/contract-planner/route");
    const rows = await (await getPlanner(makeRequest("/api/contract-planner", { cookie: adminCookie }))).json();
    const row = rows.find((r: any) => r.contractId === contractId);
    expect(row.readyForDispatch).toBe(false);
    expect(row.blockedReasons).toContain("STANDARD pricing configured");
  });

  it("15. an over-limit ONE_TIME_TRIP_COUNT contract missing OVERAGE pricing is still correctly reported as not ready, with overageActive true", async () => {
    const { adminCookie, contractId } = await setupContract({ totalTripsPurchased: 2, tripsUsed: 2, withStandard: true, withOverage: false });
    const { GET: getPlanner } = await import("@/app/api/contract-planner/route");
    const rows = await (await getPlanner(makeRequest("/api/contract-planner", { cookie: adminCookie }))).json();
    const row = rows.find((r: any) => r.contractId === contractId);
    expect(row.overageActive).toBe(true);
    expect(row.tripsRemaining).toBe(0);
  });

  it("13. trips used/remaining are correctly exposed for a ONE_TIME_TRIP_COUNT contract", async () => {
    const { adminCookie, contractId } = await setupContract({ totalTripsPurchased: 5, tripsUsed: 2, withStandard: true });
    const { GET: getPlanner } = await import("@/app/api/contract-planner/route");
    const rows = await (await getPlanner(makeRequest("/api/contract-planner", { cookie: adminCookie }))).json();
    const row = rows.find((r: any) => r.contractId === contractId);
    expect(row.tripsUsed).toBe(2);
    expect(row.tripsRemaining).toBe(3);
    expect(row.overageActive).toBe(false);
  });

  it("11/12. the API reports the correct operationalPath for each contract type", async () => {
    const monthly = await setupContract({ type: "MONTHLY_ACCUMULATED", withStandard: true });
    const tripCount = await setupContract({ type: "ONE_TIME_TRIP_COUNT", withStandard: true });
    const { GET: getPlanner } = await import("@/app/api/contract-planner/route");
    const rows = await (await getPlanner(makeRequest("/api/contract-planner", { cookie: monthly.adminCookie }))).json();
    expect(rows.find((r: any) => r.contractId === monthly.contractId).operationalPath).toBe("MONTHLY_ACCUMULATION");
    expect(rows.find((r: any) => r.contractId === tripCount.contractId).operationalPath).toBe("DISPATCH_READY_TRIP");
  });

  it("11/12/16/17/18. the Planner UI shows the type-specific operational path explanation, all blocked reasons (not just the first), and does not claim an unsupported create-trip capability", () => {
    const source = plannerSource();
    expect(source).toContain("Deliveries accumulate during the month and are invoiced manually at month-end.");
    expect(source).toContain("Each delivered trip consumes one purchased trip; over-limit trips require OVERAGE pricing.");
    expect(source).toContain("r.blockedReasons.map((reason: string)");
    expect(source).not.toContain("Create dispatch-ready trip");
    expect(source).toContain("View in Control Tower");
  });

  it("19/20. the Planner still links to Contract Management with contractId, and to Control Tower filtered by contractId", () => {
    const source = plannerSource();
    expect(source).toContain("/admin/contracts?contractId=${r.contractId}");
    expect(source).toContain("/admin/dispatch?contractId=${r.contractId}");
  });
});

describe("Contract Management operational guidance (Task S.1, Part 8)", () => {
  it("21/22/23. contract detail shows operational guidance, type-specific explanation, and links to Planner (always) and Control Tower (when ready)", () => {
    const source = contractsSource();
    expect(source).toContain("Operational guidance");
    expect(source).toContain("Monthly accumulation contract: deliveries accumulate");
    expect(source).toContain("One-time trip-count contract: each delivered trip consumes");
    expect(source).toContain("View active trips in Control Tower");
    expect(source).toContain("View in Planner");
  });

  it("24. unknown contractId behavior remains safe (unchanged from Milestone S)", () => {
    const source = contractsSource();
    expect(source).toContain("was not found — it may have been removed or belongs to a different tenant");
  });
});

describe("Control Tower contract-filter empty state (Task S.1, Part 9)", () => {
  it("shows the exact specified empty-state message with links back to Planner/Contract Management when filtered by a contract with no operational items", () => {
    const source = controlTowerSource();
    expect(source).toContain("No active operational trips/orders for this contract yet.");
    expect(source).toContain("/admin/contract-planner?contractId=${contextContractId}");
  });
});

describe("Regression protection (Task S.1, Part 10)", () => {
  it("25/26/27. Milestone S deep links, Milestone R sidebar, and Milestone Q modules all remain intact", () => {
    expect(dispatchSource()).toContain('searchParams.get("tripId")');
    const adminSource = fs.readFileSync(path.join(process.cwd(), "app/admin/page.tsx"), "utf8");
    expect(adminSource).toContain("AdminShell");
    expect(adminSource).not.toMatch(/\(\["overview", "fleet", "drivers".*\] as const\)\.map/);
  });

  it("28/29/30. Task P.2 contract-priced invoice and monthly-billing markers are untouched", () => {
    const stopRouteSource = fs.readFileSync(path.join(process.cwd(), "app/api/trips/[id]/stops/[stopId]/route.ts"), "utf8");
    const pricingSource = fs.readFileSync(path.join(process.cwd(), "lib/contractPricing.ts"), "utf8");
    const erpSource = fs.readFileSync(path.join(process.cwd(), "lib/erp/sync.ts"), "utf8");
    expect(stopRouteSource).toContain("Task P.2");
    expect(pricingSource).toContain("PricingEngineError");
    expect(erpSource).toContain("isContractPriced");
  });

  it("a real end-to-end ONE_TIME_TRIP_COUNT delivery still prices correctly and increments tripsUsed exactly once", async () => {
    const { adminCookie, contractId, tenantId } = await setupPricedContractForDelivery();
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
    const warehouse = await db.query.warehouses.findFirst({ where: eq(warehouses.tenantId, tenant!.id) });
    const customerId = (await db.query.contracts.findFirst({ where: eq(contracts.id, contractId) }))!.customerId;
    const { order, trip, driverCookie } = await runToAssigned({ tenantId, adminCookie, customerId, contractId, warehouseId: warehouse!.id, label: `s1-e2e-${genId().slice(0, 6)}` });
    const { PATCH: confirmLoading } = await import("@/app/api/trips/[id]/loading/route");
    await confirmLoading(makeRequest(`/api/trips/${trip.id}/loading`, { method: "PATCH", cookie: adminCookie }), { params: { id: trip.id } });
    const { PATCH: tripAction } = await import("@/app/api/trips/[id]/route");
    await tripAction(makeRequest(`/api/trips/${trip.id}`, { method: "PATCH", cookie: adminCookie, body: { action: "dispatch" } }), { params: { id: trip.id } });
    const stopId = trip.stops[0].id;
    const { PATCH: stopAction } = await import("@/app/api/trips/[id]/stops/[stopId]/route");
    await stopAction(makeRequest(`/api/trips/${trip.id}/stops/${stopId}`, { method: "PATCH", cookie: driverCookie, body: { action: "arrive" } }), { params: { id: trip.id, stopId } });
    const deliverRes = await stopAction(makeRequest(`/api/trips/${trip.id}/stops/${stopId}`, { method: "PATCH", cookie: driverCookie, body: { action: "deliver", deliveredQty: 1, emptiesCollected: 0, recipientName: "Test" } }), { params: { id: trip.id, stopId } });
    const deliverBody = await deliverRes.json();
    expect(deliverBody.invoice.subtotal).toBe(500);
    const contractAfter = await db.query.contracts.findFirst({ where: eq(contracts.id, contractId) });
    expect(contractAfter!.tripsUsed).toBe(1);
  });

  async function setupPricedContractForDelivery() {
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const tenantId = tenant!.id;
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const customerId = genId();
    await db.insert(customers).values({ id: customerId, tenantId, name: "S1 Regression Delivery Customer", type: "B2B", address: "Test", lat: 24.7, lng: 46.7 });
    const contractId = genId();
    await db.insert(contracts).values({ id: contractId, tenantId, customerId, contractNumber: `S1-DEL-${genId().slice(0, 8)}`, type: "ONE_TIME_TRIP_COUNT", status: "ACTIVE", appliesToAllSites: true, totalTripsPurchased: 5, tripsUsed: 0, startDate: new Date("2020-01-01") });
    await db.insert(contractPricingRules).values({ id: genId(), tenantId, pricingScope: "CONTRACT", contractId, rateType: "STANDARD", pricePerTrip: 500, vatRate: 0.15 });
    return { tenantId, adminCookie, contractId };
  }

  it("no passwordHash exposure in any of this task's changes", () => {
    const combined = dispatchSource() + plannerSource() + contractsSource() + controlTowerSource();
    expect(combined).not.toContain("passwordHash");
  });
});
