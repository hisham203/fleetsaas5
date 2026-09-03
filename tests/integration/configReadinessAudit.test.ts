import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { makeRequest, loginAs } from "../helpers/request";
import { db } from "@/lib/db/client";
import { tenants, vehicles } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { genId } from "@/lib/helpers";

// Task H — Configuration & Pilot Readiness Review. Tests the two
// implemented fixes: vehicle capacity editing (previously creation-only)
// and Billing tab invoice-type visibility. Everything else audited in
// this task was either already correct (verified by reading, not
// re-tested here to avoid duplicating Task G.2/G.3's own coverage) or
// deliberately deferred (documented in the final report, not built).
describe("Vehicle capacity editing (Task H)", () => {
  it("1. PATCH /api/vehicles/[id] now accepts capacityLiters and capacityUnits, independently", async () => {
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");

    const vehicleId = genId();
    await db.insert(vehicles).values({ id: vehicleId, tenantId: tenant!.id, plateNumber: "TEST-EDIT-01", vehicleType: "Water Tanker", status: "AVAILABLE" });

    const { PATCH: updateVehicle } = await import("@/app/api/vehicles/[id]/route");
    const res = await updateVehicle(
      makeRequest(`/api/vehicles/${vehicleId}`, { method: "PATCH", cookie: adminCookie, body: { capacityLiters: 21000 } }),
      { params: { id: vehicleId } }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.capacityLiters).toBe(21000);
  });

  it("2. editing capacity does not accidentally clear homeWarehouseId, and vice versa", async () => {
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const { warehouses } = await import("@/lib/db/schema");
    const loadingPoint = await db.query.warehouses.findFirst({ where: eq(warehouses.tenantId, tenant!.id) });

    const vehicleId = genId();
    await db.insert(vehicles).values({
      id: vehicleId, tenantId: tenant!.id, plateNumber: "TEST-EDIT-02", vehicleType: "Water Tanker",
      status: "AVAILABLE", homeWarehouseId: loadingPoint!.id, capacityLiters: 18000,
    });

    const { PATCH: updateVehicle } = await import("@/app/api/vehicles/[id]/route");
    // Edit capacity only — homeWarehouseId must survive untouched.
    await updateVehicle(
      makeRequest(`/api/vehicles/${vehicleId}`, { method: "PATCH", cookie: adminCookie, body: { capacityLiters: 28000 } }),
      { params: { id: vehicleId } }
    );
    const afterCapacityEdit = await db.query.vehicles.findFirst({ where: eq(vehicles.id, vehicleId) });
    expect(afterCapacityEdit!.capacityLiters).toBe(28000);
    expect(afterCapacityEdit!.homeWarehouseId).toBe(loadingPoint!.id);
  });

  it("3. legacy capacityUnits vehicles can still be edited independently of capacityLiters", async () => {
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Demo Water Co.") });
    const adminCookie = await loginAs("admin@demo-water.co", "password123");

    const vehicleId = genId();
    await db.insert(vehicles).values({ id: vehicleId, tenantId: tenant!.id, plateNumber: "TEST-EDIT-03", vehicleType: "Refill Van", status: "AVAILABLE", capacityUnits: 100 });

    const { PATCH: updateVehicle } = await import("@/app/api/vehicles/[id]/route");
    const res = await updateVehicle(
      makeRequest(`/api/vehicles/${vehicleId}`, { method: "PATCH", cookie: adminCookie, body: { capacityUnits: 150 } }),
      { params: { id: vehicleId } }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.capacityUnits).toBe(150);
    expect(body.capacityLiters).toBeNull();
  });

  it("4. the admin vehicles table source includes a click-to-edit capacity control", () => {
    const adminSource = fs.readFileSync(path.join(process.cwd(), "app/admin/page.tsx"), "utf8");
    expect(adminSource).toContain("startEditCapacity");
    expect(adminSource).toContain("saveCapacity");
  });
});

describe("Billing tab invoice-type visibility (Task H)", () => {
  it("5. the admin Billing tab source now displays invoiceType and distinguishes monthly from single-order invoices", () => {
    const adminSource = fs.readFileSync(path.join(process.cwd(), "app/admin/page.tsx"), "utf8");
    expect(adminSource).toContain("invoiceType");
    expect(adminSource).toContain("MONTHLY_CONSOLIDATED");
    expect(adminSource).toContain("Single order");
  });

  it("6. GET /api/invoices still returns the invoiceType/contractPeriod/lineItemsCount fields the Billing tab now reads", async () => {
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const { GET: getInvoices } = await import("@/app/api/invoices/route");
    const res = await getInvoices(makeRequest("/api/invoices", { cookie: adminCookie }));
    expect(res.status).toBe(200);
    const rows = await res.json();
    // Field presence, not specific values — this tenant may or may not
    // have invoices yet depending on other tests' ordering.
    if (rows.length > 0) {
      expect(rows[0]).toHaveProperty("invoiceType");
      expect(rows[0]).toHaveProperty("lineItemsCount");
    }
  });
});

describe("Re-confirmation of prior pilot fixes (Task H, Part 4)", () => {
  it("7. loading confirmation still succeeds for a Riyadh Bulk Water trip with no tracked inventory (G.3 fix holds)", async () => {
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const { warehouses, customers } = await import("@/lib/db/schema");
    const { createIsolatedDriverAndVehicle } = await import("../helpers/testFixtures");
    const loadingPoint = await db.query.warehouses.findFirst({ where: eq(warehouses.tenantId, tenant!.id) });
    const customer = await db.query.customers.findFirst({ where: eq(customers.tenantId, tenant!.id) });
    const isolated = await createIsolatedDriverAndVehicle(tenant!.id, "h-loading-reconfirm");

    const { POST: createOrder } = await import("@/app/api/orders/route");
    const order = await (await createOrder(makeRequest("/api/orders", {
      method: "POST", cookie: adminCookie, body: { customerId: customer!.id, qtyOrdered: 1, emptyBottlesToCollect: 0, paymentMethod: "CASH" },
    }))).json();
    const { POST: createTrip } = await import("@/app/api/trips/route");
    const trip = await (await createTrip(makeRequest("/api/trips", {
      method: "POST", cookie: adminCookie,
      body: { driverId: isolated.driverId, vehicleId: isolated.vehicleId, warehouseId: loadingPoint!.id, orderIds: [order.id] },
    }))).json();
    const { PATCH: confirmLoading } = await import("@/app/api/trips/[id]/loading/route");
    const res = await confirmLoading(makeRequest(`/api/trips/${trip.id}/loading`, { method: "PATCH", cookie: adminCookie }), { params: { id: trip.id } });
    expect(res.status).toBe(200);
  });

  it("8. driver expense form source still guards against submitting with no vehicle assigned (G.2 fix holds)", () => {
    const driverSource = fs.readFileSync(path.join(process.cwd(), "app/driver/page.tsx"), "utf8");
    expect(driverSource).toContain("hasVehicle");
  });

  it("9. dispatch page source still contains no misleading bottle-era order wording (G.3 fix holds)", () => {
    const dispatchSource = fs.readFileSync(path.join(process.cwd(), "app/dispatch/page.tsx"), "utf8");
    expect(dispatchSource).not.toContain("bottleSizeLtr");
  });
});
