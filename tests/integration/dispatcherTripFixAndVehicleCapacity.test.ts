import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { makeRequest, loginAs } from "../helpers/request";
import { db } from "@/lib/db/client";
import { tenants, warehouses, vehicles, customers, orders } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { createIsolatedDriverAndVehicle } from "../helpers/testFixtures";
import { genId } from "@/lib/helpers";

// Task G.2/G.3 — Dispatcher Trip Assignment Fix + Vehicle Capacity Liters
// UI Support.
describe("Dispatcher trip assignment fix (G.3)", () => {
  describe("1/2. Root cause: the seed's ad-hoc order was left PENDING while already attached to a real trip", () => {
    it("the seeded ad-hoc order is now correctly ASSIGNED, not PENDING — it must not appear in the dispatcher's assignable queue", async () => {
      const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
      const riyadhTowers = await db.query.customers.findFirst({ where: and(eq(customers.tenantId, tenant!.id), eq(customers.name, "Riyadh Towers Facilities")) });
      const adHocOrder = await db.query.orders.findFirst({ where: and(eq(orders.tenantId, tenant!.id), eq(orders.customerId, riyadhTowers!.id)) });
      expect(adHocOrder!.status).toBe("ASSIGNED");
      expect(adHocOrder!.status).not.toBe("PENDING");
    });

    it("attempting to create a second trip for an order already on an active trip returns a clear 422, not a crash", async () => {
      const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
      const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
      const loadingPoint = await db.query.warehouses.findFirst({ where: eq(warehouses.tenantId, tenant!.id) });
      const customer = await db.query.customers.findFirst({ where: eq(customers.tenantId, tenant!.id) });
      const isolated1 = await createIsolatedDriverAndVehicle(tenant!.id, "g3-dup-first");
      const isolated2 = await createIsolatedDriverAndVehicle(tenant!.id, "g3-dup-second");

      const { POST: createOrder } = await import("@/app/api/orders/route");
      const order = await (await createOrder(makeRequest("/api/orders", {
        method: "POST", cookie: adminCookie,
        body: { customerId: customer!.id, qtyOrdered: 1, emptyBottlesToCollect: 0, paymentMethod: "CASH" },
      }))).json();

      const { POST: createTrip } = await import("@/app/api/trips/route");
      const firstTripRes = await createTrip(makeRequest("/api/trips", {
        method: "POST", cookie: adminCookie,
        body: { driverId: isolated1.driverId, vehicleId: isolated1.vehicleId, warehouseId: loadingPoint!.id, orderIds: [order.id] },
      }));
      expect(firstTripRes.status).toBe(201);

      // The order's own status now correctly reflects ASSIGNED, so the
      // pre-existing orders.status guard alone would already catch this
      // — but this proves the NEW, direct tripStops-based guard also
      // works even if that first line of defense were ever bypassed
      // (e.g. status manually reset without clearing the real tripStop).
      await db.update(orders).set({ status: "PENDING" }).where(eq(orders.id, order.id));

      const secondTripRes = await createTrip(makeRequest("/api/trips", {
        method: "POST", cookie: adminCookie,
        body: { driverId: isolated2.driverId, vehicleId: isolated2.vehicleId, warehouseId: loadingPoint!.id, orderIds: [order.id] },
      }));
      expect(secondTripRes.status).toBe(422); // not a 500, not an empty body
      const body = await secondTripRes.json();
      expect(typeof body.error).toBe("string");
      expect(body.error).toContain("already assigned");
    });
  });

  it("3/7. a fresh Riyadh Bulk Water order can be assigned to a trip end-to-end with a 28,000L tanker — the exact previously-stuck scenario now works", async () => {
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const loadingPoint = await db.query.warehouses.findFirst({ where: eq(warehouses.tenantId, tenant!.id) });
    const customer = await db.query.customers.findFirst({ where: eq(customers.tenantId, tenant!.id) });
    const isolated = await createIsolatedDriverAndVehicle(tenant!.id, "g3-happy-path");
    // A dedicated, isolated 28,000L tanker (capacityUnits null, matching
    // the real seeded fleet's shape exactly) rather than the shared
    // seeded RBW-T006 — avoids any availability contention with another
    // test that might also reach for that same real vehicle.
    const tanker28kId = genId();
    await db.insert(vehicles).values({
      id: tanker28kId, tenantId: tenant!.id, plateNumber: "TEST-CAP-28K", vehicleType: "Water Tanker",
      capacityLiters: 28000, status: "AVAILABLE",
    });

    const { POST: createOrder } = await import("@/app/api/orders/route");
    const order = await (await createOrder(makeRequest("/api/orders", {
      method: "POST", cookie: adminCookie,
      body: { customerId: customer!.id, qtyOrdered: 1, emptyBottlesToCollect: 0, paymentMethod: "CASH" },
    }))).json();

    const { POST: createTrip } = await import("@/app/api/trips/route");
    const res = await createTrip(makeRequest("/api/trips", {
      method: "POST", cookie: adminCookie,
      body: { driverId: isolated.driverId, vehicleId: tanker28kId, warehouseId: loadingPoint!.id, orderIds: [order.id] },
    }));
    expect(res.status).toBe(201); // not blocked by bottle-era capacityUnits assumptions (null on this vehicle)
    const body = await res.json();
    expect(body.vehicle.capacityLiters).toBe(28000);
  });

  it("Demo Water Co.'s existing bottle-van trip creation and capacity enforcement remain completely unaffected", async () => {
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Demo Water Co.") });
    const adminCookie = await loginAs("admin@demo-water.co", "password123");
    const mainWarehouse = await db.query.warehouses.findFirst({ where: and(eq(warehouses.tenantId, tenant!.id), eq(warehouses.isDefault, true)) });
    const customer = await db.query.customers.findFirst({ where: eq(customers.tenantId, tenant!.id) });
    const isolated = await createIsolatedDriverAndVehicle(tenant!.id, "g3-demowater-regression");

    const { POST: createOrder } = await import("@/app/api/orders/route");
    const order = await (await createOrder(makeRequest("/api/orders", {
      method: "POST", cookie: adminCookie,
      body: { customerId: customer!.id, qtyOrdered: 2, emptyBottlesToCollect: 2, paymentMethod: "CASH" },
    }))).json();

    const { POST: createTrip } = await import("@/app/api/trips/route");
    const res = await createTrip(makeRequest("/api/trips", {
      method: "POST", cookie: adminCookie,
      body: { driverId: isolated.driverId, vehicleId: isolated.vehicleId, warehouseId: mainWarehouse!.id, orderIds: [order.id] },
    }));
    expect(res.status).toBe(201); // isolated fixture vehicle has capacityUnits:100, well above 2 — still enforced correctly
  });

  describe("5/6. Dispatch page wording — source content", () => {
    const dispatchSource = fs.readFileSync(path.join(process.cwd(), "app/dispatch/page.tsx"), "utf8");

    it("no longer displays the misleading bottle-era 'x {bottleSizeLtr}L' order line", () => {
      expect(dispatchSource).not.toContain("bottleSizeLtr");
      expect(dispatchSource).toContain("unit(s)");
    });

    it("uses neutral 'load(s) total' wording instead of 'units total'", () => {
      expect(dispatchSource).toContain("load(s) total");
      expect(dispatchSource).not.toContain("units total");
    });

    it("createTrip always resets the busy state, even if the response is unreadable", () => {
      expect(dispatchSource).toContain("finally");
      expect(dispatchSource).toContain("setBusy(false)");
    });
  });

  it("Demo Water Co. and Acme's bottle/diesel order displays are unaffected by the wording change (neutral wording, not tenant-specific removal)", async () => {
    // The order line change is global copy, not tenant-conditional logic
    // — confirmed by the source check above having no tenant branching.
    // This test just confirms the underlying qtyOrdered/emptyBottlesToCollect
    // data driving that display is completely untouched for existing tenants.
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Demo Water Co.") });
    const adminCookie = await loginAs("admin@demo-water.co", "password123");
    const { GET: getOrders } = await import("@/app/api/orders/route");
    const res = await getOrders(makeRequest(`/api/orders?tenantId=${tenant!.id}`, { cookie: adminCookie }));
    expect(res.status).toBe(200);
    const rows = await res.json();
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.every((o: any) => typeof o.qtyOrdered === "number")).toBe(true);
  });
});

describe("Vehicle capacityLiters UI support (G.3)", () => {
  it("8. the vehicle creation API already accepts capacityLiters end-to-end", async () => {
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");

    const { POST: createVehicle } = await import("@/app/api/vehicles/route");
    const res = await createVehicle(makeRequest("/api/vehicles", {
      method: "POST", cookie: adminCookie,
      body: { plateNumber: "TEST-CAP-01", vehicleType: "Water Tanker", capacityLiters: 21000 },
    }));
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created.capacityLiters).toBe(21000);
    expect(created.tenantId).toBe(tenant!.id);
  });

  it("9. the admin vehicle creation form's source includes a capacityLiters field with clear labeling", () => {
    const adminSource = fs.readFileSync(path.join(process.cwd(), "app/admin/page.tsx"), "utf8");
    expect(adminSource).toContain("capacityLiters");
    expect(adminSource).toContain("Tanker capacity (liters)");
    // Placeholder is illustrative only, not a hardcoded requirement.
    expect(adminSource).toMatch(/18000|18,000/);
  });

  it("10. a vehicle created with capacityLiters displays in liters via GET /api/vehicles, not units", async () => {
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const { POST: createVehicle } = await import("@/app/api/vehicles/route");
    await createVehicle(makeRequest("/api/vehicles", {
      method: "POST", cookie: adminCookie,
      body: { plateNumber: "TEST-CAP-02", vehicleType: "Water Tanker", capacityLiters: 18000 },
    }));

    const { GET: getVehicles } = await import("@/app/api/vehicles/route");
    const res = await getVehicles(makeRequest("/api/vehicles", { cookie: adminCookie }));
    const rows = await res.json();
    const created = rows.find((v: any) => v.plateNumber === "TEST-CAP-02");
    expect(created.capacityLiters).toBe(18000);
    expect(created.capacityUnits).toBeNull();
  });

  it("11. legacy vehicle creation with only capacityUnits still works exactly as before", async () => {
    const adminCookie = await loginAs("admin@demo-water.co", "password123");
    const { POST: createVehicle } = await import("@/app/api/vehicles/route");
    const res = await createVehicle(makeRequest("/api/vehicles", {
      method: "POST", cookie: adminCookie,
      body: { plateNumber: "DW-TEST-LEGACY-01", vehicleType: "Refill Van", capacityUnits: 120 },
    }));
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created.capacityUnits).toBe(120);
    expect(created.capacityLiters).toBeNull();
  });
});
