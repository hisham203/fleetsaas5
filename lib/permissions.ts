/**
 * P2-02: Enterprise Permission Catalogue & Authorization Service
 *
 * The canonical permission model for Smarty1.
 * Format: RESOURCE.ACTION (stable machine-readable codes)
 * These codes are seeded into the permissions table and referenced at runtime.
 *
 * Design principle: DENY BY DEFAULT. No permission = no access.
 * Effective permissions = UNION of all role permissions for a user.
 */

import { db } from "@/lib/db/client";
import { permissions, rolePermissions, userRoles, roles } from "@/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";

// ── Permission Catalogue ──────────────────────────────────────────────────────

export type PermissionCode = typeof PERMISSIONS[keyof typeof PERMISSIONS];

export const PERMISSIONS = {
  // OPERATIONS — Orders
  ORDERS_VIEW:    "orders.view",
  ORDERS_CREATE:  "orders.create",
  ORDERS_EDIT:    "orders.edit",
  ORDERS_CANCEL:  "orders.cancel",

  // OPERATIONS — Trips
  TRIPS_VIEW:          "trips.view",
  TRIPS_CREATE:        "trips.create",
  TRIPS_EDIT:          "trips.edit",
  TRIPS_ASSIGN:        "trips.assign",        // assign driver + vehicle
  TRIPS_DISPATCH:      "trips.dispatch",       // formally dispatch to driver
  TRIPS_REASSIGN:      "trips.reassign",       // change assignment after dispatch
  TRIPS_FAIL:          "trips.fail",           // mark trip as failed
  TRIPS_VIEW_LIVE:     "trips.view_live",      // view GPS live tracking

  // OPERATIONS — Control Tower
  CONTROL_TOWER_VIEW:          "control_tower.view",
  CONTROL_TOWER_MANAGE_EVENTS: "control_tower.manage_events",

  // OPERATIONS — Driver Execution (driver-app actions)
  DRIVER_ARRIVED_LOADING:  "driver.arrived_loading",
  DRIVER_CONFIRM_LOADING:  "driver.confirm_loading",
  DRIVER_ARRIVED_SITE:     "driver.arrived_site",
  DRIVER_DELIVER:          "driver.deliver",
  DRIVER_FAIL_TRIP:        "driver.fail_trip",

  // FLEET
  VEHICLES_VIEW:   "vehicles.view",
  VEHICLES_CREATE: "vehicles.create",
  VEHICLES_EDIT:   "vehicles.edit",
  VEHICLES_ASSIGN: "vehicles.assign",

  DRIVERS_VIEW:   "drivers.view",
  DRIVERS_CREATE: "drivers.create",
  DRIVERS_EDIT:   "drivers.edit",
  DRIVERS_ASSIGN: "drivers.assign",

  // CUSTOMERS & CRM
  CUSTOMERS_VIEW:   "customers.view",
  CUSTOMERS_CREATE: "customers.create",
  CUSTOMERS_EDIT:   "customers.edit",
  SITES_VIEW:       "sites.view",
  SITES_CREATE:     "sites.create",
  SITES_EDIT:       "sites.edit",

  // CONTRACTS
  CONTRACTS_VIEW:     "contracts.view",
  CONTRACTS_CREATE:   "contracts.create",
  CONTRACTS_EDIT:     "contracts.edit",
  CONTRACTS_ACTIVATE: "contracts.activate",
  CONTRACTS_RETIRE:   "contracts.retire",

  // BILLING & FINANCE
  BILLING_VIEW:    "billing.view",
  BILLING_CREATE:  "billing.create",
  BILLING_SETTLE:  "billing.settle",
  EXPENSES_VIEW:   "expenses.view",
  EXPENSES_CREATE: "expenses.create",
  EXPENSES_APPROVE:"expenses.approve",

  // MAINTENANCE
  MAINTENANCE_VIEW:   "maintenance.view",
  MAINTENANCE_CREATE: "maintenance.create",
  MAINTENANCE_ASSIGN: "maintenance.assign",
  MAINTENANCE_CLOSE:  "maintenance.close",

  // WORKSHOPS
  WORKSHOPS_VIEW:   "workshops.view",
  WORKSHOPS_MANAGE: "workshops.manage",

  // PROCUREMENT
  PR_VIEW:    "procurement.pr.view",
  PR_CREATE:  "procurement.pr.create",
  PR_APPROVE: "procurement.pr.approve",
  PO_VIEW:    "procurement.po.view",
  PO_CREATE:  "procurement.po.create",
  PO_APPROVE: "procurement.po.approve",
  GR_VIEW:    "procurement.gr.view",
  GR_RECEIVE: "procurement.gr.receive",

  // INVENTORY
  INVENTORY_VIEW:    "inventory.view",
  INVENTORY_RECEIVE: "inventory.receive",
  INVENTORY_ADJUST:  "inventory.adjust",

  // REPORTS
  REPORTS_OPERATIONS_VIEW: "reports.operations.view",
  REPORTS_FLEET_VIEW:      "reports.fleet.view",
  REPORTS_FINANCE_VIEW:    "reports.finance.view",
  REPORTS_PROCUREMENT_VIEW:"reports.procurement.view",
  SCORECARDS_VIEW:         "scorecards.view",

  // PLATFORM ADMINISTRATION
  USERS_VIEW:   "users.view",
  USERS_MANAGE: "users.manage",
  ROLES_VIEW:   "roles.view",
  ROLES_MANAGE: "roles.manage",      // sensitive: can grant any permission
  TENANT_SETTINGS: "tenant.settings",
} as const;

// Default role templates — seeded via scripts/seedRbac.ts:
export const DEFAULT_ROLES = [
  {
    name: "TENANT_ADMIN",
    label: "Tenant Administrator",
    description: "Full administrative access for the organization. Can manage users, roles, and settings.",
    isSensitive: true,
    permissions: Object.values(PERMISSIONS),
  },
  {
    name: "OPERATION_COORDINATOR",
    label: "Operation Coordinator",
    description: "Handles order intake and trip planning. Cannot assign vehicles/drivers or dispatch.",
    permissions: [
      PERMISSIONS.ORDERS_VIEW, PERMISSIONS.ORDERS_CREATE, PERMISSIONS.ORDERS_EDIT,
      PERMISSIONS.TRIPS_VIEW, PERMISSIONS.TRIPS_CREATE,
      PERMISSIONS.CUSTOMERS_VIEW, PERMISSIONS.SITES_VIEW,
      PERMISSIONS.CONTRACTS_VIEW,
      PERMISSIONS.VEHICLES_VIEW, PERMISSIONS.DRIVERS_VIEW,
      PERMISSIONS.CONTROL_TOWER_VIEW,
      PERMISSIONS.REPORTS_OPERATIONS_VIEW,
    ],
  },
  {
    name: "OPERATION_SUPERVISOR",
    label: "Operation Supervisor",
    description: "Controls resource assignment and dispatch. Key operational authority role.",
    permissions: [
      PERMISSIONS.ORDERS_VIEW,
      PERMISSIONS.TRIPS_VIEW, PERMISSIONS.TRIPS_EDIT, PERMISSIONS.TRIPS_ASSIGN,
      PERMISSIONS.TRIPS_DISPATCH, PERMISSIONS.TRIPS_REASSIGN, PERMISSIONS.TRIPS_FAIL,
      PERMISSIONS.TRIPS_VIEW_LIVE,
      PERMISSIONS.VEHICLES_VIEW, PERMISSIONS.VEHICLES_ASSIGN,
      PERMISSIONS.DRIVERS_VIEW, PERMISSIONS.DRIVERS_ASSIGN,
      PERMISSIONS.CUSTOMERS_VIEW, PERMISSIONS.SITES_VIEW,
      PERMISSIONS.CONTROL_TOWER_VIEW, PERMISSIONS.CONTROL_TOWER_MANAGE_EVENTS,
      PERMISSIONS.REPORTS_OPERATIONS_VIEW, PERMISSIONS.REPORTS_FLEET_VIEW,
      PERMISSIONS.SCORECARDS_VIEW,
    ],
  },
  {
    name: "DRIVER",
    label: "Driver",
    description: "Driver app access only. Can only execute trips assigned and dispatched to them.",
    permissions: [
      PERMISSIONS.DRIVER_ARRIVED_LOADING,
      PERMISSIONS.DRIVER_CONFIRM_LOADING,
      PERMISSIONS.DRIVER_ARRIVED_SITE,
      PERMISSIONS.DRIVER_DELIVER,
      PERMISSIONS.DRIVER_FAIL_TRIP,
      PERMISSIONS.TRIPS_VIEW,
    ],
  },
  {
    name: "FLEET_MAINTENANCE",
    label: "Fleet & Maintenance User",
    description: "Manages vehicle maintenance, workshops, and inventory.",
    permissions: [
      PERMISSIONS.VEHICLES_VIEW, PERMISSIONS.VEHICLES_EDIT,
      PERMISSIONS.MAINTENANCE_VIEW, PERMISSIONS.MAINTENANCE_CREATE,
      PERMISSIONS.MAINTENANCE_ASSIGN, PERMISSIONS.MAINTENANCE_CLOSE,
      PERMISSIONS.WORKSHOPS_VIEW, PERMISSIONS.WORKSHOPS_MANAGE,
      PERMISSIONS.INVENTORY_VIEW, PERMISSIONS.INVENTORY_RECEIVE, PERMISSIONS.INVENTORY_ADJUST,
      PERMISSIONS.REPORTS_FLEET_VIEW,
    ],
  },
  {
    name: "FINANCE_USER",
    label: "Finance User",
    description: "Billing, invoices, expenses, and financial reports.",
    permissions: [
      PERMISSIONS.ORDERS_VIEW, PERMISSIONS.TRIPS_VIEW,
      PERMISSIONS.BILLING_VIEW, PERMISSIONS.BILLING_CREATE, PERMISSIONS.BILLING_SETTLE,
      PERMISSIONS.EXPENSES_VIEW, PERMISSIONS.EXPENSES_APPROVE,
      PERMISSIONS.CONTRACTS_VIEW,
      PERMISSIONS.REPORTS_FINANCE_VIEW, PERMISSIONS.REPORTS_OPERATIONS_VIEW,
    ],
  },
  {
    name: "PROCUREMENT_USER",
    label: "Procurement User",
    description: "Purchase requisitions, purchase orders, goods receipts, and suppliers.",
    permissions: [
      PERMISSIONS.PR_VIEW, PERMISSIONS.PR_CREATE, PERMISSIONS.PR_APPROVE,
      PERMISSIONS.PO_VIEW, PERMISSIONS.PO_CREATE, PERMISSIONS.PO_APPROVE,
      PERMISSIONS.GR_VIEW, PERMISSIONS.GR_RECEIVE,
      PERMISSIONS.INVENTORY_VIEW,
      PERMISSIONS.REPORTS_PROCUREMENT_VIEW,
    ],
  },
  {
    name: "AUDITOR",
    label: "Read-Only Auditor",
    description: "Read-only access across all modules. No write actions permitted.",
    permissions: [
      PERMISSIONS.ORDERS_VIEW, PERMISSIONS.TRIPS_VIEW, PERMISSIONS.TRIPS_VIEW_LIVE,
      PERMISSIONS.VEHICLES_VIEW, PERMISSIONS.DRIVERS_VIEW,
      PERMISSIONS.CUSTOMERS_VIEW, PERMISSIONS.SITES_VIEW, PERMISSIONS.CONTRACTS_VIEW,
      PERMISSIONS.BILLING_VIEW, PERMISSIONS.EXPENSES_VIEW,
      PERMISSIONS.MAINTENANCE_VIEW, PERMISSIONS.WORKSHOPS_VIEW, PERMISSIONS.INVENTORY_VIEW,
      PERMISSIONS.PR_VIEW, PERMISSIONS.PO_VIEW, PERMISSIONS.GR_VIEW,
      PERMISSIONS.REPORTS_OPERATIONS_VIEW, PERMISSIONS.REPORTS_FLEET_VIEW,
      PERMISSIONS.REPORTS_FINANCE_VIEW, PERMISSIONS.REPORTS_PROCUREMENT_VIEW,
      PERMISSIONS.SCORECARDS_VIEW, PERMISSIONS.USERS_VIEW, PERMISSIONS.ROLES_VIEW,
      PERMISSIONS.CONTROL_TOWER_VIEW,
    ],
  },
] as const;

// ── Authorization Service ─────────────────────────────────────────────────────

/**
 * Returns the effective set of permission codes for a user within a tenant.
 * Effective = UNION of all permissions granted through the user's active roles.
 * DENY BY DEFAULT: if a user has no roles, they have no permissions.
 */
export async function getEffectivePermissions(userId: string, tenantId: string): Promise<Set<string>> {
  const userRoleRows = await db.query.userRoles.findMany({
    where: and(eq(userRoles.userId, userId), eq(userRoles.tenantId, tenantId)),
    with: { role: { with: { rolePermissions: { with: { permission: true } } } } },
  });

  const codes = new Set<string>();
  for (const ur of userRoleRows) {
    if (!ur.role?.isActive) continue; // skip deactivated roles
    for (const rp of ur.role.rolePermissions) {
      if (rp.permission?.code) codes.add(rp.permission.code);
    }
  }
  return codes;
}

/**
 * Returns true if the user has the specified permission code within their tenant.
 * Uses database-backed lookup — NEVER trust client-supplied permission claims.
 */
export async function hasPermission(
  userId: string, tenantId: string, code: PermissionCode | string
): Promise<boolean> {
  const effective = await getEffectivePermissions(userId, tenantId);
  return effective.has(code);
}

/**
 * Throws a structured 403 error object if the user lacks the required permission.
 * Use in API route handlers: await requirePermission(session, tenantId, PERMISSIONS.TRIPS_DISPATCH)
 */
export function createPermissionError(code: string) {
  return { error: `Insufficient permissions: ${code} is required`, errorCode: "PERMISSION_DENIED", status: 403 };
}
