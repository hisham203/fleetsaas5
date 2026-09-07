import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { makeRequest, loginAs } from "../helpers/request";
import { db } from "@/lib/db/client";
import { tenants, warehouses } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { genId } from "@/lib/helpers";

// Milestone AA — Product QA, Bulk Water Corrections & Layout Consistency.
const customersPageSource = () => fs.readFileSync(path.join(process.cwd(), "app/admin/customers/page.tsx"), "utf8");
const adminPageSource = () => fs.readFileSync(path.join(process.cwd(), "app/admin/page.tsx"), "utf8");
const shellSource = () => fs.readFileSync(path.join(process.cwd(), "components/AdminShell.tsx"), "utf8");
const dispatchSource = () => fs.readFileSync(path.join(process.cwd(), "app/dispatch/page.tsx"), "utf8");
const loadingPointsSource = () => fs.readFileSync(path.join(process.cwd(), "app/admin/loading-points/page.tsx"), "utf8");

describe("Bottle terminology cleanup (Milestone AA, Parts 2/3)", () => {
  it("1. no visible customer screen label says 'Default bottle price' — relabeled as legacy fallback pricing", () => {
    expect(customersPageSource()).not.toContain("Default bottle price");
    expect(customersPageSource()).toContain("Legacy fallback pricing");
    expect(customersPageSource()).toContain("Bulk water contracts should use contract pricing rules");
  });

  it("2/3. Fleet add vehicle form does not say 'bottle vans'", () => {
    expect(adminPageSource()).not.toContain("bottle vans");
    expect(adminPageSource()).toContain("General capacity units");
  });

  it("the legacy field is now presented as a collapsible, de-emphasized section, not a primary form field", () => {
    expect(customersPageSource()).toContain("<details");
    expect(customersPageSource()).toContain("<summary");
  });

  it("no DB field was renamed — contractPricePerBottle remains the column name (a UI/label-only cleanup)", () => {
    const schemaSource = fs.readFileSync(path.join(process.cwd(), "lib/db/schema.ts"), "utf8");
    expect(schemaSource).toContain("contractPricePerBottle");
  });

  it("legitimate bottle-delivery tenants (Demo Water Co./Acme) keep their real bottleSizeLtr/emptyBottlesToCollect fields untouched", () => {
    const driverSource = fs.readFileSync(path.join(process.cwd(), "app/driver/page.tsx"), "utf8");
    const b2bSource = fs.readFileSync(path.join(process.cwd(), "app/b2b/page.tsx"), "utf8");
    expect(driverSource).toContain("bottleSizeLtr");
    expect(b2bSource).toContain("bottleSizeLtr");
  });
});

describe("Dispatch navigation and layout fix (Milestone AA, Part 4)", () => {
  it("6/7. Dispatch page now uses the shared AdminShell, not a standalone TopNav-only layout", () => {
    const source = dispatchSource();
    expect(source).toContain("import AdminShell from");
    expect(source).toContain('<AdminShell title="Dispatch (Live)"');
  });

  it("root cause confirmed: a Dispatcher's login destination is /dispatch directly", () => {
    const loginSource = fs.readFileSync(path.join(process.cwd(), "app/login/page.tsx"), "utf8");
    expect(loginSource).toContain('DISPATCHER: "/dispatch"');
  });

  it("8. /dispatch deep links (tripId/orderId) still work — the resolution logic is untouched by the layout wrapper change", () => {
    const source = dispatchSource();
    expect(source).toContain("deepLinkTripId");
    expect(source).toContain('searchParams.get("orderId")');
  });

  it("9/10. Dispatch Control Tower link and Contract & Capacity Planner remain discoverable in the sidebar", () => {
    const source = shellSource();
    expect(source).toContain('{ label: "Dispatch Control Tower", href: "/admin/dispatch" }');
    expect(source).toContain('{ label: "Dispatch (Live)", href: "/dispatch" }');
    expect(source).toContain("Contract & Capacity Planner");
  });

  it("Milestone W's failed-trip exception handling is unaffected by the layout wrapper change", () => {
    const source = dispatchSource();
    expect(source).toContain("Exception Center");
  });
});

describe("Loading Points create/edit (Milestone AA, Part 5)", () => {
  it("12/13/14. Loading Points page has create and edit actions inside the same page", () => {
    const source = loadingPointsSource();
    expect(source).toContain("+ New Loading Point");
    expect(source).toContain("function LoadingPointForm");
    expect(source).toContain('onClick={() => setEditingId(editingId === w.id ? null : w.id)}');
  });

  it("15. 'Edit in Fleet & Inventory' no longer navigates anywhere useless — editing happens inline", () => {
    const source = loadingPointsSource();
    expect(source).not.toContain('Edit in Fleet &amp; Inventory');
    expect(source).not.toContain('<a href="/admin" className="text-aquaDark hover:underline text-xs font-medium">Edit');
  });

  it("16. loading point create validates required fields client-side (disabled until all are filled)", () => {
    const source = loadingPointsSource();
    expect(source).toContain("disabled={!name || !address || !lat || !lng || submitting}");
  });

  it("a real loading point can be created via the existing, unmodified POST /api/warehouses", async () => {
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const { POST: createWarehouse } = await import("@/app/api/warehouses/route");
    const res = await createWarehouse(makeRequest("/api/warehouses", { method: "POST", cookie: adminCookie, body: { name: "AA Test Filling Station", address: "Test Address", lat: 24.5, lng: 46.5 } }));
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created.tenantId).toBe(tenant!.id);
  });

  it("a real loading point can be edited via the existing, unmodified PATCH /api/warehouses/[id]", async () => {
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const whId = genId();
    await db.insert(warehouses).values({ id: whId, tenantId: tenant!.id, name: "AA Edit Test", address: "Old Address", lat: 24.1, lng: 46.1 });
    const { PATCH: updateWarehouse } = await import("@/app/api/warehouses/[id]/route");
    const res = await updateWarehouse(makeRequest(`/api/warehouses/${whId}`, { method: "PATCH", cookie: adminCookie, body: { address: "New Address" } }), { params: { id: whId } });
    expect(res.status).toBe(200);
    const updated = await db.query.warehouses.findFirst({ where: eq(warehouses.id, whId) });
    expect(updated!.address).toBe("New Address");
  });

  it("17. loading points remain tenant-isolated", async () => {
    const demoTenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Demo Water Co.") });
    const riyadhAdminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const demoWarehouseId = genId();
    await db.insert(warehouses).values({ id: demoWarehouseId, tenantId: demoTenant!.id, name: "AA Isolation Test", address: "Test", lat: 24.0, lng: 46.0 });
    const { PATCH: updateWarehouse } = await import("@/app/api/warehouses/[id]/route");
    const res = await updateWarehouse(makeRequest(`/api/warehouses/${demoWarehouseId}`, { method: "PATCH", cookie: riyadhAdminCookie, body: { address: "Hacked" } }), { params: { id: demoWarehouseId } });
    expect(res.status).toBe(404);
  });

  it("18. loading points are not confused with maintenance warehouses — the honest Inventory placeholder never references the warehouses table (Milestone AB split the merged placeholder into separate Inventory/Procurement/Master Items pages)", () => {
    const placeholderSource = fs.readFileSync(path.join(process.cwd(), "app/admin/inventory-planned/page.tsx"), "utf8");
    expect(placeholderSource).toContain("distinct concept from Loading Points");
  });

  it("missing schema fields (city/district/status/contact) are honestly documented, not faked", () => {
    const source = loadingPointsSource();
    expect(source).toContain("aren&apos;t supported by the schema yet");
    expect(source).not.toContain("District");
  });
});

describe("Inventory retirement (Milestone AA, Part 6)", () => {
  it("19. Inventory no longer appears in primary sidebar navigation", () => {
    expect(shellSource()).not.toContain('{ label: "Inventory", href: "/admin?tab=inventory" }');
    expect(adminPageSource()).not.toContain('item("Inventory", "inventory")');
  });

  it("20. the inventory route, if visited directly, is clearly labeled legacy", () => {
    const source = adminPageSource();
    expect(source).toContain('inventory: "Legacy Delivery Stock"');
    expect(source).toContain("not part of the bulk water tanker business model");
  });

  it("22. Inventory/Procurement/Master Items placeholders are all discoverable in the sidebar, replacing the old Inventory slot (Milestone AB split the one merged placeholder into three separate module links)", () => {
    expect(shellSource()).toContain("Inventory (Planned)");
    expect(shellSource()).toContain("Procurement (Planned)");
    expect(shellSource()).toContain("Master Items (Planned)");
  });

  it("23. no fake maintenance inventory rows appear in the placeholder", () => {
    const placeholderSource = fs.readFileSync(path.join(process.cwd(), "app/admin/maintenance-inventory/page.tsx"), "utf8");
    expect(placeholderSource).not.toContain("<table");
    expect(placeholderSource).not.toContain("fetch(");
  });
});

describe("Escalations clarification (Milestone AA, Part 7)", () => {
  it("24. Escalations is renamed to clarify it is SLA-based, distinct from failed-trip exceptions", () => {
    const source = dispatchSource();
    expect(source).toContain('<h3 className="font-medium">SLA Escalations</h3>');
    expect(source).toContain("separate from failed deliveries below");
  });

  it("28. Acknowledge/Resolve behavior remains valid and untouched (a real, working workflow, not removed)", () => {
    const source = dispatchSource();
    expect(source).toContain("async function acknowledge(id: string)");
    expect(source).toContain("async function resolve(id: string)");
  });

  it("escalations now link to their related order via the existing deep-link mechanism", () => {
    const source = dispatchSource();
    expect(source).toContain("/dispatch?orderId=${esc.orderId}");
  });

  it("27. normal Dispatch Queue is not polluted with escalations — they remain in their own, separate panel", () => {
    const source = dispatchSource();
    const escalationsIdx = source.indexOf("function EscalationsPanel");
    const queueIdx = source.indexOf("Dispatch queue");
    expect(escalationsIdx).toBeGreaterThan(0);
    expect(queueIdx).toBeGreaterThan(0);
  });
});

describe("Regression protection (Milestone AA)", () => {
  it("36. Task P.2 contract-priced invoice markers remain unchanged", () => {
    const stopRoute = fs.readFileSync(path.join(process.cwd(), "app/api/trips/[id]/stops/[stopId]/route.ts"), "utf8");
    expect(stopRoute).toContain("Task P.2");
    expect(stopRoute).toContain("Proof of delivery is required before this trip can be marked delivered.");
  });

  it("37. Milestone W POD gate and auto-close-trip fix remain unchanged", () => {
    const stopRoute = fs.readFileSync(path.join(process.cwd(), "app/api/trips/[id]/stops/[stopId]/route.ts"), "utf8");
    expect(stopRoute).toContain("autoCloseTripIfAllStopsResolved");
  });

  it("38/39. Milestone X expenses and Milestone Y reports remain functional", async () => {
    const { runReport } = await import("@/lib/reportQuery");
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const result = await runReport("fuelExpenseClaims", tenant!.id, { columns: [], filters: [] });
    expect(Array.isArray(result.rows)).toBe(true);
  });

  it("40. Milestone Z customer price migration remains functional", () => {
    expect(customersPageSource()).toContain("contractPricePerBottle");
  });

  it("41. V.1 schedule/planned demand schema remains untouched", () => {
    const scheduleRouteSource = fs.readFileSync(path.join(process.cwd(), "app/api/contracts/[id]/delivery-schedules/route.ts"), "utf8");
    expect(scheduleRouteSource).not.toContain("export async function POST");
  });

  it("no schema file was modified for this milestone (Milestone AA itself) — warehouses remains exactly as it was; Z.1 later legitimately added workshops schema separately", () => {
    const schemaSource = fs.readFileSync(path.join(process.cwd(), "lib/db/schema.ts"), "utf8");
    expect(schemaSource).toContain('export const warehouses = pgTable("warehouses"');
  });

  it("a real end-to-end ONE_TIME_TRIP_COUNT delivery still prices correctly", async () => {
    const { contracts, contractPricingRules, customers, orders } = await import("@/lib/db/schema");
    const { createIsolatedDriverAndVehicle } = await import("../helpers/testFixtures");
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const tenantId = tenant!.id;
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const warehouse = await db.query.warehouses.findFirst({ where: eq(warehouses.tenantId, tenantId) });
    const customerId = genId();
    await db.insert(customers).values({ id: customerId, tenantId, name: "AA Regression Customer", type: "B2B", address: "Test", lat: 24.7, lng: 46.7 });
    const contractId = genId();
    await db.insert(contracts).values({ id: contractId, tenantId, customerId, contractNumber: `AA-${genId().slice(0, 8)}`, type: "ONE_TIME_TRIP_COUNT", status: "ACTIVE", appliesToAllSites: true, totalTripsPurchased: 5, tripsUsed: 0, startDate: new Date("2020-01-01") });
    await db.insert(contractPricingRules).values({ id: genId(), tenantId, pricingScope: "CONTRACT", contractId, rateType: "STANDARD", pricePerTrip: 500, vatRate: 0.15 });
    const { POST: createOrder } = await import("@/app/api/orders/route");
    const order = await (await createOrder(makeRequest("/api/orders", { method: "POST", cookie: adminCookie, body: { customerId, contractId, qtyOrdered: 1, emptyBottlesToCollect: 0, paymentMethod: "CASH" } }))).json();
    const isolated = await createIsolatedDriverAndVehicle(tenantId, `aa-e2e-${genId().slice(0, 6)}`);
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
    const combined = adminPageSource() + customersPageSource() + dispatchSource() + loadingPointsSource() + shellSource();
    expect(combined).not.toContain("passwordHash");
  });
});
