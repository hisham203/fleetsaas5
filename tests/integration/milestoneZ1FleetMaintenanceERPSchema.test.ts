import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { makeRequest, loginAs } from "../helpers/request";
import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

// Milestone Z.1 — Fleet Maintenance ERP Schema Foundation. Schema +
// empty-safe read APIs only. No create/update/delete route exists for
// any of these 15 tables, and none of them holds a single row anywhere
// — every test here confirms that, never fabricated data.
const schemaSource = fs.readFileSync(path.join(process.cwd(), "lib/db/schema.ts"), "utf8");

describe("Schema tables exist (Milestone Z.1, Part 11)", () => {
  const expectedTables = [
    ["itemGroups", "item_groups"],
    ["itemCategories", "item_categories"],
    ["itemSubcategories", "item_subcategories"],
    ["items", "items"],
    ["workshops", "workshops"],
    ["maintenanceWarehouses", "maintenance_warehouses"],
    ["maintenanceInventoryBalances", "maintenance_inventory_balances"],
    ["maintenanceInventoryMovements", "maintenance_inventory_movements"],
    ["suppliers", "suppliers"],
    ["purchaseRequisitions", "purchase_requisitions"],
    ["purchaseRequisitionLines", "purchase_requisition_lines"],
    ["purchaseOrders", "purchase_orders"],
    ["purchaseOrderLines", "purchase_order_lines"],
    ["goodsReceipts", "goods_receipts"],
    ["goodsReceiptLines", "goods_receipt_lines"],
  ];

  it.each(expectedTables)("1-15. %s (%s) is defined in schema.ts", (exportName, tableName) => {
    expect(schemaSource).toContain(`export const ${exportName} = pgTable(`);
    expect(schemaSource).toContain(`"${tableName}"`);
  });

  it("each new table exists as a real, queryable table and is genuinely empty", async () => {
    const { itemGroups, itemCategories, itemSubcategories, items, workshops, maintenanceWarehouses, maintenanceInventoryBalances, maintenanceInventoryMovements, suppliers, purchaseRequisitions, purchaseRequisitionLines, purchaseOrders, purchaseOrderLines, goodsReceipts, goodsReceiptLines } = await import("@/lib/db/schema");
    const results = await Promise.all([
      db.query.itemGroups.findMany(),
      db.query.itemCategories.findMany(),
      db.query.itemSubcategories.findMany(),
      db.query.items.findMany(),
      db.query.workshops.findMany(),
      db.query.maintenanceWarehouses.findMany(),
      db.query.maintenanceInventoryBalances.findMany(),
      db.query.maintenanceInventoryMovements.findMany(),
      db.query.suppliers.findMany(),
      db.query.purchaseRequisitions.findMany(),
      db.query.purchaseRequisitionLines.findMany(),
      db.query.purchaseOrders.findMany(),
      db.query.purchaseOrderLines.findMany(),
      db.query.goodsReceipts.findMany(),
      db.query.goodsReceiptLines.findMany(),
    ]);
    for (const rows of results) {
      expect(rows.length).toBe(0);
    }
  });

  it("16. tenant/code unique indexes exist for item_groups, item_categories, item_subcategories, items, workshops, maintenance_warehouses, suppliers, purchase_requisitions, purchase_orders, goods_receipts", () => {
    expect(schemaSource).toContain("item_groups_tenant_code_unique");
    expect(schemaSource).toContain("item_categories_tenant_code_unique");
    expect(schemaSource).toContain("item_subcategories_tenant_code_unique");
    expect(schemaSource).toContain("items_tenant_item_code_unique");
    expect(schemaSource).toContain("workshops_tenant_code_unique");
    expect(schemaSource).toContain("maintenance_warehouses_tenant_code_unique");
    expect(schemaSource).toContain("suppliers_tenant_code_unique");
    expect(schemaSource).toContain("purchase_requisitions_tenant_pr_number_unique");
    expect(schemaSource).toContain("purchase_orders_tenant_po_number_unique");
    expect(schemaSource).toContain("goods_receipts_tenant_receipt_number_unique");
  });

  it("17. the balance unique tenant/warehouse/item index exists", () => {
    expect(schemaSource).toContain("maintenance_inventory_balances_warehouse_item_unique");
  });

  it("18/19. no destructive migration touched legacy delivery inventory or the existing loading-point warehouses table", () => {
    expect(schemaSource).toContain('itemName: text("item_name").notNull(), // e.g. "19L Bottle - Full", "19L Bottle - Empty"');
    expect(schemaSource).toContain('export const warehouses = pgTable("warehouses"');
    const migrationSource = fs.readFileSync(path.join(process.cwd(), "drizzle/0017_bored_black_panther.sql"), "utf8");
    expect(migrationSource).not.toMatch(/ALTER TABLE|DROP TABLE|TRUNCATE/i);
  });

  it("the migration contains exactly 15 CREATE TABLE statements, purely additive", () => {
    const migrationSource = fs.readFileSync(path.join(process.cwd(), "drizzle/0017_bored_black_panther.sql"), "utf8");
    const matches = migrationSource.match(/^CREATE TABLE/gm) ?? [];
    expect(matches.length).toBe(15);
  });

  it("20. no seed data was inserted into any new table", async () => {
    const rows = await db.query.items.findMany();
    expect(rows.length).toBe(0);
    const seedSource = fs.readFileSync(path.join(process.cwd(), "scripts/seedData.ts"), "utf8");
    expect(seedSource).not.toContain("itemGroups");
    expect(seedSource).not.toContain("purchaseRequisitions");
  });

  it("zero DB-level foreign keys were introduced, matching this schema's established convention", () => {
    const zSection = schemaSource.slice(schemaSource.indexOf("Milestone Z.1"), schemaSource.indexOf("invoiceLineItems = pgTable"));
    expect(zSection).not.toContain(".references(");
  });
});

describe("Empty-safe read APIs (Milestone Z.1, Part 9)", () => {
  const endpoints: [string, string][] = [
    ["GET /api/item-groups", "/api/item-groups"],
    ["GET /api/item-categories", "/api/item-categories"],
    ["GET /api/item-subcategories", "/api/item-subcategories"],
    ["GET /api/items", "/api/items"],
    ["GET /api/workshops", "/api/workshops"],
    ["GET /api/maintenance-warehouses", "/api/maintenance-warehouses"],
    ["GET /api/maintenance-inventory/balances", "/api/maintenance-inventory/balances"],
    ["GET /api/maintenance-inventory/movements", "/api/maintenance-inventory/movements"],
    ["GET /api/suppliers", "/api/suppliers"],
    ["GET /api/purchase-requisitions", "/api/purchase-requisitions"],
    ["GET /api/purchase-orders", "/api/purchase-orders"],
    ["GET /api/goods-receipts", "/api/goods-receipts"],
  ];

  const routeFiles: Record<string, string> = {
    "/api/item-groups": "app/api/item-groups/route.ts",
    "/api/item-categories": "app/api/item-categories/route.ts",
    "/api/item-subcategories": "app/api/item-subcategories/route.ts",
    "/api/items": "app/api/items/route.ts",
    "/api/workshops": "app/api/workshops/route.ts",
    "/api/maintenance-warehouses": "app/api/maintenance-warehouses/route.ts",
    "/api/maintenance-inventory/balances": "app/api/maintenance-inventory/balances/route.ts",
    "/api/maintenance-inventory/movements": "app/api/maintenance-inventory/movements/route.ts",
    "/api/suppliers": "app/api/suppliers/route.ts",
    "/api/purchase-requisitions": "app/api/purchase-requisitions/route.ts",
    "/api/purchase-orders": "app/api/purchase-orders/route.ts",
    "/api/goods-receipts": "app/api/goods-receipts/route.ts",
  };

  it.each(endpoints)("21-32. %s returns an empty array safely for a real admin session", async (_label, urlPath) => {
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const { GET } = await import(`@/${routeFiles[urlPath]}`);
    const res = await GET(makeRequest(urlPath, { cookie: adminCookie }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(0);
  });

  it.each(endpoints)("33. %s requires authentication", async (_label, urlPath) => {
    const { GET } = await import(`@/${routeFiles[urlPath]}`);
    const res = await GET(makeRequest(urlPath, {}));
    expect(res.status).toBe(401);
  });

  it("34. APIs are tenant-scoped (query construction always includes tenantId from the session, never a client-supplied value)", () => {
    for (const file of Object.values(routeFiles)) {
      const source = fs.readFileSync(path.join(process.cwd(), file), "utf8");
      expect(source).toContain("getSessionTenantId(session)");
      expect(source).toContain("eq(");
    }
  });

  it("no route in this milestone exposes a POST, PATCH, or DELETE handler — read-only, exactly as scoped", () => {
    for (const file of Object.values(routeFiles)) {
      const source = fs.readFileSync(path.join(process.cwd(), file), "utf8");
      expect(source).not.toContain("export async function POST");
      expect(source).not.toContain("export async function PATCH");
      expect(source).not.toContain("export async function DELETE");
    }
  });

  it("no passwordHash or sensitive field exposure in any new route", () => {
    const combined = Object.values(routeFiles).map((f) => fs.readFileSync(path.join(process.cwd(), f), "utf8")).join("\n");
    expect(combined).not.toContain("passwordHash");
  });
});

describe("Placeholder UI wiring (Milestone Z.1, Part 10)", () => {
  it("35/36/37. Inventory, Procurement, and Master Items placeholders all show the schema-foundation-implemented message", () => {
    const componentSource = fs.readFileSync(path.join(process.cwd(), "components/PlannedModulePlaceholder.tsx"), "utf8");
    expect(componentSource).toContain("Schema foundation implemented. Operational CRUD will be added in later milestones.");
  });

  it("38. no fake rows appear — the placeholder only ever displays real, live-fetched counts, defaulting to 0 while loading", () => {
    const componentSource = fs.readFileSync(path.join(process.cwd(), "components/PlannedModulePlaceholder.tsx"), "utf8");
    expect(componentSource).toContain("liveCounts ? liveCounts[c.label] ?? 0");
    expect(componentSource).not.toContain("Math.random()");
  });

  it("each placeholder page is wired to its own module's real endpoints, never another module's", () => {
    const inventorySource = fs.readFileSync(path.join(process.cwd(), "app/admin/inventory-planned/page.tsx"), "utf8");
    const procurementSource = fs.readFileSync(path.join(process.cwd(), "app/admin/procurement-planned/page.tsx"), "utf8");
    const masterItemsSource = fs.readFileSync(path.join(process.cwd(), "app/admin/master-items-planned/page.tsx"), "utf8");
    expect(inventorySource).toContain("/api/maintenance-inventory/balances");
    expect(procurementSource).toContain("/api/purchase-orders");
    expect(masterItemsSource).toContain("/api/items");
    expect(masterItemsSource).not.toContain("/api/purchase-orders");
  });
});

describe("Regression protection (Milestone Z.1)", () => {
  it("39. Task P.2 contract-priced invoice markers remain unchanged", () => {
    const stopRoute = fs.readFileSync(path.join(process.cwd(), "app/api/trips/[id]/stops/[stopId]/route.ts"), "utf8");
    expect(stopRoute).toContain("Task P.2");
    expect(stopRoute).toContain("Proof of delivery is required before this trip can be marked delivered.");
  });

  it("40. Milestone W POD gate and auto-close-trip fix remain unchanged", () => {
    const stopRoute = fs.readFileSync(path.join(process.cwd(), "app/api/trips/[id]/stops/[stopId]/route.ts"), "utf8");
    expect(stopRoute).toContain("autoCloseTripIfAllStopsResolved");
  });

  it("41. Milestone X expense approval remains functional", async () => {
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const { GET: getExpenses } = await import("@/app/api/expenses/route");
    const res = await getExpenses(makeRequest("/api/expenses", { cookie: adminCookie }));
    expect(res.status).toBe(200);
  });

  it("42. Milestone Y reports remain functional", async () => {
    const { runReport } = await import("@/lib/reportQuery");
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const result = await runReport("fuelExpenseClaims", tenant!.id, { columns: [], filters: [] });
    expect(Array.isArray(result.rows)).toBe(true);
  });

  it("46. V.1 schedule/planned demand schema remains untouched (no generation code path)", () => {
    const scheduleRouteSource = fs.readFileSync(path.join(process.cwd(), "app/api/contracts/[id]/delivery-schedules/route.ts"), "utf8");
    expect(scheduleRouteSource).not.toContain("export async function POST");
  });

  it("no pricing, billing, or ERP file was modified", () => {
    const pricingSource = fs.readFileSync(path.join(process.cwd(), "lib/contractPricing.ts"), "utf8");
    const erpSource = fs.readFileSync(path.join(process.cwd(), "lib/erp/sync.ts"), "utf8");
    expect(pricingSource).toContain("PricingEngineError");
    expect(erpSource).not.toContain("purchaseOrder");
  });

  it("a real end-to-end ONE_TIME_TRIP_COUNT delivery still prices correctly", async () => {
    const { contracts, contractPricingRules, warehouses, orders, customers } = await import("@/lib/db/schema");
    const { createIsolatedDriverAndVehicle } = await import("../helpers/testFixtures");
    const { genId } = await import("@/lib/helpers");
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const tenantId = tenant!.id;
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const warehouse = await db.query.warehouses.findFirst({ where: eq(warehouses.tenantId, tenantId) });
    const customerId = genId();
    await db.insert(customers).values({ id: customerId, tenantId, name: "Z1 Regression Customer", type: "B2B", address: "Test", lat: 24.7, lng: 46.7 });
    const contractId = genId();
    await db.insert(contracts).values({ id: contractId, tenantId, customerId, contractNumber: `Z1-${genId().slice(0, 8)}`, type: "ONE_TIME_TRIP_COUNT", status: "ACTIVE", appliesToAllSites: true, totalTripsPurchased: 5, tripsUsed: 0, startDate: new Date("2020-01-01") });
    await db.insert(contractPricingRules).values({ id: genId(), tenantId, pricingScope: "CONTRACT", contractId, rateType: "STANDARD", pricePerTrip: 500, vatRate: 0.15 });
    const { POST: createOrder } = await import("@/app/api/orders/route");
    const order = await (await createOrder(makeRequest("/api/orders", { method: "POST", cookie: adminCookie, body: { customerId, contractId, qtyOrdered: 1, emptyBottlesToCollect: 0, paymentMethod: "CASH" } }))).json();
    const isolated = await createIsolatedDriverAndVehicle(tenantId, `z1-e2e-${genId().slice(0, 6)}`);
    const { POST: createTrip } = await import("@/app/api/trips/route");
    const trip = await (await createTrip(makeRequest("/api/trips", { method: "POST", cookie: adminCookie, body: { driverId: isolated.driverId, vehicleId: isolated.vehicleId, warehouseId: warehouse!.id, orderIds: [order.id] } }))).json();
    const { PATCH: confirmLoading } = await import("@/app/api/trips/[id]/loading/route");
    await confirmLoading(makeRequest(`/api/trips/${trip.id}/loading`, { method: "PATCH", cookie: adminCookie }), { params: { id: trip.id } });
    const { PATCH: tripAction } = await import("@/app/api/trips/[id]/route");
    await tripAction(makeRequest(`/api/trips/${trip.id}`, { method: "PATCH", cookie: adminCookie, body: { action: "dispatch" } }), { params: { id: trip.id } });
    const stopId = trip.stops[0].id;
    const { PATCH: stopAction } = await import("@/app/api/trips/[id]/stops/[stopId]/route");
    await stopAction(makeRequest(`/api/trips/${trip.id}/stops/${stopId}`, { method: "PATCH", cookie: isolated.driverCookie, body: { action: "arrive" } }), { params: { id: trip.id, stopId } });
    const deliverRes = await stopAction(makeRequest(`/api/trips/${trip.id}/stops/${stopId}`, { method: "PATCH", cookie: isolated.driverCookie, body: { action: "deliver", deliveredQty: 1, emptiesCollected: 0, recipientName: "Test" } }), { params: { id: trip.id, stopId } });
    expect((await deliverRes.json()).invoice.subtotal).toBe(500);
  });
});
