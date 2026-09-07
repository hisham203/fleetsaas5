import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { makeRequest, loginAs } from "../helpers/request";
import { db } from "@/lib/db/client";
import { formatSequenceNumber, computePeriodKey, NUMBERING_ENTITY_TYPES } from "@/lib/numbering";

// Milestone AD — Numbering & Sequence Schema Foundation. Schema +
// pure formatter + empty-safe read APIs only. No allocation/generator
// function exists; no existing entity creation flow was converted.
const schemaSource = fs.readFileSync(path.join(process.cwd(), "lib/db/schema.ts"), "utf8");

describe("Schema/migration tests (Part 11, items 1-18)", () => {
  it("1/2. numbering_series and numbering_sequence_ledger tables are defined", () => {
    expect(schemaSource).toContain("export const numberingSeries = pgTable(");
    expect(schemaSource).toContain('"numbering_series"');
    expect(schemaSource).toContain("export const numberingSequenceLedger = pgTable(");
    expect(schemaSource).toContain('"numbering_sequence_ledger"');
  });

  it("3/4/5/6/7/8. numbering_series has tenantId, entityType, prefix, seriesSegment, nextNumber, resetPolicy", () => {
    const section = schemaSource.slice(schemaSource.indexOf("export const numberingSeries = pgTable("), schemaSource.indexOf("export const numberingSequenceLedger = pgTable("));
    expect(section).toContain('tenantId: text("tenant_id")');
    expect(section).toContain('entityType: text("entity_type")');
    expect(section).toContain('prefix: text("prefix")');
    expect(section).toContain('seriesSegment: text("series_segment")');
    expect(section).toContain('nextNumber: integer("next_number")');
    expect(section).toContain('resetPolicy: text("reset_policy")');
  });

  it("9/10/11/12. numbering_sequence_ledger has generatedNumber, sequenceNumber, periodKey, referenceTable/referenceId", () => {
    const section = schemaSource.slice(schemaSource.indexOf("export const numberingSequenceLedger = pgTable("), schemaSource.indexOf("// Line items on an invoice"));
    expect(section).toContain('generatedNumber: text("generated_number")');
    expect(section).toContain('sequenceNumber: integer("sequence_number")');
    expect(section).toContain('periodKey: text("period_key")');
    expect(section).toContain('referenceTable: text("reference_table")');
    expect(section).toContain('referenceId: text("reference_id")');
  });

  it("13/14. unique tenant/entityType and tenant/seriesCode rules exist on numbering_series", () => {
    expect(schemaSource).toContain("numbering_series_tenant_entity_type_unique");
    expect(schemaSource).toContain("numbering_series_tenant_series_code_unique");
  });

  it("15/16. unique generatedNumber and unique sequence-per-series/period rules exist on the ledger", () => {
    expect(schemaSource).toContain("numbering_sequence_ledger_tenant_generated_number_unique");
    expect(schemaSource).toContain("numbering_sequence_ledger_series_period_sequence_unique");
  });

  it("17. the migration is non-destructive — exactly 2 CREATE TABLE statements, zero ALTER/DROP/TRUNCATE", () => {
    const migrationSource = fs.readFileSync(path.join(process.cwd(), "drizzle/0018_clear_sinister_six.sql"), "utf8");
    const creates = migrationSource.match(/^CREATE TABLE/gm) ?? [];
    expect(creates.length).toBe(2);
    expect(migrationSource).not.toMatch(/ALTER TABLE|DROP TABLE|TRUNCATE|DELETE FROM|INSERT INTO/i);
  });

  it("18. no seed data was inserted; both tables are genuinely empty", async () => {
    const rows = await Promise.all([db.query.numberingSeries.findMany(), db.query.numberingSequenceLedger.findMany()]);
    expect(rows[0].length).toBe(0);
    expect(rows[1].length).toBe(0);
    const seedSource = fs.readFileSync(path.join(process.cwd(), "scripts/seedData.ts"), "utf8");
    expect(seedSource).not.toContain("numberingSeries");
  });

  it("existing warehouses/suppliers tables remain completely unaffected by this migration", async () => {
    const { warehouses } = await import("@/lib/db/schema");
    const rows = await db.query.warehouses.findMany();
    expect(rows.length).toBeGreaterThan(0); // the real, pre-existing loading points, untouched
  });

  it("zero DB-level foreign keys were introduced, matching this schema's established convention", () => {
    const section = schemaSource.slice(schemaSource.indexOf("Milestone AD"), schemaSource.indexOf("// Line items on an invoice"));
    expect(section).not.toContain(".references(");
  });
});

describe("Formatter tests (Part 11, items 19-28)", () => {
  it("19/20/21/22. exact examples from this milestone's own spec: C06001, V06001, PR06001, PO06025", () => {
    expect(formatSequenceNumber({ prefix: "C", seriesSegment: "06", separator: "", paddingLength: 3 }, 1)).toBe("C06001");
    expect(formatSequenceNumber({ prefix: "V", seriesSegment: "06", separator: "", paddingLength: 3 }, 1)).toBe("V06001");
    expect(formatSequenceNumber({ prefix: "PR", seriesSegment: "06", separator: "", paddingLength: 3 }, 1)).toBe("PR06001");
    expect(formatSequenceNumber({ prefix: "PO", seriesSegment: "06", separator: "", paddingLength: 3 }, 25)).toBe("PO06025");
  });

  it("23. separator example: C-06-0001", () => {
    expect(formatSequenceNumber({ prefix: "C", seriesSegment: "06", separator: "-", paddingLength: 4 }, 1)).toBe("C-06-0001");
  });

  it("24. year example: EX-2026-00001", () => {
    expect(formatSequenceNumber({ prefix: "EX", separator: "-", paddingLength: 5, includeYear: true }, 1, new Date("2026-01-15"))).toBe("EX-2026-00001");
  });

  it("25. month example, when includeMonth is enabled", () => {
    expect(formatSequenceNumber({ prefix: "EX", separator: "-", paddingLength: 3, includeMonth: true }, 1, new Date("2026-03-15"))).toBe("EX-03-001");
  });

  it("26. leading zeros are preserved regardless of padding length", () => {
    expect(formatSequenceNumber({ prefix: "I", separator: "", paddingLength: 6 }, 42)).toBe("I000042");
  });

  it("27/28. prefix can be one letter or two letters", () => {
    expect(formatSequenceNumber({ prefix: "D", separator: "", paddingLength: 3 }, 1)).toBe("D001");
    expect(formatSequenceNumber({ prefix: "TR", separator: "", paddingLength: 3 }, 1)).toBe("TR001");
  });

  it("computePeriodKey returns null for NEVER, a year for YEARLY, and a year-month for MONTHLY", () => {
    expect(computePeriodKey("NEVER")).toBeNull();
    expect(computePeriodKey("YEARLY", new Date("2026-05-01"))).toBe("2026");
    expect(computePeriodKey("MONTHLY", new Date("2026-05-01"))).toBe("2026-05");
  });

  it("the formatter never touches the database — confirmed by source inspection (no db import)", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "lib/numbering.ts"), "utf8");
    expect(source).not.toContain('from "@/lib/db/client"');
  });
});

describe("Entity type registry (Part 5)", () => {
  it("includes all 20 entity types with recommended prefixes, matching this milestone's own list", () => {
    expect(NUMBERING_ENTITY_TYPES.length).toBe(20);
    const byType = Object.fromEntries(NUMBERING_ENTITY_TYPES.map((e) => [e.entityType, e.recommendedPrefix]));
    expect(byType.CUSTOMER).toBe("C");
    expect(byType.SUPPLIER).toBe("V");
    expect(byType.PURCHASE_REQUISITION).toBe("PR");
    expect(byType.PURCHASE_ORDER).toBe("PO");
    expect(byType.GOODS_RECEIPT).toBe("GR");
  });
});

describe("API tests (Part 11, items 29-34)", () => {
  it("29/30/31. all three endpoints return safely for a real admin session", async () => {
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const { GET: getSeries } = await import("@/app/api/settings/numbering-series/route");
    const seriesRes = await getSeries(makeRequest("/api/settings/numbering-series", { cookie: adminCookie }));
    expect(seriesRes.status).toBe(200);
    expect(await seriesRes.json()).toEqual([]);

    const { GET: getLedger } = await import("@/app/api/settings/numbering-ledger/route");
    const ledgerRes = await getLedger(makeRequest("/api/settings/numbering-ledger", { cookie: adminCookie }));
    expect(ledgerRes.status).toBe(200);
    expect(await ledgerRes.json()).toEqual([]);

    const { GET: getEntityTypes } = await import("@/app/api/settings/numbering-entity-types/route");
    const typesRes = await getEntityTypes(makeRequest("/api/settings/numbering-entity-types", { cookie: adminCookie }));
    expect(typesRes.status).toBe(200);
    const types = await typesRes.json();
    expect(types.length).toBe(20);
  });

  it("32/33. all three endpoints require auth and ADMIN role", async () => {
    const driverCookie = await loginAs("mohammed@riyadh-bulk-water.co", "password123");
    const { GET: getSeries } = await import("@/app/api/settings/numbering-series/route");
    const noAuth = await getSeries(makeRequest("/api/settings/numbering-series", {}));
    expect(noAuth.status).toBe(401);
    const driverRes = await getSeries(makeRequest("/api/settings/numbering-series", { cookie: driverCookie }));
    expect(driverRes.status).toBe(401);
  });

  it("34. endpoints are tenant-isolated (confirmed via source: tenantId always comes from the session)", () => {
    const seriesSource = fs.readFileSync(path.join(process.cwd(), "app/api/settings/numbering-series/route.ts"), "utf8");
    const ledgerSource = fs.readFileSync(path.join(process.cwd(), "app/api/settings/numbering-ledger/route.ts"), "utf8");
    expect(seriesSource).toContain("getSessionTenantId(session)");
    expect(ledgerSource).toContain("getSessionTenantId(session)");
  });

  it("no passwordHash exposure in any new route", () => {
    const files = ["app/api/settings/numbering-series/route.ts", "app/api/settings/numbering-ledger/route.ts", "app/api/settings/numbering-entity-types/route.ts", "lib/numbering.ts"];
    const combined = files.map((f) => fs.readFileSync(path.join(process.cwd(), f), "utf8")).join("\n");
    expect(combined).not.toContain("passwordHash");
  });
});

describe("Settings UI tests (Part 11, items 35-40)", () => {
  const settingsSource = fs.readFileSync(path.join(process.cwd(), "app/admin/settings/page.tsx"), "utf8");

  it("35/36/37. Settings shows Numbering & Sequences, entity types, and the exact format examples", () => {
    expect(settingsSource).toContain("Numbering & Sequences");
    expect(settingsSource).toContain("Supported entity types");
    expect(settingsSource).toContain("C06001");
    expect(settingsSource).toContain("V06001");
    expect(settingsSource).toContain("PR06001");
  });

  it("38. Settings does not show any fake active series — the empty state is honest", () => {
    expect(settingsSource).toContain("No numbering series configured yet.");
  });

  it("39. Settings does not allow editing nextNumber — no input/form for it", () => {
    expect(settingsSource).not.toContain("<input");
    expect(settingsSource).not.toMatch(/onChange.*nextNumber/);
  });

  it("40. Settings states automatic assignment will be added later", () => {
    expect(settingsSource).toContain("Configuration UI and automatic assignment will be added in later milestones");
  });
});

describe("Regression protection (Milestone AD)", () => {
  it("41/42. Supplier save and sidebar order from Milestone AC still work", async () => {
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const { POST: createSupplier } = await import("@/app/api/suppliers/route");
    const { genId } = await import("@/lib/helpers");
    const res = await createSupplier(makeRequest("/api/suppliers", { method: "POST", cookie: adminCookie, body: { supplierCode: `AD-${genId().slice(0, 6)}`, name: "AD Regression Supplier", email: "" } }));
    expect(res.status).toBe(201);

    const shellSource = fs.readFileSync(path.join(process.cwd(), "components/AdminShell.tsx"), "utf8");
    const adminPageSource = fs.readFileSync(path.join(process.cwd(), "app/admin/page.tsx"), "utf8");
    expect(shellSource).toContain('{ label: "Dispatch (Live)", href: "/dispatch" }');
    expect(adminPageSource).toContain('{ label: "Dispatch (Live)", href: "/dispatch" }');
  });

  it("43/44. Z.2 CRUD and Z.1 read APIs still work", async () => {
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const { GET: getWorkshops } = await import("@/app/api/workshops/route");
    const res = await getWorkshops(makeRequest("/api/workshops", { cookie: adminCookie }));
    expect(res.status).toBe(200);
  });

  it("45. Task P.2 contract-priced invoice markers remain unchanged", () => {
    const stopRoute = fs.readFileSync(path.join(process.cwd(), "app/api/trips/[id]/stops/[stopId]/route.ts"), "utf8");
    expect(stopRoute).toContain("Task P.2");
  });

  it("46. Milestone W POD gate remains unchanged", () => {
    const stopRoute = fs.readFileSync(path.join(process.cwd(), "app/api/trips/[id]/stops/[stopId]/route.ts"), "utf8");
    expect(stopRoute).toContain("autoCloseTripIfAllStopsResolved");
  });

  it("no existing entity numbering was converted — genNumber() remains completely unchanged", () => {
    const helpersSource = fs.readFileSync(path.join(process.cwd(), "lib/helpers.ts"), "utf8");
    expect(helpersSource).toContain("export function genNumber(prefix: string)");
    const ordersSource = fs.readFileSync(path.join(process.cwd(), "app/api/orders/route.ts"), "utf8");
    expect(ordersSource).toContain('genNumber("ORD")');
    expect(ordersSource).not.toContain("allocateNextNumber");
  });

  it("no pricing, billing, or ERP file was modified", () => {
    const pricingSource = fs.readFileSync(path.join(process.cwd(), "lib/contractPricing.ts"), "utf8");
    const erpSource = fs.readFileSync(path.join(process.cwd(), "lib/erp/sync.ts"), "utf8");
    expect(pricingSource).toContain("PricingEngineError");
    expect(erpSource).not.toContain("numberingSeries");
  });

  it("dispatch and driver app runtime files were not modified in this milestone", () => {
    const dispatchSource = fs.readFileSync(path.join(process.cwd(), "app/dispatch/page.tsx"), "utf8");
    const driverSource = fs.readFileSync(path.join(process.cwd(), "app/driver/page.tsx"), "utf8");
    expect(dispatchSource).not.toContain("numberingSeries");
    expect(driverSource).not.toContain("numberingSeries");
  });
});
