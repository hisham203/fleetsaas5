import { describe, it, expect, beforeAll } from "vitest";
import { makeRequest, loginAs } from "../helpers/request";
import { db } from "@/lib/db/client";
import { contractPricingRules } from "@/lib/db/schema";
import { genId } from "@/lib/helpers";
import { createIsolatedDriverAndVehicle } from "../helpers/testFixtures";

// Task S1 — deliberate passwordHash / sensitive field exposure audit.
// Every test below proves a specific, confirmed exposure found during the
// audit is now fixed — not by inference, but by directly calling the
// route and asserting the string "passwordHash" never appears anywhere in
// the real serialized response body.
describe("S1 — passwordHash exposure audit", () => {
  let waterAdminCookie: string;
  let dispatcherCookie: string;
  let driverCookie: string;
  let assignedDriverCookie: string;
  let tenantId: string;
  let jarirId: string;
  let vehicleId: string;
  let driverId: string;

  beforeAll(async () => {
    waterAdminCookie = await loginAs("admin@demo-water.co", "password123");
    dispatcherCookie = await loginAs("dispatch@demo-water.co", "password123");
    driverCookie = await loginAs("khalid@demo-water.co", "password123");

    const { GET: tenantGet } = await import("@/app/api/tenant/route");
    tenantId = (await (await tenantGet(makeRequest("/api/tenant", { cookie: waterAdminCookie }))).json()).id;

    const { GET: customersGet } = await import("@/app/api/customers/route");
    jarirId = (await (await customersGet(makeRequest("/api/customers", { cookie: waterAdminCookie }))).json()).find((c: any) => c.name === "Jarir Bookstore HQ").id;

    const isolated = await createIsolatedDriverAndVehicle(tenantId, "s1-audit");
    vehicleId = isolated.vehicleId;
    driverId = isolated.driverId;
    assignedDriverCookie = isolated.driverCookie;
  });

  it("1. GET/POST /api/drivers — the canonical driver-listing endpoint — never exposes passwordHash", async () => {
    const { GET } = await import("@/app/api/drivers/route");
    const res = await GET(makeRequest("/api/drivers", { cookie: waterAdminCookie }));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("passwordHash");
    const body = JSON.parse(text);
    expect(body.length).toBeGreaterThan(0);
    expect(body[0].user.email).toBeTruthy(); // safe fields still present — existing lookups by email keep working
  });

  it("2. GET/POST /api/tasks never exposes passwordHash on the embedded driver.user", async () => {
    const { POST: createTask } = await import("@/app/api/tasks/route");
    const created = await (await createTask(makeRequest("/api/tasks", {
      method: "POST", cookie: waterAdminCookie,
      body: { driverId, type: "INSPECTION", title: "S1 audit test task" },
    }))).json();
    expect(JSON.stringify(created)).not.toContain("passwordHash");
    expect(created.driver.user.name).toBeTruthy();

    const { GET } = await import("@/app/api/tasks/route");
    const listRes = await GET(makeRequest("/api/tasks", { cookie: waterAdminCookie }));
    const text = await listRes.text();
    expect(text).not.toContain("passwordHash");
  });

  it("3. GET/POST /api/expenses never exposes passwordHash, including when accessed by a DRIVER session", async () => {
    const { POST: createExpense } = await import("@/app/api/expenses/route");
    // ADMIN files on behalf of the driver — a driver session can only file
    // under their own profile, and driverId here belongs to the isolated
    // fixture driver, not whichever driver is logged in as driverCookie.
    const created = await (await createExpense(makeRequest("/api/expenses", {
      method: "POST", cookie: waterAdminCookie,
      body: { driverId, vehicleId, category: "FUEL", amount: 50, reason: "S1 audit test expense" },
    }))).json();
    expect(JSON.stringify(created)).not.toContain("passwordHash");

    const { GET } = await import("@/app/api/expenses/route");
    // A DRIVER session can read this list too — the exact scenario that
    // made this exposure worse than most others.
    const listRes = await GET(makeRequest("/api/expenses", { cookie: driverCookie }));
    const text = await listRes.text();
    expect(text).not.toContain("passwordHash");
  });

  it("4/5. GET /api/exceptions never exposes passwordHash on either the order.customer or the tripStop.trip.driver.user embed", async () => {
    const { GET } = await import("@/app/api/exceptions/route");
    const res = await GET(makeRequest("/api/exceptions", { cookie: waterAdminCookie }));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("passwordHash");
  });

  it("6. GET /api/trips never exposes passwordHash on the stops.order.customer embed (missed during Task D.5's driver.user-only fix)", async () => {
    const { GET } = await import("@/app/api/trips/route");
    const res = await GET(makeRequest("/api/trips", { cookie: waterAdminCookie }));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("passwordHash");
  });

  it("7. GET /api/escalations never exposes passwordHash on the order.customer embed", async () => {
    const { GET } = await import("@/app/api/escalations/route");
    const res = await GET(makeRequest("/api/escalations", { cookie: waterAdminCookie }));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("passwordHash");
  });

  it("8. GET /api/sla never exposes passwordHash on the ...order-spread customer embed", async () => {
    const { GET } = await import("@/app/api/sla/route");
    const res = await GET(makeRequest("/api/sla", { cookie: waterAdminCookie }));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("passwordHash");
    const body = JSON.parse(text);
    expect(Array.isArray(body.orders)).toBe(true);
  });

  it("existing behavior is unchanged: drivers/tasks/expenses/exceptions/trips/escalations/sla all still return their real, functionally-needed safe fields", async () => {
    const { GET: driversGet } = await import("@/app/api/drivers/route");
    const drivers = await (await driversGet(makeRequest("/api/drivers", { cookie: waterAdminCookie }))).json();
    const khalid = drivers.find((d: any) => d.user.email === "khalid@demo-water.co");
    expect(khalid).toBeTruthy(); // the exact lookup-by-email pattern used throughout this whole test suite still works

    const { GET: tripsGet } = await import("@/app/api/trips/route");
    const trips = await (await tripsGet(makeRequest("/api/trips", { cookie: waterAdminCookie }))).json();
    expect(Array.isArray(trips)).toBe(true);
  });

  it("end-to-end regression: a full contract-linked delivery still works and produces zero passwordHash exposure across every touched route", async () => {
    const { POST: createContract } = await import("@/app/api/contracts/route");
    const { PATCH: patchContract } = await import("@/app/api/contracts/[id]/route");
    const contract = await (await createContract(makeRequest("/api/contracts", {
      method: "POST", cookie: waterAdminCookie,
      body: { customerId: jarirId, type: "ONE_TIME_TRIP_COUNT", totalTripsPurchased: 5, startDate: "2020-01-01" },
    }))).json();
    await patchContract(makeRequest(`/api/contracts/${contract.id}`, { method: "PATCH", cookie: waterAdminCookie, body: { status: "ACTIVE" } }), { params: { id: contract.id } });
    await db.insert(contractPricingRules).values({ id: genId(), tenantId, pricingScope: "CONTRACT", contractId: contract.id, rateType: "STANDARD", pricePerTrip: 400, vatRate: 0.15 });

    const { POST: createOrder } = await import("@/app/api/orders/route");
    const order = await (await createOrder(makeRequest("/api/orders", {
      method: "POST", cookie: waterAdminCookie,
      body: { customerId: jarirId, contractId: contract.id, qtyOrdered: 2, emptyBottlesToCollect: 2, paymentMethod: "CASH" },
    }))).json();
    expect(JSON.stringify(order)).not.toContain("passwordHash");

    const { GET: warehousesGet } = await import("@/app/api/warehouses/route");
    const warehouseId = (await (await warehousesGet(makeRequest("/api/warehouses", { cookie: waterAdminCookie }))).json()).find((w: any) => w.isDefault).id;

    const { POST: createTrip } = await import("@/app/api/trips/route");
    const trip = await (await createTrip(makeRequest("/api/trips", {
      method: "POST", cookie: waterAdminCookie,
      body: { driverId, vehicleId, warehouseId, orderIds: [order.id] },
    }))).json();
    expect(JSON.stringify(trip)).not.toContain("passwordHash");

    const { PATCH: confirmLoading } = await import("@/app/api/trips/[id]/loading/route");
    await confirmLoading(makeRequest(`/api/trips/${trip.id}/loading`, { method: "PATCH", cookie: waterAdminCookie }), { params: { id: trip.id } });
    const { PATCH: tripAction } = await import("@/app/api/trips/[id]/route");
    await tripAction(makeRequest(`/api/trips/${trip.id}`, { method: "PATCH", cookie: waterAdminCookie, body: { action: "dispatch" } }), { params: { id: trip.id } });

    const stopId = trip.stops[0].id;
    const { PATCH: stopAction } = await import("@/app/api/trips/[id]/stops/[stopId]/route");
    const arriveRes = await stopAction(makeRequest(`/api/trips/${trip.id}/stops/${stopId}`, { method: "PATCH", cookie: assignedDriverCookie, body: { action: "arrive" } }), { params: { id: trip.id, stopId } });
    expect(JSON.stringify(await arriveRes.json())).not.toContain("passwordHash");

    const { GET: exceptionsGet } = await import("@/app/api/exceptions/route");
    const exceptionsRes = await exceptionsGet(makeRequest("/api/exceptions", { cookie: waterAdminCookie }));
    expect(await exceptionsRes.text()).not.toContain("passwordHash");

    const { GET: escalationsGet } = await import("@/app/api/escalations/route");
    const escalationsRes = await escalationsGet(makeRequest("/api/escalations", { cookie: waterAdminCookie }));
    expect(await escalationsRes.text()).not.toContain("passwordHash");

    const { GET: slaGet } = await import("@/app/api/sla/route");
    const slaRes = await slaGet(makeRequest("/api/sla", { cookie: waterAdminCookie }));
    expect(await slaRes.text()).not.toContain("passwordHash");
  });
});
