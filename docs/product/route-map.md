# Smarty1 Route Map — Milestone A Final

Maps all current UI routes to target module locations.

## Active Routes (Milestone A)

| Current Route | Module | Target Domain | Target Route | Action |
|---|---|---|---|---|
| `/` | Root | COMMAND CENTER | `/command` | REDIRECT ✅ |
| `/command` | Command Center | COMMAND CENTER | `/command` | ACTIVE ✅ |
| `/command/alerts` | Alerts | COMMAND CENTER | `/command/alerts` | REDIRECT (stub → /control-tower) |
| `/command/sla` | SLA Monitor | COMMAND CENTER | `/command/sla` | REDIRECT (stub → /admin/reports) |
| `/control-tower` | Control Tower | COMMAND CENTER | `/control-tower` | KEEP ✅ |
| `/login` | Auth | — | `/login` | KEEP ✅ |
| `/signup` | Auth | — | `/signup` | KEEP ✅ |
| `/dispatch` | Live Dispatch (Coordinator) | OPERATIONS | `/dispatch` | KEEP ✅ PRIMARY OPERATOR DEST |
| `/dispatch/assign` | Assignment Workspace | OPERATIONS | `/dispatch/assign` | KEEP ✅ |
| `/admin/dispatch` | Dispatch Control Tower (Supervisor) | OPERATIONS | `/admin/dispatch` | KEEP ✅ SUPERVISOR DEST |
| `/operations/trips/[id]` | Trip 360 | OPERATIONS | `/operations/trips/[id]` | ACTIVE ✅ NEW |
| `/fleet/vehicles` | Vehicles | FLEET | `/fleet/vehicles` | ACTIVE ✅ NEW |
| `/fleet/drivers` | Drivers | FLEET | `/fleet/drivers` | ACTIVE ✅ NEW |
| `/fleet/maintenance` | Maintenance | FLEET | `/fleet/maintenance` | ACTIVE ✅ NEW |
| `/commercial/customers` | Customers | COMMERCIAL | `/commercial/customers` | ACTIVE ✅ NEW |
| `/supply-chain/inventory` | Inventory | SUPPLY CHAIN | `/supply-chain/inventory` | ACTIVE ✅ NEW |
| `/analytics/reports` | Reports | ANALYTICS | `/analytics/reports` | ACTIVE ✅ NEW |
| `/administration/users` | Users | ADMINISTRATION | `/administration/users` | ACTIVE ✅ NEW |
| `/admin` | Dashboard (legacy) | COMMAND CENTER | `/command` | KEEP (tests depend on it) |
| `/admin/customers` | Customers (full CRUD) | COMMERCIAL | `/admin/customers` | KEEP ✅ |
| `/admin/contracts` | Contracts | COMMERCIAL | `/admin/contracts` | KEEP ✅ |
| `/admin/contract-planner` | Capacity Planner | COMMERCIAL | `/admin/contract-planner` | KEEP ✅ |
| `/admin/expenses` | Expenses | COMMERCIAL | `/admin/expenses` | KEEP ✅ |
| `/admin/loading-points` | Loading Points | OPERATIONS | `/admin/loading-points` | KEEP ✅ |
| `/admin/inventory` | Inventory (maintenance) | FLEET/SC | `/admin/inventory` | KEEP (maintenance-focused) |
| `/admin/maintenance-inventory` | Maint. Inventory | FLEET | `/admin/maintenance-inventory` | KEEP ✅ |
| `/admin/master-items` | Master Items | SUPPLY CHAIN | `/admin/master-items` | KEEP ✅ |
| `/admin/procurement` | Procurement | SUPPLY CHAIN | `/admin/procurement` | KEEP ✅ |
| `/admin/reports` | Reports (full) | ANALYTICS | `/admin/reports` | KEEP ✅ |
| `/admin/settings` | Organization Settings | ADMINISTRATION | `/admin/settings` | KEEP ✅ |
| `/admin/workshops` | Workshops | FLEET | `/admin/workshops` | KEEP ✅ |
| `/settings/access` | Users & Access (full) | ADMINISTRATION | `/settings/access` | KEEP ✅ |
| `/settings/roles` | Roles & Permissions | ADMINISTRATION | `/settings/roles` | KEEP ✅ |
| `/driver` | Driver PWA | DRIVER | `/driver` | KEEP ✅ UNCHANGED |
| `/b2b` | B2B Customer Portal | COMMERCIAL | `/b2b` | KEEP ✅ UNCHANGED |

## Compatibility Placeholders (Present in Code, NOT Active Navigation)

| Route | Status | Reason | Navigation |
|---|---|---|---|
| `/admin/inventory-planned` | DEFERRED / COMPATIBILITY PLACEHOLDER | Tests verify boundary documentation | NOT IN NAV |
| `/admin/procurement-planned` | DEFERRED / COMPATIBILITY PLACEHOLDER | Tests verify boundary documentation | NOT IN NAV |
| `/admin/master-items-planned` | DEFERRED / COMPATIBILITY PLACEHOLDER | Redirects to `/admin/master-items` | NOT IN NAV |

## Dispatch Surface Clarification

Two dispatch surfaces exist intentionally:

| Route | Purpose | Primary User | Navigation Position |
|---|---|---|---|
| `/dispatch` | **PRIMARY** — Coordinator workspace: create orders, plan trips (PLANNED, unassigned). The live operational queue. | Operations Coordinator | PRIMARY in Operations domain |
| `/admin/dispatch` | **SECONDARY** — Supervisor Dispatch Control Tower: assign resources, dispatch trips, manual trip closure, lifecycle monitoring. | Operations Supervisor | SECONDARY in Operations domain |

**Planned Milestone B action:** Consolidate into a unified Operations workspace with role-aware views. No behavioral changes in Milestone A.

## Inventory Overlap Documentation

| Route | APIs | Domain | Scope | Why Separate |
|---|---|---|---|---|
| `/admin/inventory` | `/api/maintenance-inventory/*`, `/api/maintenance-warehouses` | FLEET (maintenance) | Spare parts, tyres, lubricants, tools for vehicle maintenance | Historically placed under Supply Chain naming but serves Fleet Maintenance |
| `/admin/maintenance-inventory` | `/api/maintenance-inventory/*`, `/api/maintenance-warehouses` | FLEET | Same data, dedicated maintenance view | Explicit maintenance context |
| `/supply-chain/inventory` (new) | `/api/inventory` | SUPPLY CHAIN | General supply chain stock (`inventoryItems` table, `warehouses`) | True tenant-wide SC inventory |

**Target Milestone C:** General SC inventory (`/supply-chain/inventory`) is the authoritative stock system. Fleet Maintenance module will issue parts from SC inventory via goods-issue transactions, eliminating the dual maintenance-inventory concept.
