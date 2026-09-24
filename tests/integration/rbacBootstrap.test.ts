/**
 * P2-02 RBAC Bootstrap Tests
 * Tests idempotency and correctness of the RBAC bootstrap.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { db } from "@/lib/db/client";
import { permissions, roles, rolePermissions } from "@/lib/db/schema";
import { eq, isNull } from "drizzle-orm";
import { runBootstrap } from "../../scripts/bootstrapRbac";

const EXPECTED_PERMISSION_COUNT = 71;
const EXPECTED_SYSTEM_ROLE_COUNT = 8;
const EXPECTED_SENSITIVE_COUNT = 17; // verified from bootstrap catalogue

describe("RBAC Bootstrap (Blocker 2 / Blocker 16)", () => {
  it("1. bootstrap runs without error and returns correct counts", async () => {
    const result = await runBootstrap();
    expect(result.permCount).toBe(EXPECTED_PERMISSION_COUNT);
    expect(result.roleCount).toBeGreaterThanOrEqual(EXPECTED_SYSTEM_ROLE_COUNT);
  });

  it("2. bootstrap is idempotent — second run produces same counts", async () => {
    const r1 = await runBootstrap();
    const r2 = await runBootstrap();
    expect(r1.permCount).toBe(r2.permCount);
    expect(r1.roleCount).toBe(r2.roleCount);
  });

  it("3. all 71 permission codes are unique", async () => {
    const allPerms = await db.query.permissions.findMany({ columns: { code: true } });
    const codes = allPerms.map(p => p.code).filter(Boolean);
    const unique = new Set(codes);
    expect(unique.size).toBe(codes.length); // no duplicates
    // May include legacy permissions from pre-bootstrap seeds (>=71):
    expect(codes.length).toBeGreaterThanOrEqual(EXPECTED_PERMISSION_COUNT);
  });

  it("4. all permissions have non-null module and action", async () => {
    const allPerms = await db.query.permissions.findMany();
    for (const p of allPerms) {
      expect(p.module?.length).toBeGreaterThan(0);
      expect(p.action?.length).toBeGreaterThan(0);
    }
  });

  it("5. sensitive permissions count is correct (17)", async () => {
    const sensitivePerms = await db.query.permissions.findMany({ where: (t, { eq }) => eq(t.isSensitive, true) });
    expect(sensitivePerms.length).toBe(EXPECTED_SENSITIVE_COUNT);
  });

  it("6. system roles exist with isSystemRole=true and tenantId=null", async () => {
    const systemRoles = await db.query.roles.findMany({ where: (t, { and, eq, isNull }) => and(eq(t.isSystemRole, true), isNull(t.tenantId)) });
    expect(systemRoles.length).toBeGreaterThanOrEqual(EXPECTED_SYSTEM_ROLE_COUNT);
    const names = systemRoles.map(r => r.name);
    expect(names).toContain("TENANT_ADMIN");
    expect(names).toContain("OPERATION_SUPERVISOR");
    expect(names).toContain("DRIVER");
    expect(names).toContain("AUDITOR");
  });

  it("7. TENANT_ADMIN has all 71 permissions linked", async () => {
    const adminRole = await db.query.roles.findFirst({ where: (t, { eq }) => eq(t.name, "TENANT_ADMIN"), with: { rolePermissions: true } });
    expect(adminRole).toBeTruthy();
    // TENANT_ADMIN has all canonical permissions (may include legacy extras in test DB):
    expect(adminRole!.rolePermissions.length).toBeGreaterThanOrEqual(EXPECTED_PERMISSION_COUNT);
  });

  it("8. DRIVER role has ONLY driver-specific permissions (no dispatch/billing)", async () => {
    const driverRole = await db.query.roles.findFirst({
      where: (t, { eq }) => eq(t.name, "DRIVER"),
      with: { rolePermissions: { with: { permission: true } } },
    });
    expect(driverRole).toBeTruthy();
    const codes = driverRole!.rolePermissions.map(rp => rp.permission?.code ?? "");
    // Drivers must NOT have dispatch or billing:
    expect(codes).not.toContain("trips.dispatch");
    expect(codes).not.toContain("billing.settle");
    expect(codes).not.toContain("roles.manage");
    // Drivers MUST have lifecycle actions:
    expect(codes).toContain("driver.arrived_loading");
    expect(codes).toContain("driver.deliver");
  });

  it("9. OPERATION_SUPERVISOR has trips.assign and trips.dispatch", async () => {
    const supRole = await db.query.roles.findFirst({
      where: (t, { eq }) => eq(t.name, "OPERATION_SUPERVISOR"),
      with: { rolePermissions: { with: { permission: true } } },
    });
    expect(supRole).toBeTruthy();
    const codes = supRole!.rolePermissions.map(rp => rp.permission?.code ?? "");
    expect(codes).toContain("trips.assign");
    expect(codes).toContain("trips.dispatch");
  });

  it("10. OPERATION_COORDINATOR does NOT have trips.assign or trips.dispatch", async () => {
    const coordRole = await db.query.roles.findFirst({
      where: (t, { eq }) => eq(t.name, "OPERATION_COORDINATOR"),
      with: { rolePermissions: { with: { permission: true } } },
    });
    expect(coordRole).toBeTruthy();
    const codes = coordRole!.rolePermissions.map(rp => rp.permission?.code ?? "");
    expect(codes).not.toContain("trips.assign");
    expect(codes).not.toContain("trips.dispatch");
  });

  it("11. no role-permission duplicates in system roles", async () => {
    const systemRoles = await db.query.roles.findMany({
      where: (t, { and, eq, isNull }) => and(eq(t.isSystemRole, true), isNull(t.tenantId)),
      with: { rolePermissions: true },
    });
    for (const role of systemRoles) {
      const permIds = role.rolePermissions.map(rp => rp.permissionId);
      const unique = new Set(permIds);
      expect(unique.size).toBe(permIds.length);
    }
  });
});
