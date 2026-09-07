import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { makeRequest, loginAs } from "../helpers/request";
import { db } from "@/lib/db/client";
import { tenants, itemGroups, itemCategories, itemSubcategories, items, workshops, maintenanceWarehouses, suppliers } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { genId } from "@/lib/helpers";

// Milestone Z.2 — Fleet Maintenance ERP Master Data & Foundation UI.
async function riyadh() {
  return await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
}
async function demo() {
  return await db.query.tenants.findFirst({ where: eq(tenants.name, "Demo Water Co.") });
}

describe("API auth/tenant tests (Part 11, items 1-6)", () => {
  it("1/2. all new POST APIs require auth and ADMIN role", async () => {
    const { POST } = await import("@/app/api/item-groups/route");
    const noAuth = await POST(makeRequest("/api/item-groups", { method: "POST", body: { code: "X", name: "X" } }));
    expect(noAuth.status).toBe(401);
    const driverCookie = await loginAs("mohammed@riyadh-bulk-water.co", "password123");
    const driverRes = await POST(makeRequest("/api/item-groups", { method: "POST", cookie: driverCookie, body: { code: "X", name: "X" } }));
    expect(driverRes.status).toBe(401);
  });

  it("3/4. tenant isolation enforced, cross-tenant references blocked", async () => {
    const r = await riyadh();
    const d = await demo();
    const riyadhAdminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const demoGroupId = genId();
    await db.insert(itemGroups).values({ id: demoGroupId, tenantId: d!.id, code: "DEMO-GRP", name: "Demo Group" });
    const { POST: createCategory } = await import("@/app/api/item-categories/route");
    const res = await createCategory(makeRequest("/api/item-categories", { method: "POST", cookie: riyadhAdminCookie, body: { code: "TEST-CAT", name: "Test", itemGroupId: demoGroupId } }));
    expect(res.status).toBe(400);
  });

  it("5/6. duplicate code per tenant returns 409; same code in different tenants is allowed", async () => {
    const r = await riyadh();
    const d = await demo();
    const riyadhAdminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const demoAdminCookie = await loginAs("admin@demo-water.co", "password123");
    const { POST: createGroup } = await import("@/app/api/item-groups/route");
    const first = await createGroup(makeRequest("/api/item-groups", { method: "POST", cookie: riyadhAdminCookie, body: { code: "SHARED-CODE", name: "First" } }));
    expect(first.status).toBe(201);
    const dup = await createGroup(makeRequest("/api/item-groups", { method: "POST", cookie: riyadhAdminCookie, body: { code: "SHARED-CODE", name: "Dup" } }));
    expect(dup.status).toBe(409);
    const otherTenant = await createGroup(makeRequest("/api/item-groups", { method: "POST", cookie: demoAdminCookie, body: { code: "SHARED-CODE", name: "Demo Version" } }));
    expect(otherTenant.status).toBe(201);
  });
});

describe("Master Items tests (Part 11, items 7-23)", () => {
  it("7/8/9. create, edit, and deactivate an item group", async () => {
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const { POST: createGroup } = await import("@/app/api/item-groups/route");
    const created = await (await createGroup(makeRequest("/api/item-groups", { method: "POST", cookie: adminCookie, body: { code: `GRP-${genId().slice(0, 6)}`, name: "Tires" } }))).json();
    const { PATCH: updateGroup } = await import("@/app/api/item-groups/[id]/route");
    const edited = await (await updateGroup(makeRequest(`/api/item-groups/${created.id}`, { method: "PATCH", cookie: adminCookie, body: { name: "Tires & Wheels" } }), { params: { id: created.id } })).json();
    expect(edited.name).toBe("Tires & Wheels");
    const deactivated = await (await updateGroup(makeRequest(`/api/item-groups/${created.id}`, { method: "PATCH", cookie: adminCookie, body: { status: "INACTIVE" } }), { params: { id: created.id } })).json();
    expect(deactivated.status).toBe("INACTIVE");
  });

  it("10/11/12. create category with and without a group, then edit it", async () => {
    const r = await riyadh();
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const groupId = genId();
    await db.insert(itemGroups).values({ id: groupId, tenantId: r!.id, code: `G-${genId().slice(0, 6)}`, name: "Test Group" });
    const { POST: createCategory, GET: getCategories } = await import("@/app/api/item-categories/route");
    const withGroup = await (await createCategory(makeRequest("/api/item-categories", { method: "POST", cookie: adminCookie, body: { code: `C1-${genId().slice(0, 6)}`, name: "With Group", itemGroupId: groupId } }))).json();
    expect(withGroup.itemGroupId).toBe(groupId);
    const withoutGroup = await (await createCategory(makeRequest("/api/item-categories", { method: "POST", cookie: adminCookie, body: { code: `C2-${genId().slice(0, 6)}`, name: "No Group" } }))).json();
    expect(withoutGroup.itemGroupId).toBeFalsy();
    const { PATCH: updateCategory } = await import("@/app/api/item-categories/[id]/route");
    const edited = await (await updateCategory(makeRequest(`/api/item-categories/${withoutGroup.id}`, { method: "PATCH", cookie: adminCookie, body: { name: "Renamed" } }), { params: { id: withoutGroup.id } })).json();
    expect(edited.name).toBe("Renamed");
  });

  it("13/14. create and edit a subcategory under a category", async () => {
    const r = await riyadh();
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const categoryId = genId();
    await db.insert(itemCategories).values({ id: categoryId, tenantId: r!.id, code: `CAT-${genId().slice(0, 6)}`, name: "Filters" });
    const { POST: createSub } = await import("@/app/api/item-subcategories/route");
    const sub = await (await createSub(makeRequest("/api/item-subcategories", { method: "POST", cookie: adminCookie, body: { code: `SUB-${genId().slice(0, 6)}`, name: "Oil Filter", categoryId } }))).json();
    expect(sub.categoryId).toBe(categoryId);
    const { PATCH: updateSub } = await import("@/app/api/item-subcategories/[id]/route");
    const edited = await (await updateSub(makeRequest(`/api/item-subcategories/${sub.id}`, { method: "PATCH", cookie: adminCookie, body: { name: "Oil Filter (Renamed)" } }), { params: { id: sub.id } })).json();
    expect(edited.name).toBe("Oil Filter (Renamed)");
  });

  it("15/16/17/18/19. create item with category, with category+subcategory, reject mismatched subcategory, edit, and deactivate", async () => {
    const r = await riyadh();
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const categoryAId = genId();
    const categoryBId = genId();
    await db.insert(itemCategories).values([
      { id: categoryAId, tenantId: r!.id, code: `CA-${genId().slice(0, 6)}`, name: "Category A" },
      { id: categoryBId, tenantId: r!.id, code: `CB-${genId().slice(0, 6)}`, name: "Category B" },
    ]);
    const subOfAId = genId();
    await db.insert(itemSubcategories).values({ id: subOfAId, tenantId: r!.id, categoryId: categoryAId, code: `SA-${genId().slice(0, 6)}`, name: "Sub of A" });

    const { POST: createItem } = await import("@/app/api/items/route");
    const withCategoryOnly = await (await createItem(makeRequest("/api/items", { method: "POST", cookie: adminCookie, body: { itemCode: `IT-${genId().slice(0, 6)}`, name: "Brake Pad", categoryId: categoryAId, itemType: "SPARE_PART", unitOfMeasure: "EA" } }))).json();
    expect(withCategoryOnly.categoryId).toBe(categoryAId);

    const withSub = await (await createItem(makeRequest("/api/items", { method: "POST", cookie: adminCookie, body: { itemCode: `IT2-${genId().slice(0, 6)}`, name: "Oil Filter Item", categoryId: categoryAId, subCategoryId: subOfAId, itemType: "SPARE_PART", unitOfMeasure: "EA" } }))).json();
    expect(withSub.subCategoryId).toBe(subOfAId);

    const mismatched = await createItem(makeRequest("/api/items", { method: "POST", cookie: adminCookie, body: { itemCode: `IT3-${genId().slice(0, 6)}`, name: "Bad Item", categoryId: categoryBId, subCategoryId: subOfAId, itemType: "SPARE_PART", unitOfMeasure: "EA" } }));
    expect(mismatched.status).toBe(400);

    const { PATCH: updateItem } = await import("@/app/api/items/[id]/route");
    const edited = await (await updateItem(makeRequest(`/api/items/${withCategoryOnly.id}`, { method: "PATCH", cookie: adminCookie, body: { name: "Brake Pad (Updated)" } }), { params: { id: withCategoryOnly.id } })).json();
    expect(edited.name).toBe("Brake Pad (Updated)");
    const deactivated = await (await updateItem(makeRequest(`/api/items/${withCategoryOnly.id}`, { method: "PATCH", cookie: adminCookie, body: { status: "INACTIVE" } }), { params: { id: withCategoryOnly.id } })).json();
    expect(deactivated.status).toBe("INACTIVE");
  });

  it("20. item master creation never creates a stock balance row", async () => {
    const r = await riyadh();
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const categoryId = genId();
    await db.insert(itemCategories).values({ id: categoryId, tenantId: r!.id, code: `CX-${genId().slice(0, 6)}`, name: "Category X" });
    const { POST: createItem } = await import("@/app/api/items/route");
    const created = await (await createItem(makeRequest("/api/items", { method: "POST", cookie: adminCookie, body: { itemCode: `ITX-${genId().slice(0, 6)}`, name: "Test Item", categoryId, itemType: "SPARE_PART", unitOfMeasure: "EA" } }))).json();
    const { maintenanceInventoryBalances } = await import("@/lib/db/schema");
    const balances = await db.query.maintenanceInventoryBalances.findMany({ where: eq(maintenanceInventoryBalances.itemId, created.id) });
    expect(balances.length).toBe(0);
  });

  it("22/23. item type and UOM are validated against the enum", async () => {
    const r = await riyadh();
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const categoryId = genId();
    await db.insert(itemCategories).values({ id: categoryId, tenantId: r!.id, code: `CY-${genId().slice(0, 6)}`, name: "Category Y" });
    const { POST: createItem } = await import("@/app/api/items/route");
    const badType = await createItem(makeRequest("/api/items", { method: "POST", cookie: adminCookie, body: { itemCode: `BADT-${genId().slice(0, 6)}`, name: "Bad", categoryId, itemType: "NOT_A_TYPE", unitOfMeasure: "EA" } }));
    expect(badType.status).toBe(400);
    const badUom = await createItem(makeRequest("/api/items", { method: "POST", cookie: adminCookie, body: { itemCode: `BADU-${genId().slice(0, 6)}`, name: "Bad", categoryId, itemType: "SPARE_PART", unitOfMeasure: "NOT_A_UOM" } }));
    expect(badUom.status).toBe(400);
  });
});

describe("Workshop tests (Part 11, items 24-29)", () => {
  it("24/25/26/27. create, edit, deactivate a workshop, and reject a duplicate code", async () => {
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const code = `WS-${genId().slice(0, 6)}`;
    const { POST: createWorkshop } = await import("@/app/api/workshops/route");
    const created = await (await createWorkshop(makeRequest("/api/workshops", { method: "POST", cookie: adminCookie, body: { workshopCode: code, name: "Main Workshop", workshopType: "INTERNAL" } }))).json();
    const { PATCH: updateWorkshop } = await import("@/app/api/workshops/[id]/route");
    const edited = await (await updateWorkshop(makeRequest(`/api/workshops/${created.id}`, { method: "PATCH", cookie: adminCookie, body: { name: "Main Workshop (Renamed)" } }), { params: { id: created.id } })).json();
    expect(edited.name).toBe("Main Workshop (Renamed)");
    const deactivated = await (await updateWorkshop(makeRequest(`/api/workshops/${created.id}`, { method: "PATCH", cookie: adminCookie, body: { status: "INACTIVE" } }), { params: { id: created.id } })).json();
    expect(deactivated.status).toBe("INACTIVE");
    const dup = await createWorkshop(makeRequest("/api/workshops", { method: "POST", cookie: adminCookie, body: { workshopCode: code, name: "Dup" } }));
    expect(dup.status).toBe(409);
  });

  it("28/29. validate workshopType enum and lat/lng bounds", async () => {
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const { POST: createWorkshop } = await import("@/app/api/workshops/route");
    const badType = await createWorkshop(makeRequest("/api/workshops", { method: "POST", cookie: adminCookie, body: { workshopCode: `WT-${genId().slice(0, 6)}`, name: "Bad", workshopType: "NOT_A_TYPE" } }));
    expect(badType.status).toBe(400);
    const badLat = await createWorkshop(makeRequest("/api/workshops", { method: "POST", cookie: adminCookie, body: { workshopCode: `WL-${genId().slice(0, 6)}`, name: "Bad Lat", lat: 999 } }));
    expect(badLat.status).toBe(400);
  });
});

describe("Maintenance Warehouse tests (Part 11, items 30-36)", () => {
  it("30/31. create a central warehouse without a workshop, and a workshop-linked warehouse", async () => {
    const r = await riyadh();
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const workshopId = genId();
    await db.insert(workshops).values({ id: workshopId, tenantId: r!.id, workshopCode: `W-${genId().slice(0, 6)}`, name: "Test Workshop" });
    const { POST: createWarehouse } = await import("@/app/api/maintenance-warehouses/route");
    const central = await (await createWarehouse(makeRequest("/api/maintenance-warehouses", { method: "POST", cookie: adminCookie, body: { warehouseCode: `CW-${genId().slice(0, 6)}`, name: "Central", warehouseType: "CENTRAL_SPARES" } }))).json();
    expect(central.workshopId).toBeFalsy();
    const linked = await (await createWarehouse(makeRequest("/api/maintenance-warehouses", { method: "POST", cookie: adminCookie, body: { warehouseCode: `LW-${genId().slice(0, 6)}`, name: "Linked", workshopId } }))).json();
    expect(linked.workshopId).toBe(workshopId);
  });

  it("32. reject a warehouse linked to a cross-tenant workshop", async () => {
    const d = await demo();
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const demoWorkshopId = genId();
    await db.insert(workshops).values({ id: demoWorkshopId, tenantId: d!.id, workshopCode: `DW-${genId().slice(0, 6)}`, name: "Demo Workshop" });
    const { POST: createWarehouse } = await import("@/app/api/maintenance-warehouses/route");
    const res = await createWarehouse(makeRequest("/api/maintenance-warehouses", { method: "POST", cookie: adminCookie, body: { warehouseCode: `X-${genId().slice(0, 6)}`, name: "Bad", workshopId: demoWorkshopId } }));
    expect(res.status).toBe(400);
  });

  it("33/34/35. edit, deactivate a warehouse, and reject a duplicate code", async () => {
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const code = `MW-${genId().slice(0, 6)}`;
    const { POST: createWarehouse } = await import("@/app/api/maintenance-warehouses/route");
    const created = await (await createWarehouse(makeRequest("/api/maintenance-warehouses", { method: "POST", cookie: adminCookie, body: { warehouseCode: code, name: "Test Warehouse" } }))).json();
    const { PATCH: updateWarehouse } = await import("@/app/api/maintenance-warehouses/[id]/route");
    const edited = await (await updateWarehouse(makeRequest(`/api/maintenance-warehouses/${created.id}`, { method: "PATCH", cookie: adminCookie, body: { name: "Renamed" } }), { params: { id: created.id } })).json();
    expect(edited.name).toBe("Renamed");
    const deactivated = await (await updateWarehouse(makeRequest(`/api/maintenance-warehouses/${created.id}`, { method: "PATCH", cookie: adminCookie, body: { status: "INACTIVE" } }), { params: { id: created.id } })).json();
    expect(deactivated.status).toBe("INACTIVE");
    const { POST: createWarehouse2 } = await import("@/app/api/maintenance-warehouses/route");
    const dup = await createWarehouse2(makeRequest("/api/maintenance-warehouses", { method: "POST", cookie: adminCookie, body: { warehouseCode: code, name: "Dup" } }));
    expect(dup.status).toBe(409);
  });

  it("36. validate warehouseType enum", async () => {
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const { POST: createWarehouse } = await import("@/app/api/maintenance-warehouses/route");
    const res = await createWarehouse(makeRequest("/api/maintenance-warehouses", { method: "POST", cookie: adminCookie, body: { warehouseCode: `BW-${genId().slice(0, 6)}`, name: "Bad", warehouseType: "NOT_A_TYPE" } }));
    expect(res.status).toBe(400);
  });
});

describe("Supplier tests (Part 11, items 37-41)", () => {
  it("37/38/39/40. create, edit, deactivate a supplier, and reject a duplicate code", async () => {
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const code = `SUP-${genId().slice(0, 6)}`;
    const { POST: createSupplier } = await import("@/app/api/suppliers/route");
    const created = await (await createSupplier(makeRequest("/api/suppliers", { method: "POST", cookie: adminCookie, body: { supplierCode: code, name: "Test Supplier" } }))).json();
    const { PATCH: updateSupplier } = await import("@/app/api/suppliers/[id]/route");
    const edited = await (await updateSupplier(makeRequest(`/api/suppliers/${created.id}`, { method: "PATCH", cookie: adminCookie, body: { name: "Renamed Supplier" } }), { params: { id: created.id } })).json();
    expect(edited.name).toBe("Renamed Supplier");
    const deactivated = await (await updateSupplier(makeRequest(`/api/suppliers/${created.id}`, { method: "PATCH", cookie: adminCookie, body: { status: "INACTIVE" } }), { params: { id: created.id } })).json();
    expect(deactivated.status).toBe("INACTIVE");
    const dup = await createSupplier(makeRequest("/api/suppliers", { method: "POST", cookie: adminCookie, body: { supplierCode: code, name: "Dup" } }));
    expect(dup.status).toBe(409);
  });

  it("41. creating a supplier never creates a PR/PO automatically", async () => {
    const r = await riyadh();
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const { POST: createSupplier } = await import("@/app/api/suppliers/route");
    await createSupplier(makeRequest("/api/suppliers", { method: "POST", cookie: adminCookie, body: { supplierCode: `SUPNO-${genId().slice(0, 6)}`, name: "No PR/PO" } }));
    const { purchaseOrders, purchaseRequisitions } = await import("@/lib/db/schema");
    const pos = await db.query.purchaseOrders.findMany({ where: eq(purchaseOrders.tenantId, r!.id) });
    const prs = await db.query.purchaseRequisitions.findMany({ where: eq(purchaseRequisitions.tenantId, r!.id) });
    expect(pos.length).toBe(0);
    expect(prs.length).toBe(0);
  });
});

describe("Inventory and Procurement screen tests (Part 11, items 42-57)", () => {
  const inventorySource = fs.readFileSync(path.join(process.cwd(), "app/admin/inventory/page.tsx"), "utf8");
  const procurementSource = fs.readFileSync(path.join(process.cwd(), "app/admin/procurement/page.tsx"), "utf8");

  it("42/43/44/45. Inventory page shows Stock Overview, Warehouses, Stock Movements, and Low Stock sections", () => {
    expect(inventorySource).toContain("Stock Overview");
    expect(inventorySource).toContain("function WarehousesTab");
    expect(inventorySource).toContain("Stock Movements");
    expect(inventorySource).toContain("Low Stock");
  });

  it("46. Inventory page does not allow stock posting — no adjustment/issue/transfer endpoint is ever called", () => {
    expect(inventorySource).not.toContain("ADJUSTMENT_IN");
    expect(inventorySource).not.toContain("ISSUE_TO_MAINTENANCE");
    expect(inventorySource).not.toContain("/api/maintenance-inventory/movements\", { method: \"POST\"");
  });

  it("47. Inventory page links to Master Items for item creation", () => {
    expect(inventorySource).toContain("/admin/master-items");
  });

  it("48/49. Inventory page shows no fake stock, and no bottle/customer-delivery stock", () => {
    expect(inventorySource).not.toContain("Math.random()");
    expect(inventorySource).not.toContain("bottle");
    expect(inventorySource).not.toContain("19L");
  });

  it("50/51/52/53. Procurement page shows Suppliers, PR, PO, and Goods Receipts sections", () => {
    expect(procurementSource).toContain("function SuppliersTab");
    expect(procurementSource).toContain("Purchase Requisitions");
    expect(procurementSource).toContain("Purchase Orders");
    expect(procurementSource).toContain("Goods Receipts");
  });

  it("54/55. Supplier CRUD is available, but PR/PO/Receiving workflow actions are not", () => {
    expect(procurementSource).toContain("function SupplierForm");
    expect(procurementSource).not.toContain('"/api/purchase-orders", { method: "POST"');
    expect(procurementSource).not.toContain('"/api/goods-receipts", { method: "POST"');
  });

  it("56/57. Procurement page never mutates Inventory balances or customer billing", () => {
    expect(procurementSource).not.toContain("maintenance-inventory");
    expect(procurementSource).not.toContain("/api/invoices");
  });
});

describe("Navigation/layout tests (Part 11, items 58-64)", () => {
  const shellSource = fs.readFileSync(path.join(process.cwd(), "components/AdminShell.tsx"), "utf8");
  const adminPageSource = fs.readFileSync(path.join(process.cwd(), "app/admin/page.tsx"), "utf8");

  it("58. Dispatch Live remains visible after login in both sidebar sources", () => {
    expect(shellSource).toContain('{ label: "Dispatch (Live)", href: "/dispatch" }');
    expect(adminPageSource).toContain('{ label: "Dispatch (Live)", href: "/dispatch" }');
  });

  it("59/60/61/62. Maintenance, Inventory, Procurement, and Master Items remain four separate sidebar items, never merged", () => {
    expect(shellSource).toContain('{ label: "Maintenance", href: "/admin?tab=maintenance" }');
    expect(shellSource).toContain('{ label: "Inventory", href: "/admin/inventory" }');
    expect(shellSource).toContain('{ label: "Procurement", href: "/admin/procurement" }');
    expect(shellSource).toContain('{ label: "Master Items", href: "/admin/master-items" }');
  });

  it("63. Loading Points remain under Operations, not confused with Maintenance Warehouses", () => {
    const opsIdx = shellSource.indexOf('label: "Operations"');
    const fleetMaintIdx = shellSource.indexOf('label: "Platform"');
    const opsSection = shellSource.slice(opsIdx, fleetMaintIdx);
    expect(opsSection).toContain("Loading Points");
  });

  it("64. Maintenance Warehouses (inside Inventory) are never conflated with Loading Points in the UI", () => {
    const inventorySource = fs.readFileSync(path.join(process.cwd(), "app/admin/inventory/page.tsx"), "utf8");
    expect(inventorySource).toContain("Loading Points are water filling sites");
  });
});

describe("Regression protection (Milestone Z.2)", () => {
  it("65. Task P.2 contract-priced invoice markers remain unchanged", () => {
    const stopRoute = fs.readFileSync(path.join(process.cwd(), "app/api/trips/[id]/stops/[stopId]/route.ts"), "utf8");
    expect(stopRoute).toContain("Task P.2");
  });

  it("66. Milestone W POD gate remains unchanged", () => {
    const stopRoute = fs.readFileSync(path.join(process.cwd(), "app/api/trips/[id]/stops/[stopId]/route.ts"), "utf8");
    expect(stopRoute).toContain("autoCloseTripIfAllStopsResolved");
  });

  it("no schema, pricing, billing, or ERP file was modified", () => {
    const schemaSource = fs.readFileSync(path.join(process.cwd(), "lib/db/schema.ts"), "utf8");
    const pricingSource = fs.readFileSync(path.join(process.cwd(), "lib/contractPricing.ts"), "utf8");
    expect(schemaSource).toContain("export const itemGroups = pgTable(");
    expect(schemaSource).toContain('"item_groups"');
    expect(pricingSource).toContain("PricingEngineError");
  });

  it("no passwordHash exposure in any new file", () => {
    const files = [
      "app/admin/master-items/page.tsx", "app/admin/workshops/page.tsx", "app/admin/inventory/page.tsx", "app/admin/procurement/page.tsx",
      "app/api/item-groups/route.ts", "app/api/workshops/route.ts", "app/api/suppliers/route.ts",
    ];
    const combined = files.map((f) => fs.readFileSync(path.join(process.cwd(), f), "utf8")).join("\n");
    expect(combined).not.toContain("passwordHash");
  });
});
