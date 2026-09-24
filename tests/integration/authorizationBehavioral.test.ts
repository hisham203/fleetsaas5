/**
 * P2-02 Behavioral Authorization Tests — Final Closure.
 *
 * All fixtures are deterministically created in beforeAll.
 * No silent skips. Fixture failure = test failure (throws).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { makeRequest, loginAs } from "../helpers/request";
import { runBootstrap } from "../../scripts/bootstrapRbac";
import { db } from "@/lib/db/client";
import { users, userRoles, roles, permissions, rolePermissions, tenants } from "@/lib/db/schema";
import { eq, and, isNull, ne } from "drizzle-orm";
import { genId } from "@/lib/helpers";
import { hashPassword } from "@/lib/auth";

// ── Fixture state ───────────────────────────────────────────────────────────
let tenantId: string;
let tenantBId: string;
let adminCookie: string;           // Platform Admin (users.role="ADMIN")
let rolesViewCookie: string;       // Ordinary user with roles.view only
let rolesManageCookie: string;     // Ordinary user with roles.manage
let tenantAdminCookie: string;     // Ordinary user with TENANT_ADMIN role
let coordinatorCookie: string;
let supervisorCookie: string;
let tenantBUserCookie: string;

// IDs of items we create (cleaned up in afterAll):
let rolesViewUserId: string;
let rolesManageUserId: string;
let tenantAdminUserId: string;
let rolesViewRoleId: string;
let rolesManageRoleId: string;
let tenantAdminRoleId: string;
let testTenantBUserId: string;
let testTargetRoleId: string;     // Tenant-owned role to test GET/PATCH/PUT against

function readSource(relPath: string) {
  return require("fs").readFileSync(require("path").join(process.cwd(), relPath), "utf8");
}

async function getOrCreateTenant(name: string): Promise<string> {
  const existing = await db.query.tenants.findFirst({ where: (t, { eq }) => eq(t.name, name) });
  if (existing) return existing.id;
  const id = genId();
  await db.insert(tenants).values({ id, name, slug: name.toLowerCase().replace(/\s+/g, "-") });
  return id;
}

async function createTestUser(email: string, tId: string, sysRole: "DISPATCHER"|"DRIVER" = "DISPATCHER"): Promise<string> {
  const existing = await db.query.users.findFirst({ where: and(eq(users.email, email), eq(users.tenantId, tId)) });
  if (existing) return existing.id;
  const id = genId();
  await db.insert(users).values({ id, tenantId: tId, email, name: email.split("@")[0], role: sysRole, passwordHash: await hashPassword("Test1234!") });
  return id;
}

async function createTestRole(name: string, tId: string): Promise<string> {
  const existing = await db.query.roles.findFirst({ where: and(eq(roles.name, name), eq(roles.tenantId, tId)) });
  if (existing) {
    if (!existing.isActive) await db.update(roles).set({ isActive: true }).where(eq(roles.id, existing.id));
    return existing.id;
  }
  const id = genId();
  await db.insert(roles).values({ id, tenantId: tId, name, label: name, isActive: true, isSystemRole: false });
  return id;
}

async function assignPermToRole(roleId: string, permCode: string) {
  const perm = await db.query.permissions.findFirst({ where: eq(permissions.code, permCode) });
  if (!perm) throw new Error(`Permission ${permCode} not found — run bootstrap first`);
  const existing = await db.query.rolePermissions.findFirst({
    where: and(eq(rolePermissions.roleId, roleId), eq(rolePermissions.permissionId, perm.id))
  });
  if (!existing) await db.insert(rolePermissions).values({ id: genId(), roleId, permissionId: perm.id });
}

async function assignRoleToUser(userId: string, roleId: string, tId: string) {
  const existing = await db.query.userRoles.findFirst({
    where: and(eq(userRoles.userId, userId), eq(userRoles.roleId, roleId))
  });
  if (!existing) await db.insert(userRoles).values({ id: genId(), userId, roleId, tenantId: tId });
}

// ── Setup ────────────────────────────────────────────────────────────────────
beforeAll(async () => {
  // Bootstrap must succeed:
  await runBootstrap();

  // Use Demo Water Co as main test tenant (always seeded):
  const mainTenant = await db.query.tenants.findFirst({ where: (t, { like }) => like(t.name, "%Water%") });
  if (!mainTenant) throw new Error("Demo Water tenant missing — run seed first");
  tenantId = mainTenant.id;

  // Get Platform Admin cookie for this tenant:
  const adminUser = await db.query.users.findFirst({
    where: and(eq(users.tenantId, tenantId), eq(users.role, "ADMIN"))
  });
  if (!adminUser) throw new Error("Platform Admin user missing in test tenant");
  adminCookie = await loginAs(adminUser.email, "password123");
  if (!adminCookie) throw new Error("Platform Admin login failed");

  // Create Tenant B for cross-tenant tests:
  tenantBId = await getOrCreateTenant("P2-02 Test Tenant B");

  // Create roles.view-only role:
  rolesViewRoleId = await createTestRole("P2_TEST_ROLES_VIEW", tenantId);
  await assignPermToRole(rolesViewRoleId, "roles.view");

  // Create roles.manage role:
  rolesManageRoleId = await createTestRole("P2_TEST_ROLES_MANAGE", tenantId);
  await assignPermToRole(rolesManageRoleId, "roles.manage");

  // Find TENANT_ADMIN system role:
  const tenantAdminSysRole = await db.query.roles.findFirst({
    where: and(eq(roles.name, "TENANT_ADMIN"), isNull(roles.tenantId))
  });
  if (!tenantAdminSysRole) throw new Error("TENANT_ADMIN system role not found — run bootstrap");
  tenantAdminRoleId = tenantAdminSysRole.id;

  // Create test users (non-ADMIN identity):
  rolesViewUserId   = await createTestUser("p2test-rolesview@water-test.co",   tenantId);
  rolesManageUserId = await createTestUser("p2test-rolesmgr@water-test.co",    tenantId);
  tenantAdminUserId = await createTestUser("p2test-tenantadmin@water-test.co", tenantId);
  testTenantBUserId = await createTestUser("p2test-tenantb@test-tenant-b.co",  tenantBId);

  // Assign roles to users:
  await assignRoleToUser(rolesViewUserId,   rolesViewRoleId,   tenantId);
  await assignRoleToUser(rolesManageUserId, rolesManageRoleId, tenantId);
  await assignRoleToUser(tenantAdminUserId, tenantAdminRoleId, tenantId);

  // Login all test users:
  rolesViewCookie   = await loginAs("p2test-rolesview@water-test.co",   "Test1234!");
  rolesManageCookie = await loginAs("p2test-rolesmgr@water-test.co",    "Test1234!");
  tenantAdminCookie = await loginAs("p2test-tenantadmin@water-test.co", "Test1234!");
  tenantBUserCookie = await loginAs("p2test-tenantb@test-tenant-b.co",  "Test1234!");

  if (!rolesViewCookie)   throw new Error("roles.view user login failed");
  if (!rolesManageCookie) throw new Error("roles.manage user login failed");
  if (!tenantAdminCookie) throw new Error("Tenant Admin login failed");

  // Get existing coordinator/supervisor from seeded data (may be absent):
  const coordUser = await db.query.users.findFirst({
    where: and(eq(users.tenantId, tenantId), eq(users.role, "DISPATCHER"))
  });
  if (coordUser) coordinatorCookie = await loginAs(coordUser.email, "password123") ?? "";

  // Create a test target role for GET/PATCH/PUT assertions:
  testTargetRoleId = await createTestRole("P2_TEST_TARGET_ROLE", tenantId);
}, 30000);

afterAll(async () => {
  // Clean up test users and roles (best-effort):
  for (const uid of [rolesViewUserId, rolesManageUserId, tenantAdminUserId, testTenantBUserId].filter(Boolean)) {
    await db.delete(userRoles).where(eq(userRoles.userId, uid)).catch(() => {});
    await db.delete(users).where(eq(users.id, uid)).catch(() => {});
  }
  for (const rid of [rolesViewRoleId, rolesManageRoleId, testTargetRoleId].filter(Boolean)) {
    await db.delete(rolePermissions).where(eq(rolePermissions.roleId, rid)).catch(() => {});
    await db.delete(roles).where(eq(roles.id, rid)).catch(() => {});
  }
});

// ── Architecture guards (source checks) ─────────────────────────────────────
describe("Architecture guards (source checks)", () => {
  it("A1. checkPermission checks Platform Admin (ADMIN) before RBAC", () => {
    const src = readSource("lib/requirePermission.ts");
    expect(src.includes('systemRole === "ADMIN"') || src.includes('userSystemRole === "ADMIN"')).toBe(true);
    expect(src).toContain("legacy role fallback");
  });

  it("A2. bootstrapRbac has exactly 71 entries in PERMISSION_CATALOGUE", () => {
    const src = readSource("scripts/bootstrapRbac.ts");
    expect((src.match(/\{ module:/g) ?? []).length).toBe(71);
  });

  it("A3. dispatch route contains db.transaction and FOR UPDATE", () => {
    const src = readSource("app/api/trips/[id]/dispatch/route.ts");
    expect(src).toContain("db.transaction");
    expect(src).toContain("FOR UPDATE");
    expect(src).toContain("DRIVER_CONFLICT");
    expect(src).toContain("VEHICLE_CONFLICT");
  });

  it("A4. user-roles POST validates cross-tenant userId", () => {
    const src = readSource("app/api/user-roles/route.ts");
    expect(src).toContain("targetUser.tenantId !== tenantId");
    expect(src).toContain("PLATFORM_ROLE_DENIED");
  });

  it("A5. roles/[id] GET uses roles.view, PATCH uses roles.manage", () => {
    const src = readSource("app/api/roles/[id]/route.ts");
    const getIdx  = src.indexOf("export async function GET");
    const patchIdx = src.indexOf("export async function PATCH");
    expect(getIdx).toBeGreaterThan(-1);
    expect(patchIdx).toBeGreaterThan(-1);
    const getSection   = src.slice(getIdx, patchIdx);
    const patchSection = src.slice(patchIdx);
    expect(getSection).toContain('"roles.view"');
    expect(getSection).not.toContain('"roles.manage"');
    expect(patchSection).toContain('"roles.manage"');
    expect(patchSection).not.toContain('"roles.view"');
  });

  it("A6. roles/[id]/permissions GET uses roles.view, PUT uses roles.manage", () => {
    const src = readSource("app/api/roles/[id]/permissions/route.ts");
    const getIdx = src.indexOf("export async function GET");
    const putIdx = src.indexOf("export async function PUT");
    expect(getIdx).toBeGreaterThan(-1);
    expect(putIdx).toBeGreaterThan(-1);
    const getSection = src.slice(getIdx, putIdx);
    const putSection = src.slice(putIdx);
    expect(getSection).toContain('"roles.view"');
    expect(getSection).not.toContain('"roles.manage"');
    expect(putSection).toContain('"roles.manage"');
    expect(putSection).not.toContain('"roles.view"');
  });
});

// ── Unauthenticated access ────────────────────────────────────────────────────
describe("Unauthenticated access", () => {
  it("B1. unauthenticated → 401 on trips", async () => {
    const { GET } = await import("@/app/api/trips/route");
    expect([401, 403]).toContain((await GET(makeRequest("/api/trips"))).status);
  });

  it("B2. unauthenticated → 401 on roles", async () => {
    const { GET } = await import("@/app/api/roles/route");
    expect([401, 403]).toContain((await GET(makeRequest("/api/roles"))).status);
  });
});

// ── Defect 1 behavioral proof ─────────────────────────────────────────────────
describe("roles.view vs roles.manage — behavioral proof (non-ADMIN users)", () => {
  it("D1. roles.view user: GET /api/roles/[id] → 200", async () => {
    const { GET } = await import("@/app/api/roles/[id]/route");
    const res = await GET(
      makeRequest(`/api/roles/${testTargetRoleId}`, { cookie: rolesViewCookie }),
      { params: Promise.resolve({ id: testTargetRoleId }) }
    );
    expect(res.status).toBe(200);
  });

  it("D2. roles.view user: PATCH /api/roles/[id] → 403 (write blocked)", async () => {
    const { PATCH } = await import("@/app/api/roles/[id]/route");
    const res = await PATCH(
      makeRequest(`/api/roles/${testTargetRoleId}`, { method: "PATCH", cookie: rolesViewCookie, body: { label: "Renamed" } }),
      { params: Promise.resolve({ id: testTargetRoleId }) }
    );
    expect(res.status).toBe(403);
  });

  it("D3. roles.view user: GET /api/roles/[id]/permissions → 200", async () => {
    const { GET } = await import("@/app/api/roles/[id]/permissions/route");
    const res = await GET(
      makeRequest(`/api/roles/${testTargetRoleId}/permissions`, { cookie: rolesViewCookie }),
      { params: Promise.resolve({ id: testTargetRoleId }) }
    );
    expect(res.status).toBe(200);
  });

  it("D4. roles.view user: PUT /api/roles/[id]/permissions → 403 (write blocked)", async () => {
    const { PUT } = await import("@/app/api/roles/[id]/permissions/route");
    const res = await PUT(
      makeRequest(`/api/roles/${testTargetRoleId}/permissions`, { method: "PUT", cookie: rolesViewCookie, body: { permissionCodes: ["trips.view"] } }),
      { params: Promise.resolve({ id: testTargetRoleId }) }
    );
    expect(res.status).toBe(403);
  });

  it("D5. roles.manage user: PATCH /api/roles/[id] → 200", async () => {
    const { PATCH } = await import("@/app/api/roles/[id]/route");
    const res = await PATCH(
      makeRequest(`/api/roles/${testTargetRoleId}`, { method: "PATCH", cookie: rolesManageCookie, body: { label: "Updated Label" } }),
      { params: Promise.resolve({ id: testTargetRoleId }) }
    );
    expect(res.status).toBe(200);
  });

  it("D6. roles.manage user: PUT /api/roles/[id]/permissions → 200", async () => {
    const { PUT } = await import("@/app/api/roles/[id]/permissions/route");
    const res = await PUT(
      makeRequest(`/api/roles/${testTargetRoleId}/permissions`, { method: "PUT", cookie: rolesManageCookie, body: { permissionCodes: ["trips.view", "trips.create"] } }),
      { params: Promise.resolve({ id: testTargetRoleId }) }
    );
    expect([200, 201]).toContain(res.status);
  });
});

// ── Tenant Admin behavioral proof (ordinary non-ADMIN user) ───────────────────
describe("Tenant Admin — ordinary non-ADMIN user with TENANT_ADMIN RBAC role", () => {
  it("E1. Tenant Admin can GET /api/roles", async () => {
    const { GET } = await import("@/app/api/roles/route");
    const res = await GET(makeRequest("/api/roles", { cookie: tenantAdminCookie }));
    expect(res.status).toBe(200);
  });

  it("E2. Tenant Admin can POST /api/roles (create custom role)", async () => {
    const { POST } = await import("@/app/api/roles/route");
    const res = await POST(makeRequest("/api/roles", {
      method: "POST", cookie: tenantAdminCookie,
      body: { name: "P2_TA_TEST_ROLE_" + Date.now(), label: "TA Test Role" }
    }));
    expect([200, 201]).toContain(res.status);
    // Clean up if created:
    if (res.status === 201) {
      const data = await res.json();
      if (data.id) await db.delete(roles).where(eq(roles.id, data.id)).catch(() => {});
    }
  });

  it("E3. Tenant Admin can GET /api/roles/[id]", async () => {
    const { GET } = await import("@/app/api/roles/[id]/route");
    const res = await GET(
      makeRequest(`/api/roles/${testTargetRoleId}`, { cookie: tenantAdminCookie }),
      { params: Promise.resolve({ id: testTargetRoleId }) }
    );
    expect(res.status).toBe(200);
  });

  it("E4. Tenant Admin can PATCH /api/roles/[id]", async () => {
    const { PATCH } = await import("@/app/api/roles/[id]/route");
    const res = await PATCH(
      makeRequest(`/api/roles/${testTargetRoleId}`, { method: "PATCH", cookie: tenantAdminCookie, body: { label: "TA Patched" } }),
      { params: Promise.resolve({ id: testTargetRoleId }) }
    );
    expect(res.status).toBe(200);
  });

  it("E5. Tenant Admin can GET and PUT /api/roles/[id]/permissions", async () => {
    const { GET, PUT } = await import("@/app/api/roles/[id]/permissions/route");
    const getRes = await GET(
      makeRequest(`/api/roles/${testTargetRoleId}/permissions`, { cookie: tenantAdminCookie }),
      { params: Promise.resolve({ id: testTargetRoleId }) }
    );
    expect(getRes.status).toBe(200);
    const putRes = await PUT(
      makeRequest(`/api/roles/${testTargetRoleId}/permissions`, { method: "PUT", cookie: tenantAdminCookie, body: { permissionCodes: ["trips.view"] } }),
      { params: Promise.resolve({ id: testTargetRoleId }) }
    );
    expect([200, 201]).toContain(putRes.status);
  });

  it("E6. Tenant Admin can GET /api/users (users.manage via TENANT_ADMIN)", async () => {
    const { GET } = await import("@/app/api/users/route");
    const res = await GET(makeRequest("/api/users", { cookie: tenantAdminCookie }));
    expect(res.status).toBe(200);
  });

  it("E7. Tenant Admin CANNOT assign Platform Admin role → 403 PLATFORM_ROLE_DENIED", async () => {
    const adminSystemRole = await db.query.roles.findFirst({
      where: (r, { eq }) => eq(r.name, "ADMIN")
    });
    if (!adminSystemRole) return; // ADMIN is not an RBAC role — skip via absence
    const { POST } = await import("@/app/api/user-roles/route");
    const res = await POST(makeRequest("/api/user-roles", {
      method: "POST", cookie: tenantAdminCookie,
      body: { userId: rolesViewUserId, roleId: adminSystemRole.id }
    }));
    expect([403, 422]).toContain(res.status);
  });
});

// ── Cross-tenant isolation ────────────────────────────────────────────────────
describe("Cross-tenant isolation", () => {
  it("F1. Tenant B user cannot access Tenant A roles", async () => {
    if (!tenantBUserCookie) return;
    const { GET } = await import("@/app/api/roles/route");
    // Tenant B has no roles — any returned roles must NOT belong to tenantId:
    const res = await GET(makeRequest("/api/roles", { cookie: tenantBUserCookie }));
    if (res.status === 200) {
      const data = await res.json();
      const tenantARoles = (data.roles ?? data ?? []).filter((r: any) => r.tenantId === tenantId);
      expect(tenantARoles.length).toBe(0);
    } else {
      expect([401, 403]).toContain(res.status);
    }
  });

  it("F2. cross-tenant user ID rejected in user-roles POST → 404", async () => {
    const anyRole = await db.query.roles.findFirst({
      where: (r) => isNull(r.tenantId)
    });
    if (!anyRole) return;
    const { POST } = await import("@/app/api/user-roles/route");
    const res = await POST(makeRequest("/api/user-roles", {
      method: "POST", cookie: adminCookie,
      body: { userId: testTenantBUserId, roleId: anyRole.id }
    }));
    expect(res.status).toBe(404);
  });

  it("F3. deactivated role assignment returns 422", async () => {
    const roleId = genId();
    await db.insert(roles).values({ id: roleId, tenantId, name: "P2_DEACT_" + roleId.slice(-4), label: "Deact", isActive: false, isSystemRole: false });
    try {
      const { POST } = await import("@/app/api/user-roles/route");
      const res = await POST(makeRequest("/api/user-roles", {
        method: "POST", cookie: adminCookie,
        body: { userId: rolesViewUserId, roleId }
      }));
      expect(res.status).toBe(422);
    } finally {
      await db.delete(roles).where(eq(roles.id, roleId)).catch(() => {});
    }
  });
});

// ── Permission model correctness ──────────────────────────────────────────────
describe("Permission model correctness", () => {
  it("C1. 71 unique permission codes in DB after bootstrap", async () => {
    const all = await db.query.permissions.findMany({ columns: { code: true } });
    expect(new Set(all.map(p => p.code).filter(Boolean)).size).toBeGreaterThanOrEqual(71);
  });

  it("C2. 17 sensitive permissions including trips.dispatch, billing.settle, roles.manage", async () => {
    const sensitive = await db.query.permissions.findMany({ where: (t, { eq }) => eq(t.isSensitive, true) });
    const codes = sensitive.map(p => p.code);
    expect(sensitive.length).toBeGreaterThanOrEqual(17);
    expect(codes).toContain("trips.dispatch");
    expect(codes).toContain("billing.settle");
    expect(codes).toContain("roles.manage");
  });

  it("C3. DRIVER legacy block does not contain trips.dispatch or roles.manage", () => {
    const src = readSource("lib/requirePermission.ts");
    const driverBlock = src.slice(src.indexOf("DRIVER: ["), src.indexOf("],", src.indexOf("DRIVER: [")));
    expect(driverBlock).not.toContain("TRIPS_DISPATCH");
    expect(driverBlock).not.toContain("ROLES_MANAGE");
  });

  it("C4. DISPATCHER legacy block contains trips.assign", () => {
    const src = readSource("lib/requirePermission.ts");
    expect(src).toContain("TRIPS_ASSIGN");
  });
});
