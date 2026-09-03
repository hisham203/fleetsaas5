import { describe, it, expect, beforeAll } from "vitest";
import { makeRequest, loginAs } from "../helpers/request";
import { db } from "@/lib/db/client";
import { contracts, contractPricingRules, contractPeriods, customerLocations, invoices, invoiceLineItems } from "@/lib/db/schema";
import { genId } from "@/lib/helpers";
import { eq, and } from "drizzle-orm";
import { createIsolatedDriverAndVehicle } from "../helpers/testFixtures";

// Task E — Manual Monthly Billing Foundation. Covers: schema (orderId
// nullable, still unique; contractPeriodId added), the manual billing
// route's success path and every eligibility rejection, real pricing
// engine usage (including capacity/location dimensions), transactional
// all-or-nothing behavior on a pricing failure, and the three A2 safety
// guards (settle-cash, ERP sync, scorecards revenue).
describe("Manual Monthly Billing (Task E)", () => {
  let waterAdminCookie: string;
  let acmeAdminCookie: string;
  let tenantId: string;
  let jarirId: string;
  let mainWarehouseId: string;
  let jarirLocationId: string;

  beforeAll(async () => {
    waterAdminCookie = await loginAs("admin@demo-water.co", "password123");
    acmeAdminCookie = await loginAs("admin@acme-fuel-demo.co", "password123");

    const { GET: tenantGet } = await import("@/app/api/tenant/route");
    tenantId = (await (await tenantGet(makeRequest("/api/tenant", { cookie: waterAdminCookie }))).json()).id;

    // A dedicated B2B customer + site for this file, not the seeded Jarir
    // Bookstore HQ — this file creates many orders across many test
    // cases, and Jarir has a real, finite credit limit (5000 SAR) that
    // other test files (credit-exposure.test.ts) genuinely depend on
    // being exactly that value. Using a customer with no credit limit at
    // all here avoids both problems: no risk of exhausting a real limit
    // mid-file, and no risk of interfering with another file's own
    // assumptions about a shared, seeded customer.
    const { customers, customerLocations: customerLocationsTable } = await import("@/lib/db/schema");
    jarirId = genId();
    await db.insert(customers).values({
      id: jarirId, tenantId, name: "Task E Test Customer", type: "B2B",
      address: "Test Address, Riyadh", lat: 24.7, lng: 46.7,
    });
    jarirLocationId = genId();
    await db.insert(customerLocationsTable).values({
      id: jarirLocationId, customerId: jarirId, label: "Test Site", address: "Test Address, Riyadh",
      cityCode: "RUH", zoneCode: "ZONE_MB", distanceBandCode: "BAND_MB",
    });

    const { GET: warehousesGet } = await import("@/app/api/warehouses/route");
    mainWarehouseId = (await (await warehousesGet(makeRequest("/api/warehouses", { cookie: waterAdminCookie }))).json()).find((w: any) => w.isDefault).id;
  });

  async function createMonthlyContract(overrides: { appliesToAllSites?: boolean } = {}) {
    const { POST: createContract } = await import("@/app/api/contracts/route");
    const { PATCH } = await import("@/app/api/contracts/[id]/route");
    const contract = await (await createContract(makeRequest("/api/contracts", {
      method: "POST", cookie: waterAdminCookie,
      body: { customerId: jarirId, type: "MONTHLY_ACCUMULATED", billingCadence: "MONTHLY", appliesToAllSites: overrides.appliesToAllSites ?? true, startDate: "2020-01-01" },
    }))).json();
    await PATCH(makeRequest(`/api/contracts/${contract.id}`, { method: "PATCH", cookie: waterAdminCookie, body: { status: "ACTIVE" } }), { params: { id: contract.id } });
    return contract.id;
  }

  // Full order -> trip -> delivery flow, returning the completed order.
  // completedAtOverride lets a test simulate a delivery that happened in
  // a specific (possibly past) period, since real delivery always stamps
  // "now".
  async function deliverContractOrder(contractId: string, opts: { locationId?: string; qtyOrdered?: number; completedAtOverride?: Date; label: string }) {
    const { POST: createOrder } = await import("@/app/api/orders/route");
    const order = await (await createOrder(makeRequest("/api/orders", {
      method: "POST", cookie: waterAdminCookie,
      body: { customerId: jarirId, contractId, locationId: opts.locationId, qtyOrdered: opts.qtyOrdered ?? 1, emptyBottlesToCollect: opts.qtyOrdered ?? 1, paymentMethod: "CASH" },
    }))).json();

    const isolated = await createIsolatedDriverAndVehicle(tenantId, opts.label);
    const { POST: createTrip } = await import("@/app/api/trips/route");
    const trip = await (await createTrip(makeRequest("/api/trips", {
      method: "POST", cookie: waterAdminCookie,
      body: { driverId: isolated.driverId, vehicleId: isolated.vehicleId, warehouseId: mainWarehouseId, orderIds: [order.id] },
    }))).json();

    const { PATCH: confirmLoading } = await import("@/app/api/trips/[id]/loading/route");
    await confirmLoading(makeRequest(`/api/trips/${trip.id}/loading`, { method: "PATCH", cookie: waterAdminCookie }), { params: { id: trip.id } });
    const { PATCH: tripAction } = await import("@/app/api/trips/[id]/route");
    await tripAction(makeRequest(`/api/trips/${trip.id}`, { method: "PATCH", cookie: waterAdminCookie, body: { action: "dispatch" } }), { params: { id: trip.id } });

    const stopId = trip.stops[0].id;
    const { PATCH: stopAction } = await import("@/app/api/trips/[id]/stops/[stopId]/route");
    await stopAction(makeRequest(`/api/trips/${trip.id}/stops/${stopId}`, { method: "PATCH", cookie: isolated.driverCookie, body: { action: "arrive" } }), { params: { id: trip.id, stopId } });
    await stopAction(
      makeRequest(`/api/trips/${trip.id}/stops/${stopId}`, { method: "PATCH", cookie: isolated.driverCookie, body: { action: "deliver", deliveredQty: opts.qtyOrdered ?? 1, emptiesCollected: opts.qtyOrdered ?? 1, recipientName: "Test" } }),
      { params: { id: trip.id, stopId } }
    );

    if (opts.completedAtOverride) {
      await db.update((await import("@/lib/db/schema")).orders).set({ completedAt: opts.completedAtOverride }).where(eq((await import("@/lib/db/schema")).orders.id, order.id));
    }
    return { orderId: order.id, vehicleId: isolated.vehicleId };
  }

  const PERIOD_START = new Date("2026-01-01T00:00:00Z");
  const PERIOD_END = new Date("2026-01-31T23:59:59Z");

  // ---------- Schema ----------

  it("1. existing single-order invoices still have a real, non-null orderId (spot check against seeded data)", async () => {
    const existing = await db.query.invoices.findFirst({ where: (i, { isNotNull }) => isNotNull(i.orderId) });
    expect(existing).toBeTruthy();
    expect(existing!.orderId).toBeTruthy();
  });

  it("2/3. invoices.orderId is nullable and still enforces uniqueness for non-null values", async () => {
    const id1 = genId();
    const id2 = genId();
    await db.insert(invoices).values({
      id: id1, tenantId, invoiceNumber: `TEST-NULL-${id1.slice(0, 6)}`, orderId: undefined, customerId: jarirId,
      subtotal: 100, vatAmount: 15, total: 115,
    });
    await db.insert(invoices).values({
      id: id2, tenantId, invoiceNumber: `TEST-NULL-${id2.slice(0, 6)}`, orderId: undefined, customerId: jarirId,
      subtotal: 200, vatAmount: 30, total: 230,
    });
    const both = await db.query.invoices.findMany({ where: (i, { inArray }) => inArray(i.id, [id1, id2]) });
    expect(both.length).toBe(2); // two NULL orderIds coexist fine
  });

  it("4. invoices.contractPeriodId exists (added by this task)", async () => {
    const { pool } = await import("@/lib/db/client");
    const result = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'invoices' AND column_name = 'contract_period_id'`);
    expect(result.rows.length).toBe(1);
  });

  // ---------- Manual billing success ----------

  it("5/6/7/8/9/10/11. generates a monthly invoice: creates period, invoice, line items, correct totals, period becomes INVOICED, correct response summary", async () => {
    const contractId = await createMonthlyContract();
    await db.insert(contractPricingRules).values({
      id: genId(), tenantId, pricingScope: "CONTRACT", contractId, rateType: "STANDARD", pricePerTrip: 500, vatRate: 0.15,
    });

    const d1 = await deliverContractOrder(contractId, { locationId: jarirLocationId, completedAtOverride: new Date("2026-01-10"), label: "e-success-1" });
    const d2 = await deliverContractOrder(contractId, { locationId: jarirLocationId, completedAtOverride: new Date("2026-01-20"), label: "e-success-2" });

    const { POST: generateInvoice } = await import("@/app/api/contracts/[id]/generate-monthly-invoice/route");
    const res = await generateInvoice(
      makeRequest(`/api/contracts/${contractId}/generate-monthly-invoice`, { method: "POST", cookie: waterAdminCookie, body: { periodStart: "2026-01-01", periodEnd: "2026-01-31" } }),
      { params: { id: contractId } }
    );
    expect(res.status).toBe(201);
    const body = await res.json();

    expect(body.ordersCount).toBe(2);
    expect(body.lineItemsCount).toBe(2);
    expect(body.subtotal).toBe(1000); // 2 x 500
    expect(body.vatAmount).toBeCloseTo(150, 2);
    expect(body.totalAmount).toBeCloseTo(1150, 2);
    expect(body.currency).toBe("SAR");

    const dbLineItems = await db.query.invoiceLineItems.findMany({ where: eq(invoiceLineItems.invoiceId, body.invoiceId) });
    expect(dbLineItems.length).toBe(2);
    const lineTotal = dbLineItems.reduce((s, li) => s + li.lineAmount + li.lineVatAmount, 0);
    expect(Math.round(lineTotal * 100) / 100).toBeCloseTo(body.totalAmount, 2);

    const period = await db.query.contractPeriods.findFirst({ where: eq(contractPeriods.id, body.contractPeriodId) });
    expect(period!.status).toBe("INVOICED");
    expect(period!.invoicedAt).toBeTruthy();
    expect(period!.invoicedByUserId).toBeTruthy();

    const dbInvoice = await db.query.invoices.findFirst({ where: eq(invoices.id, body.invoiceId) });
    expect(dbInvoice!.orderId).toBeNull();
    expect(dbInvoice!.contractPeriodId).toBe(body.contractPeriodId);
    expect(dbInvoice!.status).toBe("PENDING"); // never auto-marked paid
  });

  // ---------- Eligibility ----------

  it("12. rejects a ONE_TIME_TRIP_COUNT contract", async () => {
    const { POST: createContract } = await import("@/app/api/contracts/route");
    const oneTime = await (await createContract(makeRequest("/api/contracts", {
      method: "POST", cookie: waterAdminCookie,
      body: { customerId: jarirId, type: "ONE_TIME_TRIP_COUNT", totalTripsPurchased: 5, startDate: "2020-01-01" },
    }))).json();
    const { PATCH } = await import("@/app/api/contracts/[id]/route");
    await PATCH(makeRequest(`/api/contracts/${oneTime.id}`, { method: "PATCH", cookie: waterAdminCookie, body: { status: "ACTIVE" } }), { params: { id: oneTime.id } });

    const { POST: generateInvoice } = await import("@/app/api/contracts/[id]/generate-monthly-invoice/route");
    const res = await generateInvoice(
      makeRequest(`/api/contracts/${oneTime.id}/generate-monthly-invoice`, { method: "POST", cookie: waterAdminCookie, body: { periodStart: "2026-01-01", periodEnd: "2026-01-31" } }),
      { params: { id: oneTime.id } }
    );
    expect(res.status).toBe(422);
  });

  it("13. rejects an inactive (DRAFT) contract", async () => {
    const { POST: createContract } = await import("@/app/api/contracts/route");
    const draft = await (await createContract(makeRequest("/api/contracts", {
      method: "POST", cookie: waterAdminCookie,
      body: { customerId: jarirId, type: "MONTHLY_ACCUMULATED", billingCadence: "MONTHLY", startDate: "2020-01-01" },
    }))).json();

    const { POST: generateInvoice } = await import("@/app/api/contracts/[id]/generate-monthly-invoice/route");
    const res = await generateInvoice(
      makeRequest(`/api/contracts/${draft.id}/generate-monthly-invoice`, { method: "POST", cookie: waterAdminCookie, body: { periodStart: "2026-01-01", periodEnd: "2026-01-31" } }),
      { params: { id: draft.id } }
    );
    expect(res.status).toBe(422);
  });

  it("14. rejects a cross-tenant contract", async () => {
    const { POST: createContract } = await import("@/app/api/contracts/route");
    const acmeCustomers = await (await (await import("@/app/api/customers/route")).GET(makeRequest("/api/customers", { cookie: acmeAdminCookie }))).json();
    const acmeContract = await (await createContract(makeRequest("/api/contracts", {
      method: "POST", cookie: acmeAdminCookie,
      body: { customerId: acmeCustomers[0].id, type: "MONTHLY_ACCUMULATED", billingCadence: "MONTHLY", startDate: "2020-01-01" },
    }))).json();

    const { POST: generateInvoice } = await import("@/app/api/contracts/[id]/generate-monthly-invoice/route");
    const res = await generateInvoice(
      makeRequest(`/api/contracts/${acmeContract.id}/generate-monthly-invoice`, { method: "POST", cookie: waterAdminCookie, body: { periodStart: "2026-01-01", periodEnd: "2026-01-31" } }),
      { params: { id: acmeContract.id } }
    );
    expect(res.status).toBe(404);
  });

  it("15. rejects an invalid period (start after end)", async () => {
    const contractId = await createMonthlyContract();
    const { POST: generateInvoice } = await import("@/app/api/contracts/[id]/generate-monthly-invoice/route");
    const res = await generateInvoice(
      makeRequest(`/api/contracts/${contractId}/generate-monthly-invoice`, { method: "POST", cookie: waterAdminCookie, body: { periodStart: "2026-01-31", periodEnd: "2026-01-01" } }),
      { params: { id: contractId } }
    );
    expect(res.status).toBe(400);
  });

  it("16. rejects a period entirely outside the contract's date range", async () => {
    const { POST: createContract } = await import("@/app/api/contracts/route");
    const { PATCH } = await import("@/app/api/contracts/[id]/route");
    const contract = await (await createContract(makeRequest("/api/contracts", {
      method: "POST", cookie: waterAdminCookie,
      body: { customerId: jarirId, type: "MONTHLY_ACCUMULATED", billingCadence: "MONTHLY", startDate: "2020-01-01", endDate: "2020-12-31" },
    }))).json();
    await PATCH(makeRequest(`/api/contracts/${contract.id}`, { method: "PATCH", cookie: waterAdminCookie, body: { status: "ACTIVE" } }), { params: { id: contract.id } });

    const { POST: generateInvoice } = await import("@/app/api/contracts/[id]/generate-monthly-invoice/route");
    const res = await generateInvoice(
      makeRequest(`/api/contracts/${contract.id}/generate-monthly-invoice`, { method: "POST", cookie: waterAdminCookie, body: { periodStart: "2026-01-01", periodEnd: "2026-01-31" } }),
      { params: { id: contract.id } }
    );
    expect(res.status).toBe(422);
  });

  it("17/19/20/21/22. rejects when there are no billable orders, correctly excluding already-billed, out-of-period, non-delivered, and other-tenant/customer orders", async () => {
    const contractId = await createMonthlyContract();
    await db.insert(contractPricingRules).values({ id: genId(), tenantId, pricingScope: "CONTRACT", contractId, rateType: "STANDARD", pricePerTrip: 300, vatRate: 0.15 });

    const { POST: generateInvoice } = await import("@/app/api/contracts/[id]/generate-monthly-invoice/route");
    const emptyRes = await generateInvoice(
      makeRequest(`/api/contracts/${contractId}/generate-monthly-invoice`, { method: "POST", cookie: waterAdminCookie, body: { periodStart: "2026-02-01", periodEnd: "2026-02-28" } }),
      { params: { id: contractId } }
    );
    expect(emptyRes.status).toBe(422); // no orders in Feb at all

    // One order in Jan, one deliberately outside the Jan period (Feb, but the request below only asks for Jan).
    await deliverContractOrder(contractId, { completedAtOverride: new Date("2026-01-15"), label: "e-excl-jan" });
    await deliverContractOrder(contractId, { completedAtOverride: new Date("2026-03-15"), label: "e-excl-mar" });

    const janRes = await generateInvoice(
      makeRequest(`/api/contracts/${contractId}/generate-monthly-invoice`, { method: "POST", cookie: waterAdminCookie, body: { periodStart: "2026-01-01", periodEnd: "2026-01-31" } }),
      { params: { id: contractId } }
    );
    expect(janRes.status).toBe(201);
    expect((await janRes.json()).ordersCount).toBe(1); // only the Jan order, March one excluded

    // Re-running the same Jan period must reject — already invoiced.
    const repeatRes = await generateInvoice(
      makeRequest(`/api/contracts/${contractId}/generate-monthly-invoice`, { method: "POST", cookie: waterAdminCookie, body: { periodStart: "2026-01-01", periodEnd: "2026-01-31" } }),
      { params: { id: contractId } }
    );
    expect(repeatRes.status).toBe(422); // 18: already-invoiced period rejected
  });

  it("18. rejects generating an invoice for a period that's already been invoiced", async () => {
    const contractId = await createMonthlyContract();
    await db.insert(contractPricingRules).values({ id: genId(), tenantId, pricingScope: "CONTRACT", contractId, rateType: "STANDARD", pricePerTrip: 300, vatRate: 0.15 });
    await deliverContractOrder(contractId, { completedAtOverride: new Date("2026-01-15"), label: "e-already-invoiced" });

    const { POST: generateInvoice } = await import("@/app/api/contracts/[id]/generate-monthly-invoice/route");
    const first = await generateInvoice(
      makeRequest(`/api/contracts/${contractId}/generate-monthly-invoice`, { method: "POST", cookie: waterAdminCookie, body: { periodStart: "2026-01-01", periodEnd: "2026-01-31" } }),
      { params: { id: contractId } }
    );
    expect(first.status).toBe(201);

    const second = await generateInvoice(
      makeRequest(`/api/contracts/${contractId}/generate-monthly-invoice`, { method: "POST", cookie: waterAdminCookie, body: { periodStart: "2026-01-01", periodEnd: "2026-01-31" } }),
      { params: { id: contractId } }
    );
    expect(second.status).toBe(422);
  });

  // ---------- Pricing ----------

  it("23/24. uses the real pricing engine with real order location dimensions — a location-specific rule beats a wildcard", async () => {
    const contractId = await createMonthlyContract();
    await db.insert(contractPricingRules).values([
      { id: genId(), tenantId, pricingScope: "CONTRACT", contractId, rateType: "STANDARD", pricePerTrip: 200, vatRate: 0.15 },
      { id: genId(), tenantId, pricingScope: "CONTRACT", contractId, rateType: "STANDARD", cityCode: "RUH", zoneCode: "ZONE_MB", distanceBandCode: "BAND_MB", pricePerTrip: 650, vatRate: 0.15 },
    ]);
    await deliverContractOrder(contractId, { locationId: jarirLocationId, completedAtOverride: new Date("2026-01-05"), label: "e-loc-specific" });

    const { POST: generateInvoice } = await import("@/app/api/contracts/[id]/generate-monthly-invoice/route");
    const res = await generateInvoice(
      makeRequest(`/api/contracts/${contractId}/generate-monthly-invoice`, { method: "POST", cookie: waterAdminCookie, body: { periodStart: "2026-01-01", periodEnd: "2026-01-31" } }),
      { params: { id: contractId } }
    );
    const body = await res.json();
    expect(body.subtotal).toBe(650); // the specific rule, not the wildcard
  });

  it("25. uses the assigned vehicle's real capacity when available", async () => {
    const contractId = await createMonthlyContract();
    await db.insert(contractPricingRules).values([
      { id: genId(), tenantId, pricingScope: "CONTRACT", contractId, rateType: "STANDARD", pricePerTrip: 300, vatRate: 0.15 },
      { id: genId(), tenantId, pricingScope: "CONTRACT", contractId, rateType: "STANDARD", tankerCapacityLtr: 21000, pricePerTrip: 720, vatRate: 0.15 },
    ]);
    const { vehicleId } = await deliverContractOrder(contractId, { completedAtOverride: new Date("2026-01-05"), label: "e-capacity" });
    await db.update((await import("@/lib/db/schema")).vehicles).set({ capacityLiters: 21000 }).where((await import("@/lib/db/schema")).vehicles.id.eq ? undefined as any : eq((await import("@/lib/db/schema")).vehicles.id, vehicleId));

    const { POST: generateInvoice } = await import("@/app/api/contracts/[id]/generate-monthly-invoice/route");
    const res = await generateInvoice(
      makeRequest(`/api/contracts/${contractId}/generate-monthly-invoice`, { method: "POST", cookie: waterAdminCookie, body: { periodStart: "2026-01-01", periodEnd: "2026-01-31" } }),
      { params: { id: contractId } }
    );
    const body = await res.json();
    expect(body.subtotal).toBe(720); // the capacity-specific rule
  });

  it("26. a missing pricing rule fails the entire invoice generation, with zero rows written (no partial invoice)", async () => {
    const contractId = await createMonthlyContract(); // zero pricing rules
    await deliverContractOrder(contractId, { completedAtOverride: new Date("2026-01-05"), label: "e-no-rule" });

    const invoicesBefore = await db.query.invoices.findMany();
    const lineItemsBefore = await db.query.invoiceLineItems.findMany();

    const { POST: generateInvoice } = await import("@/app/api/contracts/[id]/generate-monthly-invoice/route");
    const res = await generateInvoice(
      makeRequest(`/api/contracts/${contractId}/generate-monthly-invoice`, { method: "POST", cookie: waterAdminCookie, body: { periodStart: "2026-01-01", periodEnd: "2026-01-31" } }),
      { params: { id: contractId } }
    );
    expect(res.status).toBe(422); // a clear, handled business-rule failure — never an unhandled exception

    const invoicesAfter = await db.query.invoices.findMany();
    const lineItemsAfter = await db.query.invoiceLineItems.findMany();
    expect(invoicesAfter.length).toBe(invoicesBefore.length); // nothing written
    expect(lineItemsAfter.length).toBe(lineItemsBefore.length);
    const period = await db.query.contractPeriods.findFirst({ where: and(eq(contractPeriods.contractId, contractId)) });
    expect(period?.status ?? "OPEN").not.toBe("INVOICED"); // period never marked invoiced either
  });

  it("28. VAT calculation is correct", async () => {
    const contractId = await createMonthlyContract();
    await db.insert(contractPricingRules).values({ id: genId(), tenantId, pricingScope: "CONTRACT", contractId, rateType: "STANDARD", pricePerTrip: 1000, vatRate: 0.15 });
    await deliverContractOrder(contractId, { completedAtOverride: new Date("2026-01-05"), label: "e-vat" });

    const { POST: generateInvoice } = await import("@/app/api/contracts/[id]/generate-monthly-invoice/route");
    const res = await generateInvoice(
      makeRequest(`/api/contracts/${contractId}/generate-monthly-invoice`, { method: "POST", cookie: waterAdminCookie, body: { periodStart: "2026-01-01", periodEnd: "2026-01-31" } }),
      { params: { id: contractId } }
    );
    const body = await res.json();
    expect(body.vatAmount).toBeCloseTo(150, 2);
    expect(body.totalAmount).toBeCloseTo(1150, 2);
  });

  // ---------- Safety ----------

  it("29. no passwordHash exposure in the response", async () => {
    const contractId = await createMonthlyContract();
    await db.insert(contractPricingRules).values({ id: genId(), tenantId, pricingScope: "CONTRACT", contractId, rateType: "STANDARD", pricePerTrip: 400, vatRate: 0.15 });
    await deliverContractOrder(contractId, { completedAtOverride: new Date("2026-01-05"), label: "e-security" });

    const { POST: generateInvoice } = await import("@/app/api/contracts/[id]/generate-monthly-invoice/route");
    const res = await generateInvoice(
      makeRequest(`/api/contracts/${contractId}/generate-monthly-invoice`, { method: "POST", cookie: waterAdminCookie, body: { periodStart: "2026-01-01", periodEnd: "2026-01-31" } }),
      { params: { id: contractId } }
    );
    expect(JSON.stringify(await res.json())).not.toContain("passwordHash");
  });

  it("33. settle-cash rejects a monthly (null-order) invoice with a clear 422, not a crash", async () => {
    const contractId = await createMonthlyContract();
    await db.insert(contractPricingRules).values({ id: genId(), tenantId, pricingScope: "CONTRACT", contractId, rateType: "STANDARD", pricePerTrip: 400, vatRate: 0.15 });
    await deliverContractOrder(contractId, { completedAtOverride: new Date("2026-01-05"), label: "e-settle-cash" });

    const { POST: generateInvoice } = await import("@/app/api/contracts/[id]/generate-monthly-invoice/route");
    const invoiceRes = await generateInvoice(
      makeRequest(`/api/contracts/${contractId}/generate-monthly-invoice`, { method: "POST", cookie: waterAdminCookie, body: { periodStart: "2026-01-01", periodEnd: "2026-01-31" } }),
      { params: { id: contractId } }
    );
    const { invoiceId } = await invoiceRes.json();

    const { POST: settleCash } = await import("@/app/api/invoices/[id]/settle-cash/route");
    const settleRes = await settleCash(makeRequest(`/api/invoices/${invoiceId}/settle-cash`, { method: "POST", cookie: waterAdminCookie }), { params: { id: invoiceId } });
    expect(settleRes.status).toBe(422);
    const settleBody = await settleRes.json();
    expect(settleBody.error).toContain("monthly consolidated invoice");
  });

  it("34. ERP sync rejects a monthly (null-order) invoice with a clear error, not a crash", async () => {
    // A real, enabled connection must exist first — otherwise
    // syncInvoiceToOdoo's own earlier "not configured" check fires
    // before ever reaching the null-order guard this test is for.
    // erp_connections.tenant_id is UNIQUE (one connection per tenant) and
    // persists beyond this test — cleaned up in a finally block so this
    // doesn't affect erp-sync.test.ts's own assumption (a fresh 201
    // create) about this same tenant's connection state, regardless of
    // which file runs first.
    const { erpConnections } = await import("@/lib/db/schema");
    const existingConnection = await db.query.erpConnections.findFirst({ where: eq(erpConnections.tenantId, tenantId) });
    const { POST: saveConnection } = await import("@/app/api/erp/connection/route");
    await saveConnection(makeRequest("/api/erp/connection", {
      method: "POST", cookie: waterAdminCookie,
      body: { baseUrl: "https://test-e-task.odoo.com", database: "test_db", username: "integration@test.co", apiKey: "supersecretapikey123" },
    }));

    try {
      const contractId = await createMonthlyContract();
      await db.insert(contractPricingRules).values({ id: genId(), tenantId, pricingScope: "CONTRACT", contractId, rateType: "STANDARD", pricePerTrip: 400, vatRate: 0.15 });
      await deliverContractOrder(contractId, { completedAtOverride: new Date("2026-01-05"), label: "e-erp" });

      const { POST: generateInvoice } = await import("@/app/api/contracts/[id]/generate-monthly-invoice/route");
      const invoiceRes = await generateInvoice(
        makeRequest(`/api/contracts/${contractId}/generate-monthly-invoice`, { method: "POST", cookie: waterAdminCookie, body: { periodStart: "2026-01-01", periodEnd: "2026-01-31" } }),
        { params: { id: contractId } }
      );
      const { invoiceId } = await invoiceRes.json();

      const { syncInvoiceToOdoo } = await import("@/lib/erp/sync");
      const result = await syncInvoiceToOdoo(tenantId, invoiceId);
      expect(result.success).toBe(false);
      expect(result.error).toContain("monthly consolidated");
    } finally {
      // Restore exactly what was there before this test — delete if
      // there wasn't one, otherwise leave the pre-existing row alone
      // (this test only ever creates a NEW one when none existed).
      if (!existingConnection) {
        await db.delete(erpConnections).where(eq(erpConnections.tenantId, tenantId));
      }
    }
  });

  it("35. Executive Dashboard revenue includes monthly invoice totals (sums invoices directly by tenant, no order join)", async () => {
    const { getExecutiveDashboard } = await import("@/lib/executiveDashboard");
    const before = await getExecutiveDashboard(tenantId);

    const contractId = await createMonthlyContract();
    await db.insert(contractPricingRules).values({ id: genId(), tenantId, pricingScope: "CONTRACT", contractId, rateType: "STANDARD", pricePerTrip: 999, vatRate: 0.15 });
    await deliverContractOrder(contractId, { completedAtOverride: new Date("2026-01-05"), label: "e-exec-dashboard" });
    const { POST: generateInvoice } = await import("@/app/api/contracts/[id]/generate-monthly-invoice/route");
    await generateInvoice(
      makeRequest(`/api/contracts/${contractId}/generate-monthly-invoice`, { method: "POST", cookie: waterAdminCookie, body: { periodStart: "2026-01-01", periodEnd: "2026-01-31" } }),
      { params: { id: contractId } }
    );

    const after = await getExecutiveDashboard(tenantId);
    expect(after.kpis.totalRevenueSar).toBeGreaterThan(before.kpis.totalRevenueSar);
  });

  it("30/31/32/36. existing non-contract flow, trip lifecycle, invoice listing, and single-order invoice_line_items behavior are all unaffected", async () => {
    const { POST: createOrder } = await import("@/app/api/orders/route");
    const plainOrder = await (await createOrder(makeRequest("/api/orders", {
      method: "POST", cookie: waterAdminCookie,
      body: { customerId: jarirId, qtyOrdered: 2, emptyBottlesToCollect: 2, paymentMethod: "CASH" },
    }))).json();
    expect(plainOrder.contractId ?? null).toBeNull();

    const isolated = await createIsolatedDriverAndVehicle(tenantId, "e-regression");
    const { POST: createTrip } = await import("@/app/api/trips/route");
    const trip = await (await createTrip(makeRequest("/api/trips", {
      method: "POST", cookie: waterAdminCookie,
      body: { driverId: isolated.driverId, vehicleId: isolated.vehicleId, warehouseId: mainWarehouseId, orderIds: [plainOrder.id] },
    }))).json();
    const { PATCH: confirmLoading } = await import("@/app/api/trips/[id]/loading/route");
    await confirmLoading(makeRequest(`/api/trips/${trip.id}/loading`, { method: "PATCH", cookie: waterAdminCookie }), { params: { id: trip.id } });
    const { PATCH: tripAction } = await import("@/app/api/trips/[id]/route");
    await tripAction(makeRequest(`/api/trips/${trip.id}`, { method: "PATCH", cookie: waterAdminCookie, body: { action: "dispatch" } }), { params: { id: trip.id } });
    const stopId = trip.stops[0].id;
    const { PATCH: stopAction } = await import("@/app/api/trips/[id]/stops/[stopId]/route");
    await stopAction(makeRequest(`/api/trips/${trip.id}/stops/${stopId}`, { method: "PATCH", cookie: isolated.driverCookie, body: { action: "arrive" } }), { params: { id: trip.id, stopId } });
    const deliverRes = await stopAction(
      makeRequest(`/api/trips/${trip.id}/stops/${stopId}`, { method: "PATCH", cookie: isolated.driverCookie, body: { action: "deliver", deliveredQty: 2, emptiesCollected: 2, recipientName: "Test" } }),
      { params: { id: trip.id, stopId } }
    );
    const deliverBody = await deliverRes.json();
    expect(deliverBody.invoice.orderId).toBe(plainOrder.id); // still the classic one-order-one-invoice path

    const lineItemsForThisOrder = await db.query.invoiceLineItems.findMany({ where: eq(invoiceLineItems.orderId, plainOrder.id) });
    expect(lineItemsForThisOrder.length).toBe(0); // invoice_line_items untouched by the normal delivery path

    const { GET: invoicesGet } = await import("@/app/api/invoices/route");
    const listRes = await invoicesGet(makeRequest("/api/invoices", { cookie: waterAdminCookie }));
    expect(listRes.status).toBe(200);
    const listText = await listRes.text();
    expect(() => JSON.parse(listText)).not.toThrow();
    expect(listText).not.toContain("passwordHash");
  });
});
