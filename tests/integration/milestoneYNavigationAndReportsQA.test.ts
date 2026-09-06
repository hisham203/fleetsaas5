import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { makeRequest, loginAs } from "../helpers/request";
import { db } from "@/lib/db/client";
import { tenants, customers, drivers, vehicles, expenseClaims } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { genId, expenseRef } from "@/lib/helpers";
import { createIsolatedDriverAndVehicle } from "../helpers/testFixtures";

// Milestone Y — Navigation QA, Reports Integrity & Relationship Audit.
const adminPageSource = () => fs.readFileSync(path.join(process.cwd(), "app/admin/page.tsx"), "utf8");
const shellSource = () => fs.readFileSync(path.join(process.cwd(), "components/AdminShell.tsx"), "utf8");
const expensesPageSource = () => fs.readFileSync(path.join(process.cwd(), "app/admin/expenses/page.tsx"), "utf8");

describe("Permanent sidebar routing fix (Milestone Y, Parts 2/3)", () => {
  it("root cause: the in-page tab switcher now updates the browser URL via router.replace, not just React state", () => {
    const source = adminPageSource();
    expect(source).toContain("const changeTab = useCallback((key: TabKey) => {");
    expect(source).toContain("router.replace(`/admin?tab=${key}`");
    // Every existing setTab(...) call site automatically gets the fix via this alias.
    expect(source).toContain("const setTab = changeTab;");
  });

  it("Reports and Scorecards each have their own distinct query-param value, never sharing state (Inventory was intentionally retired from primary navigation in Milestone AA)", () => {
    const source = shellSource();
    expect(source).toContain('{ label: "Reports", href: "/admin?tab=reports" }');
    expect(source).toContain('{ label: "Scorecards", href: "/admin?tab=scorecards" }');
  });

  it("Customers & Sites is the sole primary customer sidebar item — the legacy 'Customers' in-page tab was removed from primary navigation", () => {
    const source = adminPageSource();
    const coreDataIdx = source.indexOf('label: "Core Data"');
    const financeIdx = source.indexOf('label: "Finance"');
    const coreDataSection = source.slice(coreDataIdx, financeIdx);
    expect(coreDataSection).toContain('{ label: "Customers & Sites", href: "/admin/customers" }');
    expect(coreDataSection).not.toContain('item("Customers", "customers")');
  });

  it("the legacy customers tab is still reachable (not deleted) but shows a clear deprecation notice linking to the new screen", () => {
    const source = adminPageSource();
    expect(source).toContain("This screen is deprecated");
    expect(source).toContain("Go to Customers &amp; Sites");
    expect(source).toContain('href="/admin/customers"');
    // VALID_TABS still includes "customers" so an old bookmark doesn't 404.
    expect(source).toContain('"customers"');
  });
});

describe("Expense unique reference (Milestone Y, Part 5)", () => {
  it("expenseRef is deterministic (stable) for the same expense", () => {
    const expense = { id: "abcdef12-3456-7890-abcd-ef1234567890", createdAt: new Date("2026-03-15") };
    const ref1 = expenseRef(expense);
    const ref2 = expenseRef(expense);
    expect(ref1).toBe(ref2);
    expect(ref1).toMatch(/^EXP-2026-[A-F0-9]{6}$/);
  });

  it("expenseRef is unique across different expenses", () => {
    const e1 = { id: genId(), createdAt: new Date() };
    const e2 = { id: genId(), createdAt: new Date() };
    expect(expenseRef(e1)).not.toBe(expenseRef(e2));
  });

  it("no schema change was needed — expenseRef is purely derived from existing id/createdAt fields", () => {
    const schemaSource = fs.readFileSync(path.join(process.cwd(), "lib/db/schema.ts"), "utf8");
    expect(schemaSource).not.toContain("expense_number");
    expect(schemaSource).not.toContain("expenseNumber");
  });

  it("Expense Ref appears in the Finance Expenses table and the Fleet vehicle expenses section", () => {
    expect(expensesPageSource()).toContain("expenseRef(e)");
    expect(adminPageSource()).toContain("expenseRef(e)");
  });
});

describe("Fuel Logs vs Fuel Expenses report separation (Milestone Y, Part 6)", () => {
  it("Fuel Logs and Fuel Expenses are two distinct, separately-named report datasets — never merged", () => {
    const datasetsSource = fs.readFileSync(path.join(process.cwd(), "lib/reportDatasets.ts"), "utf8");
    expect(datasetsSource).toContain('label: "Fuel Logs"');
    expect(datasetsSource).toContain('label: "Fuel Expenses"');
    expect(datasetsSource).toContain("fuelExpenseClaims");
  });

  it("Fuel Logs report reads only the fuelLogs table; Fuel Expenses reads only expenseClaims filtered to category=FUEL", () => {
    const querySource = fs.readFileSync(path.join(process.cwd(), "lib/reportQuery.ts"), "utf8");
    expect(querySource).toContain("async function fetchFuelLogsRows");
    expect(querySource).toContain("async function fetchFuelExpenseClaimsRows");
    expect(querySource).toContain('eq(expenseClaims.category, "FUEL")');
  });

  it("a real fuel expense claim now appears in the Fuel Expenses report (the exact reported bug, fixed)", async () => {
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const isolated = await createIsolatedDriverAndVehicle(tenant!.id, `y-fuel-${genId().slice(0, 6)}`);
    const claimId = genId();
    await db.insert(expenseClaims).values({ id: claimId, tenantId: tenant!.id, driverId: isolated.driverId, vehicleId: isolated.vehicleId, category: "FUEL", amount: 180, reason: "Fill-up", status: "PENDING" });
    const { runReport } = await import("@/lib/reportQuery");
    const result = await runReport("fuelExpenseClaims", tenant!.id, { columns: [], filters: [] });
    expect(result.rows.some((r: any) => r.amount === 180)).toBe(true);
  });

  it("a non-fuel expense claim (e.g. TOLL) does NOT appear in the Fuel Expenses report", async () => {
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const isolated = await createIsolatedDriverAndVehicle(tenant!.id, `y-toll-${genId().slice(0, 6)}`);
    const claimId = genId();
    await db.insert(expenseClaims).values({ id: claimId, tenantId: tenant!.id, driverId: isolated.driverId, vehicleId: isolated.vehicleId, category: "TOLL", amount: 25, reason: "Toll gate", status: "PENDING" });
    const { runReport } = await import("@/lib/reportQuery");
    const result = await runReport("fuelExpenseClaims", tenant!.id, { columns: [], filters: [] });
    expect(result.rows.some((r: any) => r.amount === 25)).toBe(false);
  });

  it("the general Expense Claims report still includes all categories, unaffected by the new dedicated report", async () => {
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const isolated = await createIsolatedDriverAndVehicle(tenant!.id, `y-general-${genId().slice(0, 6)}`);
    const claimId = genId();
    await db.insert(expenseClaims).values({ id: claimId, tenantId: tenant!.id, driverId: isolated.driverId, vehicleId: isolated.vehicleId, category: "MAINTENANCE", amount: 300, reason: "Repair", status: "PENDING" });
    const { runReport } = await import("@/lib/reportQuery");
    const result = await runReport("expenseClaims", tenant!.id, { columns: [], filters: [] });
    expect(result.rows.some((r: any) => r.amount === 300)).toBe(true);
  });

  it("reports remain tenant-isolated for the new dataset", async () => {
    const demoTenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Demo Water Co.") });
    const riyadhTenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const isolated = await createIsolatedDriverAndVehicle(demoTenant!.id, `y-iso-${genId().slice(0, 6)}`);
    const claimId = genId();
    // Task Y.1 flaky-CI fix: this previously used amount: 999, an
    // arbitrarily large value that (when this test happened to run
    // before tests/integration/seed-data-quality.test.ts's "Acme's
    // expenses are priced at wholesale fuel scale, distinctly larger
    // than Demo Water Co.'s retail scale" check, depending on shared
    // test-database execution order) inflated Demo Water Co.'s average
    // expense amount enough to break that pre-existing test's ratio
    // assertion. The app's tenant isolation was never at fault — this
    // test only needs a small, uniquely-identifiable amount to prove
    // isolation, not one large enough to skew another test's aggregate
    // statistics on the same shared tenant.
    await db.insert(expenseClaims).values({ id: claimId, tenantId: demoTenant!.id, driverId: isolated.driverId, vehicleId: isolated.vehicleId, category: "FUEL", amount: 37.5, reason: "Fuel", status: "PENDING" });
    const { runReport } = await import("@/lib/reportQuery");
    const result = await runReport("fuelExpenseClaims", riyadhTenant!.id, { columns: [], filters: [] });
    expect(result.rows.some((r: any) => r.amount === 37.5)).toBe(false);
  });
});

describe("Relationship audit spot-checks (Milestone Y, Part 7)", () => {
  it("Expense -> Driver/Vehicle/Trip relationship is correctly embedded and safely column-restricted", async () => {
    const source = fs.readFileSync(path.join(process.cwd(), "app/api/expenses/route.ts"), "utf8");
    expect(source).toContain("driver: { with: { user: { columns: SAFE_USER_COLUMNS } } }, vehicle: true, trip: true");
  });

  it("Vehicle -> Trips/Expenses/Maintenance relationships are all present and tenant-scoped in the operations API", async () => {
    const source = fs.readFileSync(path.join(process.cwd(), "app/api/vehicles/[id]/operations/route.ts"), "utf8");
    expect(source).toContain("eq(trips.vehicleId, vehicleId)");
    expect(source).toContain("eq(expenseClaims.vehicleId, vehicleId)");
    expect(source).toContain("eq(maintenanceRecords.vehicleId, vehicleId)");
  });

  it("Customer -> Contracts/Orders relationship is present in the customer operations hub", async () => {
    const source = fs.readFileSync(path.join(process.cwd(), "app/admin/customers/page.tsx"), "utf8");
    expect(source).toContain("CustomerOperationsPanel");
    expect(source).toContain("/api/orders?customerId=");
  });

  it("Contract -> pending orders relationship remains intact (Milestone T's operational activity)", async () => {
    const source = fs.readFileSync(path.join(process.cwd(), "app/admin/contracts/page.tsx"), "utf8");
    expect(source).toContain("Operational activity");
  });

  it("Trip -> Expenses relationship is safely surfaced in Dispatch as a link, never inline approval", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "app/dispatch/page.tsx"), "utf8");
    expect(source).toContain("/admin/expenses?vehicleId=${trip.vehicle.id}");
  });
});

describe("Regression protection (Milestone Y)", () => {
  it("Task P.2 and Milestone W delivery/POD route markers remain unchanged", () => {
    const stopRoute = fs.readFileSync(path.join(process.cwd(), "app/api/trips/[id]/stops/[stopId]/route.ts"), "utf8");
    expect(stopRoute).toContain("Task P.2");
    expect(stopRoute).toContain("Proof of delivery is required before this trip can be marked delivered.");
    expect(stopRoute).toContain("autoCloseTripIfAllStopsResolved");
  });

  it("Milestone X expense approval behavior is unaffected", async () => {
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const isolated = await createIsolatedDriverAndVehicle(tenant!.id, `y-reg-${genId().slice(0, 6)}`);
    const claimId = genId();
    await db.insert(expenseClaims).values({ id: claimId, tenantId: tenant!.id, driverId: isolated.driverId, vehicleId: isolated.vehicleId, category: "FUEL", amount: 75, reason: "Fuel", status: "PENDING" });
    const { POST: approve } = await import("@/app/api/expenses/[id]/approve/route");
    const res = await approve(makeRequest(`/api/expenses/${claimId}/approve`, { method: "POST", cookie: adminCookie }), { params: { id: claimId } });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("APPROVED");
  });

  it("V.1 schema tables have no generation code path (unchanged from the CI fix)", () => {
    const scheduleRouteSource = fs.readFileSync(path.join(process.cwd(), "app/api/contracts/[id]/delivery-schedules/route.ts"), "utf8");
    expect(scheduleRouteSource).not.toContain("export async function POST");
  });

  it("a real end-to-end ONE_TIME_TRIP_COUNT delivery still prices correctly", async () => {
    const { contracts, contractPricingRules, warehouses, orders } = await import("@/lib/db/schema");
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const tenantId = tenant!.id;
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const warehouse = await db.query.warehouses.findFirst({ where: eq(warehouses.tenantId, tenantId) });
    const customerId = genId();
    await db.insert(customers).values({ id: customerId, tenantId, name: "Y Regression Customer", type: "B2B", address: "Test", lat: 24.7, lng: 46.7 });
    const contractId = genId();
    await db.insert(contracts).values({ id: contractId, tenantId, customerId, contractNumber: `Y-${genId().slice(0, 8)}`, type: "ONE_TIME_TRIP_COUNT", status: "ACTIVE", appliesToAllSites: true, totalTripsPurchased: 5, tripsUsed: 0, startDate: new Date("2020-01-01") });
    await db.insert(contractPricingRules).values({ id: genId(), tenantId, pricingScope: "CONTRACT", contractId, rateType: "STANDARD", pricePerTrip: 500, vatRate: 0.15 });
    const { POST: createOrder } = await import("@/app/api/orders/route");
    const order = await (await createOrder(makeRequest("/api/orders", { method: "POST", cookie: adminCookie, body: { customerId, contractId, qtyOrdered: 1, emptyBottlesToCollect: 0, paymentMethod: "CASH" } }))).json();
    const isolated = await createIsolatedDriverAndVehicle(tenantId, `y-e2e-${genId().slice(0, 6)}`);
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
    const combined = adminPageSource() + expensesPageSource() + fs.readFileSync(path.join(process.cwd(), "lib/reportQuery.ts"), "utf8");
    expect(combined).not.toContain("passwordHash");
  });
});
