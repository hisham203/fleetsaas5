import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { makeRequest, loginAs } from "../helpers/request";
import { db } from "@/lib/db/client";
import { tenants, suppliers, numberingSeries, numberingSequenceLedger } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { genId } from "@/lib/helpers";
import { allocateNextNumber, NoActiveSeriesError } from "@/lib/numbering";

// Milestone AE — Sequence Allocation, Settings Configuration & Supplier
// Pilot Conversion.
async function riyadh() {
  return await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
}
async function demo() {
  return await db.query.tenants.findFirst({ where: eq(tenants.name, "Demo Water Co.") });
}
async function makeSupplierSeries(tenantId: string, overrides: Partial<any> = {}) {
  // Idempotent for the SUPPLIER entityType specifically: multiple tests
  // in this file legitimately need an active SUPPLIER series for the
  // same real tenant, and numbering_series' own tenantId+entityType
  // unique constraint (a real, correct app rule, not a test artifact)
  // would otherwise reject the second test's setup. Other entityTypes
  // still get a fresh row each call, since each test uses its own
  // unique entityType for those.
  if ((overrides.entityType ?? "SUPPLIER") === "SUPPLIER") {
    const existing = await db.query.numberingSeries.findFirst({ where: and(eq(numberingSeries.tenantId, tenantId), eq(numberingSeries.entityType, "SUPPLIER")) });
    if (existing) return existing.id;
  }
  const id = genId();
  await db.insert(numberingSeries).values({
    id, tenantId, entityType: "SUPPLIER", seriesCode: `SUP-${genId().slice(0, 6)}`,
    displayName: "Supplier Series", prefix: "V", seriesSegment: "06", paddingLength: 3, nextNumber: 1, status: "ACTIVE",
    ...overrides,
  });
  return id;
}

describe("Numbering series API tests (Part 7, items 1-15)", () => {
  it("1/2. POST requires auth and ADMIN role", async () => {
    const { POST } = await import("@/app/api/settings/numbering-series/route");
    const noAuth = await POST(makeRequest("/api/settings/numbering-series", { method: "POST", body: { entityType: "SUPPLIER", seriesCode: "X", displayName: "X", prefix: "V" } }));
    expect(noAuth.status).toBe(401);
    const driverCookie = await loginAs("mohammed@riyadh-bulk-water.co", "password123");
    const driverRes = await POST(makeRequest("/api/settings/numbering-series", { method: "POST", cookie: driverCookie, body: { entityType: "SUPPLIER", seriesCode: "X", displayName: "X", prefix: "V" } }));
    expect(driverRes.status).toBe(401);
  });

  it("3/4. creates a SUPPLIER series with prefix V, segment 06, padding 3; formatter preview shows V06001", async () => {
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const { POST } = await import("@/app/api/settings/numbering-series/route");
    const res = await POST(makeRequest("/api/settings/numbering-series", { method: "POST", cookie: adminCookie, body: { entityType: "SUPPLIER", seriesCode: `S-${genId().slice(0, 6)}`, displayName: "Supplier Main", prefix: "V", seriesSegment: "06", paddingLength: 3, nextNumber: 1 } }));
    expect(res.status).toBe(201);
    const created = await res.json();
    const { formatSequenceNumber } = await import("@/lib/numbering");
    expect(formatSequenceNumber({ prefix: created.prefix, seriesSegment: created.seriesSegment, separator: created.separator, paddingLength: created.paddingLength }, created.nextNumber)).toBe("V06001");
  });

  it("5/6/7/8. duplicate entityType/seriesCode per tenant return 409; same values in a different tenant are allowed", async () => {
    const riyadhAdminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const demoAdminCookie = await loginAs("admin@demo-water.co", "password123");
    const { POST } = await import("@/app/api/settings/numbering-series/route");
    const entityType = "WORKSHOP";
    const seriesCode = `WS-${genId().slice(0, 6)}`;
    const first = await POST(makeRequest("/api/settings/numbering-series", { method: "POST", cookie: riyadhAdminCookie, body: { entityType, seriesCode, displayName: "Workshop Series", prefix: "W" } }));
    expect(first.status).toBe(201);
    const dupEntityType = await POST(makeRequest("/api/settings/numbering-series", { method: "POST", cookie: riyadhAdminCookie, body: { entityType, seriesCode: `OTHER-${genId().slice(0, 6)}`, displayName: "Dup Entity", prefix: "W" } }));
    expect(dupEntityType.status).toBe(409);
    const dupSeriesCode = await POST(makeRequest("/api/settings/numbering-series", { method: "POST", cookie: riyadhAdminCookie, body: { entityType: "ITEM", seriesCode, displayName: "Dup Code", prefix: "I" } }));
    expect(dupSeriesCode.status).toBe(409);
    const otherTenant = await POST(makeRequest("/api/settings/numbering-series", { method: "POST", cookie: demoAdminCookie, body: { entityType, seriesCode, displayName: "Other Tenant", prefix: "W" } }));
    expect(otherTenant.status).toBe(201);
  });

  it("9/10/11. PATCH edits safe fields, but rejects entityType/seriesCode/nextNumber changes", async () => {
    const tenant = await riyadh();
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const seriesId = await makeSupplierSeries(tenant!.id, { entityType: "DRIVER", seriesCode: `DRV-${genId().slice(0, 6)}` });
    const { PATCH } = await import("@/app/api/settings/numbering-series/[id]/route");
    const editDisplayName = await PATCH(makeRequest(`/api/settings/numbering-series/${seriesId}`, { method: "PATCH", cookie: adminCookie, body: { displayName: "Renamed" } }), { params: { id: seriesId } });
    expect(editDisplayName.status).toBe(200);
    const rejectEntityType = await PATCH(makeRequest(`/api/settings/numbering-series/${seriesId}`, { method: "PATCH", cookie: adminCookie, body: { entityType: "ITEM" } }), { params: { id: seriesId } });
    expect(rejectEntityType.status).toBe(400);
    const rejectNextNumber = await PATCH(makeRequest(`/api/settings/numbering-series/${seriesId}`, { method: "PATCH", cookie: adminCookie, body: { nextNumber: 999 } }), { params: { id: seriesId } });
    expect(rejectNextNumber.status).toBe(400);
  });

  it("12/13/14/15. rejects invalid entityType, resetPolicy, paddingLength, and nextNumber", async () => {
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const { POST } = await import("@/app/api/settings/numbering-series/route");
    const badEntity = await POST(makeRequest("/api/settings/numbering-series", { method: "POST", cookie: adminCookie, body: { entityType: "NOT_REAL", seriesCode: `X-${genId().slice(0, 6)}`, displayName: "X", prefix: "V" } }));
    expect(badEntity.status).toBe(400);
    const badReset = await POST(makeRequest("/api/settings/numbering-series", { method: "POST", cookie: adminCookie, body: { entityType: "CONTRACT", seriesCode: `X-${genId().slice(0, 6)}`, displayName: "X", prefix: "V", resetPolicy: "WEEKLY" } }));
    expect(badReset.status).toBe(400);
    const badPadding = await POST(makeRequest("/api/settings/numbering-series", { method: "POST", cookie: adminCookie, body: { entityType: "EXPENSE", seriesCode: `X-${genId().slice(0, 6)}`, displayName: "X", prefix: "V", paddingLength: 50 } }));
    expect(badPadding.status).toBe(400);
    const badNextNumber = await POST(makeRequest("/api/settings/numbering-series", { method: "POST", cookie: adminCookie, body: { entityType: "TRIP", seriesCode: `X-${genId().slice(0, 6)}`, displayName: "X", prefix: "V", nextNumber: 0 } }));
    expect(badNextNumber.status).toBe(400);
  });
});

describe("Settings UI tests (Part 7, items 16-21)", () => {
  const settingsSource = fs.readFileSync(path.join(process.cwd(), "app/admin/settings/page.tsx"), "utf8");

  it("16/17. Settings renders the series list and a create form", () => {
    expect(settingsSource).toContain("Configured series");
    expect(settingsSource).toContain("function SeriesForm");
    expect(settingsSource).toContain("+ New Series");
  });

  it("18. preview is computed purely client-side and never calls an API", () => {
    expect(settingsSource).toContain("function previewFormat()");
    const previewFnBody = settingsSource.slice(settingsSource.indexOf("function previewFormat()"), settingsSource.indexOf("async function save()"));
    expect(previewFnBody).not.toContain("fetch(");
  });

  it("19. Settings shows the V06001 example", () => {
    expect(settingsSource).toContain("V06001");
  });

  it("20. nextNumber is rendered read-only (locked), not as an editable field, once a series exists", () => {
    expect(settingsSource).toContain("(locked)");
  });

  it("21. Users/Roles/Permissions remain design pending", () => {
    const matches = settingsSource.match(/Design pending \/ schema required/g) ?? [];
    expect(matches.length).toBe(3);
  });
});

describe("Allocator tests (Part 7, items 22-32)", () => {
  it("22. fails clearly if no active series exists", async () => {
    const tenant = await riyadh();
    await expect(allocateNextNumber({ tenantId: tenant!.id, entityType: "NO_SERIES_FOR_THIS_TEST" })).rejects.toThrow(NoActiveSeriesError);
  });

  it("23. ignores inactive series", async () => {
    const tenant = await riyadh();
    await makeSupplierSeries(tenant!.id, { entityType: "MAINTENANCE_WAREHOUSE", seriesCode: `INACTIVE-${genId().slice(0, 6)}`, status: "INACTIVE" });
    await expect(allocateNextNumber({ tenantId: tenant!.id, entityType: "MAINTENANCE_WAREHOUSE" })).rejects.toThrow(NoActiveSeriesError);
  });

  it("24/25/26/27. returns V06001 then V06002, creates a ledger row each time, and increments nextNumber", async () => {
    const tenant = await riyadh();
    const seriesId = await makeSupplierSeries(tenant!.id, { entityType: "ITEM_GROUP", seriesCode: `IG-${genId().slice(0, 6)}` });
    const first = await allocateNextNumber({ tenantId: tenant!.id, entityType: "ITEM_GROUP" });
    expect(first.generatedNumber).toBe("V06001");
    const second = await allocateNextNumber({ tenantId: tenant!.id, entityType: "ITEM_GROUP" });
    expect(second.generatedNumber).toBe("V06002");
    const ledgerRows = await db.query.numberingSequenceLedger.findMany({ where: eq(numberingSequenceLedger.seriesId, seriesId) });
    expect(ledgerRows.length).toBe(2);
    const updatedSeries = await db.query.numberingSeries.findFirst({ where: eq(numberingSeries.id, seriesId) });
    expect(updatedSeries!.nextNumber).toBe(3);
  });

  it("28/29/30. periodKey is ALL for NEVER, a year for YEARLY, a year-month for MONTHLY", async () => {
    const tenant = await riyadh();
    await makeSupplierSeries(tenant!.id, { entityType: "ITEM_CATEGORY", seriesCode: `NEVER-${genId().slice(0, 6)}`, resetPolicy: "NEVER" });
    const never = await allocateNextNumber({ tenantId: tenant!.id, entityType: "ITEM_CATEGORY" });
    expect(never.periodKey).toBe("ALL");

    await makeSupplierSeries(tenant!.id, { entityType: "ITEM_SUBCATEGORY", seriesCode: `YEARLY-${genId().slice(0, 6)}`, resetPolicy: "YEARLY" });
    const yearly = await allocateNextNumber({ tenantId: tenant!.id, entityType: "ITEM_SUBCATEGORY", date: new Date("2026-05-01") });
    expect(yearly.periodKey).toBe("2026");

    await makeSupplierSeries(tenant!.id, { entityType: "CUSTOMER_SITE", seriesCode: `MONTHLY-${genId().slice(0, 6)}`, resetPolicy: "MONTHLY" });
    const monthly = await allocateNextNumber({ tenantId: tenant!.id, entityType: "CUSTOMER_SITE", date: new Date("2026-05-01") });
    expect(monthly.periodKey).toBe("2026-05");
  });

  it("31. generatedNumber uniqueness is enforced at the DB level (unique index)", async () => {
    const tenant = await riyadh();
    const seriesId = await makeSupplierSeries(tenant!.id, { entityType: "MAINTENANCE_WORK_ORDER", seriesCode: `WO-${genId().slice(0, 6)}` });
    await expect(
      db.insert(numberingSequenceLedger).values([
        { id: genId(), tenantId: tenant!.id, seriesId, entityType: "MAINTENANCE_WORK_ORDER", generatedNumber: "DUPTEST01", sequenceNumber: 1, periodKey: "ALL" },
        { id: genId(), tenantId: tenant!.id, seriesId, entityType: "MAINTENANCE_WORK_ORDER", generatedNumber: "DUPTEST01", sequenceNumber: 2, periodKey: "ALL" },
      ])
    ).rejects.toThrow();
  });

  it("32. concurrent allocations against the same series never produce duplicate numbers (the real duplicate this test caught during development, now fixed)", async () => {
    const tenant = await riyadh();
    await makeSupplierSeries(tenant!.id, { entityType: "PURCHASE_ORDER", seriesCode: `PO-${genId().slice(0, 6)}` });
    const results = await Promise.all(Array.from({ length: 15 }, () => allocateNextNumber({ tenantId: tenant!.id, entityType: "PURCHASE_ORDER" })));
    const numbers = results.map((r) => r.generatedNumber);
    expect(new Set(numbers).size).toBe(15);
  });
});

describe("Supplier pilot tests (Part 7, items 33-45)", () => {
  it("33/34. manual supplier code with a leading zero is preserved exactly, and never allocates a ledger row", async () => {
    const tenant = await riyadh();
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const code = `0${genId().slice(0, 5)}`; // leading-zero code, distinct from Milestone AC's own "015" regression case
    const { POST: createSupplier } = await import("@/app/api/suppliers/route");
    const res = await createSupplier(makeRequest("/api/suppliers", { method: "POST", cookie: adminCookie, body: { supplierCode: code, name: "Manual Code Supplier" } }));
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created.supplierCode).toBe(code);
    const ledgerRows = await db.query.numberingSequenceLedger.findMany({ where: and(eq(numberingSequenceLedger.tenantId, tenant!.id), eq(numberingSequenceLedger.referenceId, created.id)) });
    expect(ledgerRows.length).toBe(0);
  });

  it("35/36/37. blank supplier code auto-generates sequentially with leading zeros preserved", async () => {
    const tenant = await riyadh();
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    await makeSupplierSeries(tenant!.id, { entityType: "SUPPLIER", seriesCode: `AUTO-${genId().slice(0, 6)}` });
    const { POST: createSupplier } = await import("@/app/api/suppliers/route");
    const first = await (await createSupplier(makeRequest("/api/suppliers", { method: "POST", cookie: adminCookie, body: { name: "Auto Supplier One" } }))).json();
    expect(first.supplierCode).toBe("V06001");
    const second = await (await createSupplier(makeRequest("/api/suppliers", { method: "POST", cookie: adminCookie, body: { name: "Auto Supplier Two" } }))).json();
    expect(second.supplierCode).toBe("V06002");
  });

  it("38. no active supplier series returns a clear 400", async () => {
    const demoAdminCookie = await loginAs("admin@demo-water.co", "password123");
    const { POST: createSupplier } = await import("@/app/api/suppliers/route");
    const res = await createSupplier(makeRequest("/api/suppliers", { method: "POST", cookie: demoAdminCookie, body: { name: "No Series Supplier" } }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Configure an active Supplier numbering series in Settings, or enter a valid supplier code."); // AF Part 5 wording
  });

  it("39/40. duplicate manual supplierCode returns 409; the same manual code is allowed in a different tenant", async () => {
    const riyadhAdminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const demoAdminCookie = await loginAs("admin@demo-water.co", "password123");
    const { POST: createSupplier } = await import("@/app/api/suppliers/route");
    const code = `DUP-${genId().slice(0, 6)}`;
    const first = await createSupplier(makeRequest("/api/suppliers", { method: "POST", cookie: riyadhAdminCookie, body: { supplierCode: code, name: "First" } }));
    expect(first.status).toBe(201);
    const dup = await createSupplier(makeRequest("/api/suppliers", { method: "POST", cookie: riyadhAdminCookie, body: { supplierCode: code, name: "Dup" } }));
    expect(dup.status).toBe(409);
    const otherTenant = await createSupplier(makeRequest("/api/suppliers", { method: "POST", cookie: demoAdminCookie, body: { supplierCode: code, name: "Other Tenant" } }));
    expect(otherTenant.status).toBe(201);
  });

  it("41. the generated supplier appears in the supplier list", async () => {
    const tenant = await riyadh();
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    await makeSupplierSeries(tenant!.id, { entityType: "SUPPLIER", seriesCode: `LIST-${genId().slice(0, 6)}` });
    const { POST: createSupplier, GET: getSuppliers } = await import("@/app/api/suppliers/route");
    const created = await (await createSupplier(makeRequest("/api/suppliers", { method: "POST", cookie: adminCookie, body: { name: "Listed Supplier" } }))).json();
    const list = await (await getSuppliers(makeRequest("/api/suppliers", { cookie: adminCookie }))).json();
    expect(list.some((s: any) => s.id === created.id)).toBe(true);
  });

  it("42. supplier PATCH never allocates a new number", async () => {
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const { POST: createSupplier } = await import("@/app/api/suppliers/route");
    const created = await (await createSupplier(makeRequest("/api/suppliers", { method: "POST", cookie: adminCookie, body: { supplierCode: `PATCH-${genId().slice(0, 6)}`, name: "Patch Test" } }))).json();
    const { PATCH: updateSupplier } = await import("@/app/api/suppliers/[id]/route");
    const patchSource = fs.readFileSync(path.join(process.cwd(), "app/api/suppliers/[id]/route.ts"), "utf8");
    expect(patchSource).not.toContain("allocateNextNumber");
    const updated = await (await updateSupplier(makeRequest(`/api/suppliers/${created.id}`, { method: "PATCH", cookie: adminCookie, body: { name: "Renamed" } }), { params: { id: created.id } })).json();
    expect(updated.supplierCode).toBe(created.supplierCode);
  });

  it("43/44/45. supplier numbering never creates PR/PO, never touches customer billing, and never touches inventory balances", async () => {
    const source = fs.readFileSync(path.join(process.cwd(), "app/api/suppliers/route.ts"), "utf8");
    expect(source).not.toContain("purchaseOrders");
    expect(source).not.toContain("purchaseRequisitions");
    expect(source).not.toContain("invoices");
    expect(source).not.toContain("maintenanceInventoryBalances");
  });
});

describe("Regression protection (Milestone AE)", () => {
  it("46. AC's blank-email supplier fix still works alongside the pilot conversion", async () => {
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const { POST: createSupplier } = await import("@/app/api/suppliers/route");
    const res = await createSupplier(makeRequest("/api/suppliers", { method: "POST", cookie: adminCookie, body: { supplierCode: `EMAIL-${genId().slice(0, 6)}`, name: "Email Test", email: "" } }));
    expect(res.status).toBe(201);
  });

  it("47. AD's read-only numbering APIs still work", async () => {
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const { GET } = await import("@/app/api/settings/numbering-entity-types/route");
    const res = await GET(makeRequest("/api/settings/numbering-entity-types", { cookie: adminCookie }));
    expect(res.status).toBe(200);
    expect((await res.json()).length).toBe(21); // AF added LOADING_POINT
  });

  it("48. Z.2 master data CRUD still works", async () => {
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const { GET } = await import("@/app/api/workshops/route");
    const res = await GET(makeRequest("/api/workshops", { cookie: adminCookie }));
    expect(res.status).toBe(200);
  });

  it("50. Task P.2 contract-priced invoice markers remain unchanged", () => {
    const stopRoute = fs.readFileSync(path.join(process.cwd(), "app/api/trips/[id]/stops/[stopId]/route.ts"), "utf8");
    expect(stopRoute).toContain("Task P.2");
  });

  it("51. Milestone W POD gate remains unchanged", () => {
    const stopRoute = fs.readFileSync(path.join(process.cwd(), "app/api/trips/[id]/stops/[stopId]/route.ts"), "utf8");
    expect(stopRoute).toContain("autoCloseTripIfAllStopsResolved");
  });

  it("no other entity was converted to automatic numbering — customers/orders/trips/contracts/expenses creation routes are unchanged", () => {
    const ordersSource = fs.readFileSync(path.join(process.cwd(), "app/api/orders/route.ts"), "utf8");
    const customersSource = fs.readFileSync(path.join(process.cwd(), "app/api/customers/route.ts"), "utf8");
    expect(ordersSource).not.toContain("allocateNextNumber");
    expect(customersSource).not.toContain("allocateNextNumber");
  });

  it("no existing supplier record was retroactively renumbered — no bulk update logic exists anywhere in the pilot conversion", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "app/api/suppliers/route.ts"), "utf8");
    expect(source).not.toContain("UPDATE suppliers SET");
    expect(source).not.toMatch(/db\.update\(suppliers\)\.set\(\{\s*supplierCode/);
  });

  it("no pricing, billing, or ERP file was modified", () => {
    const pricingSource = fs.readFileSync(path.join(process.cwd(), "lib/contractPricing.ts"), "utf8");
    const erpSource = fs.readFileSync(path.join(process.cwd(), "lib/erp/sync.ts"), "utf8");
    expect(pricingSource).toContain("PricingEngineError");
    expect(erpSource).not.toContain("allocateNextNumber");
  });

  it("dispatch and driver app runtime files were not modified in this milestone", () => {
    const dispatchSource = fs.readFileSync(path.join(process.cwd(), "app/dispatch/page.tsx"), "utf8");
    const driverSource = fs.readFileSync(path.join(process.cwd(), "app/driver/page.tsx"), "utf8");
    expect(dispatchSource).not.toContain("allocateNextNumber");
    expect(driverSource).not.toContain("allocateNextNumber");
  });

  it("no passwordHash exposure in any changed file", () => {
    const files = ["lib/numbering.ts", "app/api/suppliers/route.ts", "app/api/settings/numbering-series/route.ts", "app/api/settings/numbering-series/[id]/route.ts", "app/admin/settings/page.tsx", "app/admin/procurement/page.tsx"];
    const combined = files.map((f) => fs.readFileSync(path.join(process.cwd(), f), "utf8")).join("\n");
    expect(combined).not.toContain("passwordHash");
  });
});
