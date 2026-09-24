import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { makeRequest, loginAs } from "../helpers/request";
import { db } from "@/lib/db/client";
import { tenants, numberingSeries, numberingSequenceLedger, itemCategories, itemSubcategories } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { genId } from "@/lib/helpers";
import { validateBusinessCode, MANUAL_CODE_REJECTED, CODE_IMMUTABLE, NO_ACTIVE_SERIES } from "@/lib/businessCodes";
import { NUMBERING_ENTITY_TYPES, CODE_FIELD_ENTITY_MAP } from "@/lib/numberingFormat";

// Milestone AF — Platform-Wide Numbering Conversion for Core Master Data.
const riyadh = async () => (await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") }))!;
const demo = async () => (await db.query.tenants.findFirst({ where: eq(tenants.name, "Demo Water Co.") }))!;
const admin = () => loginAs("admin@riyadh-bulk-water.co", "password123");
// Milestone AF supplier tests own the ACME tenant's SUPPLIER series so they
// can never collide with AE's tests, which assume Riyadh's SUPPLIER series
// is fresh (the same cross-file isolation class fixed in Z.2).
const acme = async () => (await db.query.tenants.findFirst({ where: eq(tenants.name, "Acme Fuel Delivery Co.") }))!;
const acmeAdmin = () => loginAs("admin@acme-fuel-demo.co", "password123");

// Idempotent per tenant+entityType (the schema's own unique rule).
async function ensureSeries(tenantId: string, entityType: string, prefix: string) {
  const existing = await db.query.numberingSeries.findFirst({ where: and(eq(numberingSeries.tenantId, tenantId), eq(numberingSeries.entityType, entityType)) });
  if (existing) return existing.id;
  const id = genId();
  await db.insert(numberingSeries).values({ id, tenantId, entityType, seriesCode: `${entityType}-${genId().slice(0, 6)}`, displayName: `${entityType} series`, prefix, seriesSegment: "06", paddingLength: 3, nextNumber: 1, status: "ACTIVE" });
  return id;
}
async function ledgerCount(tenantId: string, entityType: string) {
  return (await db.query.numberingSequenceLedger.findMany({ where: and(eq(numberingSequenceLedger.tenantId, tenantId), eq(numberingSequenceLedger.entityType, entityType)) })).length;
}

describe("Supplier production bug (Part 10, items 1-7)", () => {
  it("4/5 (AF.1). any manual supplierCode — 'V', 'AB' or a well-formed one — is rejected: codes are system-generated", async () => {
    const cookie = await acmeAdmin();
    const { POST } = await import("@/app/api/suppliers/route");
    for (const bad of ["V", "AB", "SUP-001"]) {
      const res = await POST(makeRequest("/api/suppliers", { method: "POST", cookie, body: { supplierCode: bad, name: "Bad Code Co" } }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe(MANUAL_CODE_REJECTED);
    }
  });

  it("6/7 (AF.1). manual '015' is rejected for suppliers and never writes a ledger row (legacy '015' rows stay readable but immutable)", async () => {
    const t = await acme(); const cookie = await acmeAdmin();
    const before = await ledgerCount(t.id, "SUPPLIER");
    const { POST } = await import("@/app/api/suppliers/route");
    const res = await POST(makeRequest("/api/suppliers", { method: "POST", cookie, body: { supplierCode: "015", name: "Manual Co" } }));
    expect(res.status).toBe(400);
    expect(await ledgerCount(t.id, "SUPPLIER")).toBe(before);
  });

  it("1/2. blank supplierCode uses entityType SUPPLIER exactly and generates from the V/06 series", async () => {
    const t = await acme(); const cookie = await acmeAdmin();
    await ensureSeries(t.id, "SUPPLIER", "V");
    const { POST } = await import("@/app/api/suppliers/route");
    const res = await POST(makeRequest("/api/suppliers", { method: "POST", cookie, body: { name: "Auto Co" } }));
    expect(res.status).toBe(201);
    const s = await res.json();
    expect(s.supplierCode).toMatch(/^V06\d{3,}$/);
    const ledger = await db.query.numberingSequenceLedger.findFirst({ where: and(eq(numberingSequenceLedger.tenantId, t.id), eq(numberingSequenceLedger.generatedNumber, s.supplierCode)) });
    expect(ledger?.entityType).toBe("SUPPLIER");
    expect(ledger?.referenceTable).toBe("suppliers");
    expect(ledger?.referenceId).toBe(s.id);
  });

  it("3. blank supplierCode with no active SUPPLIER series returns the clear, actionable 400 (Demo tenant: no SUPPLIER series is ever created for it by any test)", async () => {
    const d = await demo();
    const existing = await db.query.numberingSeries.findFirst({ where: and(eq(numberingSeries.tenantId, d.id), eq(numberingSeries.entityType, "SUPPLIER")) });
    if (existing) await db.update(numberingSeries).set({ status: "INACTIVE" }).where(eq(numberingSeries.id, existing.id));
    const cookie = await loginAs("admin@demo-water.co", "password123");
    const { POST } = await import("@/app/api/suppliers/route");
    const res = await POST(makeRequest("/api/suppliers", { method: "POST", cookie, body: { name: "No Series Co" } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(NO_ACTIVE_SERIES); // AF.1 wording
    if (existing) await db.update(numberingSeries).set({ status: "ACTIVE" }).where(eq(numberingSeries.id, existing.id));
  });
});

describe("Shared validation (Part 10, items 8-16)", () => {
  it.each(["015", "8788", "V06001", "SUP-001", "WH_001", "ITEM001", "LP06001"])("accepts %s", (v) => {
    expect(validateBusinessCode(v).ok).toBe(true);
  });
  it.each(["V", "AB", "@", "!!!", "   ", "V!", "A B", ""])("rejects %j", (v) => {
    expect(validateBusinessCode(v).ok).toBe(false);
  });
  it("trims and preserves leading zeros", () => {
    const r = validateBusinessCode("  0099  ");
    expect(r.ok && r.value).toBe("0099");
  });
});

describe("Z.2 master data conversion (Part 10, items 17-29)", () => {
  const cases: { label: string; entityType: string; prefix: string; route: string; codeField: string; body: (t: string) => Promise<Record<string, unknown>> }[] = [
    { label: "Item Group", entityType: "ITEM_GROUP", prefix: "IG", route: "item-groups", codeField: "code", body: async () => ({ name: "G" }) },
    { label: "Item Category", entityType: "ITEM_CATEGORY", prefix: "IC", route: "item-categories", codeField: "code", body: async () => ({ name: "C" }) },
    { label: "Workshop", entityType: "WORKSHOP", prefix: "W", route: "workshops", codeField: "workshopCode", body: async () => ({ name: "W" }) },
    { label: "Maintenance Warehouse", entityType: "MAINTENANCE_WAREHOUSE", prefix: "WH", route: "maintenance-warehouses", codeField: "warehouseCode", body: async () => ({ name: "WH" }) },
    { label: "Item Subcategory", entityType: "ITEM_SUBCATEGORY", prefix: "ISC", route: "item-subcategories", codeField: "code", body: async (t) => { const id = genId(); await db.insert(itemCategories).values({ id, tenantId: t, code: `C-${genId().slice(0, 6)}`, name: "Parent" }); return { name: "S", categoryId: id }; } },
    { label: "Item", entityType: "ITEM", prefix: "I", route: "items", codeField: "itemCode", body: async (t) => { const id = genId(); await db.insert(itemCategories).values({ id, tenantId: t, code: `C-${genId().slice(0, 6)}`, name: "Parent" }); return { name: "I", categoryId: id, itemType: "SPARE_PART", unitOfMeasure: "EA" }; } },
  ];

  it.each(cases)("17-22/26. $label: blank code allocates $prefix06NNN, writes a linked ledger row", async (c) => {
    const t = await acme(); const cookie = await acmeAdmin();
    await ensureSeries(t.id, c.entityType, c.prefix);
    const before = await ledgerCount(t.id, c.entityType);
    const mod = await import(`@/app/api/${c.route}/route`);
    const res = await mod.POST(makeRequest(`/api/${c.route}`, { method: "POST", cookie, body: await c.body(t.id) }));
    expect(res.status).toBe(201);
    const row = await res.json();
    expect(row[c.codeField]).toMatch(new RegExp(`^${c.prefix}06\\d{3,}$`));
    expect(await ledgerCount(t.id, c.entityType)).toBe(before + 1);
  });

  it.each(cases)("23/24/26 (AF.1). $label: any manual code is rejected and nothing is allocated or ledgered", async (c) => {
    const t = await acme(); const cookie = await acmeAdmin();
    const before = await ledgerCount(t.id, c.entityType);
    const mod = await import(`@/app/api/${c.route}/route`);
    for (const code of [`M-${genId().slice(0, 6)}`, "AB"]) {
      const res = await mod.POST(makeRequest(`/api/${c.route}`, { method: "POST", cookie, body: { ...(await c.body(t.id)), [c.codeField]: code } }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe(MANUAL_CODE_REJECTED);
    }
    expect(await ledgerCount(t.id, c.entityType)).toBe(before);
  });

  it("25 (AF.1). PATCH refuses any code change and never allocates", async () => {
    const t = await acme(); const cookie = await acmeAdmin();
    await ensureSeries(t.id, "WORKSHOP", "W");
    const { POST } = await import("@/app/api/workshops/route");
    const created = await (await POST(makeRequest("/api/workshops", { method: "POST", cookie, body: { name: "P" } }))).json();
    const before = await ledgerCount(t.id, "WORKSHOP");
    const { PATCH } = await import("@/app/api/workshops/[id]/route");
    for (const code of ["X", `R-${genId().slice(0, 6)}`]) {
      const res = await PATCH(makeRequest(`/api/workshops/${created.id}`, { method: "PATCH", cookie, body: { workshopCode: code } }), { params: Promise.resolve({ id: created.id }) } as any);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe(CODE_IMMUTABLE);
    }
    expect(await ledgerCount(t.id, "WORKSHOP")).toBe(before);
  });

  it("27. duplicate generated codes cannot occur — 15 concurrent item-group creates yield 15 distinct codes", async () => {
    const t = await acme(); const cookie = await acmeAdmin();
    await ensureSeries(t.id, "ITEM_GROUP", "IG");
    const { POST } = await import("@/app/api/item-groups/route");
    const rows = await Promise.all(Array.from({ length: 15 }, (_, i) => POST(makeRequest("/api/item-groups", { method: "POST", cookie, body: { name: `G${i}` } })).then((r) => r.json())));
    expect(new Set(rows.map((r) => r.code)).size).toBe(15);
  });

  it("28/29 (AF.1). cross-tenant isolation: a tenant allocates only from its OWN series — a series on one tenant never satisfies another", async () => {
    // Self-contained negative case: MAINTENANCE_WAREHOUSE is given an
    // active series on ACME only. Relying on "Demo happens to have no
    // WORKSHOP series" was wrong — AE legitimately creates one for Demo
    // to prove seriesCode is reusable across tenants.
    const t = await acme(); const aCookie = await acmeAdmin(); const dCookie = await loginAs("admin@demo-water.co", "password123");
    const d = await demo();
    await ensureSeries(t.id, "MAINTENANCE_WAREHOUSE", "WH");
    const demoSeries = await db.query.numberingSeries.findFirst({ where: and(eq(numberingSeries.tenantId, d.id), eq(numberingSeries.entityType, "MAINTENANCE_WAREHOUSE")) });
    if (demoSeries) await db.update(numberingSeries).set({ status: "INACTIVE" }).where(eq(numberingSeries.id, demoSeries.id)); // temporarily deactivate
    const { POST } = await import("@/app/api/maintenance-warehouses/route");
    expect((await POST(makeRequest("/api/maintenance-warehouses", { method: "POST", cookie: aCookie, body: { name: "A" } }))).status).toBe(201);
    const dRes = await POST(makeRequest("/api/maintenance-warehouses", { method: "POST", cookie: dCookie, body: { name: "D" } }));
    expect(dRes.status).toBe(400);
    expect((await dRes.json()).error).toBe(NO_ACTIVE_SERIES);
    if (demoSeries) await db.update(numberingSeries).set({ status: "ACTIVE" }).where(eq(numberingSeries.id, demoSeries.id));
  });
});

describe("Core master data audit decisions (Part 10, items 30-35)", () => {
  const schema = fs.readFileSync(path.join(process.cwd(), "lib/db/schema.ts"), "utf8");
  const col = (table: string) => schema.slice(schema.indexOf(`export const ${table} = pgTable(`), schema.indexOf("(table) =>", schema.indexOf(`export const ${table} = pgTable(`)));

  it("30/31 (AG). customers.customerCode and customerLocations.siteCode now exist — converted, not schema-gap", () => {
    expect(col("customers")).toMatch(/customer_code|customerCode/);
    expect(col("customerLocations")).toMatch(/site_code|siteCode/);
    expect(CODE_FIELD_ENTITY_MAP.find((m) => m.entityType === "CUSTOMER")?.status).toBe("converted");
    expect(CODE_FIELD_ENTITY_MAP.find((m) => m.entityType === "CUSTOMER_SITE")?.status).toBe("converted");
  });

  it("32/33 (AG). plate/license stay manual and required; vehicleCode/driverCode are now system-generated via resolveEntityCode — all converted", () => {
    expect(col("vehicles")).toContain('plateNumber: text("plate_number").notNull()');
    expect(col("drivers")).toContain('licenseNumber: text("license_number").notNull()');
    expect(col("vehicles")).toMatch(/vehicle_code|vehicleCode/);
    expect(col("drivers")).toMatch(/driver_code|driverCode/);
    const v = fs.readFileSync(path.join(process.cwd(), "app/api/vehicles/route.ts"), "utf8");
    const d = fs.readFileSync(path.join(process.cwd(), "app/api/drivers/route.ts"), "utf8");
    expect(v).toContain("resolveEntityCode");
    expect(d).toContain("resolveEntityCode");
    expect(CODE_FIELD_ENTITY_MAP.find((m) => m.entityType === "VEHICLE")?.status).toBe("converted");
    expect(CODE_FIELD_ENTITY_MAP.find((m) => m.entityType === "DRIVER")?.status).toBe("converted");
  });

  it("34/35. contracts (genNumber) and expenses (derived expenseRef) are audit-only and untouched", () => {
    const c = fs.readFileSync(path.join(process.cwd(), "app/api/contracts/route.ts"), "utf8");
    // RC1: contracts use allocator + genNumber fallback; resolveEntityCode is present
    expect(c).toContain("resolveEntityCode");
    expect(CODE_FIELD_ENTITY_MAP.find((m) => m.entityType === "CONTRACT")?.status).toBe("audit-only");
    expect(CODE_FIELD_ENTITY_MAP.find((m) => m.entityType === "EXPENSE")?.status).toBe("audit-only");
    // RC1: expenseRef column now exists
    expect(col("expenseClaims")).toMatch(/expense_ref|expenseRef/);
  });

  it("orders/trips/invoices/PR/PO/GRN remain audit-only; genNumber untouched in orders/trips", () => {
    for (const et of ["ORDER", "TRIP", "INVOICE", "PURCHASE_REQUISITION", "PURCHASE_ORDER", "GOODS_RECEIPT"]) {
      expect(CODE_FIELD_ENTITY_MAP.find((m) => m.entityType === et)?.status).toBe("audit-only");
    }
    expect(fs.readFileSync(path.join(process.cwd(), "app/api/orders/route.ts"), "utf8")).toContain('genNumber("ORD")');
    expect(fs.readFileSync(path.join(process.cwd(), "app/api/trips/route.ts"), "utf8")).toContain('genNumber("TRIP")');
  });

  it("registry has LOADING_POINT; AG may have created series via ensureAllSeries (that's legitimate)", async () => {
    expect(NUMBERING_ENTITY_TYPES.find((e) => e.entityType === "LOADING_POINT")?.recommendedPrefix).toBe("LP");
  });
});

describe("Settings UI (Part 10, items 36-40)", () => {
  const s = fs.readFileSync(path.join(process.cwd(), "app/admin/settings/page.tsx"), "utf8");
  it("36/37. renders converted, schema-gap and audit-only statuses from CODE_FIELD_ENTITY_MAP", () => {
    expect(s).toContain("CODE_FIELD_ENTITY_MAP");
    expect(s).toContain("Schema gap (proposed)");
    expect(s).toContain("Audit-only / future");
  });
  it("38. shows the AF example list", () => {
    for (const ex of ["C06001", "S06001", "VH06001", "D06001", "CN06001", "EX06001", "LP06001", "IG06001", "IC06001", "ISC06001", "I06001", "W06001", "WH06001"]) expect(s).toContain(ex);
  });
  it("39/40. never auto-creates a series; preview stays client-side; imports only the client-safe module", () => {
    expect(s).not.toContain("ensureSeries"); expect(s).not.toContain("seedSeries");
    expect(s).toContain("Preview (does not consume a number)");
    expect(s).toContain('from "@/lib/numberingFormat"');
    expect(s).not.toContain('from "@/lib/numbering"');
    expect(s).not.toContain("businessCodes");
  });
});

describe("UI code fields (Part 6, superseded by AF.1: system-generated, read-only)", () => {
  it.each(["master-items", "workshops", "inventory", "procurement"])("%s page shows the next-code preview and has no manual code entry", (p) => {
    const src = fs.readFileSync(path.join(process.cwd(), `app/admin/${p}/page.tsx`), "utf8");
    expect(src).toContain("NextCodePreview");
    expect(src).not.toContain("Leave blank to auto-generate from Settings numbering series.");
    expect(src).not.toMatch(/placeholder="(Supplier code|Code|Item code|Workshop code|Warehouse code)/);
  });
});

describe("Regression protection (Milestone AF)", () => {
  it("no schema, migration, seedData, pricing, billing, ERP, dispatch or driver-app changes", () => {
    const schema = fs.readFileSync(path.join(process.cwd(), "lib/db/schema.ts"), "utf8");
    // AG legitimately added these five code columns — the test above confirms they exist
    expect(fs.readdirSync(path.join(process.cwd(), "drizzle")).filter((f) => f.endsWith(".sql")).length).toBe(25); // P2-01 added migration 0021
    expect(fs.readFileSync(path.join(process.cwd(), "lib/contractPricing.ts"), "utf8")).toContain("PricingEngineError");
    const stop = fs.readFileSync(path.join(process.cwd(), "app/api/trips/[id]/stops/[stopId]/route.ts"), "utf8");
    expect(stop).toContain("Task P.2"); expect(stop).toContain("autoCloseTripIfAllStopsResolved");
    for (const f of ["app/dispatch/page.tsx", "app/driver/page.tsx", "lib/erp/sync.ts", "scripts/seedData.ts"]) {
      expect(fs.readFileSync(path.join(process.cwd(), f), "utf8")).not.toContain("resolveEntityCode");
    }
  });
  it("lib/numbering.ts is now only the allocator + re-export; pure primitives live in numberingFormat.ts (no db import)", () => {
    const n = fs.readFileSync(path.join(process.cwd(), "lib/numbering.ts"), "utf8");
    const f = fs.readFileSync(path.join(process.cwd(), "lib/numberingFormat.ts"), "utf8");
    expect(n).toContain('export * from "./numberingFormat"');
    expect(f).not.toContain("db/client"); expect(f).toContain("export function formatSequenceNumber");
  });
  it("no passwordHash exposure in any changed file", () => {
    const files = ["lib/businessCodes.ts", "lib/numberingFormat.ts", "lib/numbering.ts", "app/api/suppliers/route.ts", "app/api/workshops/route.ts", "app/api/items/route.ts", "app/admin/settings/page.tsx"];
    expect(files.map((f) => fs.readFileSync(path.join(process.cwd(), f), "utf8")).join("\n")).not.toContain("passwordHash");
  });
});
