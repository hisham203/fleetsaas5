import { describe, it, expect } from "vitest";
import { makeRequest, loginAs } from "../helpers/request";
import { db } from "@/lib/db/client";
import { contracts, contractPricingRules, customerLocations, customers, invoices } from "@/lib/db/schema";
import { genId } from "@/lib/helpers";
import { eq } from "drizzle-orm";
import { createIsolatedDriverAndVehicle } from "../helpers/testFixtures";

// Task E.1 — Billing Reporting & Invoice Path Reconciliation Audit. Tests
// only the real bug found (a passwordHash exposure the S1/S2 sweep
// couldn't have caught, since it's a direct query, not an eager-load
// embed) and the two most important "does this actually reconcile both
// invoice paths correctly" guarantees: no double-counting in scorecards
// or the Executive Dashboard when both invoice types genuinely coexist
// for the same tenant/driver.
describe("Billing reconciliation audit (Task E.1)", () => {
  it("1. customer statement never exposes passwordHash, even though it fetches the customer directly (not via an embed)", async () => {
    const jarirPortalCookie = await loginAs("portal@jarir-demo.co", "password123");
    const jarir = await db.query.customers.findFirst({ where: eq(customers.loginEmail, "portal@jarir-demo.co") });

    const { GET } = await import("@/app/api/customers/[id]/statement/route");
    const res = await GET(makeRequest(`/api/customers/${jarir!.id}/statement`, { cookie: jarirPortalCookie }), { params: { id: jarir!.id } });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("passwordHash");

    // Confirm the fix is a real allowlist, not an accidental over-removal —
    // creditLimit is genuinely needed here and must still work.
    const body = JSON.parse(text);
    expect(body.customer.creditLimit).toBe(5000);
    expect(body.creditLimit).toBe(5000);
    expect(body.customer.name).toBe("Jarir Bookstore HQ");
  });

  it("2. GET /api/invoices distinguishes SINGLE_ORDER from MONTHLY_CONSOLIDATED with an explicit invoiceType and lineItemsCount", async () => {
    const waterAdminCookie = await loginAs("admin@demo-water.co", "password123");
    const { GET: tenantGet } = await import("@/app/api/tenant/route");
    const tenantId = (await (await tenantGet(makeRequest("/api/tenant", { cookie: waterAdminCookie }))).json()).id;

    // A dedicated, isolated B2B customer — this file creates several
    // orders/deliveries, and reusing a real seeded customer risks the
    // exact credit-limit cross-test-file interference already found and
    // fixed in Task E.
    const testCustomerId = genId();
    await db.insert(customers).values({ id: testCustomerId, tenantId, name: "E.1 Audit Customer", type: "B2B", address: "Test Address, Riyadh", lat: 24.7, lng: 46.7 });

    const { GET: warehousesGet } = await import("@/app/api/warehouses/route");
    const warehouseId = (await (await warehousesGet(makeRequest("/api/warehouses", { cookie: waterAdminCookie }))).json()).find((w: any) => w.isDefault).id;

    // A normal single-order delivery.
    const { POST: createOrder } = await import("@/app/api/orders/route");
    const plainOrder = await (await createOrder(makeRequest("/api/orders", {
      method: "POST", cookie: waterAdminCookie,
      body: { customerId: testCustomerId, qtyOrdered: 1, emptyBottlesToCollect: 1, paymentMethod: "CASH" },
    }))).json();
    const isolated = await createIsolatedDriverAndVehicle(tenantId, "e1-single-order");
    const { POST: createTrip } = await import("@/app/api/trips/route");
    const trip = await (await createTrip(makeRequest("/api/trips", {
      method: "POST", cookie: waterAdminCookie,
      body: { driverId: isolated.driverId, vehicleId: isolated.vehicleId, warehouseId, orderIds: [plainOrder.id] },
    }))).json();
    const { PATCH: confirmLoading } = await import("@/app/api/trips/[id]/loading/route");
    await confirmLoading(makeRequest(`/api/trips/${trip.id}/loading`, { method: "PATCH", cookie: waterAdminCookie }), { params: { id: trip.id } });
    const { PATCH: tripAction } = await import("@/app/api/trips/[id]/route");
    await tripAction(makeRequest(`/api/trips/${trip.id}`, { method: "PATCH", cookie: waterAdminCookie, body: { action: "dispatch" } }), { params: { id: trip.id } });
    const stopId = trip.stops[0].id;
    const { PATCH: stopAction } = await import("@/app/api/trips/[id]/stops/[stopId]/route");
    await stopAction(makeRequest(`/api/trips/${trip.id}/stops/${stopId}`, { method: "PATCH", cookie: isolated.driverCookie, body: { action: "arrive" } }), { params: { id: trip.id, stopId } });
    await stopAction(
      makeRequest(`/api/trips/${trip.id}/stops/${stopId}`, { method: "PATCH", cookie: isolated.driverCookie, body: { action: "deliver", deliveredQty: 1, emptiesCollected: 1, recipientName: "Test" } }),
      { params: { id: trip.id, stopId } }
    );

    // A monthly consolidated delivery, for the same customer.
    const { POST: createContract } = await import("@/app/api/contracts/route");
    const { PATCH: patchContract } = await import("@/app/api/contracts/[id]/route");
    const contract = await (await createContract(makeRequest("/api/contracts", {
      method: "POST", cookie: waterAdminCookie,
      body: { customerId: testCustomerId, type: "MONTHLY_ACCUMULATED", billingCadence: "MONTHLY", startDate: "2020-01-01" },
    }))).json();
    await patchContract(makeRequest(`/api/contracts/${contract.id}`, { method: "PATCH", cookie: waterAdminCookie, body: { status: "ACTIVE" } }), { params: { id: contract.id } });
    await db.insert(contractPricingRules).values({ id: genId(), tenantId, pricingScope: "CONTRACT", contractId: contract.id, rateType: "STANDARD", pricePerTrip: 400, vatRate: 0.15 });

    const monthlyOrder = await (await createOrder(makeRequest("/api/orders", {
      method: "POST", cookie: waterAdminCookie,
      body: { customerId: testCustomerId, contractId: contract.id, qtyOrdered: 1, emptyBottlesToCollect: 1, paymentMethod: "CASH" },
    }))).json();
    const isolated2 = await createIsolatedDriverAndVehicle(tenantId, "e1-monthly-order");
    const trip2 = await (await createTrip(makeRequest("/api/trips", {
      method: "POST", cookie: waterAdminCookie,
      body: { driverId: isolated2.driverId, vehicleId: isolated2.vehicleId, warehouseId, orderIds: [monthlyOrder.id] },
    }))).json();
    await confirmLoading(makeRequest(`/api/trips/${trip2.id}/loading`, { method: "PATCH", cookie: waterAdminCookie }), { params: { id: trip2.id } });
    await tripAction(makeRequest(`/api/trips/${trip2.id}`, { method: "PATCH", cookie: waterAdminCookie, body: { action: "dispatch" } }), { params: { id: trip2.id } });
    const stopId2 = trip2.stops[0].id;
    await stopAction(makeRequest(`/api/trips/${trip2.id}/stops/${stopId2}`, { method: "PATCH", cookie: isolated2.driverCookie, body: { action: "arrive" } }), { params: { id: trip2.id, stopId: stopId2 } });
    await stopAction(
      makeRequest(`/api/trips/${trip2.id}/stops/${stopId2}`, { method: "PATCH", cookie: isolated2.driverCookie, body: { action: "deliver", deliveredQty: 1, emptiesCollected: 1, recipientName: "Test" } }),
      { params: { id: trip2.id, stopId: stopId2 } }
    );
    const { POST: generateInvoice } = await import("@/app/api/contracts/[id]/generate-monthly-invoice/route");
    const monthlyInvoiceRes = await generateInvoice(
      makeRequest(`/api/contracts/${contract.id}/generate-monthly-invoice`, { method: "POST", cookie: waterAdminCookie, body: { periodStart: "2020-01-01", periodEnd: "2030-01-01" } }),
      { params: { id: contract.id } }
    );
    const monthlyInvoice = await monthlyInvoiceRes.json();

    const { GET: invoicesGet } = await import("@/app/api/invoices/route");
    const listRes = await invoicesGet(makeRequest("/api/invoices", { cookie: waterAdminCookie }));
    expect(listRes.status).toBe(200);
    const list = await listRes.json();

    const singleOrderInvoice = list.find((i: any) => i.orderId === plainOrder.id);
    expect(singleOrderInvoice.invoiceType).toBe("SINGLE_ORDER");
    expect(singleOrderInvoice.lineItemsCount).toBe(0);

    const monthlyInvoiceInList = list.find((i: any) => i.id === monthlyInvoice.invoiceId);
    expect(monthlyInvoiceInList.invoiceType).toBe("MONTHLY_CONSOLIDATED");
    expect(monthlyInvoiceInList.lineItemsCount).toBe(1);
    expect(monthlyInvoiceInList.orderId).toBeNull();

    expect(JSON.stringify(list)).not.toContain("passwordHash");

    // 3/7. Credit notes work identically for a monthly invoice — never
    // touches .order, purely amount/id/customerId based.
    const { POST: createCreditNote } = await import("@/app/api/invoices/[id]/credit-notes/route");
    const creditRes = await createCreditNote(
      makeRequest(`/api/invoices/${monthlyInvoice.invoiceId}/credit-notes`, { method: "POST", cookie: waterAdminCookie, body: { amount: 50, reason: "Test credit on a monthly invoice" } }),
      { params: { id: monthlyInvoice.invoiceId } }
    );
    expect(creditRes.status).toBe(201);

    // 5. Scorecards correctly attribute revenue for BOTH the single-order
    // and the monthly-billed order, without double-counting either.
    const { computeDriverScorecards } = await import("@/lib/scorecards");
    const scorecards = await computeDriverScorecards(tenantId);
    const driver1Card = scorecards.find((s) => s.driverId === isolated.driverId);
    const driver2Card = scorecards.find((s) => s.driverId === isolated2.driverId);
    expect(driver1Card!.revenueCollectedSar).toBeCloseTo(singleOrderInvoice.total, 2);
    expect(driver2Card!.revenueCollectedSar).toBeCloseTo(400 * 1.15, 2); // the monthly line's own total, counted exactly once

    // Executive Dashboard revenue must equal invoices.total summed once —
    // never invoices.total PLUS invoice_line_items totals again.
    const { getExecutiveDashboard } = await import("@/lib/executiveDashboard");
    const dashboard = await getExecutiveDashboard(tenantId);
    const allInvoicesForTenant = await db.query.invoices.findMany({ where: eq((await import("@/lib/db/schema")).invoices.tenantId, tenantId) });
    const expectedTotal = allInvoicesForTenant.reduce((s, i) => s + i.total, 0);
    expect(dashboard.kpis.totalRevenueSar).toBeCloseTo(expectedTotal, 2);
  });

  it("6. customer statement includes a monthly consolidated invoice for that customer, not just single-order ones", async () => {
    const waterAdminCookie = await loginAs("admin@demo-water.co", "password123");
    const { GET: tenantGet } = await import("@/app/api/tenant/route");
    const tenantId = (await (await tenantGet(makeRequest("/api/tenant", { cookie: waterAdminCookie }))).json()).id;

    const testCustomerId = genId();
    await db.insert(customers).values({ id: testCustomerId, tenantId, name: "E.1 Statement Customer", type: "B2B", address: "Test Address, Riyadh", lat: 24.7, lng: 46.7 });

    const { POST: createContract } = await import("@/app/api/contracts/route");
    const { PATCH: patchContract } = await import("@/app/api/contracts/[id]/route");
    const contract = await (await createContract(makeRequest("/api/contracts", {
      method: "POST", cookie: waterAdminCookie,
      body: { customerId: testCustomerId, type: "MONTHLY_ACCUMULATED", billingCadence: "MONTHLY", startDate: "2020-01-01" },
    }))).json();
    await patchContract(makeRequest(`/api/contracts/${contract.id}`, { method: "PATCH", cookie: waterAdminCookie, body: { status: "ACTIVE" } }), { params: { id: contract.id } });
    await db.insert(contractPricingRules).values({ id: genId(), tenantId, pricingScope: "CONTRACT", contractId: contract.id, rateType: "STANDARD", pricePerTrip: 350, vatRate: 0.15 });

    const { GET: warehousesGet } = await import("@/app/api/warehouses/route");
    const warehouseId = (await (await warehousesGet(makeRequest("/api/warehouses", { cookie: waterAdminCookie }))).json()).find((w: any) => w.isDefault).id;
    const { POST: createOrder } = await import("@/app/api/orders/route");
    const order = await (await createOrder(makeRequest("/api/orders", {
      method: "POST", cookie: waterAdminCookie,
      body: { customerId: testCustomerId, contractId: contract.id, qtyOrdered: 1, emptyBottlesToCollect: 1, paymentMethod: "CASH" },
    }))).json();
    const isolated = await createIsolatedDriverAndVehicle(tenantId, "e1-statement-inclusion");
    const { POST: createTrip } = await import("@/app/api/trips/route");
    const trip = await (await createTrip(makeRequest("/api/trips", {
      method: "POST", cookie: waterAdminCookie,
      body: { driverId: isolated.driverId, vehicleId: isolated.vehicleId, warehouseId, orderIds: [order.id] },
    }))).json();
    const { PATCH: confirmLoading } = await import("@/app/api/trips/[id]/loading/route");
    await confirmLoading(makeRequest(`/api/trips/${trip.id}/loading`, { method: "PATCH", cookie: waterAdminCookie }), { params: { id: trip.id } });
    const { PATCH: tripAction } = await import("@/app/api/trips/[id]/route");
    await tripAction(makeRequest(`/api/trips/${trip.id}`, { method: "PATCH", cookie: waterAdminCookie, body: { action: "dispatch" } }), { params: { id: trip.id } });
    const stopId = trip.stops[0].id;
    const { PATCH: stopAction } = await import("@/app/api/trips/[id]/stops/[stopId]/route");
    await stopAction(makeRequest(`/api/trips/${trip.id}/stops/${stopId}`, { method: "PATCH", cookie: isolated.driverCookie, body: { action: "arrive" } }), { params: { id: trip.id, stopId } });
    await stopAction(
      makeRequest(`/api/trips/${trip.id}/stops/${stopId}`, { method: "PATCH", cookie: isolated.driverCookie, body: { action: "deliver", deliveredQty: 1, emptiesCollected: 1, recipientName: "Test" } }),
      { params: { id: trip.id, stopId } }
    );

    const { POST: generateInvoice } = await import("@/app/api/contracts/[id]/generate-monthly-invoice/route");
    const invoiceRes = await generateInvoice(
      makeRequest(`/api/contracts/${contract.id}/generate-monthly-invoice`, { method: "POST", cookie: waterAdminCookie, body: { periodStart: "2020-01-01", periodEnd: "2030-01-01" } }),
      { params: { id: contract.id } }
    );
    const monthlyInvoice = await invoiceRes.json();

    const { GET: statementGet } = await import("@/app/api/customers/[id]/statement/route");
    const statementRes = await statementGet(makeRequest(`/api/customers/${testCustomerId}/statement`, { cookie: waterAdminCookie }), { params: { id: testCustomerId } });
    expect(statementRes.status).toBe(200);
    const statement = await statementRes.json();
    const foundMonthlyInvoice = statement.invoices.find((i: any) => i.id === monthlyInvoice.invoiceId);
    expect(foundMonthlyInvoice).toBeTruthy(); // not silently excluded
    expect(foundMonthlyInvoice.orderId).toBeNull();
    expect(foundMonthlyInvoice.total).toBeCloseTo(monthlyInvoice.totalAmount, 2);
  });

  it("7/8. Executive Dashboard revenue counts each invoice exactly once — never invoice.total plus a separate invoice_line_items sum", async () => {
    const waterAdminCookie = await loginAs("admin@demo-water.co", "password123");
    const { GET: tenantGet } = await import("@/app/api/tenant/route");
    const tenantId = (await (await tenantGet(makeRequest("/api/tenant", { cookie: waterAdminCookie }))).json()).id;

    const { getExecutiveDashboard } = await import("@/lib/executiveDashboard");
    const before = await getExecutiveDashboard(tenantId);

    const testCustomerId = genId();
    await db.insert(customers).values({ id: testCustomerId, tenantId, name: "E.1 Dashboard Customer", type: "B2B", address: "Test Address, Riyadh", lat: 24.7, lng: 46.7 });
    const { POST: createContract } = await import("@/app/api/contracts/route");
    const { PATCH: patchContract } = await import("@/app/api/contracts/[id]/route");
    const contract = await (await createContract(makeRequest("/api/contracts", {
      method: "POST", cookie: waterAdminCookie,
      body: { customerId: testCustomerId, type: "MONTHLY_ACCUMULATED", billingCadence: "MONTHLY", startDate: "2020-01-01" },
    }))).json();
    await patchContract(makeRequest(`/api/contracts/${contract.id}`, { method: "PATCH", cookie: waterAdminCookie, body: { status: "ACTIVE" } }), { params: { id: contract.id } });
    await db.insert(contractPricingRules).values({ id: genId(), tenantId, pricingScope: "CONTRACT", contractId: contract.id, rateType: "STANDARD", pricePerTrip: 777, vatRate: 0.15 });

    const { GET: warehousesGet } = await import("@/app/api/warehouses/route");
    const warehouseId = (await (await warehousesGet(makeRequest("/api/warehouses", { cookie: waterAdminCookie }))).json()).find((w: any) => w.isDefault).id;
    const { POST: createOrder } = await import("@/app/api/orders/route");
    const order = await (await createOrder(makeRequest("/api/orders", {
      method: "POST", cookie: waterAdminCookie,
      body: { customerId: testCustomerId, contractId: contract.id, qtyOrdered: 1, emptyBottlesToCollect: 1, paymentMethod: "CASH" },
    }))).json();
    const isolated = await createIsolatedDriverAndVehicle(tenantId, "e1-dashboard-nodup");
    const { POST: createTrip } = await import("@/app/api/trips/route");
    const trip = await (await createTrip(makeRequest("/api/trips", {
      method: "POST", cookie: waterAdminCookie,
      body: { driverId: isolated.driverId, vehicleId: isolated.vehicleId, warehouseId, orderIds: [order.id] },
    }))).json();
    const { PATCH: confirmLoading } = await import("@/app/api/trips/[id]/loading/route");
    await confirmLoading(makeRequest(`/api/trips/${trip.id}/loading`, { method: "PATCH", cookie: waterAdminCookie }), { params: { id: trip.id } });
    const { PATCH: tripAction } = await import("@/app/api/trips/[id]/route");
    await tripAction(makeRequest(`/api/trips/${trip.id}`, { method: "PATCH", cookie: waterAdminCookie, body: { action: "dispatch" } }), { params: { id: trip.id } });
    const stopId = trip.stops[0].id;
    const { PATCH: stopAction } = await import("@/app/api/trips/[id]/stops/[stopId]/route");
    await stopAction(makeRequest(`/api/trips/${trip.id}/stops/${stopId}`, { method: "PATCH", cookie: isolated.driverCookie, body: { action: "arrive" } }), { params: { id: trip.id, stopId } });
    await stopAction(
      makeRequest(`/api/trips/${trip.id}/stops/${stopId}`, { method: "PATCH", cookie: isolated.driverCookie, body: { action: "deliver", deliveredQty: 1, emptiesCollected: 1, recipientName: "Test" } }),
      { params: { id: trip.id, stopId } }
    );
    const { POST: generateInvoice } = await import("@/app/api/contracts/[id]/generate-monthly-invoice/route");
    const invoiceRes = await generateInvoice(
      makeRequest(`/api/contracts/${contract.id}/generate-monthly-invoice`, { method: "POST", cookie: waterAdminCookie, body: { periodStart: "2020-01-01", periodEnd: "2030-01-01" } }),
      { params: { id: contract.id } }
    );
    const monthlyInvoice = await invoiceRes.json();

    const after = await getExecutiveDashboard(tenantId);
    // Exactly the size of the one new invoice's total — if line items were
    // ALSO being summed separately, this delta would be roughly double.
    expect(after.kpis.totalRevenueSar - before.kpis.totalRevenueSar).toBeCloseTo(monthlyInvoice.totalAmount, 2);
  });

  it("9/10. scorecards attribute monthly revenue exactly once, only via the invoice_line_items fallback path — never double-counted against a (nonexistent) direct invoice", async () => {
    const waterAdminCookie = await loginAs("admin@demo-water.co", "password123");
    const { GET: tenantGet } = await import("@/app/api/tenant/route");
    const tenantId = (await (await tenantGet(makeRequest("/api/tenant", { cookie: waterAdminCookie }))).json()).id;

    const testCustomerId = genId();
    await db.insert(customers).values({ id: testCustomerId, tenantId, name: "E.1 Scorecard Customer", type: "B2B", address: "Test Address, Riyadh", lat: 24.7, lng: 46.7 });
    const { POST: createContract } = await import("@/app/api/contracts/route");
    const { PATCH: patchContract } = await import("@/app/api/contracts/[id]/route");
    const contract = await (await createContract(makeRequest("/api/contracts", {
      method: "POST", cookie: waterAdminCookie,
      body: { customerId: testCustomerId, type: "MONTHLY_ACCUMULATED", billingCadence: "MONTHLY", startDate: "2020-01-01" },
    }))).json();
    await patchContract(makeRequest(`/api/contracts/${contract.id}`, { method: "PATCH", cookie: waterAdminCookie, body: { status: "ACTIVE" } }), { params: { id: contract.id } });
    await db.insert(contractPricingRules).values({ id: genId(), tenantId, pricingScope: "CONTRACT", contractId: contract.id, rateType: "STANDARD", pricePerTrip: 500, vatRate: 0.15 });

    const { GET: warehousesGet } = await import("@/app/api/warehouses/route");
    const warehouseId = (await (await warehousesGet(makeRequest("/api/warehouses", { cookie: waterAdminCookie }))).json()).find((w: any) => w.isDefault).id;
    const { POST: createOrder } = await import("@/app/api/orders/route");
    const order = await (await createOrder(makeRequest("/api/orders", {
      method: "POST", cookie: waterAdminCookie,
      body: { customerId: testCustomerId, contractId: contract.id, qtyOrdered: 1, emptyBottlesToCollect: 1, paymentMethod: "CASH" },
    }))).json();
    const isolated = await createIsolatedDriverAndVehicle(tenantId, "e1-scorecard-once");
    const { POST: createTrip } = await import("@/app/api/trips/route");
    const trip = await (await createTrip(makeRequest("/api/trips", {
      method: "POST", cookie: waterAdminCookie,
      body: { driverId: isolated.driverId, vehicleId: isolated.vehicleId, warehouseId, orderIds: [order.id] },
    }))).json();
    const { PATCH: confirmLoading } = await import("@/app/api/trips/[id]/loading/route");
    await confirmLoading(makeRequest(`/api/trips/${trip.id}/loading`, { method: "PATCH", cookie: waterAdminCookie }), { params: { id: trip.id } });
    const { PATCH: tripAction } = await import("@/app/api/trips/[id]/route");
    await tripAction(makeRequest(`/api/trips/${trip.id}`, { method: "PATCH", cookie: waterAdminCookie, body: { action: "dispatch" } }), { params: { id: trip.id } });
    const stopId = trip.stops[0].id;
    const { PATCH: stopAction } = await import("@/app/api/trips/[id]/stops/[stopId]/route");
    await stopAction(makeRequest(`/api/trips/${trip.id}/stops/${stopId}`, { method: "PATCH", cookie: isolated.driverCookie, body: { action: "arrive" } }), { params: { id: trip.id, stopId } });
    await stopAction(
      makeRequest(`/api/trips/${trip.id}/stops/${stopId}`, { method: "PATCH", cookie: isolated.driverCookie, body: { action: "deliver", deliveredQty: 1, emptiesCollected: 1, recipientName: "Test" } }),
      { params: { id: trip.id, stopId } }
    );
    // Before the monthly invoice is even generated: no direct invoice
    // exists for this order (Task E.1's delivery-route fix), so
    // scorecards must show ZERO revenue for it at this point — not a
    // silent undercount hiding a bug, a genuinely correct "not billed
    // yet" state.
    const { computeDriverScorecards } = await import("@/lib/scorecards");
    const before = await computeDriverScorecards(tenantId);
    const driverCardBefore = before.find((s) => s.driverId === isolated.driverId);
    expect(driverCardBefore!.revenueCollectedSar).toBe(0);

    const { POST: generateInvoice } = await import("@/app/api/contracts/[id]/generate-monthly-invoice/route");
    await generateInvoice(
      makeRequest(`/api/contracts/${contract.id}/generate-monthly-invoice`, { method: "POST", cookie: waterAdminCookie, body: { periodStart: "2020-01-01", periodEnd: "2030-01-01" } }),
      { params: { id: contract.id } }
    );

    const after = await computeDriverScorecards(tenantId);
    const driverCardAfter = after.find((s) => s.driverId === isolated.driverId);
    expect(driverCardAfter!.revenueCollectedSar).toBeCloseTo(500 * 1.15, 2); // counted exactly once, via the fallback
  });

  it("3. CRITICAL FIX: a MONTHLY_ACCUMULATED contract order gets NO invoice created at delivery time (prevents double-billing against the later monthly consolidated invoice)", async () => {
    const waterAdminCookie = await loginAs("admin@demo-water.co", "password123");
    const { GET: tenantGet } = await import("@/app/api/tenant/route");
    const tenantId = (await (await tenantGet(makeRequest("/api/tenant", { cookie: waterAdminCookie }))).json()).id;

    const testCustomerId = genId();
    await db.insert(customers).values({ id: testCustomerId, tenantId, name: "E.1 No-Double-Bill Customer", type: "B2B", address: "Test Address, Riyadh", lat: 24.7, lng: 46.7 });

    const { POST: createContract } = await import("@/app/api/contracts/route");
    const { PATCH: patchContract } = await import("@/app/api/contracts/[id]/route");
    const monthlyContract = await (await createContract(makeRequest("/api/contracts", {
      method: "POST", cookie: waterAdminCookie,
      body: { customerId: testCustomerId, type: "MONTHLY_ACCUMULATED", billingCadence: "MONTHLY", startDate: "2020-01-01" },
    }))).json();
    await patchContract(makeRequest(`/api/contracts/${monthlyContract.id}`, { method: "PATCH", cookie: waterAdminCookie, body: { status: "ACTIVE" } }), { params: { id: monthlyContract.id } });

    const oneTimeContract = await (await createContract(makeRequest("/api/contracts", {
      method: "POST", cookie: waterAdminCookie,
      body: { customerId: testCustomerId, type: "ONE_TIME_TRIP_COUNT", totalTripsPurchased: 5, startDate: "2020-01-01" },
    }))).json();
    await patchContract(makeRequest(`/api/contracts/${oneTimeContract.id}`, { method: "PATCH", cookie: waterAdminCookie, body: { status: "ACTIVE" } }), { params: { id: oneTimeContract.id } });
    // Task P.2: a real STANDARD pricing rule is now required for this
    // contract to be invoiceable at all — calculateContractPrice never
    // silently falls back to bottle pricing. A wildcard rule (no
    // city/zone/band/capacity) matches any delivery under this contract.
    await db.insert(contractPricingRules).values({
      id: genId(), tenantId, pricingScope: "CONTRACT", contractId: oneTimeContract.id, rateType: "STANDARD", pricePerTrip: 500, vatRate: 0.15,
    });

    const { GET: warehousesGet } = await import("@/app/api/warehouses/route");
    const warehouseId = (await (await warehousesGet(makeRequest("/api/warehouses", { cookie: waterAdminCookie }))).json()).find((w: any) => w.isDefault).id;
    const { POST: createOrder } = await import("@/app/api/orders/route");
    const { POST: createTrip } = await import("@/app/api/trips/route");
    const { PATCH: confirmLoading } = await import("@/app/api/trips/[id]/loading/route");
    const { PATCH: tripAction } = await import("@/app/api/trips/[id]/route");
    const { PATCH: stopAction } = await import("@/app/api/trips/[id]/stops/[stopId]/route");

    async function deliverAndReturn(contractId: string, label: string) {
      const order = await (await createOrder(makeRequest("/api/orders", {
        method: "POST", cookie: waterAdminCookie,
        body: { customerId: testCustomerId, contractId, qtyOrdered: 1, emptyBottlesToCollect: 1, paymentMethod: "CASH" },
      }))).json();
      const isolated = await createIsolatedDriverAndVehicle(tenantId, label);
      const trip = await (await createTrip(makeRequest("/api/trips", {
        method: "POST", cookie: waterAdminCookie,
        body: { driverId: isolated.driverId, vehicleId: isolated.vehicleId, warehouseId, orderIds: [order.id] },
      }))).json();
      await confirmLoading(makeRequest(`/api/trips/${trip.id}/loading`, { method: "PATCH", cookie: waterAdminCookie }), { params: { id: trip.id } });
      await tripAction(makeRequest(`/api/trips/${trip.id}`, { method: "PATCH", cookie: waterAdminCookie, body: { action: "dispatch" } }), { params: { id: trip.id } });
      const stopId = trip.stops[0].id;
      await stopAction(makeRequest(`/api/trips/${trip.id}/stops/${stopId}`, { method: "PATCH", cookie: isolated.driverCookie, body: { action: "arrive" } }), { params: { id: trip.id, stopId } });
      const deliverRes = await stopAction(
        makeRequest(`/api/trips/${trip.id}/stops/${stopId}`, { method: "PATCH", cookie: isolated.driverCookie, body: { action: "deliver", deliveredQty: 1, emptiesCollected: 1, recipientName: "Test" } }),
        { params: { id: trip.id, stopId } }
      );
      return { order, deliverBody: await deliverRes.json() };
    }

    const monthly = await deliverAndReturn(monthlyContract.id, "e1-nodup-monthly");
    expect(monthly.deliverBody.invoice ?? null).toBeNull(); // the fix: no invoice in the response at all
    const monthlyOrderInvoices = await db.query.invoices.findMany({ where: eq(invoices.orderId, monthly.order.id) });
    expect(monthlyOrderInvoices.length).toBe(0); // and none in the database either

    // Task P.2: ONE_TIME_TRIP_COUNT now gets a real contract-priced
    // invoice (500 SAR base from the rule above) instead of the old,
    // wrong bottle-priced one — still correctly not a double-bill.
    const oneTime = await deliverAndReturn(oneTimeContract.id, "e1-nodup-onetime");
    expect(oneTime.deliverBody.invoice).toBeTruthy();
    expect(oneTime.deliverBody.invoice.subtotal).toBe(500);
    expect(oneTime.deliverBody.billingError).toBeNull();
    const oneTimeOrderInvoices = await db.query.invoices.findMany({ where: eq(invoices.orderId, oneTime.order.id) });
    expect(oneTimeOrderInvoices.length).toBe(1);

    // A normal, non-contract order is completely unaffected either way.
    const { POST: createPlainOrder } = await import("@/app/api/orders/route");
    const plainOrder = await (await createPlainOrder(makeRequest("/api/orders", {
      method: "POST", cookie: waterAdminCookie,
      body: { customerId: testCustomerId, qtyOrdered: 1, emptyBottlesToCollect: 1, paymentMethod: "CASH" },
    }))).json();
    const isolated3 = await createIsolatedDriverAndVehicle(tenantId, "e1-nodup-plain");
    const trip3 = await (await createTrip(makeRequest("/api/trips", {
      method: "POST", cookie: waterAdminCookie,
      body: { driverId: isolated3.driverId, vehicleId: isolated3.vehicleId, warehouseId, orderIds: [plainOrder.id] },
    }))).json();
    await confirmLoading(makeRequest(`/api/trips/${trip3.id}/loading`, { method: "PATCH", cookie: waterAdminCookie }), { params: { id: trip3.id } });
    await tripAction(makeRequest(`/api/trips/${trip3.id}`, { method: "PATCH", cookie: waterAdminCookie, body: { action: "dispatch" } }), { params: { id: trip3.id } });
    const stopId3 = trip3.stops[0].id;
    await stopAction(makeRequest(`/api/trips/${trip3.id}/stops/${stopId3}`, { method: "PATCH", cookie: isolated3.driverCookie, body: { action: "arrive" } }), { params: { id: trip3.id, stopId: stopId3 } });
    const plainDeliverRes = await stopAction(
      makeRequest(`/api/trips/${trip3.id}/stops/${stopId3}`, { method: "PATCH", cookie: isolated3.driverCookie, body: { action: "deliver", deliveredQty: 1, emptiesCollected: 1, recipientName: "Test" } }),
      { params: { id: trip3.id, stopId: stopId3 } }
    );
    expect((await plainDeliverRes.json()).invoice).toBeTruthy();
  });
});
