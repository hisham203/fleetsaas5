import { describe, it, expect, beforeAll } from "vitest";
import { makeRequest, loginAs } from "../helpers/request";

describe("per-warehouse inventory (BR-09)", () => {
  let dispatcherCookie: string;
  let adminCookie: string;
  let mainWarehouseId: string;
  let northWarehouseId: string;

  beforeAll(async () => {
    dispatcherCookie = await loginAs("dispatch@demo-water.co", "password123");
    adminCookie = await loginAs("admin@demo-water.co", "password123");

    const { GET: warehousesGet } = await import("@/app/api/warehouses/route");
    const warehouses = await (await warehousesGet(makeRequest("/api/warehouses", { cookie: dispatcherCookie }))).json();
    mainWarehouseId = warehouses.find((w: any) => w.isDefault).id;
    northWarehouseId = warehouses.find((w: any) => !w.isDefault).id;
  });

  it("seed data gives each warehouse its own independent stock", async () => {
    const { GET } = await import("@/app/api/inventory/route");
    const inventory = await (await GET(makeRequest("/api/inventory", { cookie: adminCookie }))).json();

    const mainFull = inventory.find((i: any) => i.warehouseId === mainWarehouseId && i.itemName === "19L Bottle - Full");
    const northFull = inventory.find((i: any) => i.warehouseId === northWarehouseId && i.itemName === "19L Bottle - Full");
    expect(mainFull.quantity).not.toBe(northFull.quantity);
  });

  it("confirming loading deducts stock from the trip's specific warehouse only", async () => {
    const { GET: inventoryGet } = await import("@/app/api/inventory/route");
    const before = await (await inventoryGet(makeRequest("/api/inventory", { cookie: adminCookie }))).json();
    const northBefore = before.find((i: any) => i.warehouseId === northWarehouseId && i.itemName === "19L Bottle - Full").quantity;
    const mainBefore = before.find((i: any) => i.warehouseId === mainWarehouseId && i.itemName === "19L Bottle - Full").quantity;

    const { GET: customersGet } = await import("@/app/api/customers/route");
    const customers = await (await customersGet(makeRequest("/api/customers", { cookie: dispatcherCookie }))).json();
    const customer = customers.find((c: any) => c.name === "Al Malaz Family");

    const { POST: createOrder } = await import("@/app/api/orders/route");
    const order = await (
      await createOrder(makeRequest("/api/orders", {
        method: "POST",
        cookie: dispatcherCookie,
        body: { customerId: customer.id, qtyOrdered: 4, emptyBottlesToCollect: 0, paymentMethod: "CASH" },
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
        body: { driverId: driver.id, vehicleId: vehicle.id, warehouseId: northWarehouseId, orderIds: [order.id] },
      }))
    ).json();

    const { PATCH: confirmLoading } = await import("@/app/api/trips/[id]/loading/route");
    await confirmLoading(
      makeRequest(`/api/trips/${trip.id}/loading`, { method: "PATCH", cookie: dispatcherCookie }),
      { params: { id: trip.id } }
    );

    const after = await (await inventoryGet(makeRequest("/api/inventory", { cookie: adminCookie }))).json();
    const northAfter = after.find((i: any) => i.warehouseId === northWarehouseId && i.itemName === "19L Bottle - Full").quantity;
    const mainAfter = after.find((i: any) => i.warehouseId === mainWarehouseId && i.itemName === "19L Bottle - Full").quantity;

    expect(northAfter).toBe(northBefore - 4); // North depot deducted by exactly the order quantity
    expect(mainAfter).toBe(mainBefore); // Main warehouse completely untouched

    // Clean up: resolve and close the trip so the vehicle/driver are freed
    // back to AVAILABLE for any other tests sharing this seeded database.
    const { PATCH: tripAction } = await import("@/app/api/trips/[id]/route");
    await tripAction(
      makeRequest(`/api/trips/${trip.id}`, { method: "PATCH", cookie: dispatcherCookie, body: { action: "dispatch" } }),
      { params: { id: trip.id } }
    );
    const stopId = trip.stops[0].id;
    const driverUserEmail = driver.user.email;
    const driverCookie = await loginAs(driverUserEmail, "password123");
    const { PATCH: stopAction } = await import("@/app/api/trips/[id]/stops/[stopId]/route");
    await stopAction(
      makeRequest(`/api/trips/${trip.id}/stops/${stopId}`, { method: "PATCH", cookie: driverCookie, body: { action: "arrive" } }),
      { params: { id: trip.id, stopId } }
    );
    await stopAction(
      makeRequest(`/api/trips/${trip.id}/stops/${stopId}`, {
        method: "PATCH",
        cookie: driverCookie,
        body: { action: "deliver", deliveredQty: 4, emptiesCollected: 0, recipientName: "Cleanup" },
      }),
      { params: { id: trip.id, stopId } }
    );
    await tripAction(
      makeRequest(`/api/trips/${trip.id}`, { method: "PATCH", cookie: dispatcherCookie, body: { action: "complete" } }),
      { params: { id: trip.id } }
    );
  });
});
