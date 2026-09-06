import { describe, it, expect } from "vitest";
import { makeRequest, loginAs } from "../helpers/request";
import { db } from "@/lib/db/client";
import { tenants, customers, contracts, contractDeliverySchedules, plannedContractDemands } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { genId } from "@/lib/helpers";

// Milestone V.1 — Contract Delivery Schedule & Planned Demand Schema.
// Schema-only foundation: no generation, no conversion, no scheduler, no
// dispatch/billing behavior change. These tests confirm the two new
// tables exist correctly and their read-only APIs are safe and
// tenant-isolated — nothing more.
describe("Schema: contract_delivery_schedules and planned_contract_demands (Milestone V.1)", () => {
  it("both tables start empty in the seeded dev/test database", async () => {
    const scheduleRows = await db.query.contractDeliverySchedules.findMany();
    const demandRows = await db.query.plannedContractDemands.findMany();
    expect(scheduleRows.length).toBe(0);
    expect(demandRows.length).toBe(0);
  });

  it("a contract_delivery_schedules row can be inserted and read back with all designed fields", async () => {
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const customerId = genId();
    await db.insert(customers).values({ id: customerId, tenantId: tenant!.id, name: "MV Schedule Test Customer", type: "B2B", address: "Test" });
    const contractId = genId();
    await db.insert(contracts).values({ id: contractId, tenantId: tenant!.id, customerId, contractNumber: `MV-${genId().slice(0, 8)}`, type: "MONTHLY_ACCUMULATED", status: "DRAFT", appliesToAllSites: true, startDate: new Date("2026-01-01"), billingCadence: "MONTHLY" });
    const scheduleId = genId();
    await db.insert(contractDeliverySchedules).values({
      id: scheduleId, tenantId: tenant!.id, contractId, scheduleName: "Weekly Tue/Thu", scheduleType: "WEEKLY", status: "DRAFT",
      startDate: new Date("2026-01-01"), weekdays: "TUE,THU", preferredStartTime: "09:00", quantityLiters: 21000,
    });
    const row = await db.query.contractDeliverySchedules.findFirst({ where: eq(contractDeliverySchedules.id, scheduleId) });
    expect(row).toBeTruthy();
    expect(row!.scheduleType).toBe("WEEKLY");
    expect(row!.weekdays).toBe("TUE,THU");
    expect(row!.status).toBe("DRAFT"); // the declared default
  });

  it("a planned_contract_demands row can be inserted and read back, and its unique constraints are enforced", async () => {
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const customerId = genId();
    await db.insert(customers).values({ id: customerId, tenantId: tenant!.id, name: "MV Demand Test Customer", type: "B2B", address: "Test" });
    const contractId = genId();
    await db.insert(contracts).values({ id: contractId, tenantId: tenant!.id, customerId, contractNumber: `MV-${genId().slice(0, 8)}`, type: "ONE_TIME_TRIP_COUNT", status: "DRAFT", appliesToAllSites: true, totalTripsPurchased: 5, tripsUsed: 0, startDate: new Date("2026-01-01") });
    const demandId = genId();
    const generationKey = `gen-${genId()}`;
    await db.insert(plannedContractDemands).values({
      id: demandId, tenantId: tenant!.id, contractId, customerId, plannedDate: new Date("2026-02-01"),
      status: "GENERATED", generationKey,
    });
    const row = await db.query.plannedContractDemands.findFirst({ where: eq(plannedContractDemands.id, demandId) });
    expect(row).toBeTruthy();
    expect(row!.status).toBe("GENERATED"); // the declared default matches explicit value here
    expect(row!.capacityMatchStatus).toBe("NOT_CHECKED"); // the declared default

    // Duplicate generationKey must be rejected by the unique index.
    await expect(
      db.insert(plannedContractDemands).values({
        id: genId(), tenantId: tenant!.id, contractId, customerId, plannedDate: new Date("2026-02-08"), generationKey,
      })
    ).rejects.toThrow();
  });

  it("multiple rows with a NULL generationKey (e.g. manually-created demand) are allowed — the unique index is NULL-safe", async () => {
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const customerId = genId();
    await db.insert(customers).values({ id: customerId, tenantId: tenant!.id, name: "MV NULL Key Customer", type: "B2B", address: "Test" });
    const contractId = genId();
    await db.insert(contracts).values({ id: contractId, tenantId: tenant!.id, customerId, contractNumber: `MV-${genId().slice(0, 8)}`, type: "ONE_TIME_TRIP_COUNT", status: "DRAFT", appliesToAllSites: true, totalTripsPurchased: 5, tripsUsed: 0, startDate: new Date("2026-01-01") });
    await db.insert(plannedContractDemands).values({ id: genId(), tenantId: tenant!.id, contractId, customerId, plannedDate: new Date("2026-02-01") });
    await db.insert(plannedContractDemands).values({ id: genId(), tenantId: tenant!.id, contractId, customerId, plannedDate: new Date("2026-02-02") });
    const rows = await db.query.plannedContractDemands.findMany({ where: eq(plannedContractDemands.contractId, contractId) });
    expect(rows.length).toBe(2);
  });

  it("contractsRelations can embed deliverySchedules and plannedDemands", async () => {
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const customerId = genId();
    await db.insert(customers).values({ id: customerId, tenantId: tenant!.id, name: "MV Relations Customer", type: "B2B", address: "Test" });
    const contractId = genId();
    await db.insert(contracts).values({ id: contractId, tenantId: tenant!.id, customerId, contractNumber: `MV-${genId().slice(0, 8)}`, type: "MONTHLY_ACCUMULATED", status: "DRAFT", appliesToAllSites: true, startDate: new Date("2026-01-01"), billingCadence: "MONTHLY" });
    await db.insert(contractDeliverySchedules).values({ id: genId(), tenantId: tenant!.id, contractId, scheduleName: "Test", scheduleType: "MONTHLY", startDate: new Date("2026-01-01") });
    const withRelations = await db.query.contracts.findFirst({ where: eq(contracts.id, contractId), with: { deliverySchedules: true, plannedDemands: true } });
    expect(withRelations!.deliverySchedules.length).toBe(1);
    expect(withRelations!.plannedDemands.length).toBe(0);
  });
});

describe("GET /api/contracts/[id]/delivery-schedules (Milestone V.1)", () => {
  it("returns an empty array for a contract with no schedules", async () => {
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const contract = await db.query.contracts.findFirst({ where: eq(contracts.tenantId, tenant!.id) });
    const { GET: getSchedules } = await import("@/app/api/contracts/[id]/delivery-schedules/route");
    const res = await getSchedules(makeRequest(`/api/contracts/${contract!.id}/delivery-schedules`, { cookie: adminCookie }), { params: { id: contract!.id } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(0);
  });

  it("returns real rows once inserted, scoped to the correct contract only", async () => {
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const customerId = genId();
    await db.insert(customers).values({ id: customerId, tenantId: tenant!.id, name: "MV API Test Customer", type: "B2B", address: "Test" });
    const contractA = genId();
    const contractB = genId();
    await db.insert(contracts).values([
      { id: contractA, tenantId: tenant!.id, customerId, contractNumber: `MV-A-${genId().slice(0, 6)}`, type: "MONTHLY_ACCUMULATED", status: "DRAFT", appliesToAllSites: true, startDate: new Date("2026-01-01"), billingCadence: "MONTHLY" },
      { id: contractB, tenantId: tenant!.id, customerId, contractNumber: `MV-B-${genId().slice(0, 6)}`, type: "MONTHLY_ACCUMULATED", status: "DRAFT", appliesToAllSites: true, startDate: new Date("2026-01-01"), billingCadence: "MONTHLY" },
    ]);
    await db.insert(contractDeliverySchedules).values({ id: genId(), tenantId: tenant!.id, contractId: contractA, scheduleName: "A's schedule", scheduleType: "WEEKLY", startDate: new Date("2026-01-01") });
    const { GET: getSchedules } = await import("@/app/api/contracts/[id]/delivery-schedules/route");
    const resA = await getSchedules(makeRequest(`/api/contracts/${contractA}/delivery-schedules`, { cookie: adminCookie }), { params: { id: contractA } });
    const resB = await getSchedules(makeRequest(`/api/contracts/${contractB}/delivery-schedules`, { cookie: adminCookie }), { params: { id: contractB } });
    expect((await resA.json()).length).toBe(1);
    expect((await resB.json()).length).toBe(0);
  });

  it("cross-tenant contractId is rejected (404), not leaked", async () => {
    const demoTenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Demo Water Co.") });
    const riyadhAdminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const demoCustomerId = genId();
    await db.insert(customers).values({ id: demoCustomerId, tenantId: demoTenant!.id, name: "MV Cross-Tenant Customer", type: "B2B", address: "Test" });
    const demoContractId = genId();
    await db.insert(contracts).values({ id: demoContractId, tenantId: demoTenant!.id, customerId: demoCustomerId, contractNumber: `MV-XT-${genId().slice(0, 6)}`, type: "MONTHLY_ACCUMULATED", status: "DRAFT", appliesToAllSites: true, startDate: new Date("2026-01-01"), billingCadence: "MONTHLY" });
    const { GET: getSchedules } = await import("@/app/api/contracts/[id]/delivery-schedules/route");
    const res = await getSchedules(makeRequest(`/api/contracts/${demoContractId}/delivery-schedules`, { cookie: riyadhAdminCookie }), { params: { id: demoContractId } });
    expect(res.status).toBe(404);
  });

  it("DRIVER and DISPATCHER are both rejected — ADMIN-only, matching this module's existing convention", async () => {
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const contract = await db.query.contracts.findFirst({ where: eq(contracts.tenantId, tenant!.id) });
    const driverCookie = await loginAs("mohammed@riyadh-bulk-water.co", "password123");
    const dispatcherCookie = await loginAs("dispatch@riyadh-bulk-water.co", "password123");
    const { GET: getSchedules } = await import("@/app/api/contracts/[id]/delivery-schedules/route");
    const driverRes = await getSchedules(makeRequest(`/api/contracts/${contract!.id}/delivery-schedules`, { cookie: driverCookie }), { params: { id: contract!.id } });
    const dispatcherRes = await getSchedules(makeRequest(`/api/contracts/${contract!.id}/delivery-schedules`, { cookie: dispatcherCookie }), { params: { id: contract!.id } });
    expect(driverRes.status).toBe(401);
    expect(dispatcherRes.status).toBe(401);
  });
});

describe("GET /api/planned-contract-demands (Milestone V.1)", () => {
  it("returns an empty array with no filters", async () => {
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const { GET: getDemands } = await import("@/app/api/planned-contract-demands/route");
    const res = await getDemands(makeRequest("/api/planned-contract-demands", { cookie: adminCookie }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it("filters correctly by contractId, customerId, and status", async () => {
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const customerId = genId();
    await db.insert(customers).values({ id: customerId, tenantId: tenant!.id, name: "MV Filter Test Customer", type: "B2B", address: "Test" });
    const contractId = genId();
    await db.insert(contracts).values({ id: contractId, tenantId: tenant!.id, customerId, contractNumber: `MV-F-${genId().slice(0, 6)}`, type: "ONE_TIME_TRIP_COUNT", status: "DRAFT", appliesToAllSites: true, totalTripsPurchased: 5, tripsUsed: 0, startDate: new Date("2026-01-01") });
    await db.insert(plannedContractDemands).values([
      { id: genId(), tenantId: tenant!.id, contractId, customerId, plannedDate: new Date("2026-02-01"), status: "GENERATED" },
      { id: genId(), tenantId: tenant!.id, contractId, customerId, plannedDate: new Date("2026-02-02"), status: "APPROVED" },
    ]);
    const { GET: getDemands } = await import("@/app/api/planned-contract-demands/route");
    const byContract = await (await getDemands(makeRequest(`/api/planned-contract-demands?contractId=${contractId}`, { cookie: adminCookie }))).json();
    expect(byContract.length).toBe(2);
    const byStatus = await (await getDemands(makeRequest(`/api/planned-contract-demands?contractId=${contractId}&status=APPROVED`, { cookie: adminCookie }))).json();
    expect(byStatus.length).toBe(1);
    expect(byStatus[0].status).toBe("APPROVED");
    const byCustomer = await (await getDemands(makeRequest(`/api/planned-contract-demands?customerId=${customerId}`, { cookie: adminCookie }))).json();
    expect(byCustomer.length).toBe(2);
  });

  it("tenant isolation: a Riyadh admin never sees Demo Water Co.'s planned demand", async () => {
    const demoTenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Demo Water Co.") });
    const riyadhAdminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const demoCustomerId = genId();
    await db.insert(customers).values({ id: demoCustomerId, tenantId: demoTenant!.id, name: "MV Demo Isolation Customer", type: "B2B", address: "Test" });
    const demoContractId = genId();
    await db.insert(contracts).values({ id: demoContractId, tenantId: demoTenant!.id, customerId: demoCustomerId, contractNumber: `MV-DEMO-${genId().slice(0, 6)}`, type: "ONE_TIME_TRIP_COUNT", status: "DRAFT", appliesToAllSites: true, totalTripsPurchased: 5, tripsUsed: 0, startDate: new Date("2026-01-01") });
    await db.insert(plannedContractDemands).values({ id: genId(), tenantId: demoTenant!.id, contractId: demoContractId, customerId: demoCustomerId, plannedDate: new Date("2026-02-01") });
    const { GET: getDemands } = await import("@/app/api/planned-contract-demands/route");
    const rows = await (await getDemands(makeRequest("/api/planned-contract-demands", { cookie: riyadhAdminCookie }))).json();
    expect(rows.some((r: any) => r.contractId === demoContractId)).toBe(false);
  });

  it("no passwordHash exposure in either route's response", async () => {
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const contract = await db.query.contracts.findFirst({ where: eq(contracts.tenantId, tenant!.id) });
    const { GET: getSchedules } = await import("@/app/api/contracts/[id]/delivery-schedules/route");
    const { GET: getDemands } = await import("@/app/api/planned-contract-demands/route");
    const scheduleText = await (await getSchedules(makeRequest(`/api/contracts/${contract!.id}/delivery-schedules`, { cookie: adminCookie }), { params: { id: contract!.id } })).text();
    const demandText = await (await getDemands(makeRequest("/api/planned-contract-demands", { cookie: adminCookie }))).text();
    expect(scheduleText).not.toContain("passwordHash");
    expect(demandText).not.toContain("passwordHash");
  });
});

describe("Regression protection (Milestone V.1) — nothing about generation, conversion, dispatch, or billing exists or was touched", () => {
  it("no generation, conversion, or scheduler code exists anywhere in the two new route files", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const scheduleSource = fs.readFileSync(path.join(process.cwd(), "app/api/contracts/[id]/delivery-schedules/route.ts"), "utf8");
    const demandSource = fs.readFileSync(path.join(process.cwd(), "app/api/planned-contract-demands/route.ts"), "utf8");
    expect(scheduleSource).not.toContain("POST");
    expect(scheduleSource).not.toContain("PATCH");
    expect(demandSource).not.toContain("POST");
    expect(demandSource).not.toContain("PATCH");
  });

  it("Task P.2 contract-priced invoice behavior is completely unaffected by this schema addition", async () => {
    const { createIsolatedDriverAndVehicle } = await import("../helpers/testFixtures");
    const { contractPricingRules, warehouses } = await import("@/lib/db/schema");
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const tenantId = tenant!.id;
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const warehouse = await db.query.warehouses.findFirst({ where: eq(warehouses.tenantId, tenantId) });
    const customerId = genId();
    await db.insert(customers).values({ id: customerId, tenantId, name: "MV Regression Customer", type: "B2B", address: "Test", lat: 24.7, lng: 46.7 });
    const contractId = genId();
    await db.insert(contracts).values({ id: contractId, tenantId, customerId, contractNumber: `MV-${genId().slice(0, 8)}`, type: "ONE_TIME_TRIP_COUNT", status: "ACTIVE", appliesToAllSites: true, totalTripsPurchased: 5, tripsUsed: 0, startDate: new Date("2020-01-01") });
    await db.insert(contractPricingRules).values({ id: genId(), tenantId, pricingScope: "CONTRACT", contractId, rateType: "STANDARD", pricePerTrip: 500, vatRate: 0.15 });
    const { POST: createOrder } = await import("@/app/api/orders/route");
    const order = await (await createOrder(makeRequest("/api/orders", { method: "POST", cookie: adminCookie, body: { customerId, contractId, qtyOrdered: 1, emptyBottlesToCollect: 0, paymentMethod: "CASH" } }))).json();
    const isolated = await createIsolatedDriverAndVehicle(tenantId, `mv-e2e-${genId().slice(0, 6)}`);
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
});
