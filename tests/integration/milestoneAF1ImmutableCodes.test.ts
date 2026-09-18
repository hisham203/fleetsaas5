import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { makeRequest, loginAs } from "../helpers/request";
import { db } from "@/lib/db/client";
import { tenants, numberingSeries, numberingSequenceLedger, itemCategories } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { genId } from "@/lib/helpers";
import { MANUAL_CODE_REJECTED, CODE_IMMUTABLE, NO_ACTIVE_SERIES } from "@/lib/businessCodes";

// Milestone AF.1 — ERP Numbering Hardening, Immutable Codes & Bulk Water
// Fleet Capacity Cleanup. Allocation tests own the ACME tenant (same
// isolation rule as AF) so they never collide with AE's Riyadh series.
const acme = async () => (await db.query.tenants.findFirst({ where: eq(tenants.name, "Acme Fuel Delivery Co.") }))!;
const acmeAdmin = () => loginAs("admin@acme-fuel-demo.co", "password123");
const src = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

async function ensureSeries(tenantId: string, entityType: string, prefix: string) {
  const existing = await db.query.numberingSeries.findFirst({ where: and(eq(numberingSeries.tenantId, tenantId), eq(numberingSeries.entityType, entityType)) });
  if (existing) return existing;
  const id = genId();
  await db.insert(numberingSeries).values({ id, tenantId, entityType, seriesCode: `${entityType}-${genId().slice(0, 6)}`, displayName: `${entityType} series`, prefix, seriesSegment: "06", paddingLength: 3, nextNumber: 1, status: "ACTIVE" });
  return (await db.query.numberingSeries.findFirst({ where: eq(numberingSeries.id, id) }))!;
}
const ledgerCount = async (tenantId: string, entityType: string) =>
  (await db.query.numberingSequenceLedger.findMany({ where: and(eq(numberingSequenceLedger.tenantId, tenantId), eq(numberingSequenceLedger.entityType, entityType)) })).length;
const params = (id: string) => ({ params: Promise.resolve({ id }) } as any);

describe("Supplier production bugs (Part 9, items 1-10)", () => {
  it("1/2. create form has no editable supplierCode input and shows the next-code preview", () => {
    const s = src("app/admin/procurement/page.tsx");
    expect(s).not.toMatch(/placeholder="Supplier code/);
    expect(s).not.toContain("Leave blank to auto-generate");
    expect(s).toContain('<NextCodePreview entityType="SUPPLIER"');
  });
  it.each(["V", "015", "SUP-001"])("3/6/7/24. POST rejects client-supplied supplierCode %s", async (code) => {
    const cookie = await acmeAdmin();
    const { POST } = await import("@/app/api/suppliers/route");
    const res = await POST(makeRequest("/api/suppliers", { method: "POST", cookie, body: { supplierCode: code, name: "X" } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(MANUAL_CODE_REJECTED);
  });
  it("4. POST with no active SUPPLIER series returns the AF.1 wording (Demo tenant — temporarily deactivated)", async () => {
    // Other test files' ensureAllSeries may have created a Demo SUPPLIER series,
    // so deactivate it temporarily to test the no-series path.
    const d = (await db.query.tenants.findFirst({ where: eq(tenants.name, "Demo Water Co.") }))!;
    const existing = await db.query.numberingSeries.findFirst({ where: and(eq(numberingSeries.tenantId, d.id), eq(numberingSeries.entityType, "SUPPLIER")) });
    if (existing) await db.update(numberingSeries).set({ status: "INACTIVE" }).where(eq(numberingSeries.id, existing.id));
    try {
      const cookie = await loginAs("admin@demo-water.co", "password123");
      const { POST } = await import("@/app/api/suppliers/route");
      const res = await POST(makeRequest("/api/suppliers", { method: "POST", cookie, body: { name: "No Series" } }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe(NO_ACTIVE_SERIES);
    } finally {
      if (existing) await db.update(numberingSeries).set({ status: "ACTIVE" }).where(eq(numberingSeries.id, existing.id));
    }
  });
  it("5/10. POST with an active SUPPLIER series allocates V06NNN and writes exactly one linked ledger row", async () => {
    const t = await acme(); const cookie = await acmeAdmin();
    await ensureSeries(t.id, "SUPPLIER", "V");
    const before = await ledgerCount(t.id, "SUPPLIER");
    const { POST } = await import("@/app/api/suppliers/route");
    const res = await POST(makeRequest("/api/suppliers", { method: "POST", cookie, body: { name: "Auto" } }));
    expect(res.status).toBe(201);
    const s = await res.json();
    expect(s.supplierCode).toMatch(/^V06\d{3,}$/);
    expect(await ledgerCount(t.id, "SUPPLIER")).toBe(before + 1);
  });
  it("8. PATCH rejects a supplierCode change; an idempotent resend of the same value is harmless", async () => {
    const t = await acme(); const cookie = await acmeAdmin();
    await ensureSeries(t.id, "SUPPLIER", "V");
    const { POST } = await import("@/app/api/suppliers/route");
    const s = await (await POST(makeRequest("/api/suppliers", { method: "POST", cookie, body: { name: "P" } }))).json();
    const { PATCH } = await import("@/app/api/suppliers/[id]/route");
    const bad = await PATCH(makeRequest(`/api/suppliers/${s.id}`, { method: "PATCH", cookie, body: { supplierCode: "V06999" } }), params(s.id));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe(CODE_IMMUTABLE);
    const same = await PATCH(makeRequest(`/api/suppliers/${s.id}`, { method: "PATCH", cookie, body: { supplierCode: s.supplierCode, name: "Renamed" } }), params(s.id));
    expect(same.status).toBe(200);
    expect((await same.json()).supplierCode).toBe(s.supplierCode);
  });
  it("9. edit UI shows the code read-only with the immutability note", () => {
    const s = src("app/admin/procurement/page.tsx");
    expect(s).toContain("Code cannot be changed after creation.");
  });
});

describe("Converted entities: system-only, immutable (Part 9, items 11-24)", () => {
  const cases = [
    { label: "Item Group", et: "ITEM_GROUP", prefix: "IG", route: "item-groups", field: "code", body: async () => ({ name: "G" }) },
    { label: "Item Category", et: "ITEM_CATEGORY", prefix: "IC", route: "item-categories", field: "code", body: async () => ({ name: "C" }) },
    { label: "Workshop", et: "WORKSHOP", prefix: "W", route: "workshops", field: "workshopCode", body: async () => ({ name: "W" }) },
    { label: "Maintenance Warehouse", et: "MAINTENANCE_WAREHOUSE", prefix: "WH", route: "maintenance-warehouses", field: "warehouseCode", body: async () => ({ name: "WH" }) },
    { label: "Item Subcategory", et: "ITEM_SUBCATEGORY", prefix: "ISC", route: "item-subcategories", field: "code", body: async (t: string) => { const id = genId(); await db.insert(itemCategories).values({ id, tenantId: t, code: `C-${genId().slice(0, 6)}`, name: "P" }); return { name: "S", categoryId: id }; } },
    { label: "Item", et: "ITEM", prefix: "I", route: "items", field: "itemCode", body: async (t: string) => { const id = genId(); await db.insert(itemCategories).values({ id, tenantId: t, code: `C-${genId().slice(0, 6)}`, name: "P" }); return { name: "I", categoryId: id, itemType: "SPARE_PART", unitOfMeasure: "EA" }; } },
  ];
  it.each(cases)("$label: manual code rejected; system create yields $prefix06NNN; PATCH refuses code change", async (c) => {
    const t = await acme(); const cookie = await acmeAdmin();
    await ensureSeries(t.id, c.et, c.prefix);
    const mod = await import(`@/app/api/${c.route}/route`);
    const manual = await mod.POST(makeRequest(`/api/${c.route}`, { method: "POST", cookie, body: { ...(await c.body(t.id)), [c.field]: "MAN-001" } }));
    expect(manual.status).toBe(400);
    expect((await manual.json()).error).toBe(MANUAL_CODE_REJECTED);
    const ok = await mod.POST(makeRequest(`/api/${c.route}`, { method: "POST", cookie, body: await c.body(t.id) }));
    expect(ok.status).toBe(201);
    const row = await ok.json();
    expect(row[c.field]).toMatch(new RegExp(`^${c.prefix}06\\d{3,}$`));
    const patchMod = await import(`@/app/api/${c.route}/[id]/route`);
    const before = await ledgerCount(t.id, c.et);
    const bad = await patchMod.PATCH(makeRequest(`/api/${c.route}/${row.id}`, { method: "PATCH", cookie, body: { [c.field]: "X-999" } }), params(row.id));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe(CODE_IMMUTABLE);
    expect(await ledgerCount(t.id, c.et)).toBe(before); // PATCH never allocates
  });
});

describe("Preview API (Part 9, items 25-29)", () => {
  it("25/26/28. returns the formatted next number without incrementing or writing a ledger row; matches what allocation then produces", async () => {
    const t = await acme(); const cookie = await acmeAdmin();
    const series = await ensureSeries(t.id, "WORKSHOP", "W");
    const nextBefore = (await db.query.numberingSeries.findFirst({ where: eq(numberingSeries.id, series.id) }))!.nextNumber;
    const before = await ledgerCount(t.id, "WORKSHOP");
    const { GET } = await import("@/app/api/settings/numbering-preview/route");
    const res = await GET(makeRequest("/api/settings/numbering-preview?entityType=WORKSHOP", { cookie }));
    expect(res.status).toBe(200);
    const p = await res.json();
    expect(p.previewNumber).toBe(`W06${String(nextBefore).padStart(3, "0")}`);
    expect(p.note).toBe("Preview only. Final number is allocated on save.");
    expect((await db.query.numberingSeries.findFirst({ where: eq(numberingSeries.id, series.id) }))!.nextNumber).toBe(nextBefore);
    expect(await ledgerCount(t.id, "WORKSHOP")).toBe(before);
    const { POST } = await import("@/app/api/workshops/route");
    const created = await (await POST(makeRequest("/api/workshops", { method: "POST", cookie, body: { name: "After preview" } }))).json();
    expect(created.workshopCode).toBe(p.previewNumber);
  });
  it("27. fails clearly without an active series (Demo — temporarily deactivated)", async () => {
    const d = (await db.query.tenants.findFirst({ where: eq(tenants.name, "Demo Water Co.") }))!;
    const existing = await db.query.numberingSeries.findFirst({ where: and(eq(numberingSeries.tenantId, d.id), eq(numberingSeries.entityType, "SUPPLIER")) });
    if (existing) await db.update(numberingSeries).set({ status: "INACTIVE" }).where(eq(numberingSeries.id, existing.id));
    try {
      const cookie = await loginAs("admin@demo-water.co", "password123");
      const { GET } = await import("@/app/api/settings/numbering-preview/route");
      const res = await GET(makeRequest("/api/settings/numbering-preview?entityType=SUPPLIER", { cookie }));
      expect(res.status).toBe(400);
    } finally {
      if (existing) await db.update(numberingSeries).set({ status: "ACTIVE" }).where(eq(numberingSeries.id, existing.id));
    }
  });
  it("29. 20 concurrent previews consume nothing", async () => {
    const t = await acme(); const cookie = await acmeAdmin();
    const series = await ensureSeries(t.id, "ITEM_GROUP", "IG");
    const nextBefore = (await db.query.numberingSeries.findFirst({ where: eq(numberingSeries.id, series.id) }))!.nextNumber;
    const before = await ledgerCount(t.id, "ITEM_GROUP");
    const { GET } = await import("@/app/api/settings/numbering-preview/route");
    const all = await Promise.all(Array.from({ length: 20 }, () => GET(makeRequest("/api/settings/numbering-preview?entityType=ITEM_GROUP", { cookie })).then((r) => r.json())));
    expect(new Set(all.map((p) => p.previewNumber)).size).toBe(1);
    expect((await db.query.numberingSeries.findFirst({ where: eq(numberingSeries.id, series.id) }))!.nextNumber).toBe(nextBefore);
    expect(await ledgerCount(t.id, "ITEM_GROUP")).toBe(before);
  });
  it("preview requires auth and ADMIN; never imports the allocator write path", async () => {
    const { GET } = await import("@/app/api/settings/numbering-preview/route");
    expect((await GET(makeRequest("/api/settings/numbering-preview?entityType=SUPPLIER", {}))).status).toBe(401);
    const s = src("app/api/settings/numbering-preview/route.ts");
    expect(s).not.toContain("allocateNextNumber");
    expect(s).not.toContain(".insert(");
  });
});

describe("Settings series hardening (Part 9, items 30-42)", () => {
  const base = () => ({ seriesCode: `S-${genId().slice(0, 6)}`, displayName: "T", prefix: "ZQ", seriesSegment: "07", separator: "", paddingLength: 3, nextNumber: 1 });
  async function post(cookie: string, body: Record<string, unknown>) {
    const { POST } = await import("@/app/api/settings/numbering-series/route");
    return POST(makeRequest("/api/settings/numbering-series", { method: "POST", cookie, body }));
  }
  it("31. lowercase / free-text entityType rejected", async () => {
    const cookie = await acmeAdmin();
    for (const et of ["workshop", "Workshop", "MY_THING"]) expect((await post(cookie, { ...base(), entityType: et })).status).toBe(400);
  });
  it("32/33/34. duplicate entityType, duplicate seriesCode, and duplicate effective format are all 409", async () => {
    const t = await acme(); const cookie = await acmeAdmin();
    const seg = genId().slice(0, 4).toUpperCase().replace(/[^A-Z0-9]/g, "A");
    const first = await post(cookie, { ...base(), entityType: "MAINTENANCE_WORK_ORDER", prefix: "WOX", seriesSegment: seg });
    expect([201, 409]).toContain(first.status); // may pre-exist from a prior run in the same DB lifetime
    const dupEntity = await post(cookie, { ...base(), entityType: "MAINTENANCE_WORK_ORDER", prefix: "WOY", seriesSegment: seg + "B" });
    expect(dupEntity.status).toBe(409);
    const existing = (await db.query.numberingSeries.findFirst({ where: and(eq(numberingSeries.tenantId, t.id), eq(numberingSeries.entityType, "MAINTENANCE_WORK_ORDER")) }))!;
    // RC1: GOODS_RECEIPT is now in SERIES_PREFIX (pre-created). Use INVOICE (audit-only, never pre-created) instead.
    const dupCode = await post(cookie, { ...base(), entityType: "INVOICE", seriesCode: existing.seriesCode, prefix: "INV" });
    expect(dupCode.status).toBe(409);
    const dupFormat = await post(cookie, { ...base(), entityType: "INVOICE", prefix: existing.prefix, seriesSegment: existing.seriesSegment ?? undefined, separator: existing.separator, paddingLength: existing.paddingLength });
    expect(dupFormat.status).toBe(409);
    expect((await dupFormat.json()).error).toMatch(/format/i);
  });
  it("35-38/40/41. prefix, segment, separator, padding, resetPolicy, status validation", async () => {
    const cookie = await acmeAdmin();
    const bad = [
      { prefix: "v" }, { prefix: "TOOLONG" }, { prefix: "" }, { prefix: "A-B" },
      { seriesSegment: "ab" }, { seriesSegment: "TOOLONGSEGMENT1" },
      { separator: "_" }, { separator: "." },
      { paddingLength: 2 }, { paddingLength: 11 }, { paddingLength: 3.5 },
      { nextNumber: 0 }, { resetPolicy: "WEEKLY" }, { status: "ARCHIVED" },
    ];
    for (const b of bad) expect((await post(cookie, { ...base(), entityType: "PURCHASE_ORDER", ...b })).status).toBe(400);
  });
  it("39. nextNumber, entityType and seriesCode cannot be PATCHed", async () => {
    const t = await acme(); const cookie = await acmeAdmin();
    const s = await ensureSeries(t.id, "ITEM", "I");
    const { PATCH } = await import("@/app/api/settings/numbering-series/[id]/route");
    for (const b of [{ nextNumber: 500 }, { entityType: "SUPPLIER" }, { seriesCode: "OTHER" }]) {
      expect((await PATCH(makeRequest(`/api/settings/numbering-series/${s.id}`, { method: "PATCH", cookie, body: b }), params(s.id))).status).toBe(400);
    }
  });
  it("30/42. Settings uses the registry dropdown for entityType and surfaces API errors", () => {
    const s = src("app/admin/settings/page.tsx");
    expect(s).toContain("Select entity type");
    expect(s).not.toMatch(/placeholder="Entity type"/);
    expect(s).toContain("extractErrorMessage");
  });
});

describe("Bulk Water Fleet capacity cleanup (Part 9, items 43-52)", () => {
  const fleet = src("app/admin/page.tsx");
  const dispatch = src("app/dispatch/page.tsx");
  it("43/44/47. add form shows Tanker capacity (liters) as primary; no General capacity units", () => {
    expect(fleet).toContain("Tanker capacity (liters)");
    expect(fleet).not.toContain("General capacity units");
    expect(fleet).toContain("Set tanker capacity");
  });
  it("45/46/50. inline edit never shows Units / units; capacityUnits is never sent from the UI", () => {
    expect(fleet).not.toMatch(/>\s*Units\s*</);
    expect(fleet).not.toMatch(/\}\s*units\b/);
    expect(fleet).not.toMatch(/capacityUnits:\s*(Number|editCapacityUnits|capacityUnits)/);
  });
  it("48. no Refill Van wording anywhere in app/", () => {
    for (const f of ["app/admin/page.tsx", "app/dispatch/page.tsx", "app/admin/dispatch/page.tsx"]) {
      if (fs.existsSync(path.join(process.cwd(), f))) expect(src(f)).not.toContain("Refill Van");
    }
  });
  it("49. dispatch plan-trip says 'order(s) selected', not legacy 'load(s) total'", () => {
    expect(dispatch).toContain("order(s) selected");
    expect(dispatch).not.toContain("load(s) total");
  });
  it("51/52. plate number stays a manual required input; no faked vehicle internal code", () => {
    expect(fleet).toMatch(/plateNumber/);
    expect(fleet).toContain("vehicleCode"); // AG: internal code now exists
    expect(src("app/api/vehicles/route.ts")).toContain("resolveEntityCode"); // AG: vehicles converted
  });
});

describe("Existing records & regression (Part 7, Part 9 items 53-69)", () => {
  it("existing manual codes are retained and readable, but immutable (no data cleanup ran)", () => {
    const routes = ["suppliers", "workshops", "maintenance-warehouses", "item-groups", "item-categories", "item-subcategories", "items"];
    for (const r of routes) expect(src(`app/api/${r}/[id]/route.ts`)).toContain("rejectCodeChange(body");
    expect(src("scripts/seedData.ts")).not.toContain("rejectCodeChange");
  });
  it("no schema/migration/pricing/billing/ERP/driver changes; dispatch runtime untouched", () => {
    expect(fs.readdirSync(path.join(process.cwd(), "drizzle")).filter((f) => f.endsWith(".sql")).length).toBe(24); // P2-01 added migration 0021
    expect(src("lib/contractPricing.ts")).toContain("PricingEngineError");
    const stop = src("app/api/trips/[id]/stops/[stopId]/route.ts");
    expect(stop).toContain("Task P.2"); expect(stop).toContain("autoCloseTripIfAllStopsResolved");
    for (const f of ["app/driver/page.tsx", "lib/erp/sync.ts", "app/api/trips/route.ts", "app/api/orders/route.ts"]) {
      expect(src(f)).not.toContain("MANUAL_CODE_REJECTED");
    }
  });
  it("no passwordHash exposure in changed files", () => {
    const files = ["lib/businessCodes.ts", "components/NextCodePreview.tsx", "app/api/settings/numbering-preview/route.ts", "app/api/settings/numbering-series/route.ts", "app/admin/settings/page.tsx", "app/admin/page.tsx"];
    expect(files.map(src).join("\n")).not.toContain("passwordHash");
  });
});
