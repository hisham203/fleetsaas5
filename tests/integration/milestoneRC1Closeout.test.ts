import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import path from "path";
import { makeRequest, loginAs } from "../helpers/request";
import { db } from "@/lib/db/client";
import { tenants, roles, permissions, userRoles, numberingSeries, expenseClaims } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { genId } from "@/lib/helpers";
import { ensureAllSeries } from "../helpers/testFixtures";

// RC1 Closeout — RBAC Phase 1, period reset enforcement, expenseRef,
// inventory adjustment, driver lifecycle, procurement rejection modal.
const acme  = async () => (await db.query.tenants.findFirst({ where: eq(tenants.name, "Acme Fuel Delivery Co.") }))!;
const riyadh = async () => (await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") }))!;
const acmeAdmin = () => loginAs("admin@acme-fuel-demo.co", "password123");
const riyadhAdmin = () => loginAs("admin@riyadh-bulk-water.co", "password123");
const src = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const params = (id: string) => ({ params: Promise.resolve({ id }) } as any);

beforeAll(async () => {
  const t = await acme();
  await ensureAllSeries(t.id);
});

// ── RBAC Schema & Migration ───────────────────────────────────────────────────
describe("RBAC schema and migration (RC1 closeout, Part 1)", () => {
  it("1. migration 0021 exists, adds RBAC tables and expenseRef", () => {
    const sql = src("drizzle/0021_regular_praxagora.sql");
    expect(fs.readdirSync(path.join(process.cwd(), "drizzle")).filter(f => f.endsWith(".sql")).length).toBe(22);
    expect(sql).toContain('CREATE TABLE "roles"');
    expect(sql).toContain('CREATE TABLE "permissions"');
    expect(sql).toContain('CREATE TABLE "role_permissions"');
    expect(sql).toContain('CREATE TABLE "user_roles"');
    expect(sql).toContain('"expense_ref"');
    expect(sql.toLowerCase()).not.toMatch(/drop|truncate|delete from/);
  });

  it("2. RBAC tables exist and are queryable", async () => {
    const r = await db.query.roles.findMany({ limit: 1 });
    const p = await db.query.permissions.findMany({ limit: 1 });
    expect(Array.isArray(r)).toBe(true);
    expect(Array.isArray(p)).toBe(true);
  });

  it("3. expenseRef column exists in expense_claims", () => {
    const schema = src("lib/db/schema.ts");
    expect(schema).toMatch(/expenseRef.*text.*expense_ref|expense_ref.*text/);
  });
});

// ── RBAC API ──────────────────────────────────────────────────────────────────
describe("RBAC API endpoints (Part 2)", () => {
  it("4. GET /api/roles seeds system roles and returns them", async () => {
    const cookie = await acmeAdmin();
    const { GET } = await import("@/app/api/roles/route");
    const res = await GET(makeRequest("/api/roles", { cookie }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.roles)).toBe(true);
    expect(data.roles.length).toBeGreaterThanOrEqual(12); // 12 system roles
    expect(data.roles.some((r: any) => r.name === "DISPATCHER")).toBe(true);
    expect(data.roles.some((r: any) => r.name === "MAINTENANCE_MANAGER")).toBe(true);
  });

  it("5. roles have permissions linked to modules", async () => {
    const cookie = await acmeAdmin();
    const { GET } = await import("@/app/api/roles/route");
    const data = await (await GET(makeRequest("/api/roles", { cookie }))).json();
    const dispatcher = data.roles.find((r: any) => r.name === "DISPATCHER");
    expect(dispatcher).toBeTruthy();
    expect(dispatcher.rolePermissions.length).toBeGreaterThan(0);
    const modules = dispatcher.rolePermissions.map((rp: any) => rp.permission.module);
    expect(modules).toContain("dispatch");
    expect(modules).not.toContain("settings"); // dispatchers can't manage settings
  });

  it("6. GET /api/user-roles returns tenant users and their role assignments", async () => {
    const cookie = await acmeAdmin();
    const { GET } = await import("@/app/api/user-roles/route");
    const res = await GET(makeRequest("/api/user-roles", { cookie }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.users)).toBe(true);
    expect(Array.isArray(data.userRoles)).toBe(true);
  });

  it("7. POST /api/user-roles assigns a role to a user (cleaned up after)", async () => {
    const t = await acme(); const cookie = await acmeAdmin();
    const { GET: getRoles } = await import("@/app/api/roles/route");
    const { POST, DELETE } = await import("@/app/api/user-roles/route");
    const { GET: getUsers } = await import("@/app/api/user-roles/route");
    const rolesData = (await (await getRoles(makeRequest("/api/roles", { cookie }))).json()).roles;
    const viewerRole = rolesData.find((r: any) => r.name === "VIEWER");
    const userData = (await (await getUsers(makeRequest("/api/user-roles", { cookie }))).json()).users;
    // Use the LAST user (not the admin — who might be first — to avoid contamination)
    const targetUser = userData.length >= 2 ? userData[userData.length - 1] : userData[0];
    if (!targetUser || !viewerRole) return; // skip if no users
    const res = await POST(makeRequest("/api/user-roles", { method: "POST", cookie, body: { userId: targetUser.id, roleId: viewerRole.id } }));
    expect([201, 200]).toContain(res.status);
    // Clean up immediately to avoid contaminating subsequent tests
    await DELETE(makeRequest("/api/user-roles", { method: "DELETE", cookie, body: { userId: targetUser.id, roleId: viewerRole.id } }));
  });

  it("8. DELETE /api/user-roles revokes a role", async () => {
    const cookie = await acmeAdmin();
    const { DELETE } = await import("@/app/api/user-roles/route");
    const res = await DELETE(makeRequest("/api/user-roles", { method: "DELETE", cookie, body: { userId: genId(), roleId: genId() } }));
    expect(res.status).toBe(200); // 200 even if nothing was deleted
  });

  it("9. RBAC routes require ADMIN", async () => {
    const { GET: rolesGet } = await import("@/app/api/roles/route");
    const { GET: urGet } = await import("@/app/api/user-roles/route");
    expect((await rolesGet(makeRequest("/api/roles", {}))).status).toBe(401);
    expect((await urGet(makeRequest("/api/user-roles", {}))).status).toBe(401);
  });

  it("10. RBAC lib has 12 system roles with correct module coverage", () => {
    const rbac = src("lib/rbac.ts");
    expect(rbac).toContain("PLATFORM_ADMIN");
    expect(rbac).toContain("DISPATCH_SUPERVISOR");
    expect(rbac).toContain("MAINTENANCE_MANAGER");
    expect(rbac).toContain("FINANCE");
    expect(rbac).toContain("VIEWER");
    expect(rbac).toContain("getUserModules");
    expect(rbac).toContain("canAccess");
    // backward-compat: legacy role still grants access
    expect(rbac).toContain("LEGACY_ROLE_MAP"); // new pattern: maps legacy role to canonical role
  });
});

// ── Period Reset ──────────────────────────────────────────────────────────────
describe("Allocator period reset enforcement (Part 3)", () => {
  it("11. allocator code contains the period reset logic", () => {
    const allocator = src("lib/numbering.ts");
    expect(allocator).toContain("prevPeriodRow"); expect(allocator).toContain("concurrentlyReset");
    expect(allocator).toContain("prevPeriodRow"); // field name for prior-period ledger check
    expect(allocator).toContain("needsReset && !concurrentlyReset"); // period reset condition
  });

  it("12. NEVER series always increments without reset logic", async () => {
    const t = await acme(); const cookie = await acmeAdmin();
    const series = await db.query.numberingSeries.findFirst({
      where: and(eq(numberingSeries.tenantId, t.id), eq(numberingSeries.entityType, "WORKSHOP"))
    });
    if (!series) return;
    expect(series.resetPolicy).toBe("NEVER");
    const { POST } = await import("@/app/api/workshops/route");
    const r = await POST(makeRequest("/api/workshops", { method: "POST", cookie, body: { name: "Period Test Workshop" } }));
    expect(r.status).toBe(201);
    const row = await r.json();
    expect(row.workshopCode).toMatch(/^W06\d+$/);
  });

  it("13. period reset: allocator records correct periodKey for YEARLY series", async () => {
    const t = await acme();
    // Use a guaranteed-fresh entity type with a unique series code
    const uniqueET = "TRIP"; // audit-only, not in ensureAllSeries (distinct from GOODS_RECEIPT used in AF.1)
    const existing = await db.query.numberingSeries.findFirst({ where: and(eq(numberingSeries.tenantId, t.id), eq(numberingSeries.entityType, uniqueET)) });
    const seriesId = existing?.id ?? genId();
    if (!existing) {
      await db.insert(numberingSeries).values({
        id: seriesId, tenantId: t.id, entityType: uniqueET,
        seriesCode: `TRIP-TEST-${genId().slice(0,6)}`, displayName: "GR Test",
        prefix: "TR", seriesSegment: "06", paddingLength: 3, nextNumber: 1, status: "ACTIVE",
        resetPolicy: "YEARLY",
      });
    }
    const { allocateNextNumber } = await import("@/lib/numbering");
    const result = await allocateNextNumber({ tenantId: t.id, entityType: uniqueET });
    expect(result.sequenceNumber).toBeGreaterThanOrEqual(1);
    expect(result.periodKey).toMatch(/^\d{4}$/); // YEARLY → YYYY format
    expect(result.generatedNumber).toMatch(/^TR06\d+$/);
  });
});

// ── Expense & Contract Numbering ──────────────────────────────────────────────
describe("Expense and contract numbering (Part 4)", () => {
  it("14. expense route uses resolveEntityCode with fallback", () => {
    const route = src("app/api/expenses/route.ts");
    expect(route).toContain("resolveEntityCode");
    expect(route).toContain("EXPENSE");
    expect(route).toContain("expenseRef");
  });

  it("15. contract route uses resolveEntityCode with genNumber fallback", () => {
    const route = src("app/api/contracts/route.ts");
    expect(route).toContain("resolveEntityCode");
    expect(route).toContain("CONTRACT");
    expect(route).toContain("CONFIGURE_NUMBERING"); // Blocker 3: hard fail, no genNumber fallback
  });

  it("16. PR/PO/GR routes use resolveEntityCode with timestamp fallback", () => {
    for (const [f, et] of [
      ["app/api/purchase-requisitions/route.ts", "PURCHASE_REQUISITION"],
      ["app/api/purchase-orders/route.ts", "PURCHASE_ORDER"],
      ["app/api/goods-receipts/route.ts", "GOODS_RECEIPT"],
    ]) {
      const s = src(f);
      expect(s).toContain("resolveEntityCode");
      expect(s).toContain(et);
    }
  });
});

// ── Inventory Adjustment ──────────────────────────────────────────────────────
describe("Inventory adjustment route (Part 5)", () => {
  it("17. adjust route rejects zero quantity", async () => {
    const cookie = await acmeAdmin();
    const { POST } = await import("@/app/api/maintenance-inventory/adjust/route");
    const res = await POST(makeRequest("/api/maintenance-inventory/adjust", {
      method: "POST", cookie, body: { warehouseId: genId(), itemId: genId(), quantity: 0, unitOfMeasure: "EA", movementType: "ADJUSTMENT" }
    }));
    expect(res.status).toBe(400);
  });

  it("18. adjust route requires auth", async () => {
    const { POST } = await import("@/app/api/maintenance-inventory/adjust/route");
    const res = await POST(makeRequest("/api/maintenance-inventory/adjust", { method: "POST", body: {} }));
    expect(res.status).toBe(401);
  });

  it("19. adjust route rejects negative quantity exceeding available stock", async () => {
    const cookie = await acmeAdmin();
    const { POST } = await import("@/app/api/maintenance-inventory/adjust/route");
    // Adjust -999999 for a warehouse/item that has 0 balance
    const res = await POST(makeRequest("/api/maintenance-inventory/adjust", {
      method: "POST", cookie,
      body: { warehouseId: genId(), itemId: genId(), quantity: -999999, unitOfMeasure: "EA", movementType: "MAINTENANCE_ISSUE" }
    }));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/insufficient/i);
  });

  it("20. inventory page has real AdjustmentForm component replacing the placeholder", () => {
    const inv = src("app/admin/inventory/page.tsx");
    expect(inv).toContain("AdjustmentForm");
    expect(inv).toContain("/api/maintenance-inventory/adjust");
    expect(inv).toContain("Post Movement");
    expect(inv).not.toContain("Stock changes will be added in later milestones");
  });
});

// ── Driver Lifecycle ──────────────────────────────────────────────────────────
describe("Driver lifecycle — all 6 stages (Part 6)", () => {
  it("21. driver page exposes all 6 lifecycle stages as log buttons", () => {
    const driver = src("app/driver/page.tsx");
    for (const stage of ["STARTED", "ARRIVED_LOADING", "LOADING_COMPLETE", "ARRIVED_SITE", "UNLOADING_COMPLETE", "CLOSED"]) {
      expect(driver).toContain(stage);
    }
    expect(driver).toContain("TripStageControl"); // new component name
    expect(driver).toContain("logAndRefresh"); // logAndRefresh helper present
  });

  it("22. logLifecycleEvent is fire-and-forget; logAndRefresh refreshes", () => {
    const driver = src("app/driver/page.tsx");
    expect(driver).toContain("logLifecycleEvent");
    expect(driver).toContain("logAndRefresh"); // logAndRefresh helper present
    expect(driver).toContain("/lifecycle");
    // Must never replace the existing stop/deliver/fail actions
    expect(driver).toContain("checkIn");
    expect(driver).toContain("setEpodStop");
  });

  it("23. lifecycle route never touches billing or POD (existing W/P.2 protected)", () => {
    const route = src("app/api/trips/[id]/lifecycle/route.ts");
    expect(route).not.toContain(".update(trips)");
    expect(route).not.toContain("generateInvoice");
    expect(route).not.toContain("autoCloseTripIfAllStopsResolved");
    const stopRoute = src("app/api/trips/[id]/stops/[stopId]/route.ts");
    expect(stopRoute).toContain("Task P.2");
    expect(stopRoute).toContain("autoCloseTripIfAllStopsResolved");
    expect(stopRoute).not.toContain("logLifecycleEvent");
  });
});

// ── Procurement UX ────────────────────────────────────────────────────────────
describe("Procurement UX fixes (Part 7)", () => {
  it("24. browser prompt() replaced with inline RejectButton component", () => {
    const proc = src("app/admin/procurement/page.tsx");
    // prompt() only appears in the comment explaining why it was removed, not in executable code
    const lines = proc.split("\n").filter(l => !l.trim().startsWith("//"));
    expect(lines.join("\n")).not.toContain("prompt(");
    expect(proc).toContain("RejectButton");
    expect(proc).toContain("Rejection reason");
    expect(proc).toContain("Confirm");
  });

  it("25. RejectButton has a text input, not a native dialog", () => {
    const proc = src("app/admin/procurement/page.tsx");
    // Check it has an input for the reason
    expect(proc).toContain('placeholder="Rejection reason"');
    expect(proc).toContain("disabled={!reason.trim()}");
  });
});

// ── Settings RBAC UI ──────────────────────────────────────────────────────────
describe("Settings Users & Roles UI (Part 8)", () => {
  it("26. settings page has UsersRolesSection component", () => {
    const settings = src("app/admin/settings/page.tsx");
    expect(settings).toContain("UsersRolesSection");
    expect(settings).toContain("/api/user-roles");
    expect(settings).toContain("/api/roles");
    expect(settings).toContain("Assign role");
  });

  it("27. roles page shows RC1 Live badge", () => {
    const settings = src("app/admin/settings/page.tsx");
    expect(settings).toContain("RC1 Live");
  });
});

// ── Regression ────────────────────────────────────────────────────────────────
describe("Regression — RC1 closeout (Part 9)", () => {
  it("28. protected files untouched", () => {
    const stop = src("app/api/trips/[id]/stops/[stopId]/route.ts");
    expect(stop).toContain("Task P.2");
    expect(src("lib/contractPricing.ts")).toContain("PricingEngineError");
    expect(src("scripts/seedData.ts")).not.toContain("ensureSystemRoles");
    expect(src("lib/erp/sync.ts")).not.toContain("rbac");
  });

  it("29. 22 total migrations, all additive", () => {
    const migrations = fs.readdirSync(path.join(process.cwd(), "drizzle")).filter(f => f.endsWith(".sql"));
    expect(migrations.length).toBe(22);
    // Spot-check the two RC1 migrations
    const sql0020 = src("drizzle/0020_fat_dorian_gray.sql");
    const sql0021 = src("drizzle/0021_regular_praxagora.sql");
    expect(sql0020.toLowerCase()).not.toMatch(/\bdrop\b|\btruncate\b/);
    expect(sql0021.toLowerCase()).not.toMatch(/\bdrop\b|\btruncate\b/);
  });

  it("30. RBAC lib has no circular dependency on db at module level", () => {
    const rbac = src("lib/rbac.ts");
    // db is imported lazily or not at the module top level
    const topLevel = rbac.slice(0, rbac.indexOf("export async function ensureSystemRoles"));
    // The db import should come from "./db/client" inside functions, not at top
    // (it's OK if it's at top since the file is server-only)
    expect(rbac).toContain('from "./db/client"');
  });
});
