import { describe, it, expect, beforeAll } from "vitest";
import { makeRequest, loginAs } from "../helpers/request";

describe("vehicle home warehouse default (BR-09)", () => {
  let adminCookie: string;
  let dispatcherCookie: string;
  let warehouseId: string;

  beforeAll(async () => {
    adminCookie = await loginAs("admin@demo-water.co", "password123");
    dispatcherCookie = await loginAs("dispatch@demo-water.co", "password123");

    const { GET: warehousesGet } = await import("@/app/api/warehouses/route");
    const warehouses = await (await warehousesGet(makeRequest("/api/warehouses", { cookie: dispatcherCookie }))).json();
    warehouseId = warehouses[0].id;
  });

  it("creates a vehicle with a home warehouse and returns it on GET", async () => {
    const { POST: createVehicle } = await import("@/app/api/vehicles/route");
    const createRes = await createVehicle(makeRequest("/api/vehicles", {
      method: "POST",
      cookie: adminCookie,
      body: { plateNumber: "TEST-HW-1", vehicleType: "Refill Van", capacityUnits: 80, homeWarehouseId: warehouseId },
    }));
    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    expect(created.homeWarehouseId).toBe(warehouseId);

    const { GET: vehiclesGet } = await import("@/app/api/vehicles/route");
    const vehicles = await (await vehiclesGet(makeRequest("/api/vehicles", { cookie: dispatcherCookie }))).json();
    const found = vehicles.find((v: any) => v.id === created.id);
    expect(found.homeWarehouseId).toBe(warehouseId);
  });

  it("rejects a home warehouse id that doesn't belong to this tenant", async () => {
    const { POST: createVehicle } = await import("@/app/api/vehicles/route");
    const res = await createVehicle(makeRequest("/api/vehicles", {
      method: "POST",
      cookie: adminCookie,
      body: { plateNumber: "TEST-HW-2", vehicleType: "Refill Van", homeWarehouseId: "not-a-real-warehouse-id" },
    }));
    expect(res.status).toBe(404);
  });

  it("can set and clear a home warehouse on an existing vehicle via PATCH", async () => {
    const { POST: createVehicle } = await import("@/app/api/vehicles/route");
    const created = await (
      await createVehicle(makeRequest("/api/vehicles", {
        method: "POST",
        cookie: adminCookie,
        body: { plateNumber: "TEST-HW-3", vehicleType: "Refill Van" },
      }))
    ).json();
    expect(created.homeWarehouseId).toBeNull();

    const { PATCH } = await import("@/app/api/vehicles/[id]/route");
    const setRes = await PATCH(
      makeRequest(`/api/vehicles/${created.id}`, { method: "PATCH", cookie: adminCookie, body: { homeWarehouseId: warehouseId } }),
      { params: { id: created.id } }
    );
    expect(setRes.status).toBe(200);
    expect((await setRes.json()).homeWarehouseId).toBe(warehouseId);

    const clearRes = await PATCH(
      makeRequest(`/api/vehicles/${created.id}`, { method: "PATCH", cookie: adminCookie, body: { homeWarehouseId: null } }),
      { params: { id: created.id } }
    );
    expect((await clearRes.json()).homeWarehouseId).toBeNull();
  });

  it("a DISPATCHER cannot update a vehicle's home warehouse (ADMIN only)", async () => {
    const { POST: createVehicle } = await import("@/app/api/vehicles/route");
    const created = await (
      await createVehicle(makeRequest("/api/vehicles", { method: "POST", cookie: adminCookie, body: { plateNumber: "TEST-HW-4", vehicleType: "Refill Van" } }))
    ).json();

    const { PATCH } = await import("@/app/api/vehicles/[id]/route");
    const res = await PATCH(
      makeRequest(`/api/vehicles/${created.id}`, { method: "PATCH", cookie: dispatcherCookie, body: { homeWarehouseId: warehouseId } }),
      { params: { id: created.id } }
    );
    expect(res.status).toBe(401);
  });
});
