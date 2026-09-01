import { describe, it, expect, beforeAll } from "vitest";
import { makeRequest, loginAs } from "../helpers/request";

describe("trip lifecycle (BR-06/07/08/09/10/18)", () => {
  let dispatcherCookie: string;
  let khalidCookie: string; // correct driver for this test's trip
  let fahadCookie: string; // a different driver, used for the ownership check
  let tenantId: string;
  let mainWarehouseId: string;
  let availableVehicleId: string;
  let availableDriverId: string; // Khalid's driver-profile id

  beforeAll(async () => {
    dispatcherCookie = await loginAs("dispatch@demo-water.co", "password123");
    khalidCookie = await loginAs("khalid@demo-water.co", "password123");
    fahadCookie = await loginAs("fahad@demo-water.co", "password123");

    const { GET: tenantGet } = await import("@/app/api/tenant/route");
    tenantId = (await (await tenantGet(makeRequest("/api/tenant", { cookie: dispatcherCookie }))).json()).id;

    const { GET: warehousesGet } = await import("@/app/api/warehouses/route");
    const warehouses = await (await warehousesGet(makeRequest("/api/warehouses", { cookie: dispatcherCookie }))).json();
    mainWarehouseId = warehouses.find((w: any) => w.isDefault).id;

    const { GET: driversGet } = await import("@/app/api/drivers/route");
    const drivers = await (await driversGet(makeRequest("/api/drivers", { cookie: dispatcherCookie }))).json();
    availableDriverId = drivers.find((d: any) => d.user.email === "khalid@demo-water.co").id;

    const { GET: vehiclesGet } = await import("@/app/api/vehicles/route");
    const vehicles = await (await vehiclesGet(makeRequest("/api/vehicles", { cookie: dispatcherCookie }))).json();
    availableVehicleId = vehicles.find((v: any) => v.status === "AVAILABLE").id;
  });

  async function createFreshOrder(qty: number) {
    const { GET: customersGet } = await import("@/app/api/customers/route");
    const customers = await (await customersGet(makeRequest("/api/customers", { cookie: dispatcherCookie }))).json();
    const customer = customers.find((c: any) => c.name === "Al Yasmin Residence");

    const { POST: createOrder } = await import("@/app/api/orders/route");
    const res = await createOrder(makeRequest("/api/orders", {
      method: "POST",
      cookie: dispatcherCookie,
      body: { customerId: customer.id, qtyOrdered: qty, emptyBottlesToCollect: qty, paymentMethod: "CASH" },
    }));
    expect(res.status).toBe(201);
    return (await res.json()).id as string;
  }

  it("BR-02: rejects a trip whose combined bottle load exceeds vehicle capacity", async () => {
    const { GET: vehiclesGet } = await import("@/app/api/vehicles/route");
    const vehicles = await (await vehiclesGet(makeRequest("/api/vehicles", { cookie: dispatcherCookie }))).json();
    const smallVehicle = vehicles.find((v: any) => v.status === "AVAILABLE" && v.capacityUnits != null);

    const bigOrderId = await createFreshOrder(smallVehicle.capacityUnits + 50);

    const { POST: createTrip } = await import("@/app/api/trips/route");
    const res = await createTrip(makeRequest("/api/trips", {
      method: "POST",
      cookie: dispatcherCookie,
      body: {
        driverId: availableDriverId,
        vehicleId: smallVehicle.id,
        warehouseId: mainWarehouseId,
        orderIds: [bigOrderId],
      },
    }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toMatch(/capacity/i);
  });

  it("runs the full happy path: create → loading gate blocks dispatch → confirm → dispatch → deliver → invoice", async () => {
    const orderId = await createFreshOrder(3);

    const { POST: createTrip } = await import("@/app/api/trips/route");
    const tripRes = await createTrip(makeRequest("/api/trips", {
      method: "POST",
      cookie: dispatcherCookie,
      body: { driverId: availableDriverId, vehicleId: availableVehicleId, warehouseId: mainWarehouseId, orderIds: [orderId] },
    }));
    expect(tripRes.status).toBe(201);
    const trip = await tripRes.json();
    expect(trip.loadingConfirmed).toBe(false);

    // BR-09: dispatch must be blocked until the warehouse confirms loading.
    const { PATCH: tripAction } = await import("@/app/api/trips/[id]/route");
    const blockedRes = await tripAction(
      makeRequest(`/api/trips/${trip.id}`, { method: "PATCH", cookie: dispatcherCookie, body: { action: "dispatch" } }),
      { params: { id: trip.id } }
    );
    expect(blockedRes.status).toBe(422);
    expect((await blockedRes.json()).error).toMatch(/loading/i);

    // Confirm loading.
    const { PATCH: confirmLoading } = await import("@/app/api/trips/[id]/loading/route");
    const loadingRes = await confirmLoading(
      makeRequest(`/api/trips/${trip.id}/loading`, { method: "PATCH", cookie: dispatcherCookie }),
      { params: { id: trip.id } }
    );
    expect(loadingRes.status).toBe(200);
    expect((await loadingRes.json()).loadingConfirmed).toBe(true);

    // Now dispatch should succeed.
    const dispatchRes = await tripAction(
      makeRequest(`/api/trips/${trip.id}`, { method: "PATCH", cookie: dispatcherCookie, body: { action: "dispatch" } }),
      { params: { id: trip.id } }
    );
    expect(dispatchRes.status).toBe(200);
    expect((await dispatchRes.json()).status).toBe("DISPATCHED");

    // Get the stop id.
    const { GET: tripsGet } = await import("@/app/api/trips/route");
    const trips = await (await tripsGet(makeRequest("/api/trips", { cookie: dispatcherCookie }))).json();
    const liveTrip = trips.find((t: any) => t.id === trip.id);
    const stopId = liveTrip.stops[0].id;

    // Driver arrives and delivers.
    const { PATCH: stopAction } = await import("@/app/api/trips/[id]/stops/[stopId]/route");
    const arriveRes = await stopAction(
      makeRequest(`/api/trips/${trip.id}/stops/${stopId}`, { method: "PATCH", cookie: khalidCookie, body: { action: "arrive" } }),
      { params: { id: trip.id, stopId } }
    );
    expect(arriveRes.status).toBe(200);

    const deliverRes = await stopAction(
      makeRequest(`/api/trips/${trip.id}/stops/${stopId}`, {
        method: "PATCH",
        cookie: khalidCookie,
        body: { action: "deliver", deliveredQty: 3, emptiesCollected: 3, recipientName: "Test Recipient" },
      }),
      { params: { id: trip.id, stopId } }
    );
    expect(deliverRes.status).toBe(200);
    const deliverBody = await deliverRes.json();

    // BR-18: invoice auto-generated with correct VAT math (3 * 8 * 1.15 = 27.6).
    expect(deliverBody.invoice.total).toBeCloseTo(27.6, 2);
    expect(deliverBody.invoice.status).toBe("PAID"); // CASH payment

    // Close the trip out — also confirms it frees the vehicle/driver back to
    // AVAILABLE (BR-08), which later tests in this suite rely on.
    const completeRes = await tripAction(
      makeRequest(`/api/trips/${trip.id}`, { method: "PATCH", cookie: dispatcherCookie, body: { action: "complete" } }),
      { params: { id: trip.id } }
    );
    expect(completeRes.status).toBe(200);
    expect((await completeRes.json()).status).toBe("COMPLETED");

    const { GET: vehiclesGet2 } = await import("@/app/api/vehicles/route");
    const vehiclesAfter = await (await vehiclesGet2(makeRequest("/api/vehicles", { cookie: dispatcherCookie }))).json();
    expect(vehiclesAfter.find((v: any) => v.id === availableVehicleId).status).toBe("AVAILABLE");
  });

  it("a driver cannot act on a trip assigned to a different driver", async () => {
    const orderId = await createFreshOrder(2);

    const { GET: vehiclesGet } = await import("@/app/api/vehicles/route");
    const vehicles = await (await vehiclesGet(makeRequest("/api/vehicles", { cookie: dispatcherCookie }))).json();
    const vehicle = vehicles.find((v: any) => v.status === "AVAILABLE");

    const { GET: driversGet } = await import("@/app/api/drivers/route");
    const drivers = await (await driversGet(makeRequest("/api/drivers", { cookie: dispatcherCookie }))).json();
    const fahadDriver = drivers.find((d: any) => d.user.email === "fahad@demo-water.co" && d.status === "AVAILABLE");
    if (!fahadDriver) return; // skip gracefully if Fahad isn't free at this point in the suite

    const { POST: createTrip } = await import("@/app/api/trips/route");
    const trip = await (
      await createTrip(makeRequest("/api/trips", {
        method: "POST",
        cookie: dispatcherCookie,
        body: { driverId: fahadDriver.id, vehicleId: vehicle.id, warehouseId: mainWarehouseId, orderIds: [orderId] },
      }))
    ).json();

    const stopId = trip.stops[0].id;

    // Khalid (wrong driver) tries to act on Fahad's trip.
    const { PATCH: stopAction } = await import("@/app/api/trips/[id]/stops/[stopId]/route");
    const res = await stopAction(
      makeRequest(`/api/trips/${trip.id}/stops/${stopId}`, { method: "PATCH", cookie: khalidCookie, body: { action: "arrive" } }),
      { params: { id: trip.id, stopId } }
    );
    expect(res.status).toBe(403);

    // GPS ping should be blocked the same way.
    const { PATCH: gpsPing } = await import("@/app/api/trips/[id]/gps/route");
    const gpsRes = await gpsPing(
      makeRequest(`/api/trips/${trip.id}/gps`, { method: "PATCH", cookie: khalidCookie, body: { lat: 24.7, lng: 46.6 } }),
      { params: { id: trip.id } }
    );
    expect(gpsRes.status).toBe(403);

    // Clean up: let the correct driver (Fahad) actually resolve and close
    // this trip, so the vehicle/driver are freed back to AVAILABLE for
    // later tests in the suite rather than left stuck ON_TRIP/IN_TRIP.
    await stopAction(
      makeRequest(`/api/trips/${trip.id}/stops/${stopId}`, { method: "PATCH", cookie: fahadCookie, body: { action: "arrive" } }),
      { params: { id: trip.id, stopId } }
    );
    await stopAction(
      makeRequest(`/api/trips/${trip.id}/stops/${stopId}`, {
        method: "PATCH",
        cookie: fahadCookie,
        body: { action: "deliver", deliveredQty: 2, emptiesCollected: 2, recipientName: "Cleanup" },
      }),
      { params: { id: trip.id, stopId } }
    );
    const { PATCH: tripAction } = await import("@/app/api/trips/[id]/route");
    await tripAction(
      makeRequest(`/api/trips/${trip.id}`, { method: "PATCH", cookie: dispatcherCookie, body: { action: "complete" } }),
      { params: { id: trip.id } }
    );
  });
});
