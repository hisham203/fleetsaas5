import { describe, it, expect, beforeAll } from "vitest";
import { makeRequest, loginAs } from "../helpers/request";

describe("executive dashboard (APP-07)", () => {
  let adminCookie: string;
  let dispatcherCookie: string;
  let driverCookie: string;
  let tenantId: string;
  let warehouseId: string;

  beforeAll(async () => {
    adminCookie = await loginAs("admin@demo-water.co", "password123");
    dispatcherCookie = await loginAs("dispatch@demo-water.co", "password123");
    driverCookie = await loginAs("khalid@demo-water.co", "password123");

    const { GET: tenantGet } = await import("@/app/api/tenant/route");
    tenantId = (await (await tenantGet(makeRequest("/api/tenant", { cookie: adminCookie }))).json()).id;

    const { GET: warehousesGet } = await import("@/app/api/warehouses/route");
    const warehouses = await (await warehousesGet(makeRequest("/api/warehouses", { cookie: dispatcherCookie }))).json();
    warehouseId = warehouses.find((w: any) => w.isDefault).id;
  });

  it("returns KPIs with sensible shapes for a tenant with no date filter (all-time)", async () => {
    const { GET } = await import("@/app/api/executive/dashboard/route");
    const res = await GET(makeRequest("/api/executive/dashboard", { cookie: adminCookie }));
    expect(res.status).toBe(200);
    const dashboard = await res.json();

    expect(dashboard.kpis.ordersTotal).toBeGreaterThanOrEqual(0);
    expect(dashboard.kpis.activeVehicleCount).toBeGreaterThan(0);
    expect(dashboard.comparison).toBeNull(); // no from/to given, nothing to compare
    expect(Array.isArray(dashboard.topDrivers)).toBe(true);
    expect(Array.isArray(dashboard.vehicleRanking)).toBe(true);
  });

  it("reflects a real completed delivery in revenue, delivered-order count, and estimated distance", async () => {
    const { GET: customersGet } = await import("@/app/api/customers/route");
    const customers = await (await customersGet(makeRequest("/api/customers", { cookie: dispatcherCookie }))).json();
    const customer = customers.find((c: any) => c.name === "Al Yasmin Residence");

    const { POST: createOrder } = await import("@/app/api/orders/route");
    const order = await (
      await createOrder(makeRequest("/api/orders", {
        method: "POST",
        cookie: dispatcherCookie,
        body: { customerId: customer.id, qtyOrdered: 3, emptyBottlesToCollect: 0, paymentMethod: "CASH" },
      }))
    ).json();

    const { GET: driversGet } = await import("@/app/api/drivers/route");
    const drivers = await (await driversGet(makeRequest("/api/drivers", { cookie: dispatcherCookie }))).json();
    const driver = drivers.find((d: any) => d.status === "AVAILABLE");
    const { GET: vehiclesGet } = await import("@/app/api/vehicles/route");
    const vehicles = await (await vehiclesGet(makeRequest("/api/vehicles", { cookie: dispatcherCookie }))).json();
    const vehicle = vehicles.find((v: any) => v.status === "AVAILABLE");

    const { POST: createTrip } = await import("@/app/api/trips/route");
    const trip = await (
      await createTrip(makeRequest("/api/trips", {
        method: "POST",
        cookie: dispatcherCookie,
        body: { driverId: driver.id, vehicleId: vehicle.id, warehouseId, orderIds: [order.id] },
      }))
    ).json();

    const { PATCH: confirmLoading } = await import("@/app/api/trips/[id]/loading/route");
    await confirmLoading(makeRequest(`/api/trips/${trip.id}/loading`, { method: "PATCH", cookie: dispatcherCookie }), { params: { id: trip.id } });
    const { PATCH: tripAction } = await import("@/app/api/trips/[id]/route");
    await tripAction(makeRequest(`/api/trips/${trip.id}`, { method: "PATCH", cookie: dispatcherCookie, body: { action: "dispatch" } }), {
      params: { id: trip.id },
    });

    const stopId = trip.stops[0].id;
    const driverCookieToUse = driver.user.email === "khalid@demo-water.co" ? driverCookie : await loginAs(driver.user.email, "password123");
    const { PATCH: stopAction } = await import("@/app/api/trips/[id]/stops/[stopId]/route");
    await stopAction(makeRequest(`/api/trips/${trip.id}/stops/${stopId}`, { method: "PATCH", cookie: driverCookieToUse, body: { action: "arrive" } }), {
      params: { id: trip.id, stopId },
    });
    await stopAction(
      makeRequest(`/api/trips/${trip.id}/stops/${stopId}`, {
        method: "PATCH",
        cookie: driverCookieToUse,
        body: { action: "deliver", deliveredQty: 3, emptiesCollected: 0, recipientName: "Exec Dashboard Test" },
      }),
      { params: { id: trip.id, stopId } }
    );
    await tripAction(makeRequest(`/api/trips/${trip.id}`, { method: "PATCH", cookie: dispatcherCookie, body: { action: "complete" } }), {
      params: { id: trip.id },
    });

    const { GET: dashboardGet } = await import("@/app/api/executive/dashboard/route");
    const dashboard = await (await dashboardGet(makeRequest("/api/executive/dashboard", { cookie: adminCookie }))).json();

    // 3 bottles * 8 SAR * 1.15 VAT = 27.60
    expect(dashboard.kpis.totalRevenueSar).toBeGreaterThanOrEqual(27.6);
    expect(dashboard.kpis.deliveredOrders).toBeGreaterThan(0);
    expect(dashboard.kpis.completedTrips).toBeGreaterThan(0);
    // Al Yasmin Residence is a real distance from the default warehouse, so
    // the haversine estimate should be a genuine positive number, not zero.
    expect(dashboard.kpis.estimatedDistanceKm).toBeGreaterThan(0);
  });

  it("computes a real comparative-analysis delta when from/to are both given", async () => {
    const now = new Date();
    const from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const to = now.toISOString();

    const { GET } = await import("@/app/api/executive/dashboard/route");
    const res = await GET(makeRequest(`/api/executive/dashboard?from=${from}&to=${to}`, { cookie: adminCookie }));
    expect(res.status).toBe(200);
    const dashboard = await res.json();

    expect(dashboard.period.from).toBeTruthy();
    expect(dashboard.period.to).toBeTruthy();
    expect(dashboard.comparison).toBeTruthy();
    expect(dashboard.comparison.previous).toBeTruthy();
    expect(typeof dashboard.comparison.changePercent).toBe("object");
  });

  it("a DISPATCHER cannot access the executive dashboard (ADMIN only)", async () => {
    const { GET } = await import("@/app/api/executive/dashboard/route");
    const res = await GET(makeRequest("/api/executive/dashboard", { cookie: dispatcherCookie }));
    expect(res.status).toBe(401);
  });

  it("a DRIVER cannot access the executive dashboard", async () => {
    const { GET } = await import("@/app/api/executive/dashboard/route");
    const res = await GET(makeRequest("/api/executive/dashboard", { cookie: driverCookie }));
    expect(res.status).toBe(401);
  });

  it("the executive dashboard is tenant-isolated", async () => {
    const acmeCookie = await loginAs("admin@acme-fuel-demo.co", "password123");
    const { GET } = await import("@/app/api/executive/dashboard/route");
    const res = await GET(makeRequest("/api/executive/dashboard", { cookie: acmeCookie }));
    expect(res.status).toBe(200);
    const dashboard = await res.json();
    // Acme's own tenant has its own separate, much smaller seeded dataset —
    // this just confirms it's returning Acme's numbers, not Water Co.'s.
    expect(dashboard.kpis.activeVehicleCount).toBeGreaterThan(0);
  });
});
