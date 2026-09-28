# Smarty1 — Product Architecture

**Fleet Operations, Logistics Execution & Telematics Intelligence Platform**

Version: Milestone A — Product Architecture Foundation
Status: Active development · Bulk Water pilot live

---

## 1. Product Positioning

Smarty1 is a multi-tenant, white-label enterprise SaaS for fleet-intensive businesses — any organization that dispatches vehicles to fulfill orders, deliver goods, or execute field operations.

**Bulk Water Tanker Delivery (Riyadh)** is the first industry configuration. The product is designed to serve:
- Fuel distribution
- FMCG/cold-chain logistics
- Construction fleet
- Field services
- Industrial transport
- Waste management
- General fleet operations

Smarty1 is **not** a vertical-specific application. Industry configuration is achieved through tenant settings, contract types, and tanker/vehicle capacity rules — not by forking the product.

---

## 2. Product Domains

```
COMMAND CENTER     ← situational awareness, live ops monitoring
OPERATIONS         ← order-to-delivery execution
FLEET              ← vehicle/driver registry, maintenance, compliance
TELEMATICS         ← GPS, telemetry, events, device management
COMMERCIAL         ← customers, contracts, pricing, billing
SUPPLY CHAIN       ← inventory, procurement, warehousing
ANALYTICS          ← reporting, scorecards, performance intelligence
ADMINISTRATION     ← org settings, access control, integrations
```

---

## 3. Domain Ownership Rules

| Rule | Detail |
|---|---|
| **COMMERCIAL defines** | What is promised (contract, price, capacity) |
| **OPERATIONS executes** | The service delivery (order → trip → delivery) |
| **SUPPLY CHAIN enables** | The resources consumed (inventory, procurement) |
| **FLEET manages** | The assets (vehicles, drivers, maintenance) |
| **TELEMATICS observes** | Real-time and historical asset behaviour |
| **ANALYTICS understands** | Aggregated performance across all domains |
| **COMMAND CENTER watches** | The live operational picture |
| **ADMINISTRATION governs** | The platform itself (access, settings, integrations) |

---

## 4. Module Taxonomy

### 4.1 COMMAND CENTER
```
/                     Executive Overview (redirects to /command)
/command              Command Center
  /command/tower      Operations Control Tower (currently /control-tower)
  /command/fleet      Live Fleet Map
  /command/alerts     Alerts & Exceptions
  /command/sla        SLA Monitor
```

### 4.2 OPERATIONS
```
/operations
  /operations/orders           Orders (currently /admin?tab=orders in admin)
  /operations/dispatch         Planning & Dispatch (consolidates /dispatch + /admin/dispatch)
  /operations/assign           Assignment Workspace (currently /dispatch/assign)
  /operations/trips            Trips
  /operations/pod              Proof of Delivery
  /operations/exceptions       Exceptions
  /operations/escalations      SLA & Escalations
  /operations/loading-points   Loading Points (currently /admin/loading-points)
```

### 4.3 FLEET
```
/fleet
  /fleet/vehicles       Vehicles (currently /admin?tab=fleet)
  /fleet/drivers        Drivers (currently /admin?tab=drivers)
  /fleet/maintenance    Maintenance (currently /admin?tab=maintenance)
  /fleet/fuel           Fuel Transactions
  /fleet/tyres          Tyres
  /fleet/compliance     Compliance Documents [future]
```

### 4.4 TELEMATICS
```
/telematics
  /telematics/live        Live Tracking (currently /control-tower map)
  /telematics/geofences   Geofence Management [future]
  /telematics/events      Events & Alerts [future]
  /telematics/devices     Device Registry [future]
  /telematics/replay      Trip Replay [future]
```

### 4.5 COMMERCIAL
```
/commercial
  /commercial/customers      Customers & Sites (currently /admin/customers)
  /commercial/contracts      Contracts (currently /admin/contracts)
  /commercial/pricing        Pricing Rules (currently in contracts)
  /commercial/planner        Contract & Capacity Planner (currently /admin/contract-planner)
  /commercial/invoices       Invoices (currently /admin?tab=billing)
  /commercial/expenses       Expenses (currently /admin/expenses)
```

### 4.6 SUPPLY CHAIN
```
/supply-chain
  /supply-chain/items        Master Items (currently /admin/master-items)
  /supply-chain/inventory    Inventory (currently /admin/inventory)
  /supply-chain/procurement  Purchase Requests & Orders (currently /admin/procurement)
  /supply-chain/suppliers    Suppliers
  /supply-chain/receiving    Goods Receipts
  /supply-chain/workshops    Workshops (currently /admin/workshops)
```

### 4.7 ANALYTICS
```
/analytics
  /analytics/operations   Operations Performance
  /analytics/fleet        Fleet Performance
  /analytics/scorecards   Driver & Vehicle Scorecards (currently /admin?tab=scorecards)
  /analytics/reports      Report Builder (currently /admin/reports)
  /analytics/sla          SLA Performance
```

### 4.8 ADMINISTRATION
```
/admin
  /admin                      (currently is the dashboard — redirect to /command)
  /settings/access            Users & Access (currently /settings/access)
  /settings/roles             Roles & Permissions (currently /settings/roles)
  /admin/settings             Organization & Numbering (currently /admin/settings)
  /admin/automation           Automation & Webhooks
  /admin/integrations         ERP & Integrations
```

---

## 5. Migration Approach

**Milestone A** establishes the navigation taxonomy and new shell while keeping
all existing routes alive via compatibility redirects. No existing URL that appears
in tests, deep-links, or the driver app should return 404.

**Route migration** is incremental:
- New shell wraps the same underlying pages
- Tab-based /admin?tab= URLs remain alive until pages are extracted
- /dispatch → /operations/dispatch (redirect in place, old URL preserved)
- /control-tower → /command/tower (redirect, old URL preserved)

---

## 6. Multi-Industry Principle

A new industry is onboarded by:
1. Creating a tenant with the appropriate contract type(s)
2. Configuring vehicle/asset capacity definitions via tenant settings
3. Configuring loading points / depots
4. Seeding relevant master items for supply chain

The codebase does NOT fork per industry. Industry-specific business rules
(e.g. strict tanker capacity equality for bulk water) are enforced at the
commercial and eligibility layer, not the UI layer.

---

## 7. UX Principles

1. **Jobs to be done, not database tables.** Every major page answers an operator question.
2. **Backend is authoritative.** UI permission hiding is UX only.
3. **Operational density over whitespace.** Fleet operations require fast scanning.
4. **Status is always actionable.** Every status should indicate the next available action.
5. **Mobile is a first-class user.** Drivers and supervisors use phones.
6. **No dead navigation.** Only implemented capabilities appear as active menu items.
7. **Consistent patterns.** The same interaction pattern across every list, detail, and action.

---

## 8. Navigation Principles

- Navigation is centralized in `lib/navigation.ts` (module registry)
- Navigation visibility is permission-aware but backend is authoritative
- No duplicate destinations
- No technical/admin pages mixed into operator workflows
- Groups collapse at narrow viewports
- Mobile uses a slide-in drawer

---

## 9. Extension Principles

Adding a new module:
1. Register the capability in `lib/navigation.ts`
2. Create the route under the correct domain
3. Use `AppShell` wrapper
4. Use shared design-system primitives (PageHeader, DataTable, StatusBadge, etc.)
5. Connect to existing permission framework
6. No new CSS classes without design token basis

---

## 10. Protected Domains (require isolated milestones)

- Billing and pricing semantics
- POD lifecycle
- ERP synchronization
- RBAC enforcement/fallback retirement
- Financial inventory valuation
- ZATCA compliance
- Production DB migrations
- Admin commercial override
