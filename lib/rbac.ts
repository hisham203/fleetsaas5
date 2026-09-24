// RC1 — Phase 1 RBAC. Module-level access control with legacy role mapping.
// No new schema migration needed — roles/permissions/user_roles in 0021.

import { db } from "./db/client";
import { roles, permissions, rolePermissions, userRoles, users } from "./db/schema";
import { eq, and } from "drizzle-orm";
import { genId } from "./helpers";

export const MODULES = [
  "dashboard", "control_tower", "dispatch", "orders", "customers",
  "contracts", "fleet", "drivers", "loading_points", "maintenance",
  "master_items", "inventory", "procurement", "expenses", "reports",
  "settings", "users",
] as const;
export type Module = typeof MODULES[number];

// Canonical module sets per named role.
export const ROLE_MODULE_MAP: Record<string, readonly string[]> = {
  PLATFORM_ADMIN:           MODULES,
  TENANT_ADMIN:             MODULES,
  DISPATCHER:               ["dashboard","control_tower","dispatch","orders","customers","contracts","fleet","drivers","loading_points","inventory","reports"],
  DISPATCH_SUPERVISOR:      ["dashboard","control_tower","dispatch","orders","customers","contracts","fleet","drivers","loading_points","maintenance","reports"],
  FLEET_MANAGER:            ["dashboard","fleet","drivers","maintenance","expenses","reports"],
  DRIVER:                   ["dashboard"],
  MAINTENANCE_MANAGER:      ["dashboard","fleet","maintenance","master_items","inventory","procurement","expenses","reports"],
  MAINTENANCE_TECHNICIAN:   ["dashboard","maintenance","master_items","inventory"],
  PROCUREMENT:              ["dashboard","master_items","inventory","procurement","expenses","reports"],
  INVENTORY:                ["dashboard","master_items","inventory","procurement"],
  FINANCE:                  ["dashboard","orders","contracts","expenses","reports","settings"],
  VIEWER:                   ["dashboard","control_tower","orders","contracts","fleet","reports"],
};

// Legacy user.role → canonical system role name.
// ADMIN → TENANT_ADMIN (full tenant access).
// Never grants full access for unknown/unmapped roles.
const LEGACY_ROLE_MAP: Record<string, string> = {
  ADMIN:       "TENANT_ADMIN",
  DISPATCHER:  "DISPATCHER",
  DRIVER:      "DRIVER",
  CUSTOMER:    "VIEWER", // customer portal users get read-only viewer access
};

export const SYSTEM_ROLES = Object.entries(ROLE_MODULE_MAP).map(([name, modules]) => ({
  name, label: name.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase()),
  isSystem: true, modules,
}));

let seeded = false;

export async function ensureSystemRoles() {
  if (seeded) return;
  const existing = await db.query.roles.findMany({ where: eq(roles.isSystemRole, true) });
  if (existing.length >= Object.keys(ROLE_MODULE_MAP).length) { seeded = true; return; }

  for (const mod of MODULES) {
    await db.insert(permissions).values({ id: genId(), module: mod, action: "access", description: `Access ${module}` }).onConflictDoNothing();
  }
  const allPerms = await db.query.permissions.findMany();
  const permMap = Object.fromEntries(allPerms.map(p => [p.module, p.id]));

  for (const [name, modules] of Object.entries(ROLE_MODULE_MAP)) {
    let role = existing.find(r => r.name === name);
    if (!role) {
      const label = name.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
      const id = genId();
      await db.insert(roles).values({ id, tenantId: null, name, label, isSystemRole: true, isActive: true });
      role = { id, tenantId: null, name, label, isSystemRole: true, isActive: true, description: null, createdAt: new Date() };
    }
    for (const modName of modules) {
      const permId = permMap[modName];
      if (permId) await db.insert(rolePermissions).values({ id: genId(), roleId: role.id, permissionId: permId }).onConflictDoNothing();
    }
  }
  seeded = true;
}

/**
 * Returns the set of modules a user may access.
 *
 * Resolution order:
 *  1. If the user has explicit user_roles rows → use those role permissions.
 *  2. Otherwise fall back to legacy user.role → canonical role mapping.
 *  3. If no mapping exists → empty set (no access).
 *
 * "No user_roles and unknown legacy role" never grants full access.
 */
export async function getUserModules(userId: string, tenantId: string): Promise<Set<string>> {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) return new Set();

  // Check explicit user_roles first
  const urRows = await db.query.userRoles.findMany({
    where: and(eq(userRoles.userId, userId), eq(userRoles.tenantId, tenantId)),
    with: { role: { with: { rolePermissions: { with: { permission: true } } } } },
  });

  if (urRows.length > 0) {
    // Explicit RBAC assignment — use it exclusively
    const modules = new Set<string>();
    for (const ur of urRows) {
      for (const rp of ur.role.rolePermissions) {
        modules.add(rp.permission.module);
      }
    }
    return modules;
  }

  // Legacy fallback: map user.role string to the canonical role's module set
  const canonicalName = LEGACY_ROLE_MAP[user.role ?? ""] ?? null;
  if (!canonicalName) return new Set(); // unknown role → no access
  const modules = ROLE_MODULE_MAP[canonicalName] ?? [];
  return new Set(modules);
}

export async function canAccess(userId: string, tenantId: string, module: Module): Promise<boolean> {
  const modules = await getUserModules(userId, tenantId);
  return modules.has(module);
}
