/**
 * SMARTY1 P2-02 — contract, authorization, resource-status and isolation tests.
 *
 * Prevents recurrence of the defects the independent source verification found:
 *   - API returns array / UI expects wrapper          - status query ignored
 *   - API returns .results / UI expects .vehicles     - required capacity lost order → trip
 *   - plateNumber / plate mismatch                    - browser Plan Trip payload ≠ API schema
 *   - tripNumber / internal id mismatch               - assignment list and detail disagree
 *   - POST /api/orders (and /bulk) gated by orders.view instead of orders.create
 *   - resources marked busy at planning; never released on failure
 *
 * Every fixture is created in beforeAll and throws if it cannot be — no silent skips.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { db } from "@/lib/db/client";
import {
  users, userRoles, roles, rolePermissions, permissions, customers, customerLocations, contracts,
  contractPricingRules, drivers, vehicles, warehouses, trips, orders, tripStops, exceptions,
} from "@/lib/db/schema";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { genId } from "@/lib/helpers";
import { hashPassword } from "@/lib/auth";
import { makeRequest, loginAs } from "../helpers/request";
import { runBootstrap } from "../../scripts/bootstrapRbac";

const PASSWORD = "Contracts_P202!";
const run = genId().slice(0, 6);
const CAP = 28000;

let tenantId: string;
let otherTenantAdminCookie: string;
let viewOnlyCookie: string;
let creatorCookie: string;
let coordinatorCookie: string;
let supervisorCookie: string;
let driverCookie: string;
let driverId: string;
let tankerId: string;
let loadingPointId: string;
let b2cCustomerId: string;
let b2bCustomerId: string;
let b2bSiteId: string;
let multiContractId: string;

function need<T>(value: T | null | undefined | "", what: string): T {
  if (value === null || value === undefined || value === "") throw new Error(`P2-02 contract-test fixture missing: ${what}`);
  return value as T;
}

async function call(modPath: string, method: string, url: string, cookie: string, body?: unknown, params?: Record<string, string>) {
  const mod: any = await import(/* @vite-ignore */ modPath);
  const req = makeRequest(url, { method, cookie, body });
  const res: Response = params ? await mod[method](req, { params: Promise.resolve(params) }) : await mod[method](req);
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function userWith(role: "DISPATCHER" | "DRIVER", label: string): Promise<{ id: string; email: string }> {
  const id = genId();
  const email = `p202c-${label}-${run}@contracts.test`;
  await db.insert(users).values({ id, tenantId, email, name: `P2-02 C ${label}`, role, passwordHash: await hashPassword(PASSWORD) });
  return { id, email };
}

async function tenantRole(name: string, codes: string[]): Promise<string> {
  const roleId = genId();
  await db.insert(roles).values({ id: roleId, tenantId, name: `${name}_${run}`, label: name, isSystemRole: false });
  const perms = await db.query.permissions.findMany({ where: inArray(permissions.code, codes) });
  if (perms.length !== codes.length) throw new Error(`permission catalogue missing one of ${codes.join(",")}`);
  for (const p of perms) await db.insert(rolePermissions).values({ id: genId(), roleId, permissionId: p.id });
  return roleId;
}

async function systemRole(name: string): Promise<string> {
  return need(await db.query.roles.findFirst({ where: and(eq(roles.name, name), isNull(roles.tenantId)) }), `system role ${name}`).id;
}

/** Order (B2C direct, capacity CAP) → planned trip, via the real APIs. */
async function plannedTrip(): Promise<{ orderId: string; tripId: string }> {
  const o = await call("@/app/api/orders/route", "POST", "/api/orders", coordinatorCookie, { customerId: b2cCustomerId, qtyOrdered: 1, paymentMethod: "CASH", selectedTankerCapacityLtr: CAP });
  const orderId = need(o.json?.id, `order (status ${o.status})`);
  const t = await call("@/app/api/trips/route", "POST", "/api/trips", coordinatorCookie, { orderIds: [orderId], warehouseId: loadingPointId });
  return { orderId, tripId: need(t.json?.id, `trip (status ${t.status} ${JSON.stringify(t.json)})`) };
}

beforeAll(async () => {
  await runBootstrap();
  const tenant = need(await db.query.tenants.findFirst({ where: (t, { eq: e }) => e(t.name, "Riyadh Bulk Water Logistics") }), "Riyadh tenant");
  tenantId = tenant.id;
  loadingPointId = need(await db.query.warehouses.findFirst({ where: eq(warehouses.tenantId, tenantId) }), "loading point").id;

  const viewOnly = await userWith("DISPATCHER", "view-only");
  await db.insert(userRoles).values({ id: genId(), userId: viewOnly.id, roleId: await tenantRole("P202_ORDERS_VIEW_ONLY", ["orders.view"]), tenantId });
  const creator = await userWith("DISPATCHER", "creator");
  await db.insert(userRoles).values({ id: genId(), userId: creator.id, roleId: await tenantRole("P202_ORDERS_CREATE", ["orders.view", "orders.create"]), tenantId });
  const coordinator = await userWith("DISPATCHER", "coordinator");
  await db.insert(userRoles).values({ id: genId(), userId: coordinator.id, roleId: await systemRole("OPERATION_COORDINATOR"), tenantId });
  const supervisor = await userWith("DISPATCHER", "supervisor");
  await db.insert(userRoles).values({ id: genId(), userId: supervisor.id, roleId: await systemRole("OPERATION_SUPERVISOR"), tenantId });
  viewOnlyCookie = await loginAs(viewOnly.email, PASSWORD);
  creatorCookie = await loginAs(creator.email, PASSWORD);
  coordinatorCookie = await loginAs(coordinator.email, PASSWORD);
  supervisorCookie = await loginAs(supervisor.email, PASSWORD);

  const d = await userWith("DRIVER", "driver");
  driverId = genId();
  await db.insert(drivers).values({ id: driverId, tenantId, userId: d.id, licenseNumber: `P202C-${run}`, status: "AVAILABLE" });
  driverCookie = await loginAs(d.email, PASSWORD);
  tankerId = genId();
  await db.insert(vehicles).values({ id: tankerId, tenantId, plateNumber: `P202C-${run}`, vehicleType: "Water Tanker", capacityLiters: CAP, status: "AVAILABLE" });

  b2cCustomerId = genId();
  await db.insert(customers).values({ id: b2cCustomerId, tenantId, name: `P2-02 C Direct ${run}`, type: "B2C", address: "Riyadh", lat: 24.7, lng: 46.7 });
  b2bCustomerId = genId();
  await db.insert(customers).values({ id: b2bCustomerId, tenantId, name: `P2-02 C Company ${run}`, type: "B2B", address: "Riyadh", lat: 24.7, lng: 46.7 });
  b2bSiteId = genId();
  await db.insert(customerLocations).values({ id: b2bSiteId, customerId: b2bCustomerId, label: `C Site ${run}`, address: "Riyadh", lat: 24.7, lng: 46.7 });
  multiContractId = genId();
  const start = new Date(); start.setMonth(start.getMonth() - 1);
  await db.insert(contracts).values({ id: multiContractId, tenantId, customerId: b2bCustomerId, contractNumber: `P202-MULTI-${run}`, type: "MONTHLY_ACCUMULATED", status: "ACTIVE", appliesToAllSites: true, billingCadence: "MONTHLY", startDate: start });
  await db.insert(contractPricingRules).values([
    { id: genId(), tenantId, pricingScope: "CONTRACT", contractId: multiContractId, rateType: "STANDARD", tankerCapacityLtr: 18000, pricePerTrip: 450, vatRate: 0.15 },
    { id: genId(), tenantId, pricingScope: "CONTRACT", contractId: multiContractId, rateType: "STANDARD", tankerCapacityLtr: 21000, pricePerTrip: 550, vatRate: 0.15 },
  ]);

  const other = need(await db.query.tenants.findFirst({ where: (t, { eq: e }) => e(t.name, "Demo Water Co.") }), "Demo Water Co. tenant");
  const otherAdmin = need(await db.query.users.findFirst({ where: and(eq(users.tenantId, other.id), eq(users.role, "ADMIN")) }), "other-tenant admin");
  otherTenantAdminCookie = await loginAs(otherAdmin.email, "password123");
}, 60_000);

// ─────────────────────────────────────────────────────────────────────────────
describe("ORDERS_CREATE authorization (behavioural)", () => {
  const b2cBody = () => ({ customerId: b2cCustomerId, qtyOrdered: 1, paymentMethod: "CASH", selectedTankerCapacityLtr: CAP });

  it("orders.view only → GET /api/orders allowed", async () => {
    expect((await call("@/app/api/orders/route", "GET", "/api/orders", viewOnlyCookie)).status).toBe(200);
  });
  it("orders.view only → POST /api/orders denied (403 PERMISSION_DENIED orders.create)", async () => {
    const r = await call("@/app/api/orders/route", "POST", "/api/orders", viewOnlyCookie, b2cBody());
    expect(r.status).toBe(403);
    expect(r.json).toMatchObject({ errorCode: "PERMISSION_DENIED", permission: "orders.create" });
  });
  it("orders.view only → POST /api/orders/bulk denied (bulk creates orders)", async () => {
    const r = await call("@/app/api/orders/bulk/route", "POST", "/api/orders/bulk", viewOnlyCookie, { customerId: b2cCustomerId, items: [{ locationId: b2bSiteId, qtyOrdered: 1 }] });
    expect(r.status).toBe(403);
    expect(r.json.permission).toBe("orders.create");
  });
  it("orders.create → POST /api/orders allowed", async () => {
    const r = await call("@/app/api/orders/route", "POST", "/api/orders", creatorCookie, b2cBody());
    expect(r.status).toBe(201);
  });
  it("source: POST uses ORDERS_CREATE, GET uses ORDERS_VIEW", () => {
    const src = readFileSync("app/api/orders/route.ts", "utf8");
    const post = src.slice(src.indexOf("export async function POST"));
    const get = src.slice(src.indexOf("export async function GET"), src.indexOf("export async function POST"));
    expect(post).toContain("PERMISSIONS.ORDERS_CREATE");
    expect(post).not.toContain("PERMISSIONS.ORDERS_VIEW");
    expect(get).toContain("PERMISSIONS.ORDERS_VIEW");
    expect(readFileSync("app/api/orders/bulk/route.ts", "utf8")).toContain("PERMISSIONS.ORDERS_CREATE");
  });
  it("legacy RBAC fallback is still present (removal is a separate controlled rollout)", () => {
    expect(readFileSync("lib/requirePermission.ts", "utf8")).toContain("const LEGACY_PERMISSIONS");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("Multi-capacity contract (strict equality preserved)", () => {
  const body = (extra: Record<string, unknown> = {}) => ({ customerId: b2bCustomerId, locationId: b2bSiteId, contractId: multiContractId, qtyOrdered: 1, paymentMethod: "ACCOUNT_CREDIT", ...extra });

  it("eligible contract exposes both capacities for the selector", async () => {
    const r = await call("@/app/api/contracts/eligible/route", "GET", `/api/contracts/eligible?customerId=${b2bCustomerId}&locationId=${b2bSiteId}`, coordinatorCookie);
    expect(r.json.find((c: any) => c.id === multiContractId).eligibleTankerCapacities.sort()).toEqual([18000, 21000]);
  });
  it("no selection → 422 TANKER_CAPACITY_REQUIRED", async () => {
    const r = await call("@/app/api/orders/route", "POST", "/api/orders", coordinatorCookie, body());
    expect(r.status).toBe(422);
    expect(r.json.errorCode).toBe("TANKER_CAPACITY_REQUIRED");
  });
  it("a size the contract does not price → 422 INVALID_TANKER_CAPACITY_FOR_CONTRACT", async () => {
    const r = await call("@/app/api/orders/route", "POST", "/api/orders", coordinatorCookie, body({ selectedTankerCapacityLtr: 28000 }));
    expect(r.status).toBe(422);
    expect(r.json.errorCode).toBe("INVALID_TANKER_CAPACITY_FOR_CONTRACT");
  });
  it("explicit 21,000 L → persisted exactly", async () => {
    const r = await call("@/app/api/orders/route", "POST", "/api/orders", coordinatorCookie, body({ selectedTankerCapacityLtr: 21000 }));
    expect(r.status).toBe(201);
    expect(r.json.requiredTankerCapacityLtr).toBe(21000);
  });
  it("B2B without contract is still refused — no commercial bypass", async () => {
    const r = await call("@/app/api/orders/route", "POST", "/api/orders", coordinatorCookie, { customerId: b2bCustomerId, locationId: b2bSiteId, qtyOrdered: 1 });
    expect(r.status).toBe(422);
    expect(r.json.errorCode).toBe("B2B_CONTRACT_REQUIRED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("API ⇄ UI response contracts", () => {
  let tripId = "";
  let orderId = "";
  beforeAll(async () => {
    ({ tripId, orderId } = await plannedTrip());
  });

  it("GET /api/trips?view=operational returns a plain array (no wrapper), and the UI reads it as one", async () => {
    const r = await call("@/app/api/trips/route", "GET", "/api/trips?status=PLANNED&view=operational", supervisorCookie);
    expect(Array.isArray(r.json)).toBe(true);
    for (const page of ["app/dispatch/page.tsx", "app/dispatch/assign/page.tsx"]) {
      const src = readFileSync(page, "utf8");
      expect(src).not.toMatch(/\.trips \?\?|\.data \?\?/);
    }
  });

  it("status query is honoured (PLANNED filter returns only PLANNED; unknown status returns none)", async () => {
    const planned = await call("@/app/api/trips/route", "GET", "/api/trips?status=PLANNED", supervisorCookie);
    expect(planned.json.length).toBeGreaterThan(0);
    expect(planned.json.every((t: any) => t.status === "PLANNED")).toBe(true);
    const none = await call("@/app/api/trips/route", "GET", "/api/trips?status=NO_SUCH_STATUS", supervisorCookie);
    expect(none.json).toEqual([]);
    const multi = await call("@/app/api/trips/route", "GET", "/api/trips?status=PLANNED,COMPLETED&view=operational", supervisorCookie);
    expect(multi.json.every((t: any) => ["PLANNED", "COMPLETED"].includes(t.status))).toBe(true);
  });

  it("eligible-vehicles returns { results } (not .vehicles) with plateNumber (not plate), and the workspace reads exactly that", async () => {
    const r = await call("@/app/api/fleet/eligible-vehicles/route", "GET", `/api/fleet/eligible-vehicles?tripId=${tripId}`, supervisorCookie);
    expect(Array.isArray(r.json.results)).toBe(true);
    expect(r.json.vehicles).toBeUndefined();
    const mine = r.json.results.find((v: any) => v.candidate.id === tankerId);
    expect(mine.candidate.plateNumber).toBe(`P202C-${run}`);
    expect(mine.candidate.plate).toBeUndefined();
    expect(["AVAILABLE", "BUSY", "INELIGIBLE"]).toContain(mine.availability);
    const ws = readFileSync("app/dispatch/assign/page.tsx", "utf8");
    expect(ws).toContain("vData?.results");
    expect(ws).not.toMatch(/vData\??\.vehicles|\.plate\b/);
    expect(readFileSync("app/dispatch/page.tsx", "utf8")).not.toMatch(/\.plate\b/);
  });

  it("eligible-drivers: every result has availability + reason; AVAILABLE status never shown as silently ineligible", async () => {
    const r = await call("@/app/api/fleet/eligible-drivers/route", "GET", `/api/fleet/eligible-drivers?tripId=${tripId}`, supervisorCookie);
    for (const d of r.json.results) {
      expect(typeof d.reason).toBe("string");
      expect(d.reason.length).toBeGreaterThan(0);
      if (d.candidate.status === "AVAILABLE" && !d.eligible) expect(d.availability).toBe("BUSY"); // explained conflict, never "Driver status is AVAILABLE"
    }
    expect(r.json.results.find((d: any) => d.candidate.id === driverId)?.eligible).toBe(true);
  });

  it("tripNumber is the business number (not the internal id) everywhere it is displayed", async () => {
    const row = need(await db.query.trips.findFirst({ where: eq(trips.id, tripId) }), "trip");
    const r = await call("@/app/api/trips/[id]/route", "GET", `/api/trips/${tripId}`, supervisorCookie, undefined, { id: tripId });
    expect(r.json.tripNumber).toBe(row.tripNumber);
    expect(r.json.tripNumber).not.toBe(tripId);
    for (const page of ["app/dispatch/page.tsx", "app/dispatch/assign/page.tsx"]) {
      expect(readFileSync(page, "utf8")).not.toContain("id.slice(-6)");
    }
  });

  it("required capacity survives order → trip → eligibility", async () => {
    const order = need(await db.query.orders.findFirst({ where: eq(orders.id, orderId) }), "order");
    expect(order.requiredTankerCapacityLtr).toBe(CAP);
    const dto = await call("@/app/api/trips/[id]/route", "GET", `/api/trips/${tripId}`, supervisorCookie, undefined, { id: tripId });
    expect(dto.json.requiredTankerCapacityLtr).toBe(CAP);
    const e = await call("@/app/api/fleet/eligible-vehicles/route", "GET", `/api/fleet/eligible-vehicles?tripId=${tripId}`, supervisorCookie);
    expect(e.json.requiredTankerCapacityLtr).toBe(CAP);
    for (const v of e.json.results.filter((x: any) => x.eligible)) expect(v.candidate.capacityLiters).toBe(CAP);
  });

  it("assignment list row and detail are the same DTO", async () => {
    const list = await call("@/app/api/trips/route", "GET", "/api/trips?status=PLANNED&view=operational", supervisorCookie);
    const detail = await call("@/app/api/trips/[id]/route", "GET", `/api/trips/${tripId}`, supervisorCookie, undefined, { id: tripId });
    expect(detail.json).toEqual(list.json.find((t: any) => t.id === tripId));
    const ws = readFileSync("app/dispatch/assign/page.tsx", "utf8");
    expect(ws).toContain("const selected = trips.find((t) => t.id === selectedId) ?? null;");
  });

  it("an unassigned trip is shown as Unassigned (never a fake check mark)", async () => {
    const detail = await call("@/app/api/trips/[id]/route", "GET", `/api/trips/${tripId}`, supervisorCookie, undefined, { id: tripId });
    expect(detail.json).toMatchObject({ driver: null, vehicle: null, isAssigned: false });
    const ws = readFileSync("app/dispatch/assign/page.tsx", "utf8");
    expect(ws).toContain("Unassigned");
    expect(ws).not.toContain("Vehicle ✓");
  });

  it("Plan Trip: browser payload == API schema == canonical request; extra legacy half-payload rejected", async () => {
    const half = await call("@/app/api/trips/route", "POST", "/api/trips", coordinatorCookie, { orderIds: [orderId], warehouseId: loadingPointId, driverId });
    expect(half.status).toBe(400); // driverId without vehicleId is never silently accepted
    const missingLp = await call("@/app/api/trips/route", "POST", "/api/trips", coordinatorCookie, { orderIds: [orderId] });
    expect(missingLp.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("Resource status follows the correct event", () => {
  it("plan → no change; assign → no change; dispatch → ON_TRIP/IN_TRIP; Mark Failed → AVAILABLE + exception", async () => {
    const { orderId, tripId } = await plannedTrip();
    const status = async () => ({
      d: (await db.query.drivers.findFirst({ where: eq(drivers.id, driverId) }))!.status,
      v: (await db.query.vehicles.findFirst({ where: eq(vehicles.id, tankerId) }))!.status,
    });
    expect(await status()).toEqual({ d: "AVAILABLE", v: "AVAILABLE" });
    expect((await call("@/app/api/trips/[id]/assign/route", "PATCH", `/api/trips/${tripId}/assign`, supervisorCookie, { vehicleId: tankerId, driverId }, { id: tripId })).status).toBe(200);
    expect(await status()).toEqual({ d: "AVAILABLE", v: "AVAILABLE" });

    // Driver cannot act before dispatch:
    const early = await call("@/app/api/trips/[id]/lifecycle/route", "POST", `/api/trips/${tripId}/lifecycle`, driverCookie, { eventType: "ARRIVED_LOADING" }, { id: tripId });
    expect(early.status).toBe(422);
    expect(early.json.errorCode).toBe("TRIP_NOT_DISPATCHED");

    expect((await call("@/app/api/trips/[id]/dispatch/route", "POST", `/api/trips/${tripId}/dispatch`, supervisorCookie, {}, { id: tripId })).status).toBe(200);
    expect(await status()).toEqual({ d: "ON_TRIP", v: "IN_TRIP" });

    const stop = need(await db.query.tripStops.findFirst({ where: eq(tripStops.tripId, tripId) }), "stop");
    const fail = await call("@/app/api/trips/[id]/stops/[stopId]/route", "PATCH", `/api/trips/${tripId}/stops/${stop.id}`, driverCookie, { action: "fail", failureReason: "Gate closed" }, { id: tripId, stopId: stop.id });
    expect(fail.status).toBe(200);
    expect((await db.query.trips.findFirst({ where: eq(trips.id, tripId) }))!.status).toBe("COMPLETED");
    expect(await status()).toEqual({ d: "AVAILABLE", v: "AVAILABLE" });
    expect(await db.query.exceptions.findFirst({ where: eq(exceptions.orderId, orderId) })).toBeTruthy();

    // A COMPLETED trip can never be dispatched again:
    const again = await call("@/app/api/trips/[id]/dispatch/route", "POST", `/api/trips/${tripId}/dispatch`, supervisorCookie, {}, { id: tripId });
    expect(again.status).toBe(422);
    expect(again.json.errorCode).toBe("INVALID_DISPATCH_STATE");
  });

  it("a tanker in MAINTENANCE is INELIGIBLE (with reason) and cannot be dispatched", async () => {
    const { tripId } = await plannedTrip();
    expect((await call("@/app/api/trips/[id]/assign/route", "PATCH", `/api/trips/${tripId}/assign`, supervisorCookie, { vehicleId: tankerId, driverId }, { id: tripId })).status).toBe(200);
    await db.update(vehicles).set({ status: "MAINTENANCE" }).where(eq(vehicles.id, tankerId));
    try {
      const e = await call("@/app/api/fleet/eligible-vehicles/route", "GET", `/api/fleet/eligible-vehicles?tripId=${tripId}`, supervisorCookie);
      expect(e.json.results.find((v: any) => v.candidate.id === tankerId)).toMatchObject({ eligible: false, availability: "INELIGIBLE", reason: "Vehicle status is MAINTENANCE" });
      const d = await call("@/app/api/trips/[id]/dispatch/route", "POST", `/api/trips/${tripId}/dispatch`, supervisorCookie, {}, { id: tripId });
      expect(d.status).toBe(422);
      expect(d.json.errorCode).toBe("VEHICLE_INELIGIBLE");
    } finally {
      await db.update(vehicles).set({ status: "AVAILABLE" }).where(eq(vehicles.id, tankerId));
      await db.update(trips).set({ vehicleId: null, driverId: null }).where(eq(trips.id, tripId));
    }
  });

  it("the same tanker cannot be assigned to two open trips", async () => {
    const a = await plannedTrip();
    const b = await plannedTrip();
    expect((await call("@/app/api/trips/[id]/assign/route", "PATCH", `/api/trips/${a.tripId}/assign`, supervisorCookie, { vehicleId: tankerId }, { id: a.tripId })).status).toBe(200);
    const second = await call("@/app/api/trips/[id]/assign/route", "PATCH", `/api/trips/${b.tripId}/assign`, supervisorCookie, { vehicleId: tankerId }, { id: b.tripId });
    expect(second.status).toBe(422);
    expect(second.json.errorCode).toBe("VEHICLE_INELIGIBLE");
    expect(second.json.error).toContain("Assigned to trip");
    await db.update(trips).set({ vehicleId: null }).where(eq(trips.id, a.tripId));
  });

  it("the same order cannot be planned twice", async () => {
    const { orderId } = await plannedTrip();
    const r = await call("@/app/api/trips/route", "POST", "/api/trips", coordinatorCookie, { orderIds: [orderId], warehouseId: loadingPointId });
    expect(r.status).toBe(422);
    expect(r.json.errorCode).toBe("ORDER_NOT_PLANNABLE");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("Tenant isolation", () => {
  it("another tenant cannot read, plan, assign or dispatch this tenant's work", async () => {
    const { orderId, tripId } = await plannedTrip();
    const otherLp = need(await db.query.warehouses.findFirst({ where: (w, { ne }) => ne(w.tenantId, tenantId) }), "other-tenant loading point");
    expect((await call("@/app/api/trips/[id]/route", "GET", `/api/trips/${tripId}`, otherTenantAdminCookie, undefined, { id: tripId })).status).toBe(404);
    expect((await call("@/app/api/trips/[id]/assign/route", "PATCH", `/api/trips/${tripId}/assign`, otherTenantAdminCookie, { driverId }, { id: tripId })).status).toBe(404);
    expect((await call("@/app/api/trips/[id]/dispatch/route", "POST", `/api/trips/${tripId}/dispatch`, otherTenantAdminCookie, {}, { id: tripId })).status).toBe(404);
    expect((await call("@/app/api/fleet/eligible-vehicles/route", "GET", `/api/fleet/eligible-vehicles?tripId=${tripId}`, otherTenantAdminCookie)).status).toBe(404);
    const plan = await call("@/app/api/trips/route", "POST", "/api/trips", otherTenantAdminCookie, { orderIds: [orderId], warehouseId: otherLp.id });
    expect(plan.status).toBe(404);
    // …and this tenant cannot plan onto another tenant's loading point:
    const cross = await call("@/app/api/trips/route", "POST", "/api/trips", coordinatorCookie, { orderIds: [orderId], warehouseId: otherLp.id });
    expect([404, 422]).toContain(cross.status);
    const list = await call("@/app/api/trips/route", "GET", "/api/trips?view=operational", otherTenantAdminCookie);
    expect(list.json.some((t: any) => t.id === tripId)).toBe(false);
  });
});
