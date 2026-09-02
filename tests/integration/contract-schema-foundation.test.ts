import { describe, it, expect } from "vitest";
import { pool, db } from "@/lib/db/client";
import {
  contracts,
  contractSiteScope,
  contractPeriods,
  distanceBands,
  contractPricingRules,
  invoiceLineItems,
  orders,
  customerLocations,
  invoices,
} from "@/lib/db/schema";
import { genId } from "@/lib/helpers";

// Contract Management A1 + A1.5 — Schema Foundation, refined per the
// independent architecture review. Still schema-only: no API route, UI,
// pricing engine, order/contract attachment logic, or monthly invoice
// generation exists. This file replaces the original A1-only version,
// which referenced two tables A1.5 renamed/removed (`contract_sites` →
// `contract_site_scope`, `invoice_orders` → `invoice_line_items`) and
// would otherwise fail outright on import.
describe("Contract Management A1 + A1.5 — schema foundation", () => {
  it("all 6 current tables exist, and the two A1.5-superseded names are gone", async () => {
    const result = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ANY($1)
    `, [[
      "contracts", "contract_site_scope", "contract_periods", "distance_bands",
      "contract_pricing_rules", "invoice_line_items", "contract_sites", "invoice_orders",
    ]]);
    const found = result.rows.map((r) => r.table_name).sort();
    expect(found).toEqual([
      "contract_periods", "contract_pricing_rules", "contract_site_scope",
      "contracts", "distance_bands", "invoice_line_items",
    ]);
    expect(found).not.toContain("contract_sites");
    expect(found).not.toContain("invoice_orders");
  });

  it("tenant-scoped tables (contracts, distance_bands, contract_pricing_rules, contract_periods, invoice_line_items) all have a direct tenant_id column — A1.5 added it to the latter two", async () => {
    for (const table of ["contracts", "distance_bands", "contract_pricing_rules", "contract_periods", "invoice_line_items"]) {
      const result = await pool.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND column_name = 'tenant_id'`,
        [table]
      );
      expect(result.rows.length, `${table} should have a tenant_id column`).toBe(1);
    }
  });

  it("contract_site_scope is correctly scoped transitively via a required parent FK, matching the existing trip_stops convention", async () => {
    const result = await pool.query(
      `SELECT is_nullable FROM information_schema.columns WHERE table_name = 'contract_site_scope' AND column_name = 'contract_id'`
    );
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].is_nullable).toBe("NO");
  });

  it("orders.contract_id and orders.invoice_id both exist and are nullable — the latter is A1.5's denormalized pointer, deliberately left unpopulated by everything today", async () => {
    for (const column of ["contract_id", "invoice_id"]) {
      const result = await pool.query(
        `SELECT is_nullable FROM information_schema.columns WHERE table_name = 'orders' AND column_name = $1`,
        [column]
      );
      expect(result.rows.length, `orders.${column} should exist`).toBe(1);
      expect(result.rows[0].is_nullable, `orders.${column} should be nullable`).toBe("YES");
    }
    // And confirm it's genuinely unpopulated in real seeded data, not just
    // nullable in principle — no code writes to it yet.
    const populated = await pool.query(`SELECT count(*) FROM orders WHERE invoice_id IS NOT NULL`);
    expect(Number(populated.rows[0].count)).toBe(0);
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

  it("contract_periods no longer has an invoice_id column — A1.5's dual-ownership fix", async () => {
    const result = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'contract_periods' AND column_name = 'invoice_id'`
    );
    expect(result.rows.length).toBe(0);
  });

  it("contract_periods retains status, invoiced_at, and invoiced_by_user_id, and has a unique constraint preventing overlapping/duplicate periods", async () => {
    for (const column of ["status", "invoiced_at", "invoiced_by_user_id"]) {
      const result = await pool.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'contract_periods' AND column_name = $1`,
        [column]
      );
      expect(result.rows.length, `contract_periods.${column} should still exist`).toBe(1);
    }
    const constraint = await pool.query(`
      SELECT indexname FROM pg_indexes WHERE tablename = 'contract_periods' AND indexname = 'contract_periods_contract_period_unique'
    `);
    expect(constraint.rows.length).toBe(1);
  });

  it("distance_bands has immutability-support fields and a real DB-level unique constraint on (tenant_id, code)", async () => {
    for (const column of ["is_active", "retired_at", "replaced_by_distance_band_id"]) {
      const result = await pool.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'distance_bands' AND column_name = $1`,
        [column]
      );
      expect(result.rows.length, `distance_bands.${column} should exist`).toBe(1);
    }
    const constraint = await pool.query(`
      SELECT indexdef FROM pg_indexes WHERE tablename = 'distance_bands' AND indexname = 'distance_bands_tenant_code_unique'
    `);
    expect(constraint.rows.length, "distance_bands should have a real DB-level unique index on (tenant_id, code)").toBe(1);
    expect(constraint.rows[0].indexdef).toContain("UNIQUE");
  });

  it("contract_pricing_rules has the priority tie-breaker column and its lookup composite index", async () => {
    const priorityCol = await pool.query(
      `SELECT is_nullable FROM information_schema.columns WHERE table_name = 'contract_pricing_rules' AND column_name = 'priority'`
    );
    expect(priorityCol.rows.length).toBe(1);
    expect(priorityCol.rows[0].is_nullable).toBe("YES");

    const index = await pool.query(`
      SELECT indexdef FROM pg_indexes WHERE tablename = 'contract_pricing_rules' AND indexname = 'contract_pricing_rules_lookup_idx'
    `);
    expect(index.rows.length).toBe(1);
    expect(index.rows[0].indexdef).toContain("tenant_id");
    expect(index.rows[0].indexdef).toContain("pricing_scope");
  });

  it("invoice_line_items exists with frozen line fields, a nullable order_id, and correct indexes/constraints", async () => {
    const columns = await pool.query(
      `SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = 'invoice_line_items'`
    );
    const byName = Object.fromEntries(columns.rows.map((r) => [r.column_name, r.is_nullable]));
    expect(byName["invoice_id"]).toBe("NO");
    expect(byName["order_id"]).toBe("YES"); // the exact A1 defect this replaces: nullable from day one, for future non-order lines
    expect(byName["line_amount"]).toBe("NO"); // frozen amount, always required
    expect(byName["line_vat_amount"]).toBe("NO");
    expect(byName["description"]).toBe("YES");
    expect(byName["quantity"]).toBe("YES");
    expect(byName["unit_price"]).toBe("YES");

    const uniqueConstraint = await pool.query(`
      SELECT indexdef FROM pg_indexes WHERE tablename = 'invoice_line_items' AND indexname = 'invoice_line_items_invoice_order_unique'
    `);
    expect(uniqueConstraint.rows.length, "should prevent double-billing the same order onto one invoice").toBe(1);

    const indexes = await pool.query(`
      SELECT indexname FROM pg_indexes WHERE tablename = 'invoice_line_items' AND indexname IN ('invoice_line_items_invoice_idx', 'invoice_line_items_order_idx')
    `);
    expect(indexes.rows.length).toBe(2);
  });

  // The single most important test in this file, carried over unchanged in
  // intent from the original A1 suite: proves the entire A1.5 refactor —
  // dropping invoice_orders, adding invoice_line_items, touching
  // contract_periods/orders/distance_bands/contract_pricing_rules — left
  // the existing invoices table and existing billing behavior completely
  // untouched.
  it("invoices.order_id remains NOT NULL and UNIQUE, and invoices has no contract_period_id column — untouched by A1 or A1.5", async () => {
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

    const contractPeriodIdResult = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'invoices' AND column_name = 'contract_period_id'`
    );
    expect(contractPeriodIdResult.rows.length, "invoices.contract_period_id is A2 scope, not A1/A1.5 — must not exist yet").toBe(0);
  });

  it("invoice_line_items exists but is empty — not populated by any current invoice generation path", async () => {
    const result = await pool.query(`SELECT count(*) FROM invoice_line_items`);
    expect(Number(result.rows[0].count)).toBe(0);
  });

  // Proves A1.5 didn't just leave invoices structurally alone — it left
  // the actual generation BEHAVIOR alone too. Creates a real order,
  // dispatches and delivers it exactly as any existing test in this suite
  // would, and confirms exactly one invoice is created via the existing
  // one-order-one-invoice path, completely untouched.
  it("existing one-order-one-invoice generation behavior still works end to end, unaffected by A1 or A1.5", async () => {
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
    // orders.contractId and orders.invoiceId are both new nullable columns
    // (A1 and A1.5 respectively) — confirm a freshly created order via the
    // existing, unmodified order-creation route leaves both null, since
    // neither order/contract attachment nor invoice-pointer population is
    // in scope for any task so far.
    expect(order.contractId ?? null).toBeNull();
    expect(order.invoiceId ?? null).toBeNull();

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
    // order, invoice_line_items still uninvolved.
    const dbInvoices = await db.query.invoices.findMany({ where: (inv, { eq }) => eq(inv.orderId, order.id) });
    expect(dbInvoices.length).toBe(1);
    const dbLineItemsForThis = await db.query.invoiceLineItems.findMany({ where: (li, { eq }) => eq(li.orderId, order.id) });
    expect(dbLineItemsForThis.length).toBe(0);
  });

  // Basic insert/read round-trips for the new tables — proving the schema
  // is genuinely usable (correct types, correct defaults), not just
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

  it("a distance_bands row and a contract_pricing_rules row (with priority set) referencing it can both be inserted and read back", async () => {
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
    const band = await db.query.distanceBands.findFirst({ where: (d, { eq }) => eq(d.id, bandId) });
    expect(band!.isActive).toBe(true); // default

    const ruleId = genId();
    await db.insert(contractPricingRules).values({
      id: ruleId,
      tenantId,
      pricingScope: "TENANT_DEFAULT",
      rateType: "STANDARD",
      distanceBandCode: band!.code,
      tankerCapacityLtr: 18000,
      pricePerTrip: 450,
      priority: 10,
    });

    const rule = await db.query.contractPricingRules.findFirst({ where: (r, { eq }) => eq(r.id, ruleId) });
    expect(rule).toBeTruthy();
    expect(rule!.contractId).toBeNull(); // TENANT_DEFAULT scope, no contract
    expect(rule!.pricePerTrip).toBe(450);
    expect(rule!.vatRate).toBe(0.15); // default
    expect(rule!.priority).toBe(10);
  });

  it("a contract_site_scope row correctly rejects a duplicate (contractId, customerLocationId) pair", async () => {
    const { loginAs, makeRequest } = await import("../helpers/request");
    const { GET: tenantGet } = await import("@/app/api/tenant/route");
    const cookie = await loginAs("admin@demo-water.co", "password123");
    const tenantId = (await (await tenantGet(makeRequest("/api/tenant", { cookie }))).json()).id;

    const { GET: customersGet } = await import("@/app/api/customers/route");
    const jarir = (await (await customersGet(makeRequest("/api/customers", { cookie }))).json()).find((c: any) => c.name === "Jarir Bookstore HQ");
    const location = (await db.query.customerLocations.findFirst({ where: (l, { eq }) => eq(l.customerId, jarir.id) }))!;

    const contractId = genId();
    await db.insert(contracts).values({
      id: contractId,
      tenantId,
      customerId: jarir.id,
      contractNumber: `TEST-SCOPE-${contractId.slice(0, 8)}`,
      type: "MONTHLY_ACCUMULATED",
      appliesToAllSites: false,
      startDate: new Date(),
    });

    await db.insert(contractSiteScope).values({ id: genId(), contractId, customerLocationId: location.id });

    await expect(
      db.insert(contractSiteScope).values({ id: genId(), contractId, customerLocationId: location.id })
    ).rejects.toThrow();
  });
});
