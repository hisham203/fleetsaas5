import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { makeRequest, loginAs } from "../helpers/request";
import { db } from "@/lib/db/client";
import { tenants, customers, contracts, contractPricingRules, warehouses, orders } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { genId } from "@/lib/helpers";
import { deriveOperationalStatus } from "@/lib/controlTowerStatus";

// Milestone T — Operations Planning Engine.
const dispatchSource = () => fs.readFileSync(path.join(process.cwd(), "app/dispatch/page.tsx"), "utf8");
const customersSource = () => fs.readFileSync(path.join(process.cwd(), "app/admin/customers/page.tsx"), "utf8");
const contractsSource = () => fs.readFileSync(path.join(process.cwd(), "app/admin/contracts/page.tsx"), "utf8");
const plannerSource = () => fs.readFileSync(path.join(process.cwd(), "app/admin/contract-planner/page.tsx"), "utf8");

// ---- Part 2/3 root-cause fix: the unit-level status contradiction ----
describe("Control Tower ↔ Dispatch status agreement (Milestone T, Parts 2/3)", () => {
  const base = {
    order: { status: "PENDING", contractId: null as string | null },
    customer: { type: "B2B" },
    trip: null,
    stop: null,
    exception: null,
    invoice: null,
    contractType: null as string | null,
  };

  it("root cause: a DELIVERED order with NO trip is DELIVERED, not NEW (the exact seed scenario that caused the reported bug)", () => {
    // This is the RBW-HOSPITAL-MONTHLY / RBW-UNIVERSITY-MONTHLY pattern:
    // orders seeded as DELIVERED under monthly contracts with no trip
    // record. Before the fix, deriveOperationalStatus returned NEW here.
    expect(deriveOperationalStatus({ ...base, order: { status: "DELIVERED", contractId: "c1" }, contractType: "MONTHLY_ACCUMULATED" })).toBe("DELIVERED");
    expect(deriveOperationalStatus({ ...base, order: { status: "PARTIALLY_DELIVERED", contractId: "c1" }, contractType: "MONTHLY_ACCUMULATED" })).toBe("DELIVERED");
  });

  it("an ASSIGNED/IN_TRANSIT order with no trip is a genuine anomaly (EXCEPTION), never silently NEW", () => {
    expect(deriveOperationalStatus({ ...base, order: { status: "ASSIGNED", contractId: null } })).toBe("EXCEPTION");
    expect(deriveOperationalStatus({ ...base, order: { status: "IN_TRANSIT", contractId: null } })).toBe("EXCEPTION");
  });

  it("a genuinely new PENDING order with no trip is still NEW (unchanged)", () => {
    expect(deriveOperationalStatus({ ...base, order: { status: "PENDING", contractId: null } })).toBe("NEW");
  });

  it("the Dispatch deep-link resolver checks trip existence FIRST, then branches by order status — matching the same ground truth", () => {
    const source = dispatchSource();
    // The trip lookup happens before any order.status branching inside the orderId branch.
    const branchStart = source.indexOf("} else if (deepLinkOrderId) {");
    const branchBody = source.slice(branchStart, branchStart + 3000);
    const tripLookupIdx = branchBody.indexOf("match.tripStop?.trip?.id");
    const statusBranchIdx = branchBody.indexOf('match.status === "PENDING"');
    expect(tripLookupIdx).toBeGreaterThan(-1);
    expect(statusBranchIdx).toBeGreaterThan(-1);
    expect(tripLookupIdx).toBeLessThan(statusBranchIdx);
  });

  it("a DELIVERED order with no trip gets an honest 'already completed, no trip record' message in Dispatch, not 'assigned'", () => {
    const source = dispatchSource();
    expect(source).toContain("No trip record is linked for it");
    expect(source).not.toContain("is marked as assigned, but its trip could not be located");
  });

  it("the anomaly message is status-specific, not hardcoded to 'assigned'", () => {
    const source = dispatchSource();
    expect(source).toContain("is marked as ${match.status.toLowerCase()}");
    expect(source).toContain("may require admin review");
  });
});

// ---- Part 5: Customers & Sites operational hub ----
describe("Customers & Sites operational hub (Milestone T, Part 5)", () => {
  it("customer detail shows a Contracts & Operational Activity panel with contracts and pending orders", () => {
    const source = customersSource();
    expect(source).toContain("CustomerOperationsPanel");
    expect(source).toContain("Contracts &amp; Operational Activity");
    expect(source).toContain("/api/orders?customerId=");
  });

  it("customer detail offers a New contract action prefilling customerId, for admins only", () => {
    const source = customersSource();
    expect(source).toContain("/admin/contracts?new=1&customerId=${customer.id}");
    expect(source).toContain("isAdmin &&");
  });

  it("the Contracts page reads new=1&customerId= and prefills the create form", () => {
    const source = contractsSource();
    expect(source).toContain('searchParams.get("new") === "1"');
    expect(source).toContain("initialCustomerId");
  });

  it("GET /api/orders supports the customerId filter the hub relies on", async () => {
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const customer = await db.query.customers.findFirst({ where: eq(customers.tenantId, tenant!.id) });
    const { GET: getOrders } = await import("@/app/api/orders/route");
    const res = await getOrders(makeRequest(`/api/orders?customerId=${customer!.id}`, { cookie: adminCookie }));
    expect(res.status).toBe(200);
    const rows = await res.json();
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.every((o: any) => o.customerId === customer!.id)).toBe(true);
  });
});

// ---- Part 6: Contract operational activity ----
describe("Contract operational activity (Milestone T, Part 6)", () => {
  it("GET /api/orders supports a contractId filter", async () => {
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const contract = await db.query.contracts.findFirst({ where: eq(contracts.tenantId, tenant!.id) });
    const { GET: getOrders } = await import("@/app/api/orders/route");
    const res = await getOrders(makeRequest(`/api/orders?contractId=${contract!.id}`, { cookie: adminCookie }));
    expect(res.status).toBe(200);
    const rows = await res.json();
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.every((o: any) => o.contractId === contract!.id)).toBe(true);
  });

  it("contract detail renders an Operational activity section reusing the shared status functions", () => {
    const source = contractsSource();
    expect(source).toContain("Operational activity");
    expect(source).toContain("deriveOperationalStatus");
    expect(source).toContain("/api/orders?contractId=");
  });

  it("monthly contract shows accumulation explanation; one-time shows trip-consumption explanation", () => {
    const source = contractsSource();
    expect(source).toContain("Monthly accumulation: deliveries accumulate during the month");
    expect(source).toContain("Each delivered trip consumes one purchased trip");
  });

  it("empty state offers Go to Planner / View customer next actions", () => {
    const source = contractsSource();
    expect(source).toContain("No operational orders for this contract yet.");
    expect(source).toContain("Go to Planner");
  });
});

// ---- Part 7: Capacity Planner ----
describe("Capacity Planner (Milestone T, Part 7)", () => {
  it("the planner API returns {contracts, capacity, demand}", async () => {
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const { GET: getPlanner } = await import("@/app/api/contract-planner/route");
    const body = await (await getPlanner(makeRequest("/api/contract-planner", { cookie: adminCookie }))).json();
    expect(Array.isArray(body.contracts)).toBe(true);
    expect(body.capacity).toBeTruthy();
    expect(Array.isArray(body.capacity.byTankerSize)).toBe(true);
    expect(body.demand).toHaveProperty("contractLinkedPending");
    expect(body.demand).toHaveProperty("nonContractPending");
  });

  it("capacity groups vehicles by real tanker size with available/total counts", async () => {
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const { GET: getPlanner } = await import("@/app/api/contract-planner/route");
    const body = await (await getPlanner(makeRequest("/api/contract-planner", { cookie: adminCookie }))).json();
    for (const size of body.capacity.byTankerSize) {
      expect(size).toHaveProperty("size");
      expect(size).toHaveProperty("available");
      expect(size).toHaveProperty("total");
      expect(size.available).toBeLessThanOrEqual(size.total);
    }
    expect(body.capacity).toHaveProperty("driversAvailable");
  });

  it("the planner page shows demand and capacity sections and the page title is Contract & Capacity Planner", () => {
    const source = plannerSource();
    expect(source).toContain('title="Contract & Capacity Planner"');
    expect(source).toContain("capacity.byTankerSize");
    expect(source).toContain("demand.contractLinkedPending");
  });

  it("Part 8 honesty: the planner does NOT claim automatic trip/order generation exists", () => {
    const source = plannerSource();
    expect(source).toContain("No automatic trip/order generation from contracts exists yet");
  });

  it("monthly vs one-time planning cards show the correct path explanation", () => {
    const source = plannerSource();
    expect(source).toContain("Deliveries accumulate during the month and are invoiced manually at month-end.");
    expect(source).toContain("Each delivered trip consumes one purchased trip; over-limit trips require OVERAGE pricing.");
  });

  it("DRIVER cannot access the planner API", async () => {
    const driverCookie = await loginAs("mohammed@riyadh-bulk-water.co", "password123");
    const { GET: getPlanner } = await import("@/app/api/contract-planner/route");
    const res = await getPlanner(makeRequest("/api/contract-planner", { cookie: driverCookie }));
    expect(res.status).toBe(401);
  });
});

// ---- Regression ----
describe("Regression protection (Milestone T)", () => {
  it("key business-logic files remain untouched (Task P.2 markers intact)", () => {
    const stopRoute = fs.readFileSync(path.join(process.cwd(), "app/api/trips/[id]/stops/[stopId]/route.ts"), "utf8");
    const pricing = fs.readFileSync(path.join(process.cwd(), "lib/contractPricing.ts"), "utf8");
    const erp = fs.readFileSync(path.join(process.cwd(), "lib/erp/sync.ts"), "utf8");
    expect(stopRoute).toContain("Task P.2");
    expect(pricing).toContain("PricingEngineError");
    expect(erp).toContain("isContractPriced");
  });

  it("Milestone R left-sidebar remains, no horizontal tab bar returned", () => {
    const adminSource = fs.readFileSync(path.join(process.cwd(), "app/admin/page.tsx"), "utf8");
    expect(adminSource).toContain("AdminShell");
    expect(adminSource).not.toMatch(/\(\["overview", "fleet", "drivers".*\] as const\)\.map/);
  });

  it("a real end-to-end ONE_TIME_TRIP_COUNT delivery still prices correctly and increments tripsUsed once", async () => {
    const { createIsolatedDriverAndVehicle } = await import("../helpers/testFixtures");
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const tenantId = tenant!.id;
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const warehouse = await db.query.warehouses.findFirst({ where: eq(warehouses.tenantId, tenantId) });
    const customerId = genId();
    await db.insert(customers).values({ id: customerId, tenantId, name: "MT Regression Customer", type: "B2B", address: "Test", lat: 24.7, lng: 46.7 });
    const contractId = genId();
    await db.insert(contracts).values({ id: contractId, tenantId, customerId, contractNumber: `MT-${genId().slice(0, 8)}`, type: "ONE_TIME_TRIP_COUNT", status: "ACTIVE", appliesToAllSites: true, totalTripsPurchased: 5, tripsUsed: 0, startDate: new Date("2020-01-01") });
    await db.insert(contractPricingRules).values({ id: genId(), tenantId, pricingScope: "CONTRACT", contractId, rateType: "STANDARD", pricePerTrip: 500, vatRate: 0.15 });
    const { POST: createOrder } = await import("@/app/api/orders/route");
    const order = await (await createOrder(makeRequest("/api/orders", { method: "POST", cookie: adminCookie, body: { customerId, contractId, qtyOrdered: 1, emptyBottlesToCollect: 0, paymentMethod: "CASH" } }))).json();
    const isolated = await createIsolatedDriverAndVehicle(tenantId, `mt-e2e-${genId().slice(0, 6)}`);
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
    const deliverBody = await deliverRes.json();
    expect(deliverBody.invoice.subtotal).toBe(500);
    const contractAfter = await db.query.contracts.findFirst({ where: eq(contracts.id, contractId) });
    expect(contractAfter!.tripsUsed).toBe(1);
  });

  it("no passwordHash exposure in any changed page source", () => {
    expect(dispatchSource() + customersSource() + contractsSource() + plannerSource()).not.toContain("passwordHash");
  });
});
