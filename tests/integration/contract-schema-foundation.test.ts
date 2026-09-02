import { describe, it, expect } from "vitest";
import { pool, db } from "@/lib/db/client";
import { contracts, contractSites, contractPeriods, distanceBands, contractPricingRules, invoiceOrders, orders, customerLocations, invoices } from "@/lib/db/schema";
import { genId } from "@/lib/helpers";

// Contract Management A1 — Schema Foundation. This is a pure schema/
// migration test suite: no API route, UI, pricing engine, order/contract
// attachment logic, or monthly invoice generation exists yet (all
// explicitly out of scope for A1 — see the Contract Management Schema
// Design docs). These tests prove the migration applied correctly and,
// most importantly, that it changed NOTHING about the existing invoices
// table or existing invoice-generation behavior.
describe("Contract Management A1 — schema foundation", () => {
  it("all 6 new tables exist in the database", async () => {
    const result = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ANY($1)
    `, [["contracts", "contract_sites", "contract_periods", "distance_bands", "contract_pricing_rules", "invoice_orders"]]);
    const found = result.rows.map((r) => r.table_name).sort();
    expect(found).toEqual(["contract_periods", "contract_pricing_rules", "contract_sites", "contracts", "distance_bands", "invoice_orders"]);
  });

  it("tenant-scoped new tables (contracts, distance_bands, contract_pricing_rules) have a tenant_id column", async () => {
    for (const table of ["contracts", "distance_bands", "contract_pricing_rules"]) {
      const result = await pool.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND column_name = 'tenant_id'`,
        [table]
      );
      expect(result.rows.length, `${table} should have a tenant_id column`).toBe(1);
    }
  });

  it("contract_sites, contract_periods, and invoice_orders are correctly scoped transitively via a required parent FK column, matching the existing trip_stops convention (no direct tenant_id, scoped via trip_id)", async () => {
    const cases: [string, string][] = [
      ["contract_sites", "contract_id"],
      ["contract_periods", "contract_id"],
      ["invoice_orders", "invoice_id"],
    ];
    for (const [table, parentColumn] of cases) {
      const result = await pool.query(
        `SELECT is_nullable FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
        [table, parentColumn]
      );
      expect(result.rows.length, `${table}.${parentColumn} should exist`).toBe(1);
      expect(result.rows[0].is_nullable, `${table}.${parentColumn} should be NOT NULL — it's the scoping anchor`).toBe("NO");
    }
  });

  it("orders.contract_id exists and is nullable", async () => {
    const result = await pool.query(
      `SELECT is_nullable FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'contract_id'`
    );
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].is_nullable).toBe("YES");
  });

  it("customer_locations.city_code, zone_code, and distance_band_code all exist and are nullable", async () => {
    for (const column of ["city_code", "zone_code", "distance_band_code"]) {
      const result = await pool.query(
        `SELECT is_nullable FROM information_schema.columns WHERE table_name = 'customer_locations' AND column_name = $1`,
        [column]
      );
      expect(result.rows.length, `customer_locations.${column} should exist`).toBe(1);
      expect(result.rows[0].is_nullable, `customer_locations.${column} should be nullable`).toBe("YES");
    }
  });

  // The single most important test in this file: A1's explicit boundary was
  // "do not touch invoices.orderId, do not drop its unique constraint, do
  // not add invoices.contractPeriodId." This proves that boundary held.
  it("invoices.order_id remains NOT NULL and UNIQUE — untouched by this migration", async () => {
    const columnResult = await pool.query(
      `SELECT is_nullable FROM information_schema.columns WHERE table_name = 'invoices' AND column_name = 'order_id'`
    );
    expect(columnResult.rows[0].is_nullable).toBe("NO");

    const constraintResult = await pool.query(`
      SELECT tc.constraint_type FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
      WHERE tc.table_name = 'invoices' AND kcu.column_name = 'order_id' AND tc.constraint_type = 'UNIQUE'
    `);
    expect(constraintResult.rows.length, "invoices.order_id should still have a UNIQUE constraint").toBe(1);
  });

  it("invoices.contract_period_id does NOT exist — explicitly out of A1 scope", async () => {
    const result = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'invoices' AND column_name = 'contract_period_id'`
    );
    expect(result.rows.length).toBe(0);
  });

  it("invoice_orders exists but is empty — not populated by any current invoice generation path", async () => {
    const result = await pool.query(`SELECT count(*) FROM invoice_orders`);
    expect(Number(result.rows[0].count)).toBe(0);
  });

  // Proves A1 didn't just leave invoices structurally alone — it left the
  // actual generation BEHAVIOR alone too. Creates a real order, dispatches
  // and delivers it exactly as any existing test in this suite would, and
  // confirms exactly one invoice is created via the existing
  // one-order-one-invoice path, completely untouched by anything in A1.
  it("existing one-order-one-invoice generation behavior still works end to end, unaffected by A1", async () => {
    const { loginAs, makeRequest } = await import("../helpers/request");
    const dispatcherCookie = await loginAs("dispatch@demo-water.co", "password123");

    const { GET: customersGet } = await import("@/app/api/customers/route");
    const customers = await (await customersGet(makeRequest("/api/customers", { cookie: dispatcherCookie }))).json();
    const customer = customers.find((c: any) => c.name === "Al Malaz Family");

    const { POST: createOrder } = await import("@/app/api/orders/route");
    const order = await (
      await createOrder(makeRequest("/api/orders", {
        method: "POST",
        cookie: dispatcherCookie,
        body: { customerId: customer.id, qtyOrdered: 2, emptyBottlesToCollect: 2, paymentMethod: "CASH" },
      }))
    ).json();
    // A1 added orders.contractId as a new nullable column — confirm a
    // freshly created order (via the existing, unmodified order-creation
    // route) correctly leaves it null, since order/contract attachment
    // logic is explicitly not part of A1.
    expect(order.contractId ?? null).toBeNull();

    const { GET: driversGet } = await import("@/app/api/drivers/route");
    const driver = (await (await driversGet(makeRequest("/api/drivers", { cookie: dispatcherCookie }))).json()).find((d: any) => d.status === "AVAILABLE");
    const { GET: vehiclesGet } = await import("@/app/api/vehicles/route");
    const vehicle = (await (await vehiclesGet(makeRequest("/api/vehicles", { cookie: dispatcherCookie }))).json()).find((v: any) => v.status === "AVAILABLE");
    const { GET: warehousesGet } = await import("@/app/api/warehouses/route");
    const warehouse = (await (await warehousesGet(makeRequest("/api/warehouses", { cookie: dispatcherCookie }))).json()).find((w: any) => w.isDefault);

    const { POST: createTrip } = await import("@/app/api/trips/route");
    const trip = await (
      await createTrip(makeRequest("/api/trips", {
        method: "POST",
        cookie: dispatcherCookie,
        body: { driverId: driver.id, vehicleId: vehicle.id, warehouseId: warehouse.id, orderIds: [order.id] },
      }))
    ).json();

    const { PATCH: confirmLoading } = await import("@/app/api/trips/[id]/loading/route");
    await confirmLoading(makeRequest(`/api/trips/${trip.id}/loading`, { method: "PATCH", cookie: dispatcherCookie }), { params: { id: trip.id } });
    const { PATCH: tripAction } = await import("@/app/api/trips/[id]/route");
    await tripAction(makeRequest(`/api/trips/${trip.id}`, { method: "PATCH", cookie: dispatcherCookie, body: { action: "dispatch" } }), { params: { id: trip.id } });

    const { PATCH: stopAction } = await import("@/app/api/trips/[id]/stops/[stopId]/route");
    const deliverRes = await stopAction(
      makeRequest(`/api/trips/${trip.id}/stops/${trip.stops[0].id}`, {
        method: "PATCH",
        cookie: dispatcherCookie,
        body: { action: "deliver", deliveredQty: 2, emptiesCollected: 2, recipientName: "Test Recipient" },
      }),
      { params: { id: trip.id, stopId: trip.stops[0].id } }
    );
    const deliverBody = await deliverRes.json();

    expect(deliverBody.invoice).toBeTruthy();
    expect(deliverBody.invoice.orderId).toBe(order.id);

    // And directly at the database level: exactly one invoice for this
    // order, invoice_orders still uninvolved.
    const dbInvoices = await db.query.invoices.findMany({ where: (inv, { eq }) => eq(inv.orderId, order.id) });
    expect(dbInvoices.length).toBe(1);
    const dbInvoiceOrdersForThis = await db.query.invoiceOrders.findMany({ where: (io, { eq }) => eq(io.orderId, order.id) });
    expect(dbInvoiceOrdersForThis.length).toBe(0);
  });

  // Basic insert/read round-trips for the new tables — proving the schema
  // is genuinely usable (correct types, correct nullability), not just
  // present. Not testing any business logic, since none exists yet.
  it("a contract row can be inserted and read back with expected defaults", async () => {
    const { GET: tenantGet } = await import("@/app/api/tenant/route");
    const { loginAs, makeRequest } = await import("../helpers/request");
    const cookie = await loginAs("admin@demo-water.co", "password123");
    const tenantId = (await (await tenantGet(makeRequest("/api/tenant", { cookie }))).json()).id;

    const { GET: customersGet } = await import("@/app/api/customers/route");
    const customer = (await (await customersGet(makeRequest("/api/customers", { cookie }))).json())[0];

    const id = genId();
    await db.insert(contracts).values({
      id,
      tenantId,
      customerId: customer.id,
      contractNumber: `TEST-CONTRACT-${id.slice(0, 8)}`,
      type: "ONE_TIME_TRIP_COUNT",
      totalTripsPurchased: 10,
      startDate: new Date(),
    });

    const inserted = await db.query.contracts.findFirst({ where: (c, { eq }) => eq(c.id, id) });
    expect(inserted).toBeTruthy();
    expect(inserted!.status).toBe("DRAFT"); // default
    expect(inserted!.appliesToAllSites).toBe(true); // default
    expect(inserted!.tripsUsed).toBe(0); // default
  });

  it("a distance_bands row and a contract_pricing_rules row referencing it can both be inserted and read back", async () => {
    const { loginAs, makeRequest } = await import("../helpers/request");
    const { GET: tenantGet } = await import("@/app/api/tenant/route");
    const cookie = await loginAs("admin@demo-water.co", "password123");
    const tenantId = (await (await tenantGet(makeRequest("/api/tenant", { cookie }))).json()).id;

    const bandId = genId();
    await db.insert(distanceBands).values({
      id: bandId,
      tenantId,
      code: `TEST_BAND_${bandId.slice(0, 6)}`,
      fromKm: 0,
      toKm: 10,
      label: "Test band 0-10km",
    });

    const ruleId = genId();
    await db.insert(contractPricingRules).values({
      id: ruleId,
      tenantId,
      pricingScope: "TENANT_DEFAULT",
      rateType: "STANDARD",
      distanceBandCode: (await db.query.distanceBands.findFirst({ where: (d, { eq }) => eq(d.id, bandId) }))!.code,
      tankerCapacityLtr: 18000,
      pricePerTrip: 450,
    });

    const rule = await db.query.contractPricingRules.findFirst({ where: (r, { eq }) => eq(r.id, ruleId) });
    expect(rule).toBeTruthy();
    expect(rule!.contractId).toBeNull(); // TENANT_DEFAULT scope, no contract
    expect(rule!.pricePerTrip).toBe(450);
    expect(rule!.vatRate).toBe(0.15); // default
  });
});
