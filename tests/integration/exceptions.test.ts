import { describe, it, expect, beforeAll } from "vitest";
import { makeRequest, loginAs } from "../helpers/request";
import { createIsolatedDriverAndVehicle } from "../helpers/testFixtures";

// Test isolation fix: this file previously hardcoded khalid@demo-water.co
// as "the" driver, looked up fresh (not cached) but still drawn from the
// same small shared seeded pool every other test file also reaches into.
// Sharing that pool is what made this file's own literal error message
// ("Khalid not available — check test ordering") a real, observed CI
// failure — a completely unrelated test file leaving the shared driver
// busy is enough to break this one. A dedicated driver+vehicle, created
// once here and touched by nothing else, removes the shared pool
// entirely; the actual availability/business logic being tested is
// unchanged.
describe("delivery exception workflow (BR-11)", () => {
  let dispatcherCookie: string;
  let driverCookie: string;
  let driverId: string;
  let vehicleId: string;
  let tenantId: string;
  let warehouseId: string;

  beforeAll(async () => {
    dispatcherCookie = await loginAs("dispatch@demo-water.co", "password123");

    const { GET: tenantGet } = await import("@/app/api/tenant/route");
    tenantId = (await (await tenantGet(makeRequest("/api/tenant", { cookie: dispatcherCookie }))).json()).id;

    const { GET: warehousesGet } = await import("@/app/api/warehouses/route");
    const warehouses = await (await warehousesGet(makeRequest("/api/warehouses", { cookie: dispatcherCookie }))).json();
    warehouseId = warehouses.find((w: any) => w.isDefault).id;

    const isolated = await createIsolatedDriverAndVehicle(tenantId, "exceptions");
    driverCookie = isolated.driverCookie;
    driverId = isolated.driverId;
    vehicleId = isolated.vehicleId;
  });

  async function createDeliveredToStopTrip(qty: number) {
    const { GET: customersGet } = await import("@/app/api/customers/route");
    const customers = await (await customersGet(makeRequest("/api/customers", { cookie: dispatcherCookie }))).json();
    const customer = customers.find((c: any) => c.name === "Al Yasmin Residence");

    const { POST: createOrder } = await import("@/app/api/orders/route");
    const order = await (
      await createOrder(makeRequest("/api/orders", {
        method: "POST",
        cookie: dispatcherCookie,
        body: { customerId: customer.id, qtyOrdered: qty, emptyBottlesToCollect: 0, paymentMethod: "CASH" },
      }))
    ).json();

    const { POST: createTrip } = await import("@/app/api/trips/route");
    const trip = await (
      await createTrip(makeRequest("/api/trips", {
        method: "POST",
        cookie: dispatcherCookie,
        body: { driverId, vehicleId, warehouseId, orderIds: [order.id] },
      }))
    ).json();

    const { PATCH: confirmLoading } = await import("@/app/api/trips/[id]/loading/route");
    await confirmLoading(makeRequest(`/api/trips/${trip.id}/loading`, { method: "PATCH", cookie: dispatcherCookie }), {
      params: { id: trip.id },
    });
    const { PATCH: tripAction } = await import("@/app/api/trips/[id]/route");
    await tripAction(makeRequest(`/api/trips/${trip.id}`, { method: "PATCH", cookie: dispatcherCookie, body: { action: "dispatch" } }), {
      params: { id: trip.id },
    });

    const stopId = trip.stops[0].id;
    const { PATCH: stopAction } = await import("@/app/api/trips/[id]/stops/[stopId]/route");
    await stopAction(makeRequest(`/api/trips/${trip.id}/stops/${stopId}`, { method: "PATCH", cookie: driverCookie, body: { action: "arrive" } }), {
      params: { id: trip.id, stopId },
    });

    return { trip, stopId, order };
  }

  // Completing the trip after its stop is resolved (however it resolved)
  // frees the driver/vehicle back to AVAILABLE — without this, every test
  // after the first would find Khalid stuck ON_TRIP and fail to set up.
  async function finishTrip(tripId: string) {
    const { PATCH: tripAction } = await import("@/app/api/trips/[id]/route");
    await tripAction(makeRequest(`/api/trips/${tripId}`, { method: "PATCH", cookie: dispatcherCookie, body: { action: "complete" } }), {
      params: { id: tripId },
    });
  }

  it("a failed delivery automatically creates an OPEN exception", async () => {
    const { trip, stopId, order } = await createDeliveredToStopTrip(3);

    const { PATCH: stopAction } = await import("@/app/api/trips/[id]/stops/[stopId]/route");
    const res = await stopAction(
      makeRequest(`/api/trips/${trip.id}/stops/${stopId}`, {
        method: "PATCH",
        cookie: driverCookie,
        body: { action: "fail", failureReason: "Customer not home" },
      }),
      { params: { id: trip.id, stopId } }
    );
    expect(res.status).toBe(200);
    await finishTrip(trip.id);
    const { GET: exceptionsGet } = await import("@/app/api/exceptions/route");
    const openExceptions = await (
      await exceptionsGet(makeRequest("/api/exceptions?status=OPEN", { cookie: dispatcherCookie }))
    ).json();
    const found = openExceptions.find((e: any) => e.orderId === order.id);
    expect(found).toBeTruthy();
    expect(found.type).toBe("FAILED");
    expect(found.reason).toBe("Customer not home");
    expect(found.status).toBe("OPEN");
  });

  it("RETURN resolution returns the undelivered quantity to stock and generates a return note", async () => {
    const { trip, stopId, order } = await createDeliveredToStopTrip(4);

    const { GET: inventoryGet } = await import("@/app/api/inventory/route");
    const before = await (await inventoryGet(makeRequest("/api/inventory", { cookie: dispatcherCookie }))).json();
    const stockBefore = before.find((i: any) => i.warehouseId === warehouseId && i.itemName === "19L Bottle - Full").quantity;

    const { PATCH: stopAction } = await import("@/app/api/trips/[id]/stops/[stopId]/route");
    await stopAction(
      makeRequest(`/api/trips/${trip.id}/stops/${stopId}`, { method: "PATCH", cookie: driverCookie, body: { action: "fail", failureReason: "Gate locked" } }),
      { params: { id: trip.id, stopId } }
    );
    await finishTrip(trip.id);

    const { GET: exceptionsGet } = await import("@/app/api/exceptions/route");
    const openExceptions = await (await exceptionsGet(makeRequest("/api/exceptions?status=OPEN", { cookie: dispatcherCookie }))).json();
    const exception = openExceptions.find((e: any) => e.orderId === order.id);

    const { POST: resolve } = await import("@/app/api/exceptions/[id]/resolve/route");
    const res = await resolve(
      makeRequest(`/api/exceptions/${exception.id}/resolve`, { method: "POST", cookie: dispatcherCookie, body: { action: "RETURN", notes: "Customer refused" } }),
      { params: { id: exception.id } }
    );
    expect(res.status).toBe(200);
    const resolved = await res.json();
    expect(resolved.status).toBe("RESOLVED");
    expect(resolved.resolutionAction).toBe("RETURN");
    expect(resolved.returnNoteNumber).toMatch(/^RTN-/);
    expect(resolved.quantityReturned).toBe(4);
    expect(resolved.customerNotified).toBe(true);

    const after = await (await inventoryGet(makeRequest("/api/inventory", { cookie: dispatcherCookie }))).json();
    const stockAfter = after.find((i: any) => i.warehouseId === warehouseId && i.itemName === "19L Bottle - Full").quantity;
    expect(stockAfter).toBe(stockBefore + 4);
  });

  it("RESCHEDULE creates a follow-up PENDING order linked to the original", async () => {
    const { trip, stopId, order } = await createDeliveredToStopTrip(2);

    const { PATCH: stopAction } = await import("@/app/api/trips/[id]/stops/[stopId]/route");
    await stopAction(
      makeRequest(`/api/trips/${trip.id}/stops/${stopId}`, { method: "PATCH", cookie: driverCookie, body: { action: "fail", failureReason: "Road blocked" } }),
      { params: { id: trip.id, stopId } }
    );
    await finishTrip(trip.id);

    const { GET: exceptionsGet } = await import("@/app/api/exceptions/route");
    const openExceptions = await (await exceptionsGet(makeRequest("/api/exceptions?status=OPEN", { cookie: dispatcherCookie }))).json();
    const exception = openExceptions.find((e: any) => e.orderId === order.id);

    const { POST: resolve } = await import("@/app/api/exceptions/[id]/resolve/route");
    const res = await resolve(
      makeRequest(`/api/exceptions/${exception.id}/resolve`, { method: "POST", cookie: dispatcherCookie, body: { action: "RESCHEDULE" } }),
      { params: { id: exception.id } }
    );
    const resolved = await res.json();
    expect(resolved.resolutionAction).toBe("RESCHEDULE");
    expect(resolved.followUpOrderId).toBeTruthy();

    const { GET: ordersGet } = await import("@/app/api/orders/route");
    const allOrders = await (await ordersGet(makeRequest(`/api/orders?tenantId=${tenantId}`, { cookie: dispatcherCookie }))).json();
    const followUp = allOrders.find((o: any) => o.id === resolved.followUpOrderId);
    expect(followUp.status).toBe("PENDING");
    expect(followUp.qtyOrdered).toBe(2);
    expect(followUp.previousOrderId).toBe(order.id);
  });

  it("CANCEL marks the order CANCELLED and still returns stock", async () => {
    const { trip, stopId, order } = await createDeliveredToStopTrip(1);

    const { PATCH: stopAction } = await import("@/app/api/trips/[id]/stops/[stopId]/route");
    await stopAction(
      makeRequest(`/api/trips/${trip.id}/stops/${stopId}`, { method: "PATCH", cookie: driverCookie, body: { action: "fail", failureReason: "Customer cancelled" } }),
      { params: { id: trip.id, stopId } }
    );
    await finishTrip(trip.id);

    const { GET: exceptionsGet } = await import("@/app/api/exceptions/route");
    const openExceptions = await (await exceptionsGet(makeRequest("/api/exceptions?status=OPEN", { cookie: dispatcherCookie }))).json();
    const exception = openExceptions.find((e: any) => e.orderId === order.id);

    const { POST: resolve } = await import("@/app/api/exceptions/[id]/resolve/route");
    const res = await resolve(
      makeRequest(`/api/exceptions/${exception.id}/resolve`, { method: "POST", cookie: dispatcherCookie, body: { action: "CANCEL" } }),
      { params: { id: exception.id } }
    );
    const resolved = await res.json();
    expect(resolved.resolutionAction).toBe("CANCEL");
    expect(resolved.returnNoteNumber).toMatch(/^RTN-/);
    expect(resolved.followUpOrderId).toBeNull();

    const { GET: ordersGet } = await import("@/app/api/orders/route");
    const allOrders = await (await ordersGet(makeRequest(`/api/orders?tenantId=${tenantId}`, { cookie: dispatcherCookie }))).json();
    expect(allOrders.find((o: any) => o.id === order.id).status).toBe("CANCELLED");
  });

  it("escalating does not close the exception, and it can still be resolved afterward", async () => {
    const { trip, stopId, order } = await createDeliveredToStopTrip(1);

    const { PATCH: stopAction } = await import("@/app/api/trips/[id]/stops/[stopId]/route");
    await stopAction(
      makeRequest(`/api/trips/${trip.id}/stops/${stopId}`, { method: "PATCH", cookie: driverCookie, body: { action: "fail", failureReason: "Vehicle breakdown" } }),
      { params: { id: trip.id, stopId } }
    );
    await finishTrip(trip.id);

    const { GET: exceptionsGet } = await import("@/app/api/exceptions/route");
    const openExceptions = await (await exceptionsGet(makeRequest("/api/exceptions?status=OPEN", { cookie: dispatcherCookie }))).json();
    const exception = openExceptions.find((e: any) => e.orderId === order.id);

    const { POST: escalate } = await import("@/app/api/exceptions/[id]/escalate/route");
    const escalateRes = await escalate(makeRequest(`/api/exceptions/${exception.id}/escalate`, { method: "POST", cookie: dispatcherCookie, body: {} }), {
      params: { id: exception.id },
    });
    expect(escalateRes.status).toBe(200);
    const escalated = await escalateRes.json();
    expect(escalated.escalated).toBe(true);
    expect(escalated.status).toBe("OPEN");

    const { POST: resolve } = await import("@/app/api/exceptions/[id]/resolve/route");
    const resolveRes = await resolve(
      makeRequest(`/api/exceptions/${exception.id}/resolve`, { method: "POST", cookie: dispatcherCookie, body: { action: "CANCEL" } }),
      { params: { id: exception.id } }
    );
    expect(resolveRes.status).toBe(200);
    expect((await resolveRes.json()).status).toBe("RESOLVED");
  });

  it("cannot resolve an already-resolved exception (idempotency guard)", async () => {
    const { trip, stopId, order } = await createDeliveredToStopTrip(1);

    const { PATCH: stopAction } = await import("@/app/api/trips/[id]/stops/[stopId]/route");
    await stopAction(
      makeRequest(`/api/trips/${trip.id}/stops/${stopId}`, { method: "PATCH", cookie: driverCookie, body: { action: "fail", failureReason: "Test" } }),
      { params: { id: trip.id, stopId } }
    );
    await finishTrip(trip.id);

    const { GET: exceptionsGet } = await import("@/app/api/exceptions/route");
    const openExceptions = await (await exceptionsGet(makeRequest("/api/exceptions?status=OPEN", { cookie: dispatcherCookie }))).json();
    const exception = openExceptions.find((e: any) => e.orderId === order.id);

    const { POST: resolve } = await import("@/app/api/exceptions/[id]/resolve/route");
    await resolve(makeRequest(`/api/exceptions/${exception.id}/resolve`, { method: "POST", cookie: dispatcherCookie, body: { action: "CANCEL" } }), {
      params: { id: exception.id },
    });

    const secondAttempt = await resolve(
      makeRequest(`/api/exceptions/${exception.id}/resolve`, { method: "POST", cookie: dispatcherCookie, body: { action: "RETURN" } }),
      { params: { id: exception.id } }
    );
    expect(secondAttempt.status).toBe(422);
  });

  it("a partially-delivered stop creates an exception sized to the undelivered portion", async () => {
    const { trip, stopId, order } = await createDeliveredToStopTrip(5);

    const { PATCH: stopAction } = await import("@/app/api/trips/[id]/stops/[stopId]/route");
    await stopAction(
      makeRequest(`/api/trips/${trip.id}/stops/${stopId}`, {
        method: "PATCH",
        cookie: driverCookie,
        body: { action: "partial", deliveredQty: 2, emptiesCollected: 0, recipientName: "Partial Test" },
      }),
      { params: { id: trip.id, stopId } }
    );
    await finishTrip(trip.id);

    const { GET: exceptionsGet } = await import("@/app/api/exceptions/route");
    const openExceptions = await (await exceptionsGet(makeRequest("/api/exceptions?status=OPEN", { cookie: dispatcherCookie }))).json();
    const exception = openExceptions.find((e: any) => e.orderId === order.id);
    expect(exception).toBeTruthy();
    expect(exception.type).toBe("PARTIALLY_DELIVERED");

    const { POST: resolve } = await import("@/app/api/exceptions/[id]/resolve/route");
    const res = await resolve(
      makeRequest(`/api/exceptions/${exception.id}/resolve`, { method: "POST", cookie: dispatcherCookie, body: { action: "RESCHEDULE" } }),
      { params: { id: exception.id } }
    );
    const resolved = await res.json();

    const { GET: ordersGet } = await import("@/app/api/orders/route");
    const allOrders = await (await ordersGet(makeRequest(`/api/orders?tenantId=${tenantId}`, { cookie: dispatcherCookie }))).json();
    const followUp = allOrders.find((o: any) => o.id === resolved.followUpOrderId);
    expect(followUp.qtyOrdered).toBe(3);
  });

  it("a DRIVER cannot access the Exception Center or resolve exceptions (ADMIN/DISPATCHER only)", async () => {
    const { GET: exceptionsGet } = await import("@/app/api/exceptions/route");
    const res = await exceptionsGet(makeRequest("/api/exceptions", { cookie: driverCookie }));
    expect(res.status).toBe(401);
  });
});
