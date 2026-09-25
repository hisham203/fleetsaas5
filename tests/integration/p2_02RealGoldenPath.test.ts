/**
 * SMARTY1 P2-02 — REAL GOLDEN PATH (authoritative acceptance suite)
 *
 *   COORDINATOR  B2B customer → site → eligible ACTIVE contract → required tanker
 *                → Create Order (PENDING) → Loading Point
 *                → POST /api/trips { orderIds, warehouseId }   ← EXACT browser payload
 *                → trip PLANNED, driverId NULL, vehicleId NULL
 *   SUPERVISOR   same trip → required capacity → eligible exact-capacity tanker
 *                + eligible driver → Assign (stays PLANNED) → Dispatch → DISPATCHED
 *   DRIVER       sees trip → ARRIVED_LOADING → LOADING_COMPLETE → ARRIVED_SITE
 *                → ePOD delivered (UNLOADING_COMPLETE) → trip COMPLETED
 *                → driver + tanker back to AVAILABLE → trip gone from PLANNED list
 *   B2C          direct order → tanker requirement → unassigned planning → eligibility
 *
 * Rules for this file (P2-02 acceptance):
 *   - Every fixture is created deterministically in beforeAll and THROWS if it
 *     cannot be created. There are NO silent early-return fixture skips and
 *     NO always-true placeholder assertions anywhere in this file.
 *   - Coordinator and Supervisor are real users with EXPLICIT RBAC roles
 *     (OPERATION_COORDINATOR / OPERATION_SUPERVISOR) — not ADMIN bypass.
 *   - The Plan Trip request body is the browser's body, key for key.
 *   - Tests run in order and each step asserts the previous step's persisted state.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { db } from "@/lib/db/client";
import {
  users, userRoles, roles, customers, customerLocations, contracts, contractPricingRules,
  drivers, vehicles, warehouses, trips, orders, tripStops,
} from "@/lib/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { genId } from "@/lib/helpers";
import { hashPassword } from "@/lib/auth";
import { makeRequest, loginAs } from "../helpers/request";
import { runBootstrap } from "../../scripts/bootstrapRbac";

const RIYADH = "Riyadh Bulk Water Logistics";
const PASSWORD = "GoldenPath_P202!";
const CAPACITY = 21000;          // the order's commercial tanker size
const WRONG_CAPACITY = 18000;    // a real tanker size that must NEVER qualify
const run = genId().slice(0, 6);

let tenantId: string;
let coordinatorCookie: string;
let supervisorCookie: string;
let driverCookie: string;
let otherDriverCookie: string;
let loadingPointId: string;
let b2bCustomerId: string;
let b2bSiteId: string;
let b2bContractId: string;
let b2cCustomerId: string;
let driverId: string;
let tankerId: string;
let wrongTankerId: string;

// Filled in by the ordered steps below (each step fails loudly if the previous didn't set it).
let b2bOrderId = "";
let b2bTripId = "";
let b2cOrderId = "";
let b2cTripId = "";

/** The exact body app/dispatch/page.tsx → PlanTripForm.planTrip sends. */
const browserPlanTripBody = (orderId: string, warehouseId: string) => ({ orderIds: [orderId], warehouseId });

function need<T>(value: T | null | undefined | "", what: string): T {
  if (value === null || value === undefined || value === "") throw new Error(`P2-02 golden-path fixture missing: ${what}`);
  return value as T;
}

async function createUser(role: "DISPATCHER" | "DRIVER", label: string): Promise<{ id: string; email: string }> {
  const id = genId();
  const email = `p202-${label}-${run}@golden-path.test`;
  await db.insert(users).values({ id, tenantId, email, name: `P2-02 ${label} ${run}`, role, passwordHash: await hashPassword(PASSWORD) });
  return { id, email };
}

async function grantSystemRole(userId: string, roleName: string) {
  const role = need(await db.query.roles.findFirst({ where: and(eq(roles.name, roleName), isNull(roles.tenantId)) }), `system role ${roleName}`);
  await db.insert(userRoles).values({ id: genId(), userId, roleId: role.id, tenantId });
}

async function call(modPath: string, method: string, url: string, cookie: string, body?: unknown, params?: Record<string, string>) {
  const mod: any = await import(/* @vite-ignore */ modPath);
  const req = makeRequest(url, { method, cookie, body });
  const res: Response = params ? await mod[method](req, { params: Promise.resolve(params) }) : await mod[method](req);
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}
const TRIPS = "@/app/api/trips/route";
const TRIP = "@/app/api/trips/[id]/route";
const ORDERS = "@/app/api/orders/route";

beforeAll(async () => {
  await runBootstrap();

  const tenant = need(await db.query.tenants.findFirst({ where: (t, { eq: e }) => e(t.name, RIYADH) }), `tenant "${RIYADH}"`);
  tenantId = tenant.id;

  const lp = need(await db.query.warehouses.findFirst({ where: and(eq(warehouses.tenantId, tenantId), eq(warehouses.isDefault, true)) }), "default loading point");
  loadingPointId = lp.id;

  // ── People with explicit RBAC roles (no ADMIN bypass anywhere in the workflow) ──
  const coordinator = await createUser("DISPATCHER", "coordinator");
  await grantSystemRole(coordinator.id, "OPERATION_COORDINATOR");
  const supervisor = await createUser("DISPATCHER", "supervisor");
  await grantSystemRole(supervisor.id, "OPERATION_SUPERVISOR");
  coordinatorCookie = need(await loginAs(coordinator.email, PASSWORD), "coordinator session");
  supervisorCookie = need(await loginAs(supervisor.email, PASSWORD), "supervisor session");

  const driverUser = await createUser("DRIVER", "driver");
  driverId = genId();
  await db.insert(drivers).values({ id: driverId, tenantId, userId: driverUser.id, licenseNumber: `P202-${run}`, status: "AVAILABLE" });
  driverCookie = need(await loginAs(driverUser.email, PASSWORD), "driver session");

  const otherDriverUser = await createUser("DRIVER", "other-driver");
  await db.insert(drivers).values({ id: genId(), tenantId, userId: otherDriverUser.id, licenseNumber: `P202X-${run}`, status: "AVAILABLE" });
  otherDriverCookie = need(await loginAs(otherDriverUser.email, PASSWORD), "other driver session");

  // ── Tankers: one exact-capacity, one wrong-capacity ──
  tankerId = genId();
  await db.insert(vehicles).values({ id: tankerId, tenantId, plateNumber: `P202-${run}-21K`, vehicleType: "Water Tanker", capacityLiters: CAPACITY, status: "AVAILABLE", homeWarehouseId: loadingPointId });
  wrongTankerId = genId();
  await db.insert(vehicles).values({ id: wrongTankerId, tenantId, plateNumber: `P202-${run}-18K`, vehicleType: "Water Tanker", capacityLiters: WRONG_CAPACITY, status: "AVAILABLE", homeWarehouseId: loadingPointId });

  // ── B2B commercial master data: company → site → ACTIVE contract → single-capacity rule ──
  b2bCustomerId = genId();
  await db.insert(customers).values({ id: b2bCustomerId, tenantId, name: `P2-02 Golden Facilities ${run}`, type: "B2B", address: "Olaya St, Riyadh", lat: 24.69, lng: 46.68 });
  b2bSiteId = genId();
  await db.insert(customerLocations).values({ id: b2bSiteId, customerId: b2bCustomerId, label: `Olaya Tower Site ${run}`, address: "Olaya St, Riyadh", lat: 24.69, lng: 46.68, cityCode: "RUH" });
  b2bContractId = genId();
  const start = new Date(); start.setMonth(start.getMonth() - 1);
  await db.insert(contracts).values({ id: b2bContractId, tenantId, customerId: b2bCustomerId, contractNumber: `P202-GP-${run}`, type: "ONE_TIME_TRIP_COUNT", status: "ACTIVE", appliesToAllSites: true, totalTripsPurchased: 20, tripsUsed: 0, startDate: start });
  await db.insert(contractPricingRules).values({ id: genId(), tenantId, pricingScope: "CONTRACT", contractId: b2bContractId, rateType: "STANDARD", tankerCapacityLtr: CAPACITY, pricePerTrip: 550, vatRate: 0.15 });

  // ── B2C customer ──
  b2cCustomerId = genId();
  await db.insert(customers).values({ id: b2cCustomerId, tenantId, name: `P2-02 Direct Villa ${run}`, type: "B2C", address: "Al Malqa, Riyadh", lat: 24.81, lng: 46.61 });
}, 60_000);

// ═════════════════════════════════════════════════════════════════════════════
describe("P2-02 golden path — COORDINATOR (B2B contract order → unassigned planned trip)", () => {
  it("1–2. coordinator is authenticated and sees the deterministic B2B customer", async () => {
    const r = await call("@/app/api/customers/route", "GET", "/api/customers", coordinatorCookie);
    expect(r.status).toBe(200);
    expect(r.json.some((c: any) => c.id === b2bCustomerId && c.type === "B2B")).toBe(true);
  });

  it("3. site list for the customer contains the site", async () => {
    const r = await call("@/app/api/customers/[id]/locations/route", "GET", `/api/customers/${b2bCustomerId}/locations`, coordinatorCookie, undefined, { id: b2bCustomerId });
    expect(r.status).toBe(200);
    expect(r.json.map((s: any) => s.id)).toContain(b2bSiteId);
  });

  it("4–5. eligible ACTIVE contract for customer+site, with its tanker capacity", async () => {
    const r = await call("@/app/api/contracts/eligible/route", "GET", `/api/contracts/eligible?customerId=${b2bCustomerId}&locationId=${b2bSiteId}`, coordinatorCookie);
    expect(r.status).toBe(200);
    const c = r.json.find((x: any) => x.id === b2bContractId);
    expect(c).toBeTruthy();
    expect(c.eligibleTankerCapacities).toEqual([CAPACITY]);
  });

  it("6–7. create order (browser B2B body) → PENDING with the contract's tanker capacity persisted", async () => {
    // Exact body NewOrderPanel.createOrder builds for a single-capacity B2B contract:
    const body = { customerId: b2bCustomerId, qtyOrdered: 1, paymentMethod: "ACCOUNT_CREDIT", locationId: b2bSiteId, contractId: b2bContractId };
    const r = await call(ORDERS, "POST", "/api/orders", coordinatorCookie, body);
    expect(r.status).toBe(201);
    b2bOrderId = need(r.json?.id, "created B2B order id");
    const row = need(await db.query.orders.findFirst({ where: eq(orders.id, b2bOrderId) }), "B2B order row");
    expect(row.status).toBe("PENDING");
    expect(row.contractId).toBe(b2bContractId);
    expect(row.locationId).toBe(b2bSiteId);
    expect(row.requiredTankerCapacityLtr).toBe(CAPACITY);
  });

  it("7b. the order is in the coordinator's Order Queue (GET /api/orders?status=PENDING)", async () => {
    const r = await call(ORDERS, "GET", "/api/orders?status=PENDING", coordinatorCookie);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.json)).toBe(true);
    expect(r.json.some((o: any) => o.id === need(b2bOrderId, "b2bOrderId"))).toBe(true);
  });

  it("8. loading point list (coordinator has no inventory.view) contains the tenant loading point", async () => {
    const r = await call("@/app/api/loading-points/route", "GET", "/api/loading-points", coordinatorCookie);
    expect(r.status).toBe(200);
    expect(r.json.find((lp: any) => lp.id === loadingPointId)?.isDefault).toBe(true);
  });

  it("8b. coordinator CANNOT assign or dispatch (role segregation)", async () => {
    const e = await call("@/app/api/fleet/eligible-vehicles/route", "GET", `/api/fleet/eligible-vehicles?capacity=${CAPACITY}`, coordinatorCookie);
    expect(e.status).toBe(403);
  });

  it("9–12. POST /api/trips with ONLY { orderIds, warehouseId } → PLANNED, driverId NULL, vehicleId NULL", async () => {
    expect(Object.keys(browserPlanTripBody("o", "w")).sort()).toEqual(["orderIds", "warehouseId"]); // no driverId, no vehicleId
    const driverBefore = need(await db.query.drivers.findFirst({ where: eq(drivers.id, driverId) }), "driver");
    const r = await call(TRIPS, "POST", "/api/trips", coordinatorCookie, browserPlanTripBody(need(b2bOrderId, "b2bOrderId"), loadingPointId));
    expect(r.status).toBe(201);
    b2bTripId = need(r.json?.id, "planned trip id");

    const trip = need(await db.query.trips.findFirst({ where: eq(trips.id, b2bTripId) }), "trip row");
    expect(trip.status).toBe("PLANNED");
    expect(trip.driverId).toBeNull();
    expect(trip.vehicleId).toBeNull();
    expect(trip.warehouseId).toBe(loadingPointId);
    expect(trip.dispatchedAt).toBeNull();
    // Planning never touches resources:
    expect((await db.query.drivers.findFirst({ where: eq(drivers.id, driverId) }))!.status).toBe(driverBefore.status);
    expect((await db.query.vehicles.findFirst({ where: eq(vehicles.id, tankerId) }))!.status).toBe("AVAILABLE");
    // The order left the queue:
    expect((await db.query.orders.findFirst({ where: eq(orders.id, b2bOrderId) }))!.status).toBe("ASSIGNED");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("P2-02 golden path — SUPERVISOR (assign, then dispatch separately)", () => {
  it("13–14. supervisor retrieves the exact same trip; required capacity is derived from the order", async () => {
    const list = await call(TRIPS, "GET", "/api/trips?status=PLANNED&view=operational", supervisorCookie);
    expect(list.status).toBe(200);
    const row = list.json.find((t: any) => t.id === need(b2bTripId, "b2bTripId"));
    expect(row).toBeTruthy();
    expect(row.requiredTankerCapacityLtr).toBe(CAPACITY);
    expect(row.driver).toBeNull();
    expect(row.vehicle).toBeNull();
    expect(row.isAssigned).toBe(false);
    expect(row.customer.id).toBe(b2bCustomerId);
    expect(row.site.id).toBe(b2bSiteId);
    expect(row.loadingPoint.id).toBe(loadingPointId);
    expect(row.order.orderType).toBe("B2B_CONTRACT");

    const detail = await call(TRIP, "GET", `/api/trips/${b2bTripId}`, supervisorCookie, undefined, { id: b2bTripId });
    expect(detail.status).toBe(200);
    expect(detail.json).toEqual(row); // list row and detail agree exactly
  });

  it("15. eligible exact-capacity tanker appears; wrong-capacity tanker is INELIGIBLE with reason", async () => {
    const r = await call("@/app/api/fleet/eligible-vehicles/route", "GET", `/api/fleet/eligible-vehicles?tripId=${b2bTripId}`, supervisorCookie);
    expect(r.status).toBe(200);
    expect(r.json.requiredTankerCapacityLtr).toBe(CAPACITY);
    const mine = r.json.results.find((v: any) => v.candidate.id === tankerId);
    expect(mine).toMatchObject({ eligible: true, availability: "AVAILABLE" });
    const wrong = r.json.results.find((v: any) => v.candidate.id === wrongTankerId);
    expect(wrong).toMatchObject({ eligible: false, availability: "INELIGIBLE" });
    expect(wrong.reason).toContain("exact match required");
    for (const v of r.json.results.filter((x: any) => x.eligible)) expect(v.candidate.capacityLiters).toBe(CAPACITY);
  });

  it("16. eligible driver appears (DB status AVAILABLE)", async () => {
    const r = await call("@/app/api/fleet/eligible-drivers/route", "GET", `/api/fleet/eligible-drivers?tripId=${b2bTripId}`, supervisorCookie);
    expect(r.status).toBe(200);
    expect(r.json.results.find((d: any) => d.candidate.id === driverId)).toMatchObject({ eligible: true, availability: "AVAILABLE" });
  });

  it("16b. assigning the wrong-capacity tanker is rejected server-side", async () => {
    const r = await call("@/app/api/trips/[id]/assign/route", "PATCH", `/api/trips/${b2bTripId}/assign`, supervisorCookie, { vehicleId: wrongTankerId }, { id: b2bTripId });
    expect(r.status).toBe(422);
    expect(r.json.errorCode).toBe("VEHICLE_INELIGIBLE");
  });

  it("16c. dispatch before assignment is refused (MISSING_ASSIGNMENT)", async () => {
    const r = await call("@/app/api/trips/[id]/dispatch/route", "POST", `/api/trips/${b2bTripId}/dispatch`, supervisorCookie, {}, { id: b2bTripId });
    expect(r.status).toBe(422);
    expect(r.json.errorCode).toBe("MISSING_ASSIGNMENT");
  });

  it("17–19. assign tanker + driver → persisted, trip REMAINS PLANNED, resources not yet in use", async () => {
    const r = await call("@/app/api/trips/[id]/assign/route", "PATCH", `/api/trips/${b2bTripId}/assign`, supervisorCookie, { vehicleId: tankerId, driverId }, { id: b2bTripId });
    expect(r.status).toBe(200);
    expect(r.json.trip.isAssigned).toBe(true);
    const trip = need(await db.query.trips.findFirst({ where: eq(trips.id, b2bTripId) }), "trip row");
    expect(trip.vehicleId).toBe(tankerId);
    expect(trip.driverId).toBe(driverId);
    expect(trip.status).toBe("PLANNED");
    expect(trip.dispatchedAt).toBeNull();
    expect((await db.query.drivers.findFirst({ where: eq(drivers.id, driverId) }))!.status).toBe("AVAILABLE");
    expect((await db.query.vehicles.findFirst({ where: eq(vehicles.id, tankerId) }))!.status).toBe("AVAILABLE");
  });

  it("20–21. dispatch separately → DISPATCHED with audit fields; resources now in active use", async () => {
    const r = await call("@/app/api/trips/[id]/dispatch/route", "POST", `/api/trips/${b2bTripId}/dispatch`, supervisorCookie, {}, { id: b2bTripId });
    expect(r.status).toBe(200);
    const trip = need(await db.query.trips.findFirst({ where: eq(trips.id, b2bTripId) }), "trip row");
    expect(trip.status).toBe("DISPATCHED");
    expect(trip.dispatchedAt).toBeInstanceOf(Date);
    expect(trip.dispatchedBy).toBeTruthy();
    expect((await db.query.drivers.findFirst({ where: eq(drivers.id, driverId) }))!.status).toBe("ON_TRIP");
    expect((await db.query.vehicles.findFirst({ where: eq(vehicles.id, tankerId) }))!.status).toBe("IN_TRIP");
  });

  it("21b. a DISPATCHED trip cannot be dispatched again or re-assigned", async () => {
    const d = await call("@/app/api/trips/[id]/dispatch/route", "POST", `/api/trips/${b2bTripId}/dispatch`, supervisorCookie, {}, { id: b2bTripId });
    expect(d.status).toBe(422);
    expect(d.json.errorCode).toBe("INVALID_DISPATCH_STATE");
    const a = await call("@/app/api/trips/[id]/assign/route", "PATCH", `/api/trips/${b2bTripId}/assign`, supervisorCookie, { driverId }, { id: b2bTripId });
    expect(a.status).toBe(422);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("P2-02 golden path — DRIVER (delivery lifecycle)", () => {
  const lifecycle = (cookie: string, eventType: string) =>
    call("@/app/api/trips/[id]/lifecycle/route", "POST", `/api/trips/${b2bTripId}/lifecycle`, cookie, { eventType }, { id: b2bTripId });

  it("22. the assigned driver sees the dispatched trip", async () => {
    const r = await call(TRIPS, "GET", "/api/trips", driverCookie);
    expect(r.status).toBe(200);
    const mine = r.json.find((t: any) => t.id === b2bTripId);
    expect(mine).toMatchObject({ status: "DISPATCHED", driverId });
    const detail = await call(TRIP, "GET", `/api/trips/${b2bTripId}`, driverCookie, undefined, { id: b2bTripId });
    expect(detail.status).toBe(200);
  });

  it("22b. another driver cannot act on it (identity enforcement)", async () => {
    const r = await lifecycle(otherDriverCookie, "ARRIVED_LOADING");
    expect(r.status).toBe(403);
    expect(r.json.errorCode).toBe("NOT_ASSIGNED");
  });

  it("22c. stages cannot be skipped (sequence enforcement)", async () => {
    const r = await lifecycle(driverCookie, "ARRIVED_SITE");
    expect(r.status).toBe(422);
  });

  it("23. ARRIVED_LOADING (Arrived Loading Point)", async () => {
    expect((await lifecycle(driverCookie, "ARRIVED_LOADING")).status).toBe(201);
  });
  it("24. LOADING_COMPLETE (Confirm Loading)", async () => {
    expect((await lifecycle(driverCookie, "LOADING_COMPLETE")).status).toBe(201);
  });
  it("25. ARRIVED_SITE (Arrived Customer Site) + stop check-in", async () => {
    expect((await lifecycle(driverCookie, "ARRIVED_SITE")).status).toBe(201);
    const stop = need(await db.query.tripStops.findFirst({ where: eq(tripStops.tripId, b2bTripId) }), "trip stop");
    const r = await call("@/app/api/trips/[id]/stops/[stopId]/route", "PATCH", `/api/trips/${b2bTripId}/stops/${stop.id}`, driverCookie, { action: "arrive" }, { id: b2bTripId, stopId: stop.id });
    expect(r.status).toBe(200);
  });

  it("26–27. Delivered: ePOD → UNLOADING_COMPLETE (recorded server-side) → trip COMPLETED", async () => {
    const stop = need(await db.query.tripStops.findFirst({ where: eq(tripStops.tripId, b2bTripId) }), "trip stop");
    const pod = await call("@/app/api/trips/[id]/stops/[stopId]/route", "PATCH", `/api/trips/${b2bTripId}/stops/${stop.id}`, driverCookie,
      { action: "deliver", deliveredQty: 1, recipientName: "Site Supervisor" }, { id: b2bTripId, stopId: stop.id });
    expect(pod.status).toBe(200);
    const trip = need(await db.query.trips.findFirst({ where: eq(trips.id, b2bTripId) }), "trip row");
    expect(trip.status).toBe("COMPLETED");
    expect((await db.query.orders.findFirst({ where: eq(orders.id, b2bOrderId) }))!.status).toBe("DELIVERED");
    // The full canonical stage sequence is persisted, in order:
    const history = await call("@/app/api/trips/[id]/lifecycle/route", "GET", `/api/trips/${b2bTripId}/lifecycle`, driverCookie, undefined, { id: b2bTripId });
    expect(history.status).toBe(200);
    const stages = history.json.events.map((e: any) => e.eventType).filter((t: string) => t !== "NOTE" && t !== "GPS_PING");
    expect(stages).toEqual(["DISPATCHED", "ARRIVED_LOADING", "LOADING_COMPLETE", "ARRIVED_SITE", "UNLOADING_COMPLETE", "CLOSED"]);
  });

  it("28. driver and tanker return to AVAILABLE at the terminal state", async () => {
    expect((await db.query.drivers.findFirst({ where: eq(drivers.id, driverId) }))!.status).toBe("AVAILABLE");
    expect((await db.query.vehicles.findFirst({ where: eq(vehicles.id, tankerId) }))!.status).toBe("AVAILABLE");
  });

  it("29. the completed trip is gone from the actionable PLANNED list (and from active trips)", async () => {
    const planned = await call(TRIPS, "GET", "/api/trips?status=PLANNED&view=operational", supervisorCookie);
    expect(planned.json.some((t: any) => t.id === b2bTripId)).toBe(false);
    const active = await call(TRIPS, "GET", "/api/trips?status=DISPATCHED,IN_PROGRESS&view=operational", supervisorCookie);
    expect(active.json.some((t: any) => t.id === b2bTripId)).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("P2-02 golden path — B2C Direct Order", () => {
  it("30. the direct-order tanker options come from the real fleet", async () => {
    const r = await call("@/app/api/orders/tanker-capacities/route", "GET", "/api/orders/tanker-capacities", coordinatorCookie);
    expect(r.status).toBe(200);
    expect(r.json.capacities.map((c: any) => c.capacityLiters)).toEqual(expect.arrayContaining([WRONG_CAPACITY, CAPACITY]));
  });

  it("30b. create B2C Direct Order (browser B2C body) — no contract, existing direct-order pricing path", async () => {
    const body = { customerId: b2cCustomerId, qtyOrdered: 1, paymentMethod: "CASH", selectedTankerCapacityLtr: CAPACITY };
    const r = await call(ORDERS, "POST", "/api/orders", coordinatorCookie, body);
    expect(r.status).toBe(201);
    b2cOrderId = need(r.json?.id, "B2C order id");
    expect(r.json.contractId ?? null).toBeNull();
    expect(r.json.pricePerBottle).toBeGreaterThan(0); // unchanged Phase 1 direct-order price source
  });

  it("31. the tanker requirement is persisted on the order", async () => {
    const row = need(await db.query.orders.findFirst({ where: eq(orders.id, need(b2cOrderId, "b2cOrderId")) }), "B2C order row");
    expect(row.requiredTankerCapacityLtr).toBe(CAPACITY);
    expect(row.status).toBe("PENDING");
  });

  it("31b. a tanker size that doesn't exist in the fleet is rejected", async () => {
    const r = await call(ORDERS, "POST", "/api/orders", coordinatorCookie, { customerId: b2cCustomerId, qtyOrdered: 1, paymentMethod: "CASH", selectedTankerCapacityLtr: 12345 });
    expect(r.status).toBe(422);
    expect(r.json.errorCode).toBe("INVALID_TANKER_CAPACITY_FOR_FLEET");
  });

  it("32. plan an unassigned trip with the browser payload", async () => {
    const r = await call(TRIPS, "POST", "/api/trips", coordinatorCookie, browserPlanTripBody(need(b2cOrderId, "b2cOrderId"), loadingPointId));
    expect(r.status).toBe(201);
    b2cTripId = need(r.json?.id, "B2C trip id");
    const trip = need(await db.query.trips.findFirst({ where: eq(trips.id, b2cTripId) }), "B2C trip row");
    expect(trip).toMatchObject({ status: "PLANNED", driverId: null, vehicleId: null });
  });

  it("33. assignment eligibility: exact-capacity tanker qualifies, wrong size does not; assignment persists", async () => {
    const e = await call("@/app/api/fleet/eligible-vehicles/route", "GET", `/api/fleet/eligible-vehicles?tripId=${need(b2cTripId, "b2cTripId")}`, supervisorCookie);
    expect(e.status).toBe(200);
    expect(e.json.requiredTankerCapacityLtr).toBe(CAPACITY);
    expect(e.json.results.find((v: any) => v.candidate.id === tankerId)?.eligible).toBe(true);
    expect(e.json.results.find((v: any) => v.candidate.id === wrongTankerId)?.eligible).toBe(false);
    const a = await call("@/app/api/trips/[id]/assign/route", "PATCH", `/api/trips/${b2cTripId}/assign`, supervisorCookie, { vehicleId: tankerId, driverId }, { id: b2cTripId });
    expect(a.status).toBe(200);
    const trip = need(await db.query.trips.findFirst({ where: eq(trips.id, b2cTripId) }), "B2C trip row");
    expect(trip).toMatchObject({ status: "PLANNED", driverId, vehicleId: tankerId });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("P2-02 browser ⇄ API ⇄ test Plan Trip contract", () => {
  it("the browser Plan Trip body is exactly { orderIds: [order.id], warehouseId } — no driverId/vehicleId", () => {
    const src = readFileSync("app/dispatch/page.tsx", "utf8");
    const planFn = src.slice(src.indexOf("async function planTrip()"), src.indexOf("return (", src.indexOf("async function planTrip()")));
    expect(planFn).toContain('fetch("/api/trips"');
    expect(planFn).toContain("body: JSON.stringify({ orderIds: [order.id], warehouseId })");
    expect(planFn).not.toContain("driverId");
    expect(planFn).not.toContain("vehicleId");
  });

  it("this suite's payload builder produces the same key set as the browser", () => {
    expect(Object.keys(browserPlanTripBody("o", "w")).sort()).toEqual(["orderIds", "warehouseId"]);
  });

  it("POST /api/trips schema makes driverId/vehicleId optional and requires orderIds + warehouseId", () => {
    const src = readFileSync("app/api/trips/route.ts", "utf8");
    const schema = src.slice(src.indexOf("const createSchema"), src.indexOf("});", src.indexOf("const createSchema")));
    expect(schema).toContain("orderIds: z.array(z.string().min(1)).min(1)");
    expect(schema).toContain("warehouseId: z.string().min(1)");
    expect(schema).toContain("driverId: z.string().min(1).optional()");
    expect(schema).toContain("vehicleId: z.string().min(1).optional()");
  });

  it("the golden-path test file itself never sends driverId/vehicleId to POST /api/trips", () => {
    const self = readFileSync("tests/integration/p2_02RealGoldenPath.test.ts", "utf8");
    const needle = "call(TRIPS, " + '"POST"';
    const tripPosts = self.split("\n").filter((l) => l.includes(needle));
    expect(tripPosts.length).toBeGreaterThanOrEqual(2);
    for (const l of tripPosts) {
      expect(l).toContain("browserPlanTripBody(");
      expect(l).not.toMatch(/driverId|vehicleId/);
    }
  });

  it("this acceptance suite contains no silent fixture skips", () => {
    const self = readFileSync("tests/integration/p2_02RealGoldenPath.test.ts", "utf8");
    expect(self).not.toMatch(/if \(!\w+\) return;/);
    expect(self).not.toContain("expect(true)" + ".toBe(true)");
  });
});
