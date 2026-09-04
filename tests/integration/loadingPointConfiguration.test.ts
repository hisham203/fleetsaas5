import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { makeRequest, loginAs } from "../helpers/request";
import { db } from "@/lib/db/client";
import { tenants, warehouses, inventoryItems } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

// Task L — Loading Point / Warehouse Operational Configuration.
describe("POST /api/warehouses — conditional inventory auto-creation (Task L)", () => {
  it("2. a new loading point for a tenant with zero existing inventory tracking (Riyadh Bulk Water) gets no bottle inventory forced onto it", async () => {
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");

    const { POST: createWarehouse } = await import("@/app/api/warehouses/route");
    const res = await createWarehouse(makeRequest("/api/warehouses", {
      method: "POST", cookie: adminCookie,
      body: { name: "Task L Test Loading Point", address: "Test Address", lat: 24.7, lng: 46.7 },
    }));
    expect(res.status).toBe(201);
    const created = await res.json();

    const items = await db.query.inventoryItems.findMany({ where: eq(inventoryItems.warehouseId, created.id) });
    expect(items.length).toBe(0);
  });

  it("4. a new warehouse for a tenant that already tracks inventory (Demo Water Co.) still gets the standard bottle items — legacy behavior unchanged", async () => {
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Demo Water Co.") });
    const adminCookie = await loginAs("admin@demo-water.co", "password123");

    const { POST: createWarehouse } = await import("@/app/api/warehouses/route");
    const res = await createWarehouse(makeRequest("/api/warehouses", {
      method: "POST", cookie: adminCookie,
      body: { name: "Task L Test Legacy Warehouse", address: "Test Address", lat: 24.7, lng: 46.7 },
    }));
    expect(res.status).toBe(201);
    const created = await res.json();

    const items = await db.query.inventoryItems.findMany({ where: eq(inventoryItems.warehouseId, created.id) });
    expect(items.length).toBe(2);
    expect(items.some((i) => i.itemName === "19L Bottle - Full")).toBe(true);
    expect(items.some((i) => i.itemName === "19L Bottle - Empty")).toBe(true);
  });
});

describe("PATCH /api/warehouses/[id] (Task L, Part 4)", () => {
  it("5/6. exists, is tenant-isolated, and updates name/address", async () => {
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const loadingPoint = await db.query.warehouses.findFirst({ where: eq(warehouses.tenantId, tenant!.id) });

    const { PATCH: updateWarehouse } = await import("@/app/api/warehouses/[id]/route");
    const res = await updateWarehouse(
      makeRequest(`/api/warehouses/${loadingPoint!.id}`, { method: "PATCH", cookie: adminCookie, body: { name: "Renamed Loading Point" } }),
      { params: { id: loadingPoint!.id } }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("Renamed Loading Point");
    expect(body.address).toBe(loadingPoint!.address); // untouched, partial update

    // Revert so this test doesn't leave the real seeded loading point renamed for other tests/runs.
    await db.update(warehouses).set({ name: loadingPoint!.name }).where(eq(warehouses.id, loadingPoint!.id));
  });

  it("cross-tenant PATCH is rejected", async () => {
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const loadingPoint = await db.query.warehouses.findFirst({ where: eq(warehouses.tenantId, tenant!.id) });
    const demoWaterCookie = await loginAs("admin@demo-water.co", "password123");

    const { PATCH: updateWarehouse } = await import("@/app/api/warehouses/[id]/route");
    const res = await updateWarehouse(
      makeRequest(`/api/warehouses/${loadingPoint!.id}`, { method: "PATCH", cookie: demoWaterCookie, body: { name: "Should fail" } }),
      { params: { id: loadingPoint!.id } }
    );
    expect(res.status).toBe(404);
  });

  it("7. does not mutate inventory in any way", async () => {
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Demo Water Co.") });
    const adminCookie = await loginAs("admin@demo-water.co", "password123");
    const warehouse = await db.query.warehouses.findFirst({ where: and(eq(warehouses.tenantId, tenant!.id), eq(warehouses.isDefault, true)) });

    const itemsBefore = await db.query.inventoryItems.findMany({ where: eq(inventoryItems.warehouseId, warehouse!.id) });

    const { PATCH: updateWarehouse } = await import("@/app/api/warehouses/[id]/route");
    await updateWarehouse(
      makeRequest(`/api/warehouses/${warehouse!.id}`, { method: "PATCH", cookie: adminCookie, body: { address: "Task L test address, reverted below" } }),
      { params: { id: warehouse!.id } }
    );

    const itemsAfter = await db.query.inventoryItems.findMany({ where: eq(inventoryItems.warehouseId, warehouse!.id) });
    expect(itemsAfter.length).toBe(itemsBefore.length);
    expect(itemsAfter.map((i) => i.quantity)).toEqual(itemsBefore.map((i) => i.quantity));

    // Revert.
    await db.update(warehouses).set({ address: warehouse!.address }).where(eq(warehouses.id, warehouse!.id));
  });

  it("DISPATCHER can also edit operational fields, matching GET's existing role policy", async () => {
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const dispatcherCookie = await loginAs("dispatch@riyadh-bulk-water.co", "password123");
    const loadingPoint = await db.query.warehouses.findFirst({ where: eq(warehouses.tenantId, tenant!.id) });

    const { PATCH: updateWarehouse } = await import("@/app/api/warehouses/[id]/route");
    const res = await updateWarehouse(
      makeRequest(`/api/warehouses/${loadingPoint!.id}`, { method: "PATCH", cookie: dispatcherCookie, body: { address: "Dispatcher-corrected address" } }),
      { params: { id: loadingPoint!.id } }
    );
    expect(res.status).toBe(200);
    await db.update(warehouses).set({ address: loadingPoint!.address }).where(eq(warehouses.id, loadingPoint!.id));
  });

  it("10. no passwordHash exposure", async () => {
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const loadingPoint = await db.query.warehouses.findFirst({ where: eq(warehouses.tenantId, tenant!.id) });
    const { PATCH: updateWarehouse } = await import("@/app/api/warehouses/[id]/route");
    const res = await updateWarehouse(
      makeRequest(`/api/warehouses/${loadingPoint!.id}`, { method: "PATCH", cookie: adminCookie, body: { address: loadingPoint!.address } }),
      { params: { id: loadingPoint!.id } }
    );
    const text = await res.text();
    expect(text).not.toContain("passwordHash");
  });
});

describe("Loading Point / Warehouse UI labels and empty-state wording (Task L)", () => {
  const adminSource = fs.readFileSync(path.join(process.cwd(), "app/admin/page.tsx"), "utf8");
  const dispatchSource = fs.readFileSync(path.join(process.cwd(), "app/dispatch/page.tsx"), "utf8");

  it("1. dual-label Loading Point / Warehouse wording exists in the admin inventory section", () => {
    expect(adminSource).toContain("Loading Points / Warehouses");
    expect(adminSource).toContain("Loading point / warehouse name");
    expect(adminSource).toContain("New loading point / warehouse");
  });

  it("3. the empty-inventory message uses the exact wording this task specified, not bottle-shortage language", () => {
    expect(adminSource).toContain("No tracked inventory. Loading confirmation will not require stock deduction.");
    expect(adminSource).not.toContain("No stock items yet.");
  });

  it("8. the dispatch page's loading point selector uses clear Loading point / warehouse wording", () => {
    expect(dispatchSource).toContain("Loading point / warehouse…");
  });

  it("9. the vehicle home loading point / warehouse display and default-selection label remain correct", () => {
    expect(adminSource).toContain("Home warehouse / loading point");
    expect(adminSource).toContain("No default loading point / warehouse");
  });

  it("an edit capability exists per loading point card", () => {
    expect(adminSource).toContain("startEditWarehouse");
    expect(adminSource).toContain("saveWarehouseEdit");
  });
});
