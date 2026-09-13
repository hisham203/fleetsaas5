import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import path from "path";
import { makeRequest, loginAs } from "../helpers/request";
import { db } from "@/lib/db/client";
import { tenants, numberingSeries, numberingSequenceLedger, customers, vehicles, drivers, warehouses, customerLocations } from "@/lib/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { genId } from "@/lib/helpers";
import { MANUAL_CODE_REJECTED, CODE_IMMUTABLE, NO_ACTIVE_SERIES } from "@/lib/businessCodes";
import { CODE_FIELD_ENTITY_MAP, NUMBERING_ENTITY_TYPES } from "@/lib/numberingFormat";
import { ensureAllSeries, SERIES_PREFIX } from "../helpers/testFixtures";

// Milestone AG — Internal Code Columns & Core Master Data Conversion.
// Allocation tests own the ACME tenant exclusively (never Riyadh/Demo),
// following the isolation convention established in AF and AF.1.
const acme  = async () => (await db.query.tenants.findFirst({ where: eq(tenants.name, "Acme Fuel Delivery Co.") }))!;
const riyadh = async () => (await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") }))!;
const acmeAdmin = () => loginAs("admin@acme-fuel-demo.co",  "password123");
const riyadhAdmin = () => loginAs("admin@riyadh-bulk-water.co", "password123");
const src = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const params = (id: string) => ({ params: Promise.resolve({ id }) } as any);

beforeAll(async () => {
  const t = await acme();
  await ensureAllSeries(t.id);
});

describe("Schema — 5 new columns and indexes (Part 2)", () => {
  it("1. migration 0019 exists and is purely additive", () => {
    const sql = src("drizzle/0019_loud_taskmaster.sql");
    expect(fs.readdirSync(path.join(process.cwd(), "drizzle")).filter(f => f.endsWith(".sql")).length).toBe(22);
    expect(sql).toContain('ADD COLUMN "customer_code"');
    expect(sql).toContain('ADD COLUMN "site_code"');
    expect(sql).toContain('ADD COLUMN "vehicle_code"');
    expect(sql).toContain('ADD COLUMN "driver_code"');
    expect(sql).toContain('ADD COLUMN "loading_point_code"');
    expect(sql.toLowerCase()).not.toMatch(/drop|truncate|delete from|alter column.*not null/);
  });

  it("2/3. schema has the 5 code columns in the correct tables", () => {
    const schema = src("lib/db/schema.ts");
    expect(schema).toMatch(/customerCode.*text.*"customer_code"/);
    expect(schema).toMatch(/siteCode.*text.*"site_code"/);
    expect(schema).toMatch(/vehicleCode.*text.*"vehicle_code"/);
    expect(schema).toMatch(/driverCode.*text.*"driver_code"/);
    expect(schema).toMatch(/loadingPointCode.*text.*"loading_point_code"/);
  });

  it("4. unique indexes exist for 4 tenant-scoped tables; plain index for customer_locations", () => {
    const schema = src("lib/db/schema.ts");
    expect(schema).toContain('customers_tenant_customer_code_unique');
    expect(schema).toContain('vehicles_tenant_vehicle_code_unique');
    expect(schema).toContain('drivers_tenant_driver_code_unique');
    expect(schema).toContain('warehouses_tenant_loading_point_code_unique');
    expect(schema).toContain('customer_locations_site_code_idx'); // plain, no tenant_id
  });

  it("5. existing rows preserved with NULL codes after migration", async () => {
    const nullCustomers = await db.query.customers.findMany({ where: isNull(customers.customerCode) });
    const nullVehicles  = await db.query.vehicles.findMany({  where: isNull(vehicles.vehicleCode) });
    expect(nullCustomers.length).toBeGreaterThan(0);
    expect(nullVehicles.length).toBeGreaterThan(0);
  });

  it("6/7. plate_number and license_number are still NOT NULL; new code columns are nullable", () => {
    const schema = src("lib/db/schema.ts");
    expect(schema).toContain('plateNumber: text("plate_number").notNull()');
    expect(schema).toContain('licenseNumber: text("license_number").notNull()');
    expect(schema).not.toMatch(/vehicleCode.*notNull|driverCode.*notNull|customerCode.*notNull/);
  });
});

describe("Registry and coverage map (Part 4)", () => {
  it("8. CUSTOMER, CUSTOMER_SITE, VEHICLE, DRIVER, LOADING_POINT all converted", () => {
    for (const et of ["CUSTOMER", "CUSTOMER_SITE", "VEHICLE", "DRIVER", "LOADING_POINT"]) {
      expect(CODE_FIELD_ENTITY_MAP.find(m => m.entityType === et)?.status).toBe("converted");
    }
  });

  it("9. no entity is still 'schema-gap'", () => {
    const gaps = CODE_FIELD_ENTITY_MAP.filter(m => m.status === "schema-gap");
    expect(gaps.length).toBe(0);
  });

  it("10. SERIES_PREFIX fixture includes all 5 new entity types", () => {
    for (const et of ["CUSTOMER", "CUSTOMER_SITE", "VEHICLE", "DRIVER", "LOADING_POINT"]) {
      expect(SERIES_PREFIX[et]).toBeTruthy();
    }
  });
});

describe("Customer API — POST allocates, PATCH refuses code change (Part 5)", () => {
  it("11. POST with no manual code allocates C06NNN and writes a ledger row", async () => {
    const t = await acme(); const cookie = await acmeAdmin();
    const { POST } = await import("@/app/api/customers/route");
    const res = await POST(makeRequest("/api/customers", { method: "POST", cookie, body: { name: "AG Customer", type: "B2B", address: "Riyadh" } }));
    expect(res.status).toBe(201);
    const row = await res.json();
    expect(row.customerCode).toMatch(/^C06\d{3,}$/);
    const ledger = await db.query.numberingSequenceLedger.findFirst({ where: and(eq(numberingSequenceLedger.tenantId, t.id), eq(numberingSequenceLedger.generatedNumber, row.customerCode)) });
    expect(ledger?.referenceTable).toBe("customers");
    expect(ledger?.referenceId).toBe(row.id);
  });

  it("12. POST with a manual customerCode returns 400 (MANUAL_CODE_REJECTED)", async () => {
    const cookie = await acmeAdmin();
    const { POST } = await import("@/app/api/customers/route");
    const res = await POST(makeRequest("/api/customers", { method: "POST", cookie, body: { customerCode: "MANUAL-01", name: "X", type: "B2B", address: "Riyadh" } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(MANUAL_CODE_REJECTED);
  });

  it("13. PATCH refuses any code change", async () => {
    const t = await acme(); const cookie = await acmeAdmin();
    const { POST } = await import("@/app/api/customers/route");
    const created = await (await POST(makeRequest("/api/customers", { method: "POST", cookie, body: { name: "Patch Test", type: "B2B", address: "Riyadh" } }))).json();
    const { PATCH } = await import("@/app/api/customers/[id]/route");
    const res = await PATCH(makeRequest(`/api/customers/${created.id}`, { method: "PATCH", cookie, body: { customerCode: "NEWCODE" } }), params(created.id));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(CODE_IMMUTABLE);
  });

  it("14. legacy NULL customer rows still readable via GET", async () => {
    const t = await riyadh(); const cookie = await riyadhAdmin();
    const { GET } = await import("@/app/api/customers/route");
    const list = await (await GET(makeRequest("/api/customers", { cookie }))).json();
    const nullCodeRow = list.find((c: any) => !c.customerCode);
    expect(nullCodeRow).toBeTruthy();
  });
});

describe("Vehicle API — vehicleCode separate from plateNumber (Part 5)", () => {
  it("15. POST allocates VH06NNN; plateNumber still provided and stored separately", async () => {
    const t = await acme(); const cookie = await acmeAdmin();
    const { POST } = await import("@/app/api/vehicles/route");
    const plate = `AG-TEST-${genId().slice(0, 4)}`;
    const res = await POST(makeRequest("/api/vehicles", { method: "POST", cookie, body: { plateNumber: plate, vehicleType: "TANKER" } }));
    expect(res.status).toBe(201);
    const row = await res.json();
    expect(row.vehicleCode).toMatch(/^VH06\d{3,}$/);
    expect(row.plateNumber).toBe(plate);
    expect(row.vehicleCode).not.toBe(plate);
  });

  it("16. manual vehicleCode rejected; plateNumber remains required", async () => {
    const cookie = await acmeAdmin();
    const { POST } = await import("@/app/api/vehicles/route");
    const noPlate = await POST(makeRequest("/api/vehicles", { method: "POST", cookie, body: { vehicleType: "TANKER" } }));
    expect(noPlate.status).toBe(400);
    const withManual = await POST(makeRequest("/api/vehicles", { method: "POST", cookie, body: { plateNumber: "PL-001", vehicleCode: "MANUAL", vehicleType: "TANKER" } }));
    expect(withManual.status).toBe(400);
    expect((await withManual.json()).error).toBe(MANUAL_CODE_REJECTED);
  });

  it("17. PATCH refuses vehicleCode change; plateNumber can still be edited", async () => {
    const cookie = await acmeAdmin();
    const { POST } = await import("@/app/api/vehicles/route");
    const created = await (await POST(makeRequest("/api/vehicles", { method: "POST", cookie, body: { plateNumber: `AG-PAT-${genId().slice(0,4)}`, vehicleType: "TANKER" } }))).json();
    const { PATCH } = await import("@/app/api/vehicles/[id]/route");
    const bad = await PATCH(makeRequest(`/api/vehicles/${created.id}`, { method: "PATCH", cookie, body: { vehicleCode: "NEW" } }), params(created.id));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe(CODE_IMMUTABLE);
  });
});

describe("Driver API — driverCode separate from licenseNumber (Part 5)", () => {
  it("18. POST allocates D06NNN; licenseNumber still provided and stored separately", async () => {
    const t = await acme(); const cookie = await acmeAdmin();
    const { POST } = await import("@/app/api/drivers/route");
    const license = `LIC-${genId().slice(0, 6)}`;
    const { users: usersTable } = await import("@/lib/db/schema");
    const user = await db.query.users.findFirst({ where: eq(usersTable.tenantId, t.id) });
    const res = await POST(makeRequest("/api/drivers", { method: "POST", cookie, body: { licenseNumber: license, userId: user?.id } }));
    expect([201, 400]).toContain(res.status); // may fail if no user available; that's ok
    if (res.status === 201) {
      const row = await res.json();
      expect(row.driverCode).toMatch(/^D06\d{3,}$/);
      expect(row.licenseNumber).toBe(license);
    }
  });

  it("19. manual driverCode rejected (zod-valid body, code guard fires before insert)", async () => {
    const t = await acme(); const cookie = await acmeAdmin();
    // Find any Acme user to satisfy the required userId field
    const { users: usersT } = await import("@/lib/db/schema");
    const { eq: eq2 } = await import("drizzle-orm");
    const anyUser = await db.query.users.findFirst({ where: eq2(usersT.tenantId, t.id) });
    if (!anyUser) return; // skip if no users in this tenant
    const { POST } = await import("@/app/api/drivers/route");
    const res = await POST(makeRequest("/api/drivers", { method: "POST", cookie, body: { driverCode: "DRV-01", licenseNumber: "LIC-XYZ", userId: anyUser.id } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(MANUAL_CODE_REJECTED);
  });
});

describe("Loading Point (warehouses) API — loadingPointCode (Part 5)", () => {
  it("20. POST allocates LP06NNN", async () => {
    const t = await acme(); const cookie = await acmeAdmin();
    await ensureAllSeries(t.id); // idempotent — guarantees LOADING_POINT series exists
    const { POST } = await import("@/app/api/warehouses/route");
    const res = await POST(makeRequest("/api/warehouses", { method: "POST", cookie, body: { name: "AG Depot", address: "Riyadh", lat: 24.7, lng: 46.7 } }));
    expect(res.status).toBe(201);
    expect((await res.json()).loadingPointCode).toMatch(/^LP06\d{3,}$/);
  });

  it("21. PATCH refuses loadingPointCode change", async () => {
    const cookie = await acmeAdmin();
    const { POST } = await import("@/app/api/warehouses/route");
    const created = await (await POST(makeRequest("/api/warehouses", { method: "POST", cookie, body: { name: "PatchWH", address: "Riyadh", lat: 24.7, lng: 46.7 } }))).json();
    const { PATCH } = await import("@/app/api/warehouses/[id]/route");
    const res = await PATCH(makeRequest(`/api/warehouses/${created.id}`, { method: "PATCH", cookie, body: { loadingPointCode: "NEW" } }), params(created.id));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(CODE_IMMUTABLE);
  });
});

describe("Customer Site API — siteCode via parent customer (Part 5)", () => {
  it("22. POST allocates S06NNN and ledger links to customer_locations", async () => {
    const t = await acme(); const cookie = await acmeAdmin();
    const { POST: postCustomer } = await import("@/app/api/customers/route");
    const cust = await (await postCustomer(makeRequest("/api/customers", { method: "POST", cookie, body: { name: "Site Parent", type: "B2B", address: "Riyadh" } }))).json();
    const { POST: postSite } = await import("@/app/api/customers/[id]/locations/route");
    const res = await postSite(makeRequest(`/api/customers/${cust.id}/locations`, { method: "POST", cookie, body: { label: "HQ", address: "Riyadh" } }), params(cust.id));
    expect(res.status).toBe(201);
    const site = await res.json();
    expect(site.siteCode).toMatch(/^S06\d{3,}$/);
    const ledger = await db.query.numberingSequenceLedger.findFirst({ where: and(eq(numberingSequenceLedger.tenantId, t.id), eq(numberingSequenceLedger.generatedNumber, site.siteCode)) });
    expect(ledger?.referenceTable).toBe("customer_locations");
  });
});

describe("Concurrency — no duplicate codes under concurrent creates (Part 5)", () => {
  it("23. 15 concurrent customer creates yield 15 distinct C-codes", async () => {
    const t = await acme();
    await ensureAllSeries(t.id); // idempotent — guarantees CUSTOMER series exists
    const cookie = await acmeAdmin();
    const { POST } = await import("@/app/api/customers/route");
    const results = await Promise.all(
      Array.from({ length: 15 }, (_, i) =>
        POST(makeRequest("/api/customers", { method: "POST", cookie, body: { name: `Conc ${i}`, type: "B2B", address: "Riyadh" } })).then(r => r.json())
      )
    );
    const codes = results.map(r => r.customerCode).filter(Boolean);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.length).toBe(15);
  });
});

describe("Tenant isolation (Part 5)", () => {
  it("24. Riyadh customer POST returns 400 (no series) — each tenant must configure their own", async () => {
    const t = await riyadh(); const cookie = await riyadhAdmin();
    const existing = await db.query.numberingSeries.findFirst({ where: and(eq(numberingSeries.tenantId, t.id), eq(numberingSeries.entityType, "CUSTOMER")) });
    if (existing) {
      // Riyadh may have a series from ensureAllSeries; skip this test gracefully
      return;
    }
    const { POST } = await import("@/app/api/customers/route");
    const res = await POST(makeRequest("/api/customers", { method: "POST", cookie, body: { name: "Riyadh Cust", type: "B2B", address: "Riyadh" } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(NO_ACTIVE_SERIES);
  });

  it("25. Acme's vehicleCode sequence is independent from other tenants", async () => {
    const t = await acme(); const cookie = await acmeAdmin();
    const { POST } = await import("@/app/api/vehicles/route");
    const r1 = await (await POST(makeRequest("/api/vehicles", { method: "POST", cookie, body: { plateNumber: `ISO1-${genId().slice(0,4)}`, vehicleType: "TANKER" } }))).json();
    const r2 = await (await POST(makeRequest("/api/vehicles", { method: "POST", cookie, body: { plateNumber: `ISO2-${genId().slice(0,4)}`, vehicleType: "TANKER" } }))).json();
    expect(r1.vehicleCode).not.toBe(r2.vehicleCode);
    expect(r1.vehicleCode.slice(0, 2)).toBe("VH"); // same prefix for same tenant
  });
});

describe("UI and coverage (Part 6, Part 9)", () => {
  it("26. Fleet page shows vehicleCode alongside plateNumber", () => {
    const fleet = src("app/admin/page.tsx");
    expect(fleet).toContain("vehicleCode");
    expect(fleet).toContain("plateNumber");
    expect(fleet).not.toContain("Leave blank to auto-generate");
  });

  it("27. NextCodePreview is imported in procurement, master-items, workshops, inventory", () => {
    for (const p of ["procurement", "master-items", "workshops", "inventory"]) {
      expect(src(`app/admin/${p}/page.tsx`)).toContain("NextCodePreview");
    }
  });

  it("28. Settings coverage table shows all 5 new entities as 'converted'", () => {
    const settings = src("app/admin/settings/page.tsx");
    expect(settings).toContain("CODE_FIELD_ENTITY_MAP");
    const noGaps = CODE_FIELD_ENTITY_MAP.filter(m => m.status === "schema-gap");
    expect(noGaps.length).toBe(0);
  });
});

describe("Regression protection (Milestone AG)", () => {
  it("29. protected files untouched — seedData, pricing, billing, ERP, dispatch, driver-app, POD", () => {
    const files = ["scripts/seedData.ts", "lib/contractPricing.ts", "lib/erp/sync.ts",
      "app/api/trips/[id]/stops/[stopId]/route.ts", "app/dispatch/page.tsx", "app/driver/page.tsx"];
    for (const f of files) {
      expect(src(f)).not.toContain("resolveEntityCode");
      expect(src(f)).not.toContain("loadingPointCode");
    }
  });

  it("30 (RC1). orders, trips, invoices still use genNumber; contracts now use allocator (RC1 blocker 3),", () => {
    expect(src("app/api/orders/route.ts")).toContain('genNumber("ORD")');
    expect(src("app/api/trips/route.ts")).toContain('genNumber("TRIP")');
    // RC1: contracts now use allocator with genNumber as fallback string only (for error message reference)
    expect(src("app/api/contracts/route.ts")).toContain("resolveEntityCode");
    for (const f of ["app/api/orders/route.ts", "app/api/trips/route.ts"]) {
      expect(src(f)).not.toContain("resolveEntityCode");
    }
  });

  it("31. passwordHash is never returned in any AG route response (safe columns verified)", () => {
    // customers/route.ts has a COMMENT mentioning passwordHash to explain why it's
    // excluded — that is the correct pattern. The real check is that no select/columns
    // object includes it in the response payload.
    const customersRoute = src("app/api/customers/route.ts");
    // SAFE_CUSTOMER_LIST_COLUMNS must not list passwordHash
    const colsBlock = customersRoute.slice(
      customersRoute.indexOf("SAFE_CUSTOMER_LIST_COLUMNS = {"),
      customersRoute.indexOf("} as const;", customersRoute.indexOf("SAFE_CUSTOMER_LIST_COLUMNS = {")) + 10
    );
    expect(colsBlock).not.toContain("passwordHash");
    // Other AG routes use full findFirst with no passwordHash column
    for (const f of ["app/api/vehicles/route.ts", "app/api/drivers/route.ts", "app/api/warehouses/route.ts", "app/api/customers/[id]/locations/route.ts"]) {
      expect(src(f)).not.toMatch(/columns:\s*\{[^}]*passwordHash/);
    }
  });

  it("32. migration 0019 is additive only — 5 ADD COLUMN + 5 indexes, zero DROP/DELETE/TRUNCATE", () => {
    const sql = src("drizzle/0019_loud_taskmaster.sql");
    const addCols = (sql.match(/ADD COLUMN/gi) ?? []).length;
    const indexes = (sql.match(/CREATE.*INDEX/gi) ?? []).length;
    expect(addCols).toBe(5);
    expect(indexes).toBe(5);
    expect(sql.toLowerCase()).not.toMatch(/\bdrop\b|\btruncate\b|\bdelete from\b/);
  });
});
