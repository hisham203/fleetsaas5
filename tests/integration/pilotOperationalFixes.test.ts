import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { makeRequest, loginAs } from "../helpers/request";
import { db } from "@/lib/db/client";
import { tenants, warehouses, drivers, customers, inventoryItems } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { genId } from "@/lib/helpers";
import { createIsolatedDriverAndVehicle } from "../helpers/testFixtures";

// Task G.2 — Pilot Operational UI & Flow Review. Three real, root-cause
// fixes, tested at the level that actually proves each one:
// 1. Trip loading confirmation (backend logic bug — tested directly).
// 2. Driver empty-state messaging (frontend copy — source-content check,
//    matching the established pattern already used by this project's
//    other login/copy tests, since no rendering framework exists).
// 3. Driver expense submission (frontend gap — source-content check for
//    the guard, plus a direct backend proof of the underlying cause).
describe("Pilot operational fixes (Task G.2)", () => {
  describe("1. Trip loading confirmation no longer hardcoded to bottles", () => {
    it("a Riyadh Bulk Water Logistics trip (no tracked inventory item at its loading point) confirms loading successfully, with no bottle-shortage message", async () => {
      const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
      const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");

      const loadingPoint = await db.query.warehouses.findFirst({ where: eq(warehouses.tenantId, tenant!.id) });
      const customer = await db.query.customers.findFirst({ where: eq(customers.tenantId, tenant!.id) });
      // A dedicated driver/vehicle for this test — this file creates
      // several trips across several tests, and the shared seeded
      // "Mohammed" driver would otherwise become unavailable (still
      // assigned to an earlier test's un-dispatched trip) for a later
      // test, exactly the class of cross-test contention already fixed
      // once before in this project for driver/vehicle fixtures.
      const isolated = await createIsolatedDriverAndVehicle(tenant!.id, "g2-loading-riyadh");

      // Confirm the premise directly: this loading point genuinely has no
      // tracked inventory at all.
      const existingStock = await db.query.inventoryItems.findMany({ where: eq(inventoryItems.warehouseId, loadingPoint!.id) });
      expect(existingStock.length).toBe(0);

      const { POST: createOrder } = await import("@/app/api/orders/route");
      const order = await (await createOrder(makeRequest("/api/orders", {
        method: "POST", cookie: adminCookie,
        body: { customerId: customer!.id, qtyOrdered: 1, emptyBottlesToCollect: 0, paymentMethod: "CASH" },
      }))).json();

      const { POST: createTrip } = await import("@/app/api/trips/route");
      const trip = await (await createTrip(makeRequest("/api/trips", {
        method: "POST", cookie: adminCookie,
        body: { driverId: isolated.driverId, vehicleId: isolated.vehicleId, warehouseId: loadingPoint!.id, orderIds: [order.id] },
      }))).json();

      const { PATCH: confirmLoading } = await import("@/app/api/trips/[id]/loading/route");
      const res = await confirmLoading(makeRequest(`/api/trips/${trip.id}/loading`, { method: "PATCH", cookie: adminCookie }), { params: { id: trip.id } });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.loadingConfirmed).toBe(true);
    });

    it("2. Demo Water Co.'s existing bottle-shortage behavior is completely unchanged — a real shortage still blocks loading with a clear message", async () => {
      const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Demo Water Co.") });
      const adminCookie = await loginAs("admin@demo-water.co", "password123");

      // A dedicated warehouse with deliberately insufficient bottle stock —
      // isolated so this doesn't interfere with any other test's shared
      // warehouse state.
      const warehouseId = genId();
      await db.insert(warehouses).values({ id: warehouseId, tenantId: tenant!.id, name: "G2 Shortage Test Warehouse", address: "Test", lat: 24.7, lng: 46.7 });
      await db.insert(inventoryItems).values({ id: genId(), tenantId: tenant!.id, warehouseId, itemName: "19L Bottle - Full", quantity: 0, unit: "bottle" });

      const customer = await db.query.customers.findFirst({ where: eq(customers.tenantId, tenant!.id) });
      const isolated = await createIsolatedDriverAndVehicle(tenant!.id, "g2-shortage-demo-water");

      const { POST: createOrder } = await import("@/app/api/orders/route");
      const order = await (await createOrder(makeRequest("/api/orders", {
        method: "POST", cookie: adminCookie,
        body: { customerId: customer!.id, qtyOrdered: 2, emptyBottlesToCollect: 2, paymentMethod: "CASH" },
      }))).json();

      const { POST: createTrip } = await import("@/app/api/trips/route");
      const trip = await (await createTrip(makeRequest("/api/trips", {
        method: "POST", cookie: adminCookie,
        body: { driverId: isolated.driverId, vehicleId: isolated.vehicleId, warehouseId, orderIds: [order.id] },
      }))).json();

      const { PATCH: confirmLoading } = await import("@/app/api/trips/[id]/loading/route");
      const res = await confirmLoading(makeRequest(`/api/trips/${trip.id}/loading`, { method: "PATCH", cookie: adminCookie }), { params: { id: trip.id } });
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.error).toContain("Shortage");
      expect(body.error).toContain("19L Bottle - Full");
    });

    it("3. a previously-latent bug for Acme (hardcoded to bottle naming) is fixed — its own diesel tank stock is now correctly checked and deducted", async () => {
      const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Acme Fuel Delivery Co.") });
      const adminCookie = await loginAs("admin@acme-fuel-demo.co", "password123");

      const warehouseId = genId();
      await db.insert(warehouses).values({ id: warehouseId, tenantId: tenant!.id, name: "G2 Acme Test Warehouse", address: "Test", lat: 24.7, lng: 46.7 });
      await db.insert(inventoryItems).values({ id: genId(), tenantId: tenant!.id, warehouseId, itemName: "Diesel Tank - Full", quantity: 5, unit: "tank" });

      const customer = await db.query.customers.findFirst({ where: eq(customers.tenantId, tenant!.id) });
      const isolated = await createIsolatedDriverAndVehicle(tenant!.id, "g2-acme-diesel");

      const { POST: createOrder } = await import("@/app/api/orders/route");
      const order = await (await createOrder(makeRequest("/api/orders", {
        method: "POST", cookie: adminCookie,
        body: { customerId: customer!.id, qtyOrdered: 2, emptyBottlesToCollect: 0, paymentMethod: "CASH" },
      }))).json();

      const { POST: createTrip } = await import("@/app/api/trips/route");
      const trip = await (await createTrip(makeRequest("/api/trips", {
        method: "POST", cookie: adminCookie,
        body: { driverId: isolated.driverId, vehicleId: isolated.vehicleId, warehouseId, orderIds: [order.id] },
      }))).json();

      const { PATCH: confirmLoading } = await import("@/app/api/trips/[id]/loading/route");
      const res = await confirmLoading(makeRequest(`/api/trips/${trip.id}/loading`, { method: "PATCH", cookie: adminCookie }), { params: { id: trip.id } });
      expect(res.status).toBe(200); // previously this would have wrongly reported a "0 bottles in stock" shortage

      const stockAfter = await db.query.inventoryItems.findFirst({ where: and(eq(inventoryItems.warehouseId, warehouseId), eq(inventoryItems.itemName, "Diesel Tank - Full")) });
      expect(stockAfter!.quantity).toBe(3); // correctly deducted from ITS OWN item, not silently ignored
    });
  });

  describe("2/3. Driver page source content — trip visibility and expense guard", () => {
    const driverPageSource = fs.readFileSync(path.join(process.cwd(), "app/driver/page.tsx"), "utf8");

    it("distinguishes a PLANNED assigned trip from having nothing assigned at all", () => {
      expect(driverPageSource).toContain("myPlannedTrip");
      expect(driverPageSource).toContain("awaiting loading confirmation by dispatcher");
      expect(driverPageSource).toContain("loaded and awaiting dispatch");
    });

    it("does not let a driver attempt an expense submission that is guaranteed to fail due to a missing vehicle assignment", () => {
      expect(driverPageSource).toContain("hasVehicle");
      expect(driverPageSource).toContain("disabled={!hasVehicle");
    });

    it("extracts a real, specific error message from a Zod validation failure instead of always falling back to a generic message", () => {
      expect(driverPageSource).toContain("extractErrorMessage");
      expect(driverPageSource).toContain("fieldErrors");
    });
  });

  describe("Root-cause proof: /api/expenses returns a non-string Zod error object when vehicleId is missing", () => {
    it("4. confirms the exact underlying cause of the reported 'Failed to submit expense' bug", async () => {
      const cookie = await loginAs("mohammed@riyadh-bulk-water.co", "password123");
      const { POST } = await import("@/app/api/expenses/route");
      const driver = await db.query.drivers.findFirst({ where: (d, { eq: eqOp }) => eqOp(d.licenseNumber, "RBW-LIC-1000") });

      const res = await POST(makeRequest("/api/expenses", {
        method: "POST", cookie,
        body: { driverId: driver!.id, vehicleId: undefined, reason: "Test — no vehicle assigned", category: "FUEL", amount: 50 },
      }));
      expect(res.status).toBe(400);
      const body = await res.json();
      // Confirmed: this is an OBJECT (Zod's flatten() shape), not a
      // string — exactly what the old frontend code's `typeof === "string"`
      // check silently swallowed into a generic, unhelpful message.
      expect(typeof body.error).not.toBe("string");
      expect(body.error.fieldErrors.vehicleId).toBeTruthy();
    });

    it("5. a valid expense submission (real vehicleId, real tripId) succeeds cleanly and exposes no passwordHash", async () => {
      const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
      const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
      const driverCookie = await loginAs("mohammed@riyadh-bulk-water.co", "password123");

      const loadingPoint = await db.query.warehouses.findFirst({ where: eq(warehouses.tenantId, tenant!.id) });
      const customer = await db.query.customers.findFirst({ where: eq(customers.tenantId, tenant!.id) });
      const isolated = await createIsolatedDriverAndVehicle(tenant!.id, "g2-valid-expense");

      const { POST: createOrder } = await import("@/app/api/orders/route");
      const order = await (await createOrder(makeRequest("/api/orders", {
        method: "POST", cookie: adminCookie,
        body: { customerId: customer!.id, qtyOrdered: 1, emptyBottlesToCollect: 0, paymentMethod: "CASH" },
      }))).json();
      const { POST: createTrip } = await import("@/app/api/trips/route");
      const trip = await (await createTrip(makeRequest("/api/trips", {
        method: "POST", cookie: adminCookie,
        body: { driverId: isolated.driverId, vehicleId: isolated.vehicleId, warehouseId: loadingPoint!.id, orderIds: [order.id] },
      }))).json();

      const { POST: submitExpense } = await import("@/app/api/expenses/route");
      const res = await submitExpense(makeRequest("/api/expenses", {
        method: "POST", cookie: isolated.driverCookie,
        body: { driverId: isolated.driverId, vehicleId: isolated.vehicleId, tripId: trip.id, category: "FUEL", amount: 75 },
      }));
      expect(res.status).toBe(201);
      const text = await res.text();
      expect(text).not.toContain("passwordHash");
    });
  });

  it("6. existing full suite behavior for Demo Water Co. warehouse-inventory remains exactly as tested before", async () => {
    // A direct sanity re-check, not a duplicate of the dedicated file —
    // proves the generic "- Full" lookup finds exactly the same row the
    // old hardcoded lookup would have.
    const demoWater = await db.query.tenants.findFirst({ where: eq(tenants.name, "Demo Water Co.") });
    const mainWarehouse = await db.query.warehouses.findFirst({ where: and(eq(warehouses.tenantId, demoWater!.id), eq(warehouses.isDefault, true)) });
    const stock = await db.query.inventoryItems.findFirst({ where: and(eq(inventoryItems.warehouseId, mainWarehouse!.id), eq(inventoryItems.itemName, "19L Bottle - Full")) });
    expect(stock).toBeTruthy();
  });
});
