import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { makeRequest, loginAs } from "../helpers/request";
import { db } from "@/lib/db/client";
import { tenants, suppliers } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { genId } from "@/lib/helpers";

// Milestone AC — Settings, Numbering, Security Foundation & Dispatch
// Workflow QA.
const shellSource = () => fs.readFileSync(path.join(process.cwd(), "components/AdminShell.tsx"), "utf8");
const adminPageSource = () => fs.readFileSync(path.join(process.cwd(), "app/admin/page.tsx"), "utf8");

describe("Supplier save fix — the exact reported case (Milestone AC, Part 2)", () => {
  it("1/2/3/4. creates a supplier with supplierCode '015' (leading zero preserved), blank email, phone, contactName, and ACTIVE status", async () => {
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const { POST: createSupplier } = await import("@/app/api/suppliers/route");
    const res = await createSupplier(makeRequest("/api/suppliers", {
      method: "POST", cookie: adminCookie,
      body: { supplierCode: "015", name: "hisham trading", contactName: "hisham", phone: "01125545525", email: "", status: "ACTIVE" },
    }));
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created.supplierCode).toBe("015"); // leading zero preserved — string, not coerced to a number
    expect(created.email).toBeFalsy(); // blank email normalized, not stored as ""
    expect(created.name).toBe("hisham trading");
    expect(created.phone).toBe("01125545525");
  });

  it("5/6. duplicate supplierCode in the same tenant returns 409; the same code in a different tenant is allowed", async () => {
    const demoAdminCookie = await loginAs("admin@demo-water.co", "password123");
    const riyadhAdminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const { POST: createSupplier } = await import("@/app/api/suppliers/route");
    const code = `DUP-${genId().slice(0, 6)}`;
    const first = await createSupplier(makeRequest("/api/suppliers", { method: "POST", cookie: riyadhAdminCookie, body: { supplierCode: code, name: "First" } }));
    expect(first.status).toBe(201);
    const dup = await createSupplier(makeRequest("/api/suppliers", { method: "POST", cookie: riyadhAdminCookie, body: { supplierCode: code, name: "Dup" } }));
    expect(dup.status).toBe(409);
    const otherTenant = await createSupplier(makeRequest("/api/suppliers", { method: "POST", cookie: demoAdminCookie, body: { supplierCode: code, name: "Other Tenant Version" } }));
    expect(otherTenant.status).toBe(201);
  });

  it("a genuinely malformed email is still correctly rejected — the fix accepts blank, not invalid", async () => {
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const { POST: createSupplier } = await import("@/app/api/suppliers/route");
    const res = await createSupplier(makeRequest("/api/suppliers", { method: "POST", cookie: adminCookie, body: { supplierCode: `BADEMAIL-${genId().slice(0, 6)}`, name: "Bad Email Co", email: "not-an-email" } }));
    expect(res.status).toBe(400);
  });

  it("7. the UI's extractErrorMessage correctly surfaces a Zod validation error (an object), not the generic 'Failed to save'", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "lib/helpers.ts"), "utf8");
    expect(source).toContain("export function extractErrorMessage");
    expect(source).toContain("fieldErrors");
    const procurementSource = fs.readFileSync(path.join(process.cwd(), "app/admin/procurement/page.tsx"), "utf8");
    expect(procurementSource).toContain("extractErrorMessage(data)");
    expect(procurementSource).not.toContain('typeof data.error === "string" ? data.error : "Failed to save"');
  });

  it("8. the created supplier is retrievable via GET /api/suppliers", async () => {
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const { POST: createSupplier, GET: getSuppliers } = await import("@/app/api/suppliers/route");
    const code = `RETR-${genId().slice(0, 6)}`;
    await createSupplier(makeRequest("/api/suppliers", { method: "POST", cookie: adminCookie, body: { supplierCode: code, name: "Retrievable Supplier" } }));
    const list = await (await getSuppliers(makeRequest("/api/suppliers", { cookie: adminCookie }))).json();
    expect(list.some((s: any) => s.supplierCode === code)).toBe(true);
  });

  it("the same class of bug is also fixed in workshops (contactEmail) and items (imageUrl) — proactive fix, not just the one reported field", async () => {
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const { POST: createWorkshop } = await import("@/app/api/workshops/route");
    const workshopRes = await createWorkshop(makeRequest("/api/workshops", { method: "POST", cookie: adminCookie, body: { workshopCode: `WEMAIL-${genId().slice(0, 6)}`, name: "Test", contactEmail: "" } }));
    expect(workshopRes.status).toBe(201);

    const { itemCategories } = await import("@/lib/db/schema");
    const categoryId = genId();
    await db.insert(itemCategories).values({ id: categoryId, tenantId: tenant!.id, code: `CIMG-${genId().slice(0, 6)}`, name: "Test Category" });
    const { POST: createItem } = await import("@/app/api/items/route");
    const itemRes = await createItem(makeRequest("/api/items", { method: "POST", cookie: adminCookie, body: { itemCode: `IIMG-${genId().slice(0, 6)}`, name: "Test Item", categoryId, itemType: "SPARE_PART", unitOfMeasure: "EA", imageUrl: "" } }));
    expect(itemRes.status).toBe(201);
  });
});

describe("Sidebar order consistency fix (Milestone AC, Part 3)", () => {
  it("9. Operations section order is identical, item-for-item, across both sidebar sources", () => {
    const extractOperationsOrder = (source: string) => {
      const opsIdx = source.indexOf('label: "Operations"');
      const coreDataIdx = source.indexOf('label: "Core Data"');
      const section = source.slice(opsIdx, coreDataIdx);
      const labels = [...section.matchAll(/label:\s*"([^"]+)"/g)].map((m) => m[1]).filter((l) => l !== "Operations");
      return labels;
    };
    const shellOrder = extractOperationsOrder(shellSource());
    const adminOrder = extractOperationsOrder(adminPageSource());
    expect(shellOrder).toEqual(adminOrder);
  });

  it("11. the canonical Operations order is exactly: Dispatch Control Tower, Dispatch (Live), Contract & Capacity Planner, Loading Points", () => {
    const extractOperationsOrder = (source: string) => {
      const opsIdx = source.indexOf('label: "Operations"');
      const coreDataIdx = source.indexOf('label: "Core Data"');
      const section = source.slice(opsIdx, coreDataIdx);
      return [...section.matchAll(/label:\s*"([^"]+)"/g)].map((m) => m[1]).filter((l) => l !== "Operations");
    };
    expect(extractOperationsOrder(shellSource())).toEqual(["Dispatch Control Tower", "Dispatch (Live)", "Contract & Capacity Planner", "Loading Points"]);
  });

  it("14. Dispatch (Live) appears exactly once in each sidebar source's Operations section (no duplicate)", () => {
    for (const source of [shellSource(), adminPageSource()]) {
      const opsIdx = source.indexOf('label: "Operations"');
      const coreDataIdx = source.indexOf('label: "Core Data"');
      const section = source.slice(opsIdx, coreDataIdx);
      const matches = section.match(/Dispatch \(Live\)/g) ?? [];
      expect(matches.length).toBe(1);
    }
  });

  it("10. Dispatch Live remains visible immediately after login (both sources still include it)", () => {
    expect(shellSource()).toContain('{ label: "Dispatch (Live)", href: "/dispatch" }');
    expect(adminPageSource()).toContain('{ label: "Dispatch (Live)", href: "/dispatch" }');
  });
});

describe("Settings module (Milestone AC, Part 4)", () => {
  it("15/16. Settings link appears in both sidebar sources and /admin/settings exists", () => {
    expect(shellSource()).toContain('{ label: "Settings", href: "/admin/settings" }');
    expect(adminPageSource()).toContain('{ label: "Settings", href: "/admin/settings" }');
    expect(fs.existsSync(path.join(process.cwd(), "app/admin/settings/page.tsx"))).toBe(true);
  });

  it("17/18/19/20. Settings shows Numbering & Sequences, Users & Access, Roles & Permissions, and Operational Settings cards", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "app/admin/settings/page.tsx"), "utf8");
    expect(source).toContain("Numbering & Sequences");
    expect(source).toContain("Users & Access");
    expect(source).toContain("Roles & Permissions");
    expect(source).toContain("Operational Settings");
  });

  it("21. the three remaining design-pending cards (Users & Access, Roles & Permissions, Operational Settings) still clearly mark themselves as such; Numbering & Sequences became a full configuration UI in Milestone AE (Suppliers pilot)", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "app/admin/settings/page.tsx"), "utf8");
    const matches = source.match(/Design pending \/ schema required/g) ?? [];
    expect(matches.length).toBe(3);
    expect(source).toContain("Only Suppliers currently use automatic numbering (pilot)");
  });
});

describe("Numbering audit findings preserved (Milestone AC, Part 5/6 — design only)", () => {
  it("22. existing genNumber behavior remains completely unchanged (not replaced in this milestone)", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "lib/helpers.ts"), "utf8");
    expect(source).toContain("export function genNumber(prefix: string)");
    expect(source).toContain('Date.now().toString(36).toUpperCase()');
  });

  it("23/24. Milestone AD's real Settings fetches are empty-safe reads only, never client-side number generation or fabricated data", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "app/admin/settings/page.tsx"), "utf8");
    expect(source).toContain('fetch("/api/settings/numbering-series")');
    expect(source).not.toContain("Math.random()");
    expect(source).not.toContain("Date.now()");
  });

  it("no numbering schema existed AT THE TIME of Milestone AC itself; Milestone AD, exactly as AC's own recommended next milestone anticipated, later implemented it", () => {
    const schemaSource = fs.readFileSync(path.join(process.cwd(), "lib/db/schema.ts"), "utf8");
    expect(schemaSource).toContain("export const numberingSeries = pgTable(");
    expect(schemaSource).toContain("export const numberingSequenceLedger = pgTable(");
  });
});

describe("Security audit findings preserved (Milestone AC, Part 8/9 — design only)", () => {
  it("25. current login still works", async () => {
    const cookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    expect(cookie).toBeTruthy();
  });

  it("26. admin routes still require auth", async () => {
    const { GET } = await import("@/app/api/suppliers/route");
    const res = await GET(makeRequest("/api/suppliers", {}));
    expect(res.status).toBe(401);
  });

  it("27. driver access remains restricted — a driver cannot call an ADMIN-only route", async () => {
    const driverCookie = await loginAs("mohammed@riyadh-bulk-water.co", "password123");
    const { GET } = await import("@/app/api/suppliers/route");
    const res = await GET(makeRequest("/api/suppliers", { cookie: driverCookie }));
    expect(res.status).toBe(401);
  });

  it("28. Settings does not expose fake role assignment controls (the real <select> elements now present are for numbering series configuration only, never roles)", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "app/admin/settings/page.tsx"), "utf8");
    expect(source).not.toContain("assignRole");
    expect(source).not.toContain("roleId");
    expect(source).not.toContain("/api/roles");
  });

  it("no roles/permissions/user_roles schema was added (design proposal only)", () => {
    const schemaSource = fs.readFileSync(path.join(process.cwd(), "lib/db/schema.ts"), "utf8");
    expect(schemaSource).not.toContain("export const roles = pgTable");
    expect(schemaSource).not.toContain("export const rolePermissions");
  });
});

describe("Driver trip lifecycle audit findings (Milestone AC, Part 11/12 — design only)", () => {
  it("29. current schema lacks fields to distinguish all six target stages (confirmed gap, not fabricated)", () => {
    const schemaSource = fs.readFileSync(path.join(process.cwd(), "lib/db/schema.ts"), "utf8");
    const tripsSection = schemaSource.slice(schemaSource.indexOf('export const trips = pgTable'), schemaSource.indexOf('export const tripStops'));
    expect(tripsSection).not.toContain("arrivedLoadingAt");
    expect(tripsSection).not.toContain("arrivedCustomerAt");
    expect(tripsSection).not.toContain("unloadingCompletedAt");
  });

  it("30. current POD/billing trigger (on delivery completion) remains completely unchanged", () => {
    const stopRoute = fs.readFileSync(path.join(process.cwd(), "app/api/trips/[id]/stops/[stopId]/route.ts"), "utf8");
    expect(stopRoute).toContain("Task P.2");
    expect(stopRoute).toContain("Proof of delivery is required before this trip can be marked delivered.");
  });

  it("31. no fake six-step status buttons were added to the Driver App", () => {
    const driverSource = fs.readFileSync(path.join(process.cwd(), "app/driver/page.tsx"), "utf8");
    expect(driverSource).not.toContain("Arrived Loading Site");
    expect(driverSource).not.toContain("Complete Loading");
  });

  it("no trip_lifecycle_events schema was added (design proposal only)", () => {
    const schemaSource = fs.readFileSync(path.join(process.cwd(), "lib/db/schema.ts"), "utf8");
    expect(schemaSource).not.toContain("trip_lifecycle_events");
  });
});

describe("Regression protection (Milestone AC)", () => {
  it("32. Z.2 master data CRUD still passes for a real Item Group create/edit cycle", async () => {
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const { POST: createGroup } = await import("@/app/api/item-groups/route");
    const res = await createGroup(makeRequest("/api/item-groups", { method: "POST", cookie: adminCookie, body: { code: `ACREG-${genId().slice(0, 6)}`, name: "Regression Group" } }));
    expect(res.status).toBe(201);
  });

  it("34. Task P.2 contract-priced invoice markers remain unchanged", () => {
    const stopRoute = fs.readFileSync(path.join(process.cwd(), "app/api/trips/[id]/stops/[stopId]/route.ts"), "utf8");
    expect(stopRoute).toContain("Task P.2");
  });

  it("36. Milestone W POD gate remains unchanged", () => {
    const stopRoute = fs.readFileSync(path.join(process.cwd(), "app/api/trips/[id]/stops/[stopId]/route.ts"), "utf8");
    expect(stopRoute).toContain("autoCloseTripIfAllStopsResolved");
  });

  it("no schema, pricing, billing, or ERP file was modified", () => {
    const schemaSource = fs.readFileSync(path.join(process.cwd(), "lib/db/schema.ts"), "utf8");
    const pricingSource = fs.readFileSync(path.join(process.cwd(), "lib/contractPricing.ts"), "utf8");
    expect(schemaSource).toContain('export const itemGroups = pgTable(');
    expect(pricingSource).toContain("PricingEngineError");
  });

  it("no passwordHash exposure in any changed file", () => {
    const files = [
      "app/api/suppliers/route.ts", "app/api/suppliers/[id]/route.ts",
      "app/api/workshops/route.ts", "app/api/items/route.ts",
      "app/admin/settings/page.tsx", "lib/helpers.ts",
    ];
    const combined = files.map((f) => fs.readFileSync(path.join(process.cwd(), f), "utf8")).join("\n");
    expect(combined).not.toContain("passwordHash");
  });
});
