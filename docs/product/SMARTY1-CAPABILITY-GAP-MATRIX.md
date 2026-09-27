# Smarty1 Capability Gap Matrix

**Purpose:** Permanent product-control document. Tracks every intended capability against current state.
**Last updated:** Milestone A

Legend: EXISTING · PARTIAL · MISSING · DEFERRED · NOT_APPLICABLE

---

## COMMAND CENTER

| Capability | Status | Route | Backend | UX Maturity | Gap | Priority | Milestone |
|---|---|---|---|---|---|---|---|
| Executive Overview | PARTIAL | `/command` (new) | Derived from existing APIs | Basic metrics | Full KPI dashboard, trend charts | P2 | Milestone B |
| Operations Control Tower | EXISTING | `/control-tower` | /api/control-tower | Good | Real-time push (currently polling) | P3 | Milestone D |
| Live Fleet Map | EXISTING | embedded in /control-tower | /api/fleet/positions | Good | Multiple vehicle markers | P2 | Milestone B |
| Alerts & Exceptions | PARTIAL | implicit | /api/exceptions, /api/escalations | Basic | Unified alert feed | P2 | Milestone B |
| SLA Monitor | PARTIAL | implicit | /api/sla | Basic | Real-time SLA breach alerts | P2 | Milestone B |
| Today's Operations | MISSING | — | — | — | Full ops digest | P3 | Milestone C |

---

## OPERATIONS

| Capability | Status | Route | Backend | UX Maturity | Gap | Priority | Milestone |
|---|---|---|---|---|---|---|---|
| Order Creation (B2B) | EXISTING | `/dispatch` | /api/orders | Good | B2B customer/contract selector | P1 | Milestone B |
| Order Creation (B2C) | EXISTING | `/dispatch` | /api/orders | Good | — | — | — |
| Trip Planning (unassigned) | EXISTING | `/dispatch` | /api/trips | Good | — | — | — |
| Assignment Workspace | EXISTING | `/dispatch/assign` | /api/trips/[id]/assign | Good | — | — | — |
| Dispatch (separate) | EXISTING | `/dispatch` | /api/trips/[id]/dispatch | Good | — | — | — |
| Driver Execution | EXISTING | `/driver` | /api/trips/[id]/lifecycle | Good | — | — | — |
| Proof of Delivery | EXISTING | embedded | /api/trips/[id]/loading | Good | ePOD capture on mobile | P2 | Milestone B |
| Exceptions | PARTIAL | implicit | /api/exceptions | Basic | Exception creation from dispatch | P2 | Milestone B |
| SLA & Escalations | PARTIAL | implicit | /api/escalations | Basic | Unified escalation view | P2 | Milestone B |
| Trip 360 View | MISSING | — | exists (trips API) | — | Dedicated trip detail page | P2 | Milestone B |
| Loading Points | EXISTING | `/admin/loading-points` | /api/warehouses | Good | — | — | — |

---

## FLEET

| Capability | Status | Route | Backend | UX Maturity | Gap | Priority | Milestone |
|---|---|---|---|---|---|---|---|
| Vehicle Registry | EXISTING | `/admin?tab=fleet` | /api/vehicles | Moderate | Vehicle 360 profile | P2 | Milestone C |
| Driver Registry | EXISTING | `/admin?tab=drivers` | /api/drivers | Moderate | Driver 360 profile | P2 | Milestone C |
| Maintenance Records | EXISTING | `/admin?tab=maintenance` | /api/vehicles/[id]/maintenance | Moderate | Work orders, PM planning | P2 | Milestone C |
| Fuel Transactions | PARTIAL | `/admin?tab=fuel` | /api/vehicles/[id]/fuel | Basic | Fuel analytics | P3 | Milestone C |
| Tyre Management | PARTIAL | `/admin?tab=tyres` | /api/vehicles/[id]/tyres | Basic | Tyre lifecycle | P3 | Milestone C |
| Workshops | EXISTING | `/admin/workshops` | /api/workshops | Moderate | — | — | — |
| Fleet Availability Dashboard | MISSING | — | partial in API | — | Real-time availability | P2 | Milestone C |
| Compliance / Documents | MISSING | — | — | — | Cert expiry alerts | P2 | Milestone D |
| Vehicle Cost Analytics | MISSING | — | — | — | Cost per km | P3 | Milestone D |

---

## TELEMATICS

| Capability | Status | Route | Backend | UX Maturity | Gap | Priority | Milestone |
|---|---|---|---|---|---|---|---|
| GPS Live Tracking | EXISTING | `/control-tower` | /api/trips/[id]/gps | Good | Multi-vehicle map view | P2 | Milestone D |
| GPS Demo | EXISTING | `/control-tower` | /api/trips/[id]/demo-gps | Good | — | — | — |
| GPS History / Trip Replay | PARTIAL | — | /api/trips/[id]/gps-history | None | Trip replay UI | P2 | Milestone D |
| Device Registry | MISSING | — | — | — | Device management | P2 | Milestone D |
| Provider Adapters | MISSING | — | — | — | GPS/telematics provider SDK | P1 | Milestone D |
| Geofence Events | MISSING | — | — | — | Define + alert on geofences | P2 | Milestone D |
| Idling Detection | MISSING | — | — | — | Requires telemetry engine | P3 | Milestone D |
| Overspeed Detection | MISSING | — | — | — | Requires telemetry engine | P3 | Milestone D |
| Stoppage Detection | MISSING | — | — | — | — | P3 | Milestone D |
| Route Deviation | MISSING | — | — | — | — | P3 | Milestone D |
| GPS Offline Detection | MISSING | — | — | — | — | P2 | Milestone D |
| Driver Behaviour | MISSING | — | — | — | Scoring engine | P3 | Milestone D |
| Fuel Sensor Integration | MISSING | — | — | — | Hardware dependency | P3 | TBD |
| Temperature Monitoring | MISSING | — | — | — | Hardware dependency | P3 | TBD |
| Door Sensors | MISSING | — | — | — | Hardware dependency | P3 | TBD |
| Engine Telemetry (OBD) | MISSING | — | — | — | Hardware dependency | P3 | TBD |
| Video Telematics / DMS | MISSING | — | — | — | Hardware dependency | P3 | TBD |
| EV / Battery Analytics | NOT_APPLICABLE | — | — | — | Not in current pilot | — | TBD |

---

## COMMERCIAL

| Capability | Status | Route | Backend | UX Maturity | Gap | Priority | Milestone |
|---|---|---|---|---|---|---|---|
| Customer Registry | EXISTING | `/admin/customers` | /api/customers | Good | Customer 360 | P2 | Milestone C |
| Customer Sites | EXISTING | embedded in customers | /api/customers/[id]/locations | Good | — | — | — |
| Contracts (B2B) | EXISTING | `/admin/contracts` | /api/contracts | Good | — | — | — |
| Contract Pricing Rules | EXISTING | embedded | /api/contract-pricing-rules | Good | — | — | — |
| Contract Planner | EXISTING | `/admin/contract-planner` | /api/contract-planner | Good | — | — | — |
| Invoices | EXISTING | `/admin?tab=billing` | /api/invoices | Moderate | Invoice detail page | P2 | Milestone B |
| Collections | PARTIAL | embedded | /api/invoices/[id]/settle-cash | Basic | Collections workflow | P3 | Milestone C |
| Expenses | EXISTING | `/admin/expenses` | /api/expenses | Good | — | — | — |
| B2C Direct Order | EXISTING | `/dispatch` | /api/orders | Good | B2C tariff refinement | P2 | Milestone B |
| B2B Portal (customer) | EXISTING | `/b2b` | /api/contracts/eligible | Good | — | — | — |
| ERP Sync (Odoo) | PARTIAL | embedded | /api/erp/* | Basic | Full bidirectional sync | P2 | Isolated milestone |

---

## SUPPLY CHAIN

| Capability | Status | Route | Backend | UX Maturity | Gap | Priority | Milestone |
|---|---|---|---|---|---|---|---|
| Master Items | EXISTING | `/admin/master-items` | /api/items | Good | — | — | — |
| Inventory | EXISTING | `/admin/inventory` | /api/inventory | Moderate | Inventory dashboard | P3 | Milestone C |
| Maintenance Inventory | EXISTING | `/admin/maintenance-inventory` | /api/maintenance-inventory/* | Moderate | Consolidate with main inventory | P2 | Milestone C |
| Purchase Requests | EXISTING | `/admin/procurement` | /api/purchase-requisitions | Good | — | — | — |
| Purchase Orders | EXISTING | `/admin/procurement` | /api/purchase-orders | Good | — | — | — |
| Goods Receipts | EXISTING | embedded | /api/goods-receipts | Good | — | — | — |
| Suppliers | PARTIAL | embedded | /api/suppliers | Basic | Supplier 360 | P3 | Milestone C |
| Stock Valuation | MISSING | — | — | — | High-risk — isolated | P3 | Isolated milestone |

---

## ANALYTICS

| Capability | Status | Route | Backend | UX Maturity | Gap | Priority | Milestone |
|---|---|---|---|---|---|---|---|
| Report Builder | EXISTING | `/admin/reports` | /api/reports, /api/reports/run | Good | — | — | — |
| Driver Scorecards | EXISTING | `/admin?tab=scorecards` | /api/scorecards/drivers | Moderate | — | — | — |
| Vehicle Scorecards | EXISTING | `/admin?tab=scorecards` | /api/scorecards/vehicles | Moderate | — | — | — |
| Operations Analytics | MISSING | — | partial in /api/executive | — | Delivery performance | P2 | Milestone C |
| Fleet Analytics | MISSING | — | — | — | Utilization, cost per km | P2 | Milestone C |
| SLA Performance | PARTIAL | implicit | /api/sla | Basic | Trend charts | P2 | Milestone C |
| Fuel Analytics | MISSING | — | /api/vehicles/[id]/fuel | — | Consumption charts | P3 | Milestone D |
| Telematics Analytics | MISSING | — | — | — | Requires P2-03+ | P3 | Milestone D |
| AI Operations Manager | DEFERRED | — | — | — | Future AI layer | — | TBD |

---

## ADMINISTRATION

| Capability | Status | Route | Backend | UX Maturity | Gap | Priority | Milestone |
|---|---|---|---|---|---|---|---|
| Users & Access | EXISTING | `/settings/access` | /api/users, /api/user-roles | Good | — | — | — |
| Roles & Permissions | EXISTING | `/settings/roles` | /api/roles, /api/permissions | Good | — | — | — |
| Organization Settings | EXISTING | `/admin/settings` | /api/settings/* | Good | — | — | — |
| Numbering Series | EXISTING | embedded | /api/settings/numbering-* | Good | — | — | — |
| Automation Rules | PARTIAL | embedded | /api/automation/* | Basic | Automation builder UI | P3 | Milestone C |
| Notifications | PARTIAL | implicit | /api/notifications | Basic | Notification center | P2 | Milestone B |
| ERP Integrations | PARTIAL | embedded | /api/erp/* | Basic | Integration management UI | P2 | Isolated milestone |
| Telematics Providers | MISSING | — | — | — | Provider config UI | P2 | Milestone D |
| Webhooks | PARTIAL | implicit | /api/automation/* | Basic | Webhook management | P3 | Milestone C |
| Audit Log | PARTIAL | implicit | /api/role-audit-log | Basic | Full audit trail UI | P2 | Milestone C |
| Multi-tenant Admin | PARTIAL | platform routes | /api/platform/* | Basic | Tenant switcher | PARTIAL | Existing |
| RBAC Legacy Fallback | EXISTING | lib/requirePermission.ts | — | — | Retirement requires isolated milestone | P1 | Isolated |
