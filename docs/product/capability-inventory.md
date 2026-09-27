# Smarty1 — Capability Inventory (Milestone A)

Generated from direct repository inspection.

---

## COMMAND CENTER

| Capability | Route | Domain | Status | APIs | Target Module | Action |
|---|---|---|---|---|---|---|
| Executive Overview | `/command` | COMMAND CENTER | EXISTING | /api/trips, /api/orders, /api/drivers, /api/vehicles | Command Center | ACTIVE ✅ |
| Operations Control Tower | `/control-tower` | COMMAND CENTER | ACTIVE | /api/control-tower, /api/trips | Control Tower | KEEP (alias) |
| Live Fleet Map | `/control-tower` (map tab) | COMMAND CENTER | PARTIAL | /api/fleet/positions, /api/trips/[id]/gps | Live Tracking | CONSOLIDATE later |
| Alerts & Exceptions | `/admin?tab=exceptions` | COMMAND CENTER | PARTIAL | /api/exceptions, /api/escalations | Alerts | KEEP |

---

## OPERATIONS

| Capability | Route | Domain | Status | APIs | Target Module | Action |
|---|---|---|---|---|---|---|
| Order Queue / Planning | `/dispatch` | OPERATIONS | ACTIVE | /api/orders, /api/trips | Planning & Dispatch | KEEP |
| Assignment Workspace | `/dispatch/assign` | OPERATIONS | ACTIVE | /api/trips, /api/fleet/eligible-* | Assignment | KEEP |
| Dispatch Control Tower | `/admin/dispatch` | OPERATIONS | ACTIVE | /api/control-tower | Dispatch Tower | KEEP |
| Loading Points | `/admin/loading-points` | OPERATIONS | ACTIVE | /api/warehouses | Loading Points | KEEP |
| Contract & Capacity Planner | `/admin/contract-planner` | OPERATIONS+COMMERCIAL | ACTIVE | /api/contract-planner | Planner | KEEP |
| Exceptions | implicit | OPERATIONS | PARTIAL | /api/exceptions | Exceptions | PARTIAL |
| SLA / Escalations | implicit | OPERATIONS | PARTIAL | /api/sla, /api/escalations | SLA Monitor | PARTIAL |

---

## FLEET

| Capability | Route | Domain | Status | APIs | Target | Action |
|---|---|---|---|---|---|---|
| Vehicles | `/admin?tab=fleet` | FLEET | ACTIVE | /api/vehicles | Vehicles | KEEP |
| Drivers | `/admin?tab=drivers` | FLEET | ACTIVE | /api/drivers | Drivers | KEEP |
| Maintenance | `/admin?tab=maintenance` | FLEET | ACTIVE | /api/vehicles/[id]/maintenance | Maintenance | KEEP |
| Fuel Transactions | `/admin?tab=fuel` | FLEET | PARTIAL | /api/vehicles/[id]/fuel | Fuel | KEEP |
| Tyres | `/admin?tab=tyres` | FLEET | PARTIAL | /api/vehicles/[id]/tyres | Tyres | KEEP |
| Workshops | `/admin/workshops` | FLEET | ACTIVE | /api/workshops | Workshops | KEEP |
| Compliance/Docs | — | FLEET | MISSING | — | Compliance | FUTURE |

---

## TELEMATICS

| Capability | Route | Domain | Status | APIs | Target | Action |
|---|---|---|---|---|---|---|
| GPS Live Tracking | `/control-tower` (map) | TELEMATICS | ACTIVE | /api/trips/[id]/gps, /api/fleet/positions | Live Tracking | KEEP |
| GPS History | implicit | TELEMATICS | PARTIAL | /api/trips/[id]/gps-history | Trip Replay | PARTIAL |
| GPS Demo | `/control-tower` | TELEMATICS | ACTIVE | /api/trips/[id]/demo-gps, /api/trips/[id]/demo-route | Demo | KEEP |
| Geofences | — | TELEMATICS | MISSING | — | Geofences | FUTURE (P2-03+) |
| Driver Behaviour | — | TELEMATICS | MISSING | — | Driver Behaviour | FUTURE |
| Device Registry | — | TELEMATICS | MISSING | — | Devices | FUTURE |
| Telemetry Ingestion | partial (GPS only) | TELEMATICS | PARTIAL | /api/trips/[id]/gps | Telemetry | PARTIAL |

---

## COMMERCIAL

| Capability | Route | Domain | Status | APIs | Target | Action |
|---|---|---|---|---|---|---|
| Customers & Sites | `/admin/customers` | COMMERCIAL | ACTIVE | /api/customers, /api/customers/[id]/locations | Customers | KEEP |
| Contracts | `/admin/contracts` | COMMERCIAL | ACTIVE | /api/contracts | Contracts | KEEP |
| Pricing Rules | embedded in contracts | COMMERCIAL | ACTIVE | /api/contract-pricing-rules | Pricing | KEEP |
| B2B Portal | `/b2b` | COMMERCIAL | ACTIVE | /api/contracts/eligible, /api/orders | B2B Portal | KEEP |
| Invoices | `/admin?tab=billing` | COMMERCIAL | ACTIVE | /api/invoices | Billing | KEEP |
| Expenses | `/admin/expenses` | COMMERCIAL | ACTIVE | /api/expenses | Expenses | KEEP |
| ERP Sync | embedded in billing | COMMERCIAL | PARTIAL | /api/erp/* | ERP | KEEP |

---

## SUPPLY CHAIN

| Capability | Route | Domain | Status | APIs | Target | Action |
|---|---|---|---|---|---|---|
| Master Items | `/admin/master-items` | SUPPLY CHAIN | ACTIVE | /api/items, /api/item-categories | Items | KEEP |
| Inventory | `/admin/inventory` | SUPPLY CHAIN | ACTIVE | /api/inventory, /api/warehouses | Inventory | KEEP |
| Maintenance Inventory | `/admin/maintenance-inventory` | SUPPLY CHAIN | ACTIVE | /api/maintenance-inventory/* | Inventory | CONSOLIDATE |
| Procurement (PRs) | `/admin/procurement` | SUPPLY CHAIN | ACTIVE | /api/purchase-requisitions, /api/purchase-orders | Procurement | KEEP |
| Goods Receipts | embedded in procurement | SUPPLY CHAIN | ACTIVE | /api/goods-receipts | Procurement | KEEP |
| Suppliers | embedded in procurement | SUPPLY CHAIN | PARTIAL | /api/suppliers | Suppliers | KEEP |
| Warehouses | embedded in loading points | SUPPLY CHAIN | ACTIVE | /api/warehouses | Warehouses | KEEP |

---

## ANALYTICS

| Capability | Route | Domain | Status | APIs | Target | Action |
|---|---|---|---|---|---|---|
| Reports | `/admin/reports` | ANALYTICS | ACTIVE | /api/reports, /api/reports/run | Reports | KEEP |
| Scorecards | `/admin?tab=scorecards` | ANALYTICS | ACTIVE | /api/scorecards/* | Scorecards | KEEP |
| Executive Dashboard | implicit in /admin | ANALYTICS | PARTIAL | /api/executive/dashboard | Dashboard | PARTIAL |
| Operations Analytics | — | ANALYTICS | MISSING | — | Ops Analytics | FUTURE |
| Fleet Analytics | — | ANALYTICS | MISSING | — | Fleet Analytics | FUTURE |

---

## ADMINISTRATION

| Capability | Route | Domain | Status | APIs | Target | Action |
|---|---|---|---|---|---|---|
| Users & Access | `/settings/access` | ADMINISTRATION | ACTIVE | /api/users, /api/user-roles | Users | KEEP |
| Roles & Permissions | `/settings/roles` | ADMINISTRATION | ACTIVE | /api/roles, /api/permissions | Roles | KEEP |
| Organization / Numbering | `/admin/settings` | ADMINISTRATION | ACTIVE | /api/settings/* | Org Settings | KEEP |
| Automation & Webhooks | embedded in settings | ADMINISTRATION | PARTIAL | /api/automation/* | Automation | KEEP |
| Audit Log | embedded | ADMINISTRATION | PARTIAL | /api/role-audit-log | Audit | KEEP |
| Tasks | embedded | ADMINISTRATION | PARTIAL | /api/tasks | Tasks | KEEP |

---

## MILESTONE A NEW PAGES (Representative Migrations)

| Page | Route | Domain | Status | DS Components Used |
|---|---|---|---|---|
| Command Center | `/command` | COMMAND CENTER | EXISTING ✅ | PageHeader, MetricCard, StatusBadge, EmptyState, LoadingState |
| Trip 360 | `/operations/trips/[id]` | OPERATIONS | EXISTING ✅ | EntityHeader, StatusBadge, DescriptionList, TimelineItem, Btn |
| Vehicles | `/fleet/vehicles` | FLEET | EXISTING ✅ | PageHeader, MetricCard, FilterBar, StatusBadge, DataTable, EmptyState |
| Drivers | `/fleet/drivers` | FLEET | EXISTING ✅ | PageHeader, MetricCard, FilterBar, StatusBadge, DataTable, EmptyState |
| Maintenance | `/fleet/maintenance` | FLEET | EXISTING ✅ | PageHeader, MetricCard, FilterBar, StatusBadge, DataTable, EmptyState |
| Customers | `/commercial/customers` | COMMERCIAL | EXISTING ✅ | PageHeader, MetricCard, FilterBar, StatusBadge, DataTable, EmptyState |
| Inventory | `/supply-chain/inventory` | SUPPLY CHAIN | EXISTING ✅ | PageHeader, MetricCard, FilterBar, StatusBadge, DataTable, EmptyState |
| Reports | `/analytics/reports` | ANALYTICS | EXISTING ✅ | PageHeader, EmptyState, LoadingState, StatusBadge, Btn |
| Users & Access | `/administration/users` | ADMINISTRATION | EXISTING ✅ | PageHeader, MetricCard, FilterBar, StatusBadge, DataTable, EmptyState |
