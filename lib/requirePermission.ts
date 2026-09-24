/**
 * P2-02 FINAL: Canonical business permission enforcement.
 *
 * AUTHORIZATION RESOLUTION ORDER:
 *   1. No session                     → 401
 *   2. Platform Admin (role="ADMIN")  → bypass ALL checks (platform identity boundary)
 *   3. Explicit RBAC check            → user has active role assignments → RBAC is authoritative
 *      a. Permission found in roles   → ALLOWED
 *      b. Permission NOT found        → DENIED (legacy fallback does NOT apply)
 *   4. Legacy fallback                → user has NO explicit role assignments
 *      → temporary compat for pre-RBAC DISPATCHER/DRIVER users
 *   5. None match                     → 403 PERMISSION_DENIED
 *
 * CRITICAL (Part 9): When a user has ANY explicit active RBAC role assignments,
 * the legacy fallback MUST NOT apply. Explicit RBAC is authoritative.
 * This prevents a restrictive RBAC assignment from being silently bypassed
 * by the legacy fallback granting back a denied permission.
 */
import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { userRoles, rolePermissions, permissions, roles } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { PERMISSIONS } from "@/lib/permissions";

export { PERMISSIONS };

// Legacy fallback: DISPATCHER/DRIVER users with NO explicit role assignments.
// Only applies when _checkHasAnyRbacRoles() returns false.
const LEGACY_PERMISSIONS: Record<string, string[]> = {
  DISPATCHER: [
    PERMISSIONS.ORDERS_VIEW, PERMISSIONS.ORDERS_CREATE, PERMISSIONS.ORDERS_EDIT, PERMISSIONS.ORDERS_CANCEL,
    PERMISSIONS.TRIPS_VIEW, PERMISSIONS.TRIPS_CREATE, PERMISSIONS.TRIPS_EDIT,
    PERMISSIONS.TRIPS_ASSIGN, PERMISSIONS.TRIPS_DISPATCH, PERMISSIONS.TRIPS_REASSIGN,
    PERMISSIONS.TRIPS_FAIL, PERMISSIONS.TRIPS_VIEW_LIVE,
    PERMISSIONS.CONTROL_TOWER_VIEW, PERMISSIONS.CONTROL_TOWER_MANAGE_EVENTS,
    PERMISSIONS.VEHICLES_VIEW, PERMISSIONS.VEHICLES_ASSIGN,
    PERMISSIONS.DRIVERS_VIEW, PERMISSIONS.DRIVERS_ASSIGN,
    PERMISSIONS.CUSTOMERS_VIEW, PERMISSIONS.SITES_VIEW,
    PERMISSIONS.CONTRACTS_VIEW, PERMISSIONS.BILLING_VIEW,
    // Expenses.view/create: require explicit RBAC assignment
    PERMISSIONS.SCORECARDS_VIEW,  // DISPATCHER may view scorecards but not REPORTS/executive dashboard
    PERMISSIONS.MAINTENANCE_VIEW,
    PERMISSIONS.INVENTORY_VIEW, PERMISSIONS.WORKSHOPS_VIEW,
    PERMISSIONS.PR_VIEW, PERMISSIONS.PO_VIEW, PERMISSIONS.GR_VIEW,
  ],
  DRIVER: [
    PERMISSIONS.TRIPS_VIEW,
    PERMISSIONS.DRIVER_ARRIVED_LOADING, PERMISSIONS.DRIVER_CONFIRM_LOADING,
    PERMISSIONS.DRIVER_ARRIVED_SITE, PERMISSIONS.DRIVER_DELIVER, PERMISSIONS.DRIVER_FAIL_TRIP,
    // Drivers submit and view their own expense claims (operational, not financial reporting):
    PERMISSIONS.EXPENSES_VIEW, PERMISSIONS.EXPENSES_CREATE,
  ],
};

/** Returns true when the user has at least one active role assignment for this tenant. */
async function _checkHasAnyRbacRoles(userId: string, tenantId: string): Promise<boolean> {
  const row = await db
    .select({ id: userRoles.id })
    .from(userRoles)
    .innerJoin(roles, and(eq(userRoles.roleId, roles.id), eq(roles.isActive, true)))
    .where(and(eq(userRoles.userId, userId), eq(userRoles.tenantId, tenantId)))
    .limit(1);
  return row.length > 0;
}

/** Returns true when the user's active roles include the given permission code. */
async function _checkRbacPermission(userId: string, tenantId: string, code: string): Promise<boolean> {
  const rows = await db
    .select({ permCode: permissions.code })
    .from(userRoles)
    .innerJoin(roles, and(eq(userRoles.roleId, roles.id), eq(roles.isActive, true)))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(and(eq(userRoles.userId, userId), eq(userRoles.tenantId, tenantId)));
  return rows.some(r => r.permCode === code);
}

/**
 * Core permission gate for business-capability API routes.
 * Returns null if allowed, NextResponse(403) if denied.
 */
export async function checkPermission(
  session: any, tenantId: string, code: string
): Promise<NextResponse | null> {
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session?.user?.id;
  const systemRole = session?.user?.role as string | undefined;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Step 2: Platform Admin always passes:
  if (systemRole === "ADMIN") return null;

  // Step 3: Check whether user has ANY explicit RBAC role assignments:
  const hasExplicitRoles = await _checkHasAnyRbacRoles(userId, tenantId);

  if (hasExplicitRoles) {
    // RBAC is authoritative — check permission, NO legacy fallback:
    const allowed = await _checkRbacPermission(userId, tenantId, code);
    if (allowed) return null;
    return NextResponse.json({
      error: `Permission required: ${code}`, errorCode: "PERMISSION_DENIED", permission: code,
    }, { status: 403 });
  }

  // Step 4: No explicit roles — legacy role fallback for pre-RBAC users (transitional):
  const legacyPerms = LEGACY_PERMISSIONS[systemRole ?? ""] ?? [];
  if (legacyPerms.includes(code)) return null;

  return NextResponse.json({
    error: `Permission required: ${code}`, errorCode: "PERMISSION_DENIED", permission: code,
  }, { status: 403 });
}

/**
 * Permission gate for RBAC administration endpoints.
 * Accepts Platform Admin OR a user with the given admin permission code.
 */
export async function checkTenantAdminPermission(
  session: any, tenantId: string,
  code: "roles.manage" | "roles.view" | "users.manage" | "users.view" | "tenant.settings"
): Promise<NextResponse | null> {
  return checkPermission(session, tenantId, code);
}

/** Get all effective permissions for UI display. */
export async function getEffectivePermissionsForUser(userId: string, tenantId: string): Promise<string[]> {
  const rows = await db
    .select({ code: permissions.code })
    .from(userRoles)
    .innerJoin(roles, and(eq(userRoles.roleId, roles.id), eq(roles.isActive, true)))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(and(eq(userRoles.userId, userId), eq(userRoles.tenantId, tenantId)));
  return [...new Set(rows.map(r => r.code).filter(Boolean))] as string[];
}
