import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { makeRequest, loginAs } from "../helpers/request";
import { db } from "@/lib/db/client";
import { tenants, customers } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { genId } from "@/lib/helpers";

// Milestone Z — Maintenance Inventory, Workshops, Warehouses &
// Procurement Foundation (Bucket A: no-schema changes only; Bucket B —
// workshops/warehouses/item master/inventory/procurement — is design
// only, per this milestone's own hard stop, and is not exercised here
// since no code was written for it).
const adminPageSource = () => fs.readFileSync(path.join(process.cwd(), "app/admin/page.tsx"), "utf8");
const customersPageSource = () => fs.readFileSync(path.join(process.cwd(), "app/admin/customers/page.tsx"), "utf8");
const shellSource = () => fs.readFileSync(path.join(process.cwd(), "components/AdminShell.tsx"), "utf8");
const placeholderSource = () => fs.readFileSync(path.join(process.cwd(), "app/admin/maintenance-inventory/page.tsx"), "utf8");

describe("Customer cleanup — contractPricePerBottle migration (Milestone Z, Part 10)", () => {
  it("1. /admin/customers exposes contractPricePerBottle editing", () => {
    expect(customersPageSource()).toContain("contractPricePerBottle");
    expect(customersPageSource()).toContain("Default bottle price");
  });

  it("2. updating contractPricePerBottle via PATCH /api/customers/[id] works", async () => {
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const customerId = genId();
    await db.insert(customers).values({ id: customerId, tenantId: tenant!.id, name: "Z Price Test Customer", type: "B2B", address: "Test" });
    const { PATCH: updateCustomer } = await import("@/app/api/customers/[id]/route");
    const res = await updateCustomer(makeRequest(`/api/customers/${customerId}`, { method: "PATCH", cookie: adminCookie, body: { contractPricePerBottle: 4.5 } }), { params: { id: customerId } });
    expect(res.status).toBe(200);
    const updated = await db.query.customers.findFirst({ where: eq(customers.id, customerId) });
    expect(updated!.contractPricePerBottle).toBe(4.5);
  });

  it("the field is now included in the safe customer list columns, so the UI can actually read it back", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "app/api/customers/route.ts"), "utf8");
    expect(source).toContain("contractPricePerBottle: true");
  });

  it("3. tenant isolation is preserved for this field", async () => {
    const demoTenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Demo Water Co.") });
    const riyadhAdminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const demoCustomerId = genId();
    await db.insert(customers).values({ id: demoCustomerId, tenantId: demoTenant!.id, name: "Z Isolation Customer", type: "B2B", address: "Test" });
    const { PATCH: updateCustomer } = await import("@/app/api/customers/[id]/route");
    const res = await updateCustomer(makeRequest(`/api/customers/${demoCustomerId}`, { method: "PATCH", cookie: riyadhAdminCookie, body: { contractPricePerBottle: 99 } }), { params: { id: demoCustomerId } });
    expect(res.status).toBe(404);
  });

  it("4. the legacy Customers tab now redirects rather than rendering its own screen, but its code remains intact (not deleted)", () => {
    const source = adminPageSource();
    expect(source).toContain("LegacyCustomersRedirect");
    expect(source).toContain('router.replace("/admin/customers")');
    expect(source).toContain("function CustomersTab("); // kept, unreferenced, not deleted
    expect(source).not.toContain('tab === "customers" && <CustomersTab');
  });

  it("5. contract pricing rules (lib/contractPricing.ts) remain completely unaffected by this migration", () => {
    const pricingSource = fs.readFileSync(path.join(process.cwd(), "lib/contractPricing.ts"), "utf8");
    expect(pricingSource).toContain("PricingEngineError");
    expect(pricingSource).not.toContain("contractPricePerBottle");
  });
});

describe("Inventory business-model clarification (Milestone Z, Part 2/12)", () => {
  it("6/7. Inventory page clarifies it is customer-delivery product stock, not maintenance inventory, and points to the new module", () => {
    const source = adminPageSource();
    expect(source).toContain("customer-delivery product stock");
    expect(source).toContain("not truck/tanker maintenance inventory");
    expect(source).toContain("Maintenance Inventory");
  });

  it("no existing inventory functionality was removed — the adjustment form and warehouse creation are unchanged", () => {
    const source = adminPageSource();
    expect(source).toContain("adjustStock");
    expect(source).toContain("showNewWarehouse");
  });
});

describe("Maintenance Inventory & Procurement placeholder (Milestone Z, Part 9/12)", () => {
  it("8. the placeholder clearly states design is pending and no live stock data exists", () => {
    const source = placeholderSource();
    expect(source).toContain("Design pending implementation approval");
    expect(source).toContain("No live stock data exists yet");
  });

  it("9. no fake inventory/procurement rows appear — the page renders no data table or mock rows at all", () => {
    const source = placeholderSource();
    expect(source).not.toContain("<table");
    expect(source).not.toContain("mockData");
    expect(source).not.toContain("fetch(");
  });

  it("clearly distinguishes maintenance warehouses from dispatch Loading Points", () => {
    const source = placeholderSource();
    expect(source).toContain("Loading Points, which serve customer delivery dispatch, not maintenance stock");
  });

  it("10. sidebar links to the placeholder are clearly labeled Planned, not presented as a live module", () => {
    expect(shellSource()).toContain("Maintenance Inventory & Procurement (Planned)");
  });

  it("11/12. existing Fleet, Finance, Reports, Dispatch navigation remains unchanged", () => {
    const source = shellSource();
    expect(source).toContain('{ label: "Fleet", href: "/admin?tab=fleet" }');
    expect(source).toContain('{ label: "Billing", href: "/admin?tab=billing" }');
    expect(source).toContain('{ label: "Reports", href: "/admin?tab=reports" }');
    expect(source).toContain('{ label: "Dispatch Control Tower", href: "/admin/dispatch" }');
  });
});

describe("Regression protection (Milestone Z)", () => {
  it("13. Task P.2 contract-priced invoice markers remain unchanged", () => {
    const stopRoute = fs.readFileSync(path.join(process.cwd(), "app/api/trips/[id]/stops/[stopId]/route.ts"), "utf8");
    expect(stopRoute).toContain("Task P.2");
    expect(stopRoute).toContain("Proof of delivery is required before this trip can be marked delivered.");
  });

  it("14. Milestone W POD gate and auto-close-trip fix remain unchanged", () => {
    const stopRoute = fs.readFileSync(path.join(process.cwd(), "app/api/trips/[id]/stops/[stopId]/route.ts"), "utf8");
    expect(stopRoute).toContain("autoCloseTripIfAllStopsResolved");
  });

  it("15. Milestone X expense approval remains functional and unaffected", async () => {
    const { expenseClaims } = await import("@/lib/db/schema");
    const { createIsolatedDriverAndVehicle } = await import("../helpers/testFixtures");
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const isolated = await createIsolatedDriverAndVehicle(tenant!.id, `z-exp-${genId().slice(0, 6)}`);
    const claimId = genId();
    await db.insert(expenseClaims).values({ id: claimId, tenantId: tenant!.id, driverId: isolated.driverId, vehicleId: isolated.vehicleId, category: "FUEL", amount: 50, reason: "Fuel", status: "PENDING" });
    const { POST: approve } = await import("@/app/api/expenses/[id]/approve/route");
    const res = await approve(makeRequest(`/api/expenses/${claimId}/approve`, { method: "POST", cookie: adminCookie }), { params: { id: claimId } });
    expect(res.status).toBe(200);
  });

  it("16. Milestone Y's Fuel Expenses report remains functional and unaffected", async () => {
    const { runReport } = await import("@/lib/reportQuery");
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const result = await runReport("fuelExpenseClaims", tenant!.id, { columns: [], filters: [] });
    expect(Array.isArray(result.rows)).toBe(true);
  });

  it("17. V.1 schedule/planned demand schema remains untouched (no generation code path)", () => {
    const scheduleRouteSource = fs.readFileSync(path.join(process.cwd(), "app/api/contracts/[id]/delivery-schedules/route.ts"), "utf8");
    expect(scheduleRouteSource).not.toContain("export async function POST");
  });

  it("no schema file was modified for this milestone — inventoryItems and warehouses remain exactly as audited", () => {
    const schemaSource = fs.readFileSync(path.join(process.cwd(), "lib/db/schema.ts"), "utf8");
    expect(schemaSource).toContain('itemName: text("item_name").notNull(), // e.g. "19L Bottle - Full", "19L Bottle - Empty"');
    expect(schemaSource).not.toContain("workshops");
    expect(schemaSource).not.toContain("purchase_requisitions");
    expect(schemaSource).not.toContain("maintenance_inventory_balances");
  });

  it("a real end-to-end ONE_TIME_TRIP_COUNT delivery still prices correctly", async () => {
    const { contracts, contractPricingRules, warehouses, orders } = await import("@/lib/db/schema");
    const { createIsolatedDriverAndVehicle } = await import("../helpers/testFixtures");
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const tenantId = tenant!.id;
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const warehouse = await db.query.warehouses.findFirst({ where: eq(warehouses.tenantId, tenantId) });
    const customerId = genId();
    await db.insert(customers).values({ id: customerId, tenantId, name: "Z Regression Customer", type: "B2B", address: "Test", lat: 24.7, lng: 46.7 });
    const contractId = genId();
    await db.insert(contracts).values({ id: contractId, tenantId, customerId, contractNumber: `Z-${genId().slice(0, 8)}`, type: "ONE_TIME_TRIP_COUNT", status: "ACTIVE", appliesToAllSites: true, totalTripsPurchased: 5, tripsUsed: 0, startDate: new Date("2020-01-01") });
    await db.insert(contractPricingRules).values({ id: genId(), tenantId, pricingScope: "CONTRACT", contractId, rateType: "STANDARD", pricePerTrip: 500, vatRate: 0.15 });
    const { POST: createOrder } = await import("@/app/api/orders/route");
    const order = await (await createOrder(makeRequest("/api/orders", { method: "POST", cookie: adminCookie, body: { customerId, contractId, qtyOrdered: 1, emptyBottlesToCollect: 0, paymentMethod: "CASH" } }))).json();
    const isolated = await createIsolatedDriverAndVehicle(tenantId, `z-e2e-${genId().slice(0, 6)}`);
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

  it("no passwordHash exposure in any changed file", () => {
    const combined = adminPageSource() + customersPageSource() + placeholderSource() + shellSource();
    expect(combined).not.toContain("passwordHash");
  });
});
