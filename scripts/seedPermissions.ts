/**
 * P2-02: Seed permissions catalogue and default role templates into the database.
 * Run this after db:seed to populate the new RBAC tables.
 * Idempotent — safe to run multiple times.
 */
import { db } from "@/lib/db/client";
import { permissions, roles, rolePermissions } from "@/lib/db/schema";
import { PERMISSIONS, DEFAULT_ROLES } from "@/lib/permissions";
import { genId } from "@/lib/helpers";
import { eq, and } from "drizzle-orm";

async function seedPermissions() {
  console.log("Seeding permissions catalogue...");

  // Build the permission catalogue:
  const permCatalogue: { module: string; action: string; code: string; category: string; description: string }[] = [
    { module: "orders", action: "view",   code: PERMISSIONS.ORDERS_VIEW,   category: "OPERATIONS", description: "View orders" },
    { module: "orders", action: "create", code: PERMISSIONS.ORDERS_CREATE, category: "OPERATIONS", description: "Create orders" },
    { module: "orders", action: "edit",   code: PERMISSIONS.ORDERS_EDIT,   category: "OPERATIONS", description: "Edit orders" },
    { module: "orders", action: "cancel", code: PERMISSIONS.ORDERS_CANCEL, category: "OPERATIONS", description: "Cancel orders" },

    { module: "trips", action: "view",      code: PERMISSIONS.TRIPS_VIEW,      category: "OPERATIONS", description: "View trips" },
    { module: "trips", action: "create",    code: PERMISSIONS.TRIPS_CREATE,    category: "OPERATIONS", description: "Create trips" },
    { module: "trips", action: "edit",      code: PERMISSIONS.TRIPS_EDIT,      category: "OPERATIONS", description: "Edit trip details" },
    { module: "trips", action: "assign",    code: PERMISSIONS.TRIPS_ASSIGN,    category: "OPERATIONS", description: "Assign vehicle and driver to trip" },
    { module: "dispatch", action: "dispatch", code: PERMISSIONS.TRIPS_DISPATCH, category: "OPERATIONS", description: "Formally dispatch trip to driver" },
    { module: "trips", action: "reassign",  code: PERMISSIONS.TRIPS_REASSIGN,  category: "OPERATIONS", description: "Reassign resources to dispatched trip" },
    { module: "trips", action: "fail",      code: PERMISSIONS.TRIPS_FAIL,      category: "OPERATIONS", description: "Mark trip as failed" },
    { module: "trips", action: "view_live", code: PERMISSIONS.TRIPS_VIEW_LIVE, category: "OPERATIONS", description: "View live GPS tracking" },

    { module: "control_tower", action: "view",          code: PERMISSIONS.CONTROL_TOWER_VIEW,          category: "OPERATIONS", description: "Access Control Tower" },
    { module: "control_tower", action: "manage_events", code: PERMISSIONS.CONTROL_TOWER_MANAGE_EVENTS, category: "OPERATIONS", description: "Manage operational events" },

    { module: "driver", action: "arrived_loading", code: PERMISSIONS.DRIVER_ARRIVED_LOADING, category: "DRIVER", description: "Mark arrived at loading point" },
    { module: "driver", action: "confirm_loading", code: PERMISSIONS.DRIVER_CONFIRM_LOADING, category: "DRIVER", description: "Confirm loading complete" },
    { module: "driver", action: "arrived_site",    code: PERMISSIONS.DRIVER_ARRIVED_SITE,    category: "DRIVER", description: "Mark arrived at customer site" },
    { module: "driver", action: "deliver",         code: PERMISSIONS.DRIVER_DELIVER,         category: "DRIVER", description: "Mark delivery complete" },
    { module: "driver", action: "fail_trip",       code: PERMISSIONS.DRIVER_FAIL_TRIP,       category: "DRIVER", description: "Mark trip failed" },

    { module: "vehicles", action: "view",   code: PERMISSIONS.VEHICLES_VIEW,   category: "FLEET", description: "View vehicles" },
    { module: "vehicles", action: "create", code: PERMISSIONS.VEHICLES_CREATE, category: "FLEET", description: "Add vehicles" },
    { module: "vehicles", action: "edit",   code: PERMISSIONS.VEHICLES_EDIT,   category: "FLEET", description: "Edit vehicle details" },
    { module: "vehicles", action: "assign", code: PERMISSIONS.VEHICLES_ASSIGN, category: "FLEET", description: "Assign vehicles to trips" },

    { module: "drivers", action: "view",   code: PERMISSIONS.DRIVERS_VIEW,   category: "FLEET", description: "View drivers" },
    { module: "drivers", action: "create", code: PERMISSIONS.DRIVERS_CREATE, category: "FLEET", description: "Add drivers" },
    { module: "drivers", action: "edit",   code: PERMISSIONS.DRIVERS_EDIT,   category: "FLEET", description: "Edit driver details" },
    { module: "drivers", action: "assign", code: PERMISSIONS.DRIVERS_ASSIGN, category: "FLEET", description: "Assign drivers to trips" },

    { module: "customers", action: "view",   code: PERMISSIONS.CUSTOMERS_VIEW,   category: "CRM", description: "View customers" },
    { module: "customers", action: "create", code: PERMISSIONS.CUSTOMERS_CREATE, category: "CRM", description: "Add customers" },
    { module: "customers", action: "edit",   code: PERMISSIONS.CUSTOMERS_EDIT,   category: "CRM", description: "Edit customer details" },
    { module: "sites", action: "view",   code: PERMISSIONS.SITES_VIEW,   category: "CRM", description: "View customer sites" },
    { module: "sites", action: "create", code: PERMISSIONS.SITES_CREATE, category: "CRM", description: "Add customer sites" },
    { module: "sites", action: "edit",   code: PERMISSIONS.SITES_EDIT,   category: "CRM", description: "Edit customer site details" },

    { module: "contracts", action: "view",     code: PERMISSIONS.CONTRACTS_VIEW,     category: "COMMERCIAL", description: "View contracts" },
    { module: "contracts", action: "create",   code: PERMISSIONS.CONTRACTS_CREATE,   category: "COMMERCIAL", description: "Create contracts" },
    { module: "contracts", action: "edit",     code: PERMISSIONS.CONTRACTS_EDIT,     category: "COMMERCIAL", description: "Edit contracts" },
    { module: "contracts", action: "activate", code: PERMISSIONS.CONTRACTS_ACTIVATE, category: "COMMERCIAL", description: "Activate contracts", },
    { module: "contracts", action: "retire",   code: PERMISSIONS.CONTRACTS_RETIRE,   category: "COMMERCIAL", description: "Retire contracts" },

    { module: "billing", action: "view",   code: PERMISSIONS.BILLING_VIEW,   category: "FINANCE", description: "View invoices" },
    { module: "billing", action: "create", code: PERMISSIONS.BILLING_CREATE, category: "FINANCE", description: "Generate invoices" },
    { module: "billing", action: "settle", code: PERMISSIONS.BILLING_SETTLE, category: "FINANCE", description: "Settle invoices" },
    { module: "expenses", action: "view",    code: PERMISSIONS.EXPENSES_VIEW,    category: "FINANCE", description: "View expense claims" },
    { module: "expenses", action: "create",  code: PERMISSIONS.EXPENSES_CREATE,  category: "FINANCE", description: "Submit expense claims" },
    { module: "expenses", action: "approve", code: PERMISSIONS.EXPENSES_APPROVE, category: "FINANCE", description: "Approve expense claims" },

    { module: "maintenance", action: "view",   code: PERMISSIONS.MAINTENANCE_VIEW,   category: "MAINTENANCE", description: "View maintenance records" },
    { module: "maintenance", action: "create", code: PERMISSIONS.MAINTENANCE_CREATE, category: "MAINTENANCE", description: "Create maintenance records" },
    { module: "maintenance", action: "assign", code: PERMISSIONS.MAINTENANCE_ASSIGN, category: "MAINTENANCE", description: "Assign maintenance work" },
    { module: "maintenance", action: "close",  code: PERMISSIONS.MAINTENANCE_CLOSE,  category: "MAINTENANCE", description: "Close maintenance records" },
    { module: "workshops", action: "view",   code: PERMISSIONS.WORKSHOPS_VIEW,   category: "MAINTENANCE", description: "View workshops" },
    { module: "workshops", action: "manage", code: PERMISSIONS.WORKSHOPS_MANAGE, category: "MAINTENANCE", description: "Manage workshops" },

    { module: "procurement", action: "pr.view",    code: PERMISSIONS.PR_VIEW,    category: "PROCUREMENT", description: "View purchase requisitions" },
    { module: "procurement", action: "pr.create",  code: PERMISSIONS.PR_CREATE,  category: "PROCUREMENT", description: "Create purchase requisitions" },
    { module: "procurement", action: "pr.approve", code: PERMISSIONS.PR_APPROVE, category: "PROCUREMENT", description: "Approve purchase requisitions" },
    { module: "procurement", action: "po.view",    code: PERMISSIONS.PO_VIEW,    category: "PROCUREMENT", description: "View purchase orders" },
    { module: "procurement", action: "po.create",  code: PERMISSIONS.PO_CREATE,  category: "PROCUREMENT", description: "Create purchase orders" },
    { module: "procurement", action: "po.approve", code: PERMISSIONS.PO_APPROVE, category: "PROCUREMENT", description: "Approve purchase orders" },
    { module: "procurement", action: "gr.view",    code: PERMISSIONS.GR_VIEW,    category: "PROCUREMENT", description: "View goods receipts" },
    { module: "procurement", action: "gr.receive", code: PERMISSIONS.GR_RECEIVE, category: "PROCUREMENT", description: "Receive goods" },
    { module: "inventory", action: "view",    code: PERMISSIONS.INVENTORY_VIEW,    category: "PROCUREMENT", description: "View inventory" },
    { module: "inventory", action: "receive", code: PERMISSIONS.INVENTORY_RECEIVE, category: "PROCUREMENT", description: "Receive inventory" },
    { module: "inventory", action: "adjust",  code: PERMISSIONS.INVENTORY_ADJUST,  category: "PROCUREMENT", description: "Adjust inventory" },

    { module: "reports", action: "operations.view", code: PERMISSIONS.REPORTS_OPERATIONS_VIEW, category: "REPORTS", description: "View operational reports" },
    { module: "reports", action: "fleet.view",      code: PERMISSIONS.REPORTS_FLEET_VIEW,      category: "REPORTS", description: "View fleet reports" },
    { module: "reports", action: "finance.view",    code: PERMISSIONS.REPORTS_FINANCE_VIEW,    category: "REPORTS", description: "View financial reports" },
    { module: "reports", action: "procurement.view",code: PERMISSIONS.REPORTS_PROCUREMENT_VIEW,category: "REPORTS", description: "View procurement reports" },
    { module: "scorecards", action: "view", code: PERMISSIONS.SCORECARDS_VIEW, category: "REPORTS", description: "View scorecards" },

    { module: "settings", action: "users.view",   code: PERMISSIONS.USERS_VIEW,       category: "ADMIN", description: "View users" },
    { module: "settings", action: "users.manage", code: PERMISSIONS.USERS_MANAGE,     category: "ADMIN", description: "Manage users" },
    { module: "settings", action: "roles.view",   code: PERMISSIONS.ROLES_VIEW,       category: "ADMIN", description: "View roles" },
    { module: "settings", action: "roles.manage", code: PERMISSIONS.ROLES_MANAGE,     category: "ADMIN", description: "Manage roles and permissions", },
    { module: "settings", action: "tenant",       code: PERMISSIONS.TENANT_SETTINGS,  category: "ADMIN", description: "Manage tenant settings" },
  ];

  // Upsert permissions (insert if not exists by code):
  const permIdsByCode: Record<string, string> = {};
  for (const perm of permCatalogue) {
    const existing = await db.query.permissions.findFirst({
      where: and(eq(permissions.module, perm.module), eq(permissions.action, perm.action)),
    });
    if (existing) {
      permIdsByCode[perm.code] = existing.id;
    } else {
      const id = genId();
      await db.insert(permissions).values({ id, module: perm.module, action: perm.action, code: perm.code, category: perm.category, description: perm.description });
      permIdsByCode[perm.code] = id;
      process.stdout.write(".");
    }
  }
  console.log(`\nPermissions: ${Object.keys(permIdsByCode).length} total`);
  return permIdsByCode;
}

async function main() {
  const permIdsByCode = await seedPermissions();
  console.log("Permissions seeded successfully.");
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
