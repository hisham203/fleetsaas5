import { describe, it, expect, beforeAll } from "vitest";
import { makeRequest, loginAs } from "../helpers/request";
import { createIsolatedDriverAndVehicle } from "../helpers/testFixtures";

// Test isolation fix: this file previously hardcoded khalid@demo-water.co
// and a single "whichever vehicle happens to be AVAILABLE" lookup, both
// cached once in beforeAll and reused across every test. That's fragile
// in a real CI run — other test files draw from the same small shared
// seeded pool, execution order isn't guaranteed, and one earlier failure
// anywhere can leave a shared driver/vehicle stuck busy for everything
// after it. Every driver/vehicle used below is created fresh, specifically
// for this file, and touched by nothing else — this is test isolation,
// not weaker validation: the same real availability/capacity checks in
// the application are exercised exactly as before, just against
// guaranteed-uncontended fixtures instead of a shared pool.
describe("trip lifecycle (BR-06/07/08/09/10/18)", () => {
  let dispatcherCookie: string;
  let tenantId: string;
  let mainWarehouseId: string;

  // Dedicated to this file, never touched by any other test.
  let driverACookie: string;
  let driverAId: string;
  let vehicleAId: string; // normal capacity, used by the happy-path test
  let driverBId: string; // a second dedicated driver, for the wrong-driver-access test
  let driverBCookie: string;
  let smallVehicleId: string; // deliberately small capacity, for the capacity-rejection test
  let smallVehicleCapacity: number;
  let vehicleCId: string; // dedicated third vehicle, for the wrong-driver-access test — independent of vehicleA so test order never matters

  beforeAll(async () => {
    dispatcherCookie = await loginAs("dispatch@demo-water.co", "password123");

    const { GET: tenantGet } = await import("@/app/api/tenant/route");
    tenantId = (await (await tenantGet(makeRequest("/api/tenant", { cookie: dispatcherCookie }))).json()).id;

    const { GET: warehousesGet } = await import("@/app/api/warehouses/route");
    const warehouses = await (await warehousesGet(makeRequest("/api/warehouses", { cookie: dispatcherCookie }))).json();
    mainWarehouseId = warehouses.find((w: any) => w.isDefault).id;

    const driverA = await createIsolatedDriverAndVehicle(tenantId, "lifecycle-a");
    driverACookie = driverA.driverCookie;
    driverAId = driverA.driverId;
    vehicleAId = driverA.vehicleId;

    const driverB = await createIsolatedDriverAndVehicle(tenantId, "lifecycle-b");
    driverBId = driverB.driverId;
    driverBCookie = driverB.driverCookie;
    vehicleCId = driverB.vehicleId; // reuse this fixture call's vehicle as the dedicated "vehicleC"

    // A dedicated, deliberately small-capacity vehicle so the capacity
    // test reliably reaches capacity validation rather than an
    // availability check — it's freshly created and used by nothing else.
    const { db } = await import("@/lib/db/client");
    const { vehicles } = await import("@/lib/db/schema");
    const { genId } = await import("@/lib/helpers");
    smallVehicleId = genId();
    smallVehicleCapacity = 5;
    await db.insert(vehicles).values({
      id: smallVehicleId,
      tenantId,
      plateNumber: `TEST-SMALLCAP-${smallVehicleId.slice(0, 6).toUpperCase()}`,
      vehicleType: "Refill Van",
      capacityUnits: smallVehicleCapacity,
      status: "AVAILABLE",
    });
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
    const bigOrderId = await createFreshOrder(smallVehicleCapacity + 50);

    const { POST: createTrip } = await import("@/app/api/trips/route");
    const res = await createTrip(makeRequest("/api/trips", {
      method: "POST",
      cookie: dispatcherCookie,
      body: {
        driverId: driverAId,
        vehicleId: smallVehicleId,
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
      body: { driverId: driverAId, vehicleId: vehicleAId, warehouseId: mainWarehouseId, orderIds: [orderId] },
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
      makeRequest(`/api/trips/${trip.id}/stops/${stopId}`, { method: "PATCH", cookie: driverACookie, body: { action: "arrive" } }),
      { params: { id: trip.id, stopId } }
    );
    expect(arriveRes.status).toBe(200);

    const deliverRes = await stopAction(
      makeRequest(`/api/trips/${trip.id}/stops/${stopId}`, {
        method: "PATCH",
        cookie: driverACookie,
        body: { action: "deliver", deliveredQty: 3, emptiesCollected: 3, recipientName: "Test Recipient" },
      }),
      { params: { id: trip.id, stopId } }
    );
    expect(deliverRes.status).toBe(200);
    const deliverBody = await deliverRes.json();

    // BR-18: invoice auto-generated with correct VAT math (3 * 8 * 1.15 = 27.6).
    expect(deliverBody.invoice.total).toBeCloseTo(27.6, 2);
    expect(deliverBody.invoice.status).toBe("PAID"); // CASH payment

    // Close the trip out — also confirms it frees the vehicle/driver back
    // to AVAILABLE (BR-08). Since vehicleA/driverA are dedicated to this
    // file and used only here, this no longer needs to matter for any
    // other test's setup the way the old shared-pool version did — this
    // assertion is kept because it's still real, correct behavior worth
    // verifying, not because anything else depends on it.
    const completeRes = await tripAction(
      makeRequest(`/api/trips/${trip.id}`, { method: "PATCH", cookie: dispatcherCookie, body: { action: "complete" } }),
      { params: { id: trip.id } }
    );
    expect(completeRes.status).toBe(200);
    expect((await completeRes.json()).status).toBe("COMPLETED");

    const { GET: vehiclesGet2 } = await import("@/app/api/vehicles/route");
    const vehiclesAfter = await (await vehiclesGet2(makeRequest("/api/vehicles", { cookie: dispatcherCookie }))).json();
    expect(vehiclesAfter.find((v: any) => v.id === vehicleAId).status).toBe("AVAILABLE");
  });

  it("a driver cannot act on a trip assigned to a different driver", async () => {
    const orderId = await createFreshOrder(2);

    const { POST: createTrip } = await import("@/app/api/trips/route");
    const trip = await (
      await createTrip(makeRequest("/api/trips", {
        method: "POST",
        cookie: dispatcherCookie,
        body: { driverId: driverBId, vehicleId: vehicleCId, warehouseId: mainWarehouseId, orderIds: [orderId] },
      }))
    ).json();

    const stopId = trip.stops[0].id;

    // driverA (wrong driver) tries to act on driverB's trip.
    const { PATCH: stopAction } = await import("@/app/api/trips/[id]/stops/[stopId]/route");
    const res = await stopAction(
      makeRequest(`/api/trips/${trip.id}/stops/${stopId}`, { method: "PATCH", cookie: driverACookie, body: { action: "arrive" } }),
      { params: { id: trip.id, stopId } }
    );
    expect(res.status).toBe(403);

    // GPS ping should be blocked the same way.
    const { PATCH: gpsPing } = await import("@/app/api/trips/[id]/gps/route");
    const gpsRes = await gpsPing(
      makeRequest(`/api/trips/${trip.id}/gps`, { method: "PATCH", cookie: driverACookie, body: { lat: 24.7, lng: 46.6 } }),
      { params: { id: trip.id } }
    );
    expect(gpsRes.status).toBe(403);

    // Clean up: let the correct driver (driverB) actually resolve and
    // close this trip. Not required by any other test here (vehicleC is
    // dedicated and unused elsewhere), but good hygiene regardless.
    await stopAction(
      makeRequest(`/api/trips/${trip.id}/stops/${stopId}`, { method: "PATCH", cookie: driverBCookie, body: { action: "arrive" } }),
      { params: { id: trip.id, stopId } }
    );
    await stopAction(
      makeRequest(`/api/trips/${trip.id}/stops/${stopId}`, {
        method: "PATCH",
        cookie: driverBCookie,
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
