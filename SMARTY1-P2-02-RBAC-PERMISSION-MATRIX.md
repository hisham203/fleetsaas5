# SMARTY1 P2-02 — RBAC Permission Matrix

**Canonical permission count:** 71 · **Sensitive:** 17 · **Date:** 2026-09-21

**Authorization system:** `lib/requirePermission.ts` · `checkPermission(session, tenantId, PERMISSIONS.CODE)`

---

## Summary

| Status | Count |
|---|---|
| ENFORCED via `checkPermission()` | 71 (all codes go through the same enforcement path) |
| Legacy fallback applies (no explicit roles) | ~30 for DISPATCHER, 7 for DRIVER |
| Platform Admin bypass | Yes — `role="ADMIN"` bypasses all checks |

---

## Permission Codes by Category

### OPERATIONS (14 codes)

| Code | Sensitive | Description | Default Roles |
|---|---|---|---|
| `orders.view` | | View orders | COORD, SUP, FINANCE |
| `orders.create` | | Create orders | COORD |
| `orders.edit` | | Edit orders | COORD |
| `orders.cancel` | ✓ | Cancel orders | COORD |
| `trips.view` | | View trips | COORD, SUP, DRIVER |
| `trips.create` | | Create trips | COORD |
| `trips.edit` | | Edit trip details | COORD, SUP |
| `trips.assign` | | Assign vehicle and driver | SUP |
| `trips.dispatch` | ✓ | **Formally dispatch to driver** | SUP |
| `trips.reassign` | ✓ | Reassign on dispatched trip | SUP |
| `trips.fail` | ✓ | Mark trip failed | SUP |
| `trips.view_live` | | Live GPS tracking | COORD, SUP |
| `control_tower.view` | | Access Control Tower | COORD, SUP |
| `control_tower.manage_events` | | Manage operational events | SUP |

### DRIVER (5 codes)

| Code | Description |
|---|---|
| `driver.arrived_loading` | First driver action (auto-sets startedAt) |
| `driver.confirm_loading` | Confirm loading complete |
| `driver.arrived_site` | Mark arrived at site |
| `driver.deliver` | Mark delivery + ePOD |
| `driver.fail_trip` | Mark trip failed (reason required) |

### FLEET (8 codes)
`vehicles.view/create/edit/assign` · `drivers.view/create/edit/assign`

### CRM (6 codes)
`customers.view/create/edit` · `sites.view/create/edit`

### COMMERCIAL (5 codes)
`contracts.view` · `contracts.create/edit/activate/retire` (all ✓ sensitive)

### FINANCE (6 codes)
`billing.view` · `billing.create/settle` (✓) · `expenses.view/create` · `expenses.approve` (✓)

### MAINTENANCE (6 codes)
`maintenance.view/create/assign/close` · `workshops.view/manage`

### PROCUREMENT (11 codes)
`procurement.pr.view/create` · `procurement.pr.approve` (✓) · `procurement.po.view/create` · `procurement.po.approve` (✓) · `procurement.gr.view/receive` · `inventory.view/receive` · `inventory.adjust` (✓)

### REPORTS (5 codes)
`reports.operations.view` · `reports.fleet.view` · `reports.finance.view` · `reports.procurement.view` · `scorecards.view`

### ADMINISTRATION (5 codes)
`users.view` · `users.manage` (✓) · `roles.view` · `roles.manage` (✓) · `tenant.settings` (✓)

---

## Sensitive Permissions (17 total)

`orders.cancel` · `trips.dispatch` · `trips.reassign` · `trips.fail` · `contracts.create/edit/activate/retire` · `billing.create/settle` · `expenses.approve` · `procurement.pr.approve/po.approve` · `inventory.adjust` · `users.manage` · `roles.manage` · `tenant.settings`

---

## Default Role Templates (8)

| Role | Assign | Dispatch | Billing | Procurement | Admin |
|---|---|---|---|---|---|
| TENANT_ADMIN | ✅ | ✅ | ✅ | ✅ | ✅ |
| OPERATION_COORDINATOR | ❌ | ❌ | — | — | — |
| OPERATION_SUPERVISOR | ✅ | ✅ | — | — | — |
| DRIVER | — | — | — | — | — |
| FLEET_MAINTENANCE | — | — | — | — | — |
| FINANCE_USER | — | — | ✅ | — | — |
| PROCUREMENT_USER | — | — | — | ✅ | — |
| AUDITOR | view only | view only | view only | view only | view only |

---

## Legacy Fallback Permissions

Applied ONLY when user has ZERO explicit RBAC role assignments.

**DISPATCHER legacy:** orders/trips/assign/dispatch, vehicles.view, drivers.view, customers/contracts/billing.view, maintenance/inventory/procurement.view, reports, scorecards

**DRIVER legacy:** trips.view, 5 lifecycle codes, expenses.view, expenses.create

**Expenses policy:** DISPATCHER does NOT have expenses.view in legacy (requires explicit RBAC assignment). DRIVER has expenses.view/create to submit own claims.
