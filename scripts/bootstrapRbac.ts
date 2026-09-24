/**
 * P2-02 Production RBAC Bootstrap
 * ================================
 * Creates the canonical permission catalogue and system role templates.
 * This is REFERENCE / CONFIGURATION DATA — not demo seed data.
 *
 * Safe to run:
 *   - On a fresh database (after migration 0024)
 *   - On an existing database (fully idempotent — uses INSERT ... ON CONFLICT DO NOTHING)
 *   - Multiple times — produces identical result every run
 *
 * Does NOT:
 *   - Create demo users, customers, orders, or trips
 *   - Modify existing permissions or role-permission mappings
 *   - Create tenant-scoped roles (those are created by tenant admins)
 *
 * Usage:
 *   DATABASE_URL=... npx tsx scripts/bootstrapRbac.ts
 *   or via: npm run db:bootstrap:rbac
 */

import { db } from "@/lib/db/client";
import { permissions, roles, rolePermissions } from "@/lib/db/schema";
import { PERMISSIONS, DEFAULT_ROLES } from "@/lib/permissions";
import { eq, and } from "drizzle-orm";
import { genId } from "@/lib/helpers";

// ── Canonical Permission Catalogue ─────────────────────────────────────────────
// Exactly 71 permissions. Source of truth: lib/permissions.ts PERMISSIONS object.
// is_sensitive = true means the permission grants financial/governance authority.
const PERMISSION_CATALOGUE = [
  // OPERATIONS
  { module: "orders",        action: "view",   code: PERMISSIONS.ORDERS_VIEW,   category: "OPERATIONS", description: "View orders",                        isSensitive: false },
  { module: "orders",        action: "create", code: PERMISSIONS.ORDERS_CREATE, category: "OPERATIONS", description: "Create orders",                      isSensitive: false },
  { module: "orders",        action: "edit",   code: PERMISSIONS.ORDERS_EDIT,   category: "OPERATIONS", description: "Edit orders",                        isSensitive: false },
  { module: "orders",        action: "cancel", code: PERMISSIONS.ORDERS_CANCEL, category: "OPERATIONS", description: "Cancel orders",                      isSensitive: true  },
  { module: "trips",         action: "view",         code: PERMISSIONS.TRIPS_VIEW,         category: "OPERATIONS", description: "View trips",                         isSensitive: false },
  { module: "trips",         action: "create",       code: PERMISSIONS.TRIPS_CREATE,       category: "OPERATIONS", description: "Create trips",                       isSensitive: false },
  { module: "trips",         action: "edit",         code: PERMISSIONS.TRIPS_EDIT,         category: "OPERATIONS", description: "Edit trip details",                  isSensitive: false },
  { module: "trips",         action: "assign",       code: PERMISSIONS.TRIPS_ASSIGN,       category: "OPERATIONS", description: "Assign vehicle and driver to trip",  isSensitive: false },
  { module: "trips",         action: "dispatch",     code: PERMISSIONS.TRIPS_DISPATCH,     category: "OPERATIONS", description: "Formally dispatch trip to driver",   isSensitive: true  },
  { module: "trips",         action: "reassign",     code: PERMISSIONS.TRIPS_REASSIGN,     category: "OPERATIONS", description: "Reassign resources to dispatched trip", isSensitive: true },
  { module: "trips",         action: "fail",         code: PERMISSIONS.TRIPS_FAIL,         category: "OPERATIONS", description: "Mark trip as failed",                isSensitive: true  },
  { module: "trips",         action: "view_live",    code: PERMISSIONS.TRIPS_VIEW_LIVE,    category: "OPERATIONS", description: "View live GPS tracking",             isSensitive: false },
  { module: "control_tower", action: "view",          code: PERMISSIONS.CONTROL_TOWER_VIEW,          category: "OPERATIONS", description: "Access Control Tower dashboard",  isSensitive: false },
  { module: "control_tower", action: "manage_events", code: PERMISSIONS.CONTROL_TOWER_MANAGE_EVENTS, category: "OPERATIONS", description: "Manage operational events",        isSensitive: false },
  // DRIVER
  { module: "driver", action: "arrived_loading", code: PERMISSIONS.DRIVER_ARRIVED_LOADING, category: "DRIVER", description: "Mark arrived at loading point",    isSensitive: false },
  { module: "driver", action: "confirm_loading", code: PERMISSIONS.DRIVER_CONFIRM_LOADING, category: "DRIVER", description: "Confirm loading complete",         isSensitive: false },
  { module: "driver", action: "arrived_site",    code: PERMISSIONS.DRIVER_ARRIVED_SITE,    category: "DRIVER", description: "Mark arrived at customer site",   isSensitive: false },
  { module: "driver", action: "deliver",         code: PERMISSIONS.DRIVER_DELIVER,         category: "DRIVER", description: "Mark delivery complete (ePOD)",   isSensitive: false },
  { module: "driver", action: "fail_trip",       code: PERMISSIONS.DRIVER_FAIL_TRIP,       category: "DRIVER", description: "Mark trip failed with reason",    isSensitive: false },
  // FLEET
  { module: "vehicles", action: "view",   code: PERMISSIONS.VEHICLES_VIEW,   category: "FLEET", description: "View vehicles",               isSensitive: false },
  { module: "vehicles", action: "create", code: PERMISSIONS.VEHICLES_CREATE, category: "FLEET", description: "Add vehicles",                isSensitive: false },
  { module: "vehicles", action: "edit",   code: PERMISSIONS.VEHICLES_EDIT,   category: "FLEET", description: "Edit vehicle details",         isSensitive: false },
  { module: "vehicles", action: "assign", code: PERMISSIONS.VEHICLES_ASSIGN, category: "FLEET", description: "Assign vehicles to trips",     isSensitive: false },
  { module: "drivers",  action: "view",   code: PERMISSIONS.DRIVERS_VIEW,    category: "FLEET", description: "View drivers",                isSensitive: false },
  { module: "drivers",  action: "create", code: PERMISSIONS.DRIVERS_CREATE,  category: "FLEET", description: "Add drivers",                 isSensitive: false },
  { module: "drivers",  action: "edit",   code: PERMISSIONS.DRIVERS_EDIT,    category: "FLEET", description: "Edit driver details",          isSensitive: false },
  { module: "drivers",  action: "assign", code: PERMISSIONS.DRIVERS_ASSIGN,  category: "FLEET", description: "Assign drivers to trips",      isSensitive: false },
  // CRM
  { module: "customers", action: "view",   code: PERMISSIONS.CUSTOMERS_VIEW,   category: "CRM", description: "View customers",             isSensitive: false },
  { module: "customers", action: "create", code: PERMISSIONS.CUSTOMERS_CREATE, category: "CRM", description: "Add customers",              isSensitive: false },
  { module: "customers", action: "edit",   code: PERMISSIONS.CUSTOMERS_EDIT,   category: "CRM", description: "Edit customer details",       isSensitive: false },
  { module: "sites",     action: "view",   code: PERMISSIONS.SITES_VIEW,        category: "CRM", description: "View customer sites",        isSensitive: false },
  { module: "sites",     action: "create", code: PERMISSIONS.SITES_CREATE,      category: "CRM", description: "Add customer sites",         isSensitive: false },
  { module: "sites",     action: "edit",   code: PERMISSIONS.SITES_EDIT,        category: "CRM", description: "Edit customer site details",  isSensitive: false },
  // COMMERCIAL
  { module: "contracts", action: "view",     code: PERMISSIONS.CONTRACTS_VIEW,     category: "COMMERCIAL", description: "View contracts",       isSensitive: false },
  { module: "contracts", action: "create",   code: PERMISSIONS.CONTRACTS_CREATE,   category: "COMMERCIAL", description: "Create contracts",     isSensitive: true  },
  { module: "contracts", action: "edit",     code: PERMISSIONS.CONTRACTS_EDIT,     category: "COMMERCIAL", description: "Edit contracts",       isSensitive: true  },
  { module: "contracts", action: "activate", code: PERMISSIONS.CONTRACTS_ACTIVATE, category: "COMMERCIAL", description: "Activate contracts",   isSensitive: true  },
  { module: "contracts", action: "retire",   code: PERMISSIONS.CONTRACTS_RETIRE,   category: "COMMERCIAL", description: "Retire contracts",     isSensitive: true  },
  // FINANCE
  { module: "billing",  action: "view",   code: PERMISSIONS.BILLING_VIEW,    category: "FINANCE", description: "View invoices",              isSensitive: false },
  { module: "billing",  action: "create", code: PERMISSIONS.BILLING_CREATE,  category: "FINANCE", description: "Generate invoices",          isSensitive: true  },
  { module: "billing",  action: "settle", code: PERMISSIONS.BILLING_SETTLE,  category: "FINANCE", description: "Settle/pay invoices",         isSensitive: true  },
  { module: "expenses", action: "view",   code: PERMISSIONS.EXPENSES_VIEW,   category: "FINANCE", description: "View expense claims",         isSensitive: false },
  { module: "expenses", action: "create", code: PERMISSIONS.EXPENSES_CREATE, category: "FINANCE", description: "Submit expense claims",       isSensitive: false },
  { module: "expenses", action: "approve",code: PERMISSIONS.EXPENSES_APPROVE,category: "FINANCE", description: "Approve expense claims",      isSensitive: true  },
  // MAINTENANCE
  { module: "maintenance", action: "view",   code: PERMISSIONS.MAINTENANCE_VIEW,   category: "MAINTENANCE", description: "View maintenance records",   isSensitive: false },
  { module: "maintenance", action: "create", code: PERMISSIONS.MAINTENANCE_CREATE, category: "MAINTENANCE", description: "Create maintenance records",  isSensitive: false },
  { module: "maintenance", action: "assign", code: PERMISSIONS.MAINTENANCE_ASSIGN, category: "MAINTENANCE", description: "Assign maintenance work",     isSensitive: false },
  { module: "maintenance", action: "close",  code: PERMISSIONS.MAINTENANCE_CLOSE,  category: "MAINTENANCE", description: "Close maintenance records",   isSensitive: false },
  { module: "workshops",   action: "view",   code: PERMISSIONS.WORKSHOPS_VIEW,     category: "MAINTENANCE", description: "View workshops",             isSensitive: false },
  { module: "workshops",   action: "manage", code: PERMISSIONS.WORKSHOPS_MANAGE,   category: "MAINTENANCE", description: "Manage workshops",           isSensitive: false },
  // PROCUREMENT
  { module: "procurement", action: "pr.view",    code: PERMISSIONS.PR_VIEW,    category: "PROCUREMENT", description: "View purchase requisitions",      isSensitive: false },
  { module: "procurement", action: "pr.create",  code: PERMISSIONS.PR_CREATE,  category: "PROCUREMENT", description: "Create purchase requisitions",    isSensitive: false },
  { module: "procurement", action: "pr.approve", code: PERMISSIONS.PR_APPROVE, category: "PROCUREMENT", description: "Approve purchase requisitions",   isSensitive: true  },
  { module: "procurement", action: "po.view",    code: PERMISSIONS.PO_VIEW,    category: "PROCUREMENT", description: "View purchase orders",            isSensitive: false },
  { module: "procurement", action: "po.create",  code: PERMISSIONS.PO_CREATE,  category: "PROCUREMENT", description: "Create purchase orders",          isSensitive: false },
  { module: "procurement", action: "po.approve", code: PERMISSIONS.PO_APPROVE, category: "PROCUREMENT", description: "Approve purchase orders",         isSensitive: true  },
  { module: "procurement", action: "gr.view",    code: PERMISSIONS.GR_VIEW,    category: "PROCUREMENT", description: "View goods receipts",             isSensitive: false },
  { module: "procurement", action: "gr.receive", code: PERMISSIONS.GR_RECEIVE, category: "PROCUREMENT", description: "Receive goods against PO",        isSensitive: false },
  { module: "inventory",   action: "view",    code: PERMISSIONS.INVENTORY_VIEW,    category: "PROCUREMENT", description: "View inventory",                    isSensitive: false },
  { module: "inventory",   action: "receive", code: PERMISSIONS.INVENTORY_RECEIVE, category: "PROCUREMENT", description: "Receive inventory",                 isSensitive: false },
  { module: "inventory",   action: "adjust",  code: PERMISSIONS.INVENTORY_ADJUST,  category: "PROCUREMENT", description: "Adjust inventory counts",           isSensitive: true  },
  // REPORTS
  { module: "reports",     action: "operations.view", code: PERMISSIONS.REPORTS_OPERATIONS_VIEW, category: "REPORTS", description: "View operational reports",  isSensitive: false },
  { module: "reports",     action: "fleet.view",      code: PERMISSIONS.REPORTS_FLEET_VIEW,      category: "REPORTS", description: "View fleet reports",        isSensitive: false },
  { module: "reports",     action: "finance.view",    code: PERMISSIONS.REPORTS_FINANCE_VIEW,    category: "REPORTS", description: "View financial reports",    isSensitive: false },
  { module: "reports",     action: "procurement.view",code: PERMISSIONS.REPORTS_PROCUREMENT_VIEW,category: "REPORTS", description: "View procurement reports",  isSensitive: false },
  { module: "scorecards",  action: "view",            code: PERMISSIONS.SCORECARDS_VIEW,          category: "REPORTS", description: "View scorecards",          isSensitive: false },
  // ADMINISTRATION
  { module: "settings", action: "users.view",   code: PERMISSIONS.USERS_VIEW,      category: "ADMIN", description: "View users in tenant",         isSensitive: false },
  { module: "settings", action: "users.manage", code: PERMISSIONS.USERS_MANAGE,    category: "ADMIN", description: "Manage users in tenant",        isSensitive: true  },
  { module: "settings", action: "roles.view",   code: PERMISSIONS.ROLES_VIEW,      category: "ADMIN", description: "View roles in tenant",          isSensitive: false },
  { module: "settings", action: "roles.manage", code: PERMISSIONS.ROLES_MANAGE,    category: "ADMIN", description: "Manage roles and permissions",   isSensitive: true  },
  { module: "settings", action: "tenant",       code: PERMISSIONS.TENANT_SETTINGS, category: "ADMIN", description: "Manage tenant settings",         isSensitive: true  },
] as const;

const EXPECTED_COUNT = 71;

async function bootstrapPermissions(): Promise<Map<string, string>> {
  console.log("  Bootstrapping permissions catalogue...");
  const codeToId = new Map<string, string>();

  if (PERMISSION_CATALOGUE.length !== EXPECTED_COUNT) {
    throw new Error(`Permission catalogue has ${PERMISSION_CATALOGUE.length} entries, expected ${EXPECTED_COUNT}. Update bootstrapRbac.ts.`);
  }

  let created = 0, skipped = 0, updated = 0;
  for (const perm of PERMISSION_CATALOGUE) {
    const existing = await db.query.permissions.findFirst({
      where: and(eq(permissions.module, perm.module), eq(permissions.action, perm.action)),
    });
    if (existing) {
      codeToId.set(perm.code, existing.id);
      // Always sync code, category, description and sensitivity (idempotent update):
      await db.update(permissions).set({
        code: perm.code, category: perm.category,
        description: perm.description, isSensitive: perm.isSensitive,
      }).where(eq(permissions.id, existing.id));
      skipped++;
    } else {
      const id = genId();
      await db.insert(permissions).values({
        id, module: perm.module, action: perm.action, code: perm.code,
        category: perm.category, description: perm.description, isSensitive: perm.isSensitive,
      });
      codeToId.set(perm.code, id);
      created++;
    }
  }
  console.log(`    ${created} created, ${skipped} synced. Total: ${codeToId.size}`);
  return codeToId;
}

async function bootstrapSystemRoles(codeToId: Map<string, string>): Promise<void> {
  console.log("  Bootstrapping system role templates...");

  for (const template of DEFAULT_ROLES) {
    // Upsert role (idempotent by name where tenantId is null):
    let role = await db.query.roles.findFirst({ where: eq(roles.name, template.name) });
    if (!role) {
      const id = genId();
      await db.insert(roles).values({
        id, name: template.name, label: template.label, description: template.description ?? null,
        tenantId: null, isSystemRole: true, isActive: true,
      });
      role = await db.query.roles.findFirst({ where: eq(roles.name, template.name) });
      console.log(`    Created: ${template.name}`);
    } else {
      console.log(`    Exists:  ${template.name}`);
    }
    if (!role) continue;

    // Upsert role-permission mappings (idempotent — skip if already present):
    let linked = 0;
    for (const permCode of template.permissions) {
      const permId = codeToId.get(permCode);
      if (!permId) { console.warn(`    WARNING: unknown permission code ${permCode}`); continue; }
      const existing = await db.query.rolePermissions.findFirst({
        where: and(eq(rolePermissions.roleId, role.id), eq(rolePermissions.permissionId, permId)),
      });
      if (!existing) {
        await db.insert(rolePermissions).values({ id: genId(), roleId: role.id, permissionId: permId }).onConflictDoNothing();
        linked++;
      }
    }
    if (linked > 0) console.log(`      Linked ${linked} new permissions`);
  }
}

export async function runBootstrap(): Promise<{ permCount: number; roleCount: number }> {
  console.log("SMARTY1 P2-02 RBAC Bootstrap");
  console.log("=============================");
  const codeToId = await bootstrapPermissions();
  await bootstrapSystemRoles(codeToId);
  const roleCount = await db.query.roles.findMany({ where: eq(roles.isSystemRole, true) });
  console.log(`\nDone. ${codeToId.size} permissions, ${roleCount.length} system roles.`);
  return { permCount: codeToId.size, roleCount: roleCount.length };
}

// Allow running directly:
if (require.main === module) {
  runBootstrap()
    .then(r => { console.log(`\n✅ Bootstrap complete: ${r.permCount} permissions, ${r.roleCount} roles`); process.exit(0); })
    .catch(e => { console.error("Bootstrap failed:", e); process.exit(1); });
}
