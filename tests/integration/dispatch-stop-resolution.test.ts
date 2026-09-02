import { describe, it, expect, beforeAll } from "vitest";
import { makeRequest, loginAs } from "../helpers/request";

// Covers the Dispatch Live Trip Workflow UX fix: a dispatcher must be able
// to resolve a stuck PENDING stop directly from the Dispatch console (not
// only via the driver app), and "Close trip" must keep being blocked until
// every stop is genuinely resolved — exactly the server-side rule the UI
// now mirrors, not a relaxed one.
describe("dispatch-side stop resolution and close-trip gating", () => {
  let dispatcherCookie: string;
  let mainWarehouseId: string;

  beforeAll(async () => {
    dispatcherCookie = await loginAs("dispatch@demo-water.co", "password123");

    const { GET: warehousesGet } = await import("@/app/api/warehouses/route");
    const warehouses = await (await warehousesGet(makeRequest("/api/warehouses", { cookie: dispatcherCookie }))).json();
    mainWarehouseId = warehouses.find((w: any) => w.isDefault).id;
  });

  async function createDispatchedTrip(qty: number) {
    // Looked up fresh per call, not cached in beforeAll — several tests in
    // this file deliberately leave a trip open (to prove Close trip stays
    // blocked), so a shared driver/vehicle pair would be exhausted after
    // the first such test and break every test after it.
    const { GET: driversGet } = await import("@/app/api/drivers/route");
    const drivers = await (await driversGet(makeRequest("/api/drivers", { cookie: dispatcherCookie }))).json();
    const driverId = drivers.find((d: any) => d.status === "AVAILABLE").id;

    const { GET: vehiclesGet } = await import("@/app/api/vehicles/route");
    const vehicles = await (await vehiclesGet(makeRequest("/api/vehicles", { cookie: dispatcherCookie }))).json();
    const vehicleId = vehicles.find((v: any) => v.status === "AVAILABLE").id;

    const { GET: customersGet } = await import("@/app/api/customers/route");
    const customers = await (await customersGet(makeRequest("/api/customers", { cookie: dispatcherCookie }))).json();
    const customer = customers.find((c: any) => c.name === "Al Malaz Family");

    const { POST: createOrder } = await import("@/app/api/orders/route");
    const orderRes = await createOrder(makeRequest("/api/orders", {
      method: "POST",
      cookie: dispatcherCookie,
      body: { customerId: customer.id, qtyOrdered: qty, emptyBottlesToCollect: qty, paymentMethod: "CASH" },
    }));
    const order = await orderRes.json();

    const { POST: createTrip } = await import("@/app/api/trips/route");
    const trip = await (
      await createTrip(makeRequest("/api/trips", {
        method: "POST",
        cookie: dispatcherCookie,
        body: { driverId, vehicleId, warehouseId: mainWarehouseId, orderIds: [order.id] },
      }))
    ).json();

    const { PATCH: confirmLoading } = await import("@/app/api/trips/[id]/loading/route");
    await confirmLoading(makeRequest(`/api/trips/${trip.id}/loading`, { method: "PATCH", cookie: dispatcherCookie }), { params: { id: trip.id } });
    const { PATCH: tripAction } = await import("@/app/api/trips/[id]/route");
    await tripAction(makeRequest(`/api/trips/${trip.id}`, { method: "PATCH", cookie: dispatcherCookie, body: { action: "dispatch" } }), {
      params: { id: trip.id },
    });

    return { tripId: trip.id, stopId: trip.stops[0].id, order };
  }

  it("a DISPATCHER session can mark a stop delivered directly (previously blocked with 401)", async () => {
    const { tripId, stopId, order } = await createDispatchedTrip(3);
    const { PATCH: stopAction } = await import("@/app/api/trips/[id]/stops/[stopId]/route");

    const res = await stopAction(
      makeRequest(`/api/trips/${tripId}/stops/${stopId}`, {
        method: "PATCH",
        cookie: dispatcherCookie,
        body: { action: "deliver", deliveredQty: order.qtyOrdered, emptiesCollected: 0, recipientName: "Dispatcher-confirmed" },
      }),
      { params: { id: tripId, stopId } }
    );
    expect(res.status).toBe(200);
    const updated = await res.json();
    expect(updated.stop.status).toBe("DELIVERED");

    // Release the driver/vehicle for other tests in this file and in the
    // rest of the suite — good test hygiene regardless of what this
    // specific test needed to assert.
    const { PATCH: tripAction } = await import("@/app/api/trips/[id]/route");
    await tripAction(makeRequest(`/api/trips/${tripId}`, { method: "PATCH", cookie: dispatcherCookie, body: { action: "complete" } }), {
      params: { id: tripId },
    });
  });

  it("a DISPATCHER session can mark a stop failed directly, and it opens a real exception (BR-11 unchanged)", async () => {
    const { tripId, stopId } = await createDispatchedTrip(2);
    const { PATCH: stopAction } = await import("@/app/api/trips/[id]/stops/[stopId]/route");

    const res = await stopAction(
      makeRequest(`/api/trips/${tripId}/stops/${stopId}`, {
        method: "PATCH",
        cookie: dispatcherCookie,
        body: { action: "fail", failureReason: "Marked failed from Dispatch console" },
      }),
      { params: { id: tripId, stopId } }
    );
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("FAILED");

    const { GET: exceptionsGet } = await import("@/app/api/exceptions/route");
    const exceptions = await (await exceptionsGet(makeRequest("/api/exceptions", { cookie: dispatcherCookie }))).json();
    expect(exceptions.some((e: any) => e.tripStopId === stopId)).toBe(true);

    const { PATCH: tripAction } = await import("@/app/api/trips/[id]/route");
    await tripAction(makeRequest(`/api/trips/${tripId}`, { method: "PATCH", cookie: dispatcherCookie, body: { action: "complete" } }), {
      params: { id: tripId },
    });
  });

  it("closing a trip with an unresolved (PENDING) stop is still rejected with the exact documented error", async () => {
    const { tripId, stopId, order } = await createDispatchedTrip(2);
    const { PATCH: tripAction } = await import("@/app/api/trips/[id]/route");

    const res = await tripAction(makeRequest(`/api/trips/${tripId}`, { method: "PATCH", cookie: dispatcherCookie, body: { action: "complete" } }), {
      params: { id: tripId },
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toMatch(/Cannot close trip — 1 stop\(s\) not yet resolved/);

    // The assertion above is already complete — this just releases the
    // driver/vehicle for other tests, since leaving them stuck DISPATCHED
    // would starve resource availability for the rest of the suite.
    const { PATCH: stopAction } = await import("@/app/api/trips/[id]/stops/[stopId]/route");
    await stopAction(
      makeRequest(`/api/trips/${tripId}/stops/${stopId}`, {
        method: "PATCH",
        cookie: dispatcherCookie,
        body: { action: "deliver", deliveredQty: order.qtyOrdered, emptiesCollected: 0, recipientName: "Cleanup" },
      }),
      { params: { id: tripId, stopId } }
    );
    await tripAction(makeRequest(`/api/trips/${tripId}`, { method: "PATCH", cookie: dispatcherCookie, body: { action: "complete" } }), {
      params: { id: tripId },
    });
  });

  it("resolving the stop from Dispatch (not the driver app) unblocks closing the trip", async () => {
    const { tripId, stopId, order } = await createDispatchedTrip(4);
    const { PATCH: stopAction } = await import("@/app/api/trips/[id]/stops/[stopId]/route");
    const { PATCH: tripAction } = await import("@/app/api/trips/[id]/route");

    // Confirm it's genuinely blocked first — not just "eventually works".
    const blocked = await tripAction(makeRequest(`/api/trips/${tripId}`, { method: "PATCH", cookie: dispatcherCookie, body: { action: "complete" } }), {
      params: { id: tripId },
    });
    expect(blocked.status).toBe(422);

    await stopAction(
      makeRequest(`/api/trips/${tripId}/stops/${stopId}`, {
        method: "PATCH",
        cookie: dispatcherCookie,
        body: { action: "deliver", deliveredQty: order.qtyOrdered, emptiesCollected: 0, recipientName: "Dispatcher-confirmed" },
      }),
      { params: { id: tripId, stopId } }
    );

    const closed = await tripAction(makeRequest(`/api/trips/${tripId}`, { method: "PATCH", cookie: dispatcherCookie, body: { action: "complete" } }), {
      params: { id: tripId },
    });
    expect(closed.status).toBe(200);
    expect((await closed.json()).status).toBe("COMPLETED");
  });

  it("a stop resolved as FAILED also unblocks closing the trip (failure is a resolution, not a block)", async () => {
    const { tripId, stopId } = await createDispatchedTrip(1);
    const { PATCH: stopAction } = await import("@/app/api/trips/[id]/stops/[stopId]/route");
    const { PATCH: tripAction } = await import("@/app/api/trips/[id]/route");

    await stopAction(
      makeRequest(`/api/trips/${tripId}/stops/${stopId}`, { method: "PATCH", cookie: dispatcherCookie, body: { action: "fail", failureReason: "Customer unreachable" } }),
      { params: { id: tripId, stopId } }
    );

    const closed = await tripAction(makeRequest(`/api/trips/${tripId}`, { method: "PATCH", cookie: dispatcherCookie, body: { action: "complete" } }), {
      params: { id: tripId },
    });
    expect(closed.status).toBe(200);
  });
});
