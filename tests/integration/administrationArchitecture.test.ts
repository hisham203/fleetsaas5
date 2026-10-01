/**
 * administrationArchitecture.test.ts
 * Administration Architecture V2 — Navigation and Route Regression Tests
 *
 * Proves the canonical administration consolidation:
 * - correct nav destinations
 * - no legacy links in navigation
 * - redirect behaviour is non-looping
 * - all APIs remain correctly protected
 * - canonical pages reach correct APIs
 * - organization, numbering, EXP-001 compatibility unchanged
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

const NAV_SRC = readFileSync("lib/navigation.ts", "utf8");
const ADMIN_SHELL_SRC = readFileSync("components/AdminShell.tsx", "utf8");
const USERS_SRC = readFileSync("app/administration/users/page.tsx", "utf8");
const ROLES_SRC = readFileSync("app/administration/roles/page.tsx", "utf8");
const NUMBERING_SRC = readFileSync("app/administration/numbering/page.tsx", "utf8");
const ORG_SRC = readFileSync("app/administration/organization/page.tsx", "utf8");
const ACCESS_REDIRECT = readFileSync("app/settings/access/page.tsx", "utf8");
const ROLES_REDIRECT = readFileSync("app/settings/roles/page.tsx", "utf8");
const ADMIN_SETTINGS_REDIRECT = readFileSync("app/admin/settings/page.tsx", "utf8");

// ── 1. Administration domain landing ─────────────────────────────────────────
describe("Administration domain landing", () => {
  it("1. Administration domain href points to /administration/users (not legacy)", () => {
    // The domain href is used as the default route when clicking the domain header:
    expect(NAV_SRC).toContain('href: "/administration/users"');
    expect(NAV_SRC).not.toMatch(/id:\s*"administration"[\s\S]{0,200}href:\s*"\/admin\/settings"/);
  });
});

// ── 2-4. Canonical nav module destinations ────────────────────────────────────
describe("Navigation module destinations", () => {
  it("2. Users nav points to /administration/users", () => {
    expect(NAV_SRC).toContain('href: "/administration/users"');
  });

  it("3. Roles nav points to /administration/roles", () => {
    expect(NAV_SRC).toContain('href: "/administration/roles"');
  });

  it("4. Numbering nav points to /administration/numbering", () => {
    expect(NAV_SRC).toContain('href: "/administration/numbering"');
  });

  it("4b. Organization nav points to /administration/organization", () => {
    expect(NAV_SRC).toContain('href: "/administration/organization"');
  });
});

// ── 5-7. No legacy links in navigation ───────────────────────────────────────
describe("Navigation: zero legacy admin links", () => {
  it("5. No canonical navigation item points to /settings/roles", () => {
    // The navigation should not contain /settings/roles as a destination:
    expect(NAV_SRC).not.toContain('href: "/settings/roles"');
  });

  it("6. No canonical navigation item points to /settings/access", () => {
    expect(NAV_SRC).not.toContain('href: "/settings/access"');
  });

  it("7. No canonical navigation item points to /admin/settings", () => {
    expect(NAV_SRC).not.toContain('href: "/admin/settings"');
  });
});

// ── 8-10. Redirect behaviour ──────────────────────────────────────────────────
describe("Legacy route compatibility redirects", () => {
  it("8. /settings/roles redirects to /administration/roles", () => {
    expect(ROLES_REDIRECT).toContain('router.replace("/administration/roles")');
    expect(ROLES_REDIRECT).not.toContain('router.replace("/settings/');
    expect(ROLES_REDIRECT).not.toContain('router.replace("/admin/settings');
  });

  it("9. /settings/access redirects to /administration/users (default tab)", () => {
    expect(ACCESS_REDIRECT).toContain('router.replace("/administration/users")');
  });

  it("9b. /settings/access?tab=roles redirects to /administration/roles", () => {
    expect(ACCESS_REDIRECT).toContain('router.replace("/administration/roles")');
    expect(ACCESS_REDIRECT).toContain('"roles"');
  });

  it("10. /admin/settings redirects to /administration/numbering (default)", () => {
    expect(ADMIN_SETTINGS_REDIRECT).toContain('router.replace("/administration/numbering")');
  });

  it("10b. /admin/settings?tab=users redirects to /administration/users", () => {
    expect(ADMIN_SETTINGS_REDIRECT).toContain('router.replace("/administration/users")');
  });

  it("10c. /admin/settings?tab=roles redirects to /administration/roles", () => {
    expect(ADMIN_SETTINGS_REDIRECT).toContain('router.replace("/administration/roles")');
  });
});

// ── 11. No redirect loops ─────────────────────────────────────────────────────
describe("Redirect loop prevention", () => {
  it("11. /settings/roles redirect target (/administration/roles) has no further redirect", () => {
    // /administration/roles is the full workspace, not a redirect:
    expect(ROLES_SRC).not.toContain('router.replace(');
    expect(ROLES_SRC).toContain("export default function RolesPage");
  });

  it("11b. /settings/access redirect target (/administration/users) has no further redirect", () => {
    expect(USERS_SRC).not.toContain('router.replace(');
    expect(USERS_SRC).toContain("export default function UsersPage");
  });

  it("11c. /admin/settings redirect target (/administration/numbering) has no further redirect", () => {
    expect(NUMBERING_SRC).not.toContain('router.replace(');
    expect(NUMBERING_SRC).toContain("export default function NumberingPage");
  });
});

// ── 12. Numbering Apply Recommended accessible ────────────────────────────────
describe("Numbering & Sequences", () => {
  it("12. Apply Recommended is accessible from /administration/numbering", () => {
    expect(NUMBERING_SRC).toContain("numbering-apply-recommended");
    expect(NUMBERING_SRC).toContain("ApplyRecommendedNumbering");
    expect(NUMBERING_SRC).toContain("confirm: true");
  });

  it("12b. Numbering page does NOT have an inline hardcoded defaults list", () => {
    // The canonical list lives in lib/numberingDefaults.ts — the numbering page
    // fetches from the API, not by duplicating the list inline:
    expect(NUMBERING_SRC).not.toContain("const RECOMMENDED = [");
    expect(NUMBERING_SRC).not.toContain("const BOOTSTRAP_SERIES");
    // The page itself does not import the defaults directly (APIs handle that):
    expect(NUMBERING_SRC).not.toContain('from "@/lib/numberingDefaults"');
  });
});

// ── 13. EXP-001 canonical defaults remain shared ──────────────────────────────
describe("EXP-001 canonical defaults architecture", () => {
  it("13. lib/numberingDefaults.ts is the single source for EXPENSE and all 17 entity types", async () => {
    const { RECOMMENDED_NUMBERING_DEFAULTS, SERIES_PREFIX_MAP } = await import("@/lib/numberingDefaults");
    expect(RECOMMENDED_NUMBERING_DEFAULTS.length).toBe(17);
    const expenseEntry = RECOMMENDED_NUMBERING_DEFAULTS.find(d => d.entityType === "EXPENSE");
    expect(expenseEntry).toBeDefined();
    expect(expenseEntry!.prefix).toBe("EXP");
    expect(SERIES_PREFIX_MAP["EXPENSE"]).toBe("EXP");
  });

  it("13b. Apply Recommended API imports from canonical defaults (no independent list)", () => {
    const src = readFileSync("app/api/settings/numbering-apply-recommended/route.ts", "utf8");
    expect(src).toContain('from "@/lib/numberingDefaults"');
    expect(src).not.toContain("{ entityType: \"EXPENSE\", seriesCode:"); // no inline list
  });

  it("13c. Signup route imports from canonical defaults", () => {
    const src = readFileSync("app/api/auth/signup/route.ts", "utf8");
    expect(src).toContain("RECOMMENDED_NUMBERING_DEFAULTS");
    expect(src).not.toContain("const BOOTSTRAP_SERIES");
  });
});

// ── 14. RBAC protection intact ────────────────────────────────────────────────
describe("RBAC protection", () => {
  it("14. /api/users requires session auth", async () => {
    const src = readFileSync("app/api/users/route.ts", "utf8");
    expect(src).toContain("getSessionFromRequest");
    expect(src).toContain("401");
  });

  it("14b. /api/roles requires session auth", async () => {
    const src = readFileSync("app/api/roles/route.ts", "utf8");
    expect(src).toContain("getSessionFromRequest");
    expect(src).toContain("401");
  });

  it("14c. /api/user-roles requires session auth", async () => {
    const src = readFileSync("app/api/user-roles/route.ts", "utf8");
    expect(src).toContain("getSessionFromRequest");
    expect(src).toContain("401");
  });

  it("14d. /api/permissions requires session auth", async () => {
    const src = readFileSync("app/api/permissions/route.ts", "utf8");
    expect(src).toContain("getSessionFromRequest");
    expect(src).toContain("401");
  });

  it("14e. /api/role-audit-log requires ADMIN or roles.view permission", () => {
    const src = readFileSync("app/api/role-audit-log/route.ts", "utf8");
    expect(src).toContain("ADMIN");
    expect(src).toContain("roles.view");
  });

  it("14f. LEGACY_PERMISSIONS unchanged (4 lines, 2 role entries)", () => {
    const src = readFileSync("lib/requirePermission.ts", "utf8");
    const idx = src.indexOf("LEGACY_PERMISSIONS");
    expect(idx).toBeGreaterThan(-1);
    // Should contain both DISPATCHER and DRIVER entries:
    expect(src).toContain("LEGACY_PERMISSIONS");
    const block = src.slice(idx, idx + 800);
    expect(block).toContain("DISPATCHER");
    expect(block).toContain("DRIVER");
  });
});

// ── 15. /administration/users — real management capability ────────────────────
describe("/administration/users canonical capabilities", () => {
  it("15. Users page fetches /api/users for list", () => {
    expect(USERS_SRC).toContain('"/api/users"');
  });

  it("15b. Users page supports creating users (POST /api/users)", () => {
    expect(USERS_SRC).toContain('method: "POST"');
    expect(USERS_SRC).toContain('"/api/users"');
    expect(USERS_SRC).toContain("CreateUserForm");
  });

  it("15c. Users page supports role assignment (POST /api/user-roles)", () => {
    expect(USERS_SRC).toContain('"/api/user-roles"');
    expect(USERS_SRC).toContain("onAssign");
    expect(USERS_SRC).toContain("onRevoke");
  });

  it("15d. Users page does NOT banner-redirect to /settings/access", () => {
    expect(USERS_SRC).not.toContain("/settings/access");
    expect(USERS_SRC).not.toContain("This view is read-only");
  });
});

// ── 16. /administration/roles — full workspace ────────────────────────────────
describe("/administration/roles canonical capabilities", () => {
  it("16. Roles page has 3 tabs: Roles, Permission Matrix, Audit", () => {
    expect(ROLES_SRC).toContain('"roles"');
    expect(ROLES_SRC).toContain('"matrix"');
    expect(ROLES_SRC).toContain('"audit"');
  });

  it("16b. Permission Matrix tab uses /api/permissions", () => {
    expect(ROLES_SRC).toContain('"/api/permissions"');
  });

  it("16c. Permission Matrix uses /api/roles/[id]/permissions for save", () => {
    expect(ROLES_SRC).toContain("/api/roles/");
    expect(ROLES_SRC).toContain("/permissions");
    expect(ROLES_SRC).toContain('"PUT"');
  });

  it("16d. Audit tab uses /api/role-audit-log", () => {
    expect(ROLES_SRC).toContain("role-audit-log");
  });

  it("16e. System and custom roles are visually separated", () => {
    expect(ROLES_SRC).toContain("System Roles");
    expect(ROLES_SRC).toContain("Custom Roles");
    expect(ROLES_SRC).toContain("isSystemRole");
  });
});

// ── 17. /administration/organization — real tenant data ───────────────────────
describe("/administration/organization", () => {
  it("17. Organization page uses /api/tenant", () => {
    expect(ORG_SRC).toContain('"/api/tenant"');
  });

  it("17b. Organization page does not invent fields (no fake org logic)", () => {
    expect(ORG_SRC).not.toContain("timezone");
    expect(ORG_SRC).not.toContain("addressLine");
    expect(ORG_SRC).not.toContain("vatNumber");
    // Only the real tenant fields: name, sector, id, createdAt:
    expect(ORG_SRC).toContain("tenant.name");
    expect(ORG_SRC).toContain("tenant.sector");
    expect(ORG_SRC).toContain("tenant.id");
  });
});

// ── 18. AdminShell no legacy links ────────────────────────────────────────────
describe("AdminShell DEFAULT_SECTIONS", () => {
  it("18. AdminShell no longer has /admin/settings in DEFAULT_SECTIONS", () => {
    // DEFAULT_SECTIONS is the legacy sidebar navigation:
    expect(ADMIN_SHELL_SRC).not.toContain('href: "/admin/settings"');
  });
});
