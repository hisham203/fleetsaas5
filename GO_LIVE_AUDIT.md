# Go-Live Product Audit — RFQ Module Readiness Matrix

**Method**: every claim below was checked against the actual repository
(routes, schema, seed data, tests) as it stands right now, not against
memory of what was built earlier. Where a claim depends on the actual
deployed Railway staging environment specifically (not just the code's
theoretical capability), that's called out explicitly — two real findings
came from this: `GOOGLE_MAPS_API_KEY` is not configured in the live
staging environment (confirmed in `STAGING_REPORT.md`), and BR-23
(Tasks/Expenses) has zero seed data despite being fully implemented in
code.

**Scale of what exists**: 63 API routes, 7 UI pages, 28 database tables,
33 test files / 218 tests, all passing.

---

## Module Readiness Matrix

| # | Module | Status | Evidence | UI | API | DB | Tests | Demo Data | Priority | Recommended Next Task |
|---|---|---|---|---|---|---|---|---|---|---|
| BR-01 | Multi-Tenant SaaS Architecture | **Done** | `getSessionTenantId()` is the single choke point every route derives tenant from; `platform_admin_tenant_grants` for Company Switcher | Admin console + signup flow | `/api/tenant`, `/api/platform/*` | `tenants`, `platformAdminTenantGrants` | `tenant-isolation.test.ts` (5), `company-switcher.test.ts` (9) | 2 tenants seeded | — | A true cross-tenant "Tenants" management screen (create/suspend tenants) — today only `/signup` creates tenants |
| BR-02 | Fleet Management | **Done** | Full CRUD, status engine, capacity validation | Admin Fleet tab | `/api/vehicles/*` | `vehicles` | `vehicle-home-warehouse.test.ts`, `crud-happy-paths.test.ts` | 5+3 vehicles | P2 | Document/insurance expiry alerts (istimara) |
| BR-03 | Driver Management | **Done** | Full CRUD, status engine, real auth per driver | Admin Drivers tab | `/api/drivers` | `drivers`, `users` | `crud-happy-paths.test.ts` | 5+3 drivers | P2 | License expiry alerts |
| BR-04 | Customer Management B2B/B2C | **Done** | Multi-location B2B, credit limits, subscriptions | Admin Customers tab + B2B portal | `/api/customers/*` | `customers`, `customerLocations`, `subscriptions` | `customer-locations.test.ts`, `credit-exposure.test.ts` | 8+3 customers | — | none blocking |
| BR-05 | Order Management | **Done** | Full status lifecycle, credit-limit blocking | Dispatch console | `/api/orders`, `/api/orders/bulk` | `orders` | `trip-lifecycle.test.ts`, `seed-data-quality.test.ts` | 61+32 orders/tenant | — | none blocking |
| BR-06 | Trip Planning & Route Optimization | **Partial** | Real Google Directions API call with graceful selection-order fallback | Dispatch trip planner | `/api/trips` | `trips`, `tripStops` | `googleMaps.test.ts` (mocked) | **No Maps API key configured in live staging** — running in fallback mode right now, not real optimization | **P0 before pilot** | Provision a real `GOOGLE_MAPS_API_KEY` for staging and verify actual optimized routing, not just the fallback path |
| BR-07 | Dispatch & Control Tower | **Partial** | Live queue, SLA badges, exception center all real; live map falls back to placeholder pins without a Maps key | Dispatch console | `/api/trips`, `/api/sla` | `trips` | `trip-lifecycle.test.ts` | rich | P1 | Mid-trip driver/vehicle reassignment (documented gap, never built) |
| BR-08 | Trip Management | **Done** | Full PLANNED→DISPATCHED→IN_PROGRESS→COMPLETED lifecycle | Dispatch console | `/api/trips/[id]` | `trips` | `trip-lifecycle.test.ts` | 56+30 historical trips | — | none blocking |
| BR-09 | Warehouse, Loading & Inventory | **Done** | Loading gate blocks dispatch on insufficient stock, deducts on confirm | Admin Inventory tab + loading confirmation | `/api/warehouses`, `/api/inventory` | `warehouses`, `inventoryItems` | `warehouse-inventory.test.ts` | 2 warehouses/tenant, realistic stock | P2 | Multi-warehouse stock transfer flow |
| BR-10 | Delivery Ops & ePOD | **Partial** | Real geo-stamp/timestamp/qty capture; `signatureNote` is a text field, no image | Driver app delivery flow | stop route | `epods` | `trip-lifecycle.test.ts` | 52+28 epods | **P1** | Photo/signature capture — needs file storage, which doesn't exist anywhere in this app yet |
| BR-11 | Delivery Exceptions & Returns | **Done** | Full Reschedule/Return/Reassign/Cancel/Escalate | Dispatch Exception Center | `/api/exceptions/*` | `exceptions` | `exceptions.test.ts` | 4+2 failed deliveries | — | none blocking |
| BR-12 | Live Location Tracking | **Partial (simulated)** | Client-side interpolated position, no real device integration, no geofencing | Dispatch live map | `/api/trips/[id]/gps` | `currentLat/Lng` on `trips` | Incidental only (`trip-lifecycle.test.ts`), no dedicated GPS test | Simulated at runtime, not seeded | **P0 before pilot** | Real hardware/`navigator.geolocation` integration — a fleet company will not accept simulated GPS for a paying pilot |
| BR-13 | Fuel/Load/Temp/Engine Monitoring | **Partial** | Manual fuel-log entry only; zero temperature/engine/load sensor fields anywhere in schema | Admin Fuel tab | `/api/vehicles/[id]/fuel` | `fuelLogs` | `vehicle-maintenance-fuel-tyres.test.ts` | 11+5 fuel logs | P1 (fuel), P2 (IoT) | IoT/telematics hardware partnership — out of a software-only session's reach |
| BR-14 | Tyre & Inventory Management | **Partial** | Tyre install/retire lifecycle real; no distinct spare-parts inventory system | Admin Tyres tab | `/api/vehicles/[id]/tyres` | `tyreRecords` | `vehicle-maintenance-fuel-tyres.test.ts` | 3 tyre records (tenant 1 only) | P2 | Spare-parts inventory beyond bottles/tanks |
| BR-15 | Maintenance Management | **Partial** | Manual open/close only, no proactive threshold alerts | Admin Maintenance tab | `/api/vehicles/[id]/maintenance` | `maintenanceRecords` | `vehicle-maintenance-fuel-tyres.test.ts` | 3+1 records | P1 | Proactive maintenance-due alerts (odometer/date threshold) |
| BR-16 | Safety & Security | **Missing** | Confirmed via direct search — zero panic button, geofencing, fatigue monitoring anywhere in the codebase | none | none | none | none | none | **P1** (often RFQ-mandatory for GCC logistics tenders) | Requires hardware vendor partnership — cannot be built in a software-only session |
| BR-17 | Driver & Vehicle Scorecards | **Done** | Configurable weights, real computation from trip/SLA/order data | Admin Scorecards tab | `/api/scorecards/*` | `scorecardConfigs` | `scorecards.test.ts` (unit + integration) | Varied, credible scores confirmed live | — | none blocking |
| BR-18 | Billing, Invoicing & Collections | **Done** | Auto-invoice on delivery, VAT, discounts, per-contract pricing, credit notes, cash settlement | Admin Billing tab | `/api/invoices/*` | `invoices`, `creditNotes` | `billing-refinements.test.ts` | 52+28 invoices, credible revenue | P2 | Payment gateway integration (no gateway call exists — `ONLINE` is a label only) |
| BR-19 | ERP & Accounting Integration | **Partial** | Real Odoo JSON-RPC client, unit-tested against a mock — **never run against a live Odoo server** | Admin ERP Sync tab | `/api/erp/*` | `erpConnections` | `odoo.test.ts` (mocked), `erp-sync.test.ts` | No real connection configured anywhere | **P0 before claiming this to an Odoo customer** | Verify against a real/trial Odoo instance via the in-app "Test connection" button |
| BR-20 | SLA & Escalation Management | **Done** | Live SLA computation, persisted escalations, acknowledge/resolve audit trail | Dispatch SLA monitor + Escalations panel | `/api/sla`, `/api/escalations/*` | `escalations` | `escalations.test.ts`, `sla.test.ts` | AT_RISK/BREACHED orders seeded | — | none blocking |
| BR-21 | Rich Analytics & Report Builder | **Done** | 9 whitelisted datasets, CSV export, saved reports | Admin Reports tab | `/api/reports/*` | `savedReports` | `reports.test.ts`, `reportDatasets.test.ts` | Rich underlying data | P2 | Scheduled/emailed reports |
| BR-22 | Workflow Automation Engine | **Done** | Real rule engine, 6 event types, anti-spam dedup, audit log | Admin Automation tab | `/api/automation/*` | `automationRules`, `automationLogs` | `automation.test.ts` (unit + integration) | Configurable live | — | none blocking |
| BR-23 | Task, Expense & Field Activity | **Done** | Full task assignment + expense approval workflow works, now genuinely demonstrable | Admin Field Ops tab + Driver app | `/api/tasks/*`, `/api/expenses/*` | `tasks`, `expenseClaims` | `tasks.test.ts`, `expenses.test.ts`, `seed-data-quality.test.ts` (6 new assertions) | **Closed** — 10 tasks/10 expenses seeded for Demo Water Co., 8/8 for Acme, verified live via the real API, not just row counts | — | none blocking |
| BR-24 | Industry Operational Scenarios | **Done (water), shallow (fuel)** | Subscriptions/refills/empty-bottle collection genuinely modeled; fuel sector reuses the same order schema with different pricing, no sector-specific fields | Both tenants | shared order API | `orders` | `seed-data-quality.test.ts` | Both tenants seeded | P2 | Sector-specific order fields for fuel (drum type, hazmat class, etc.) if pursuing fuel-sector customers specifically |
| APP-01 | Admin Web Platform | **Done (mostly)** | All major tabs present and functional | `/admin` | many | many | broad coverage | rich | P2 | Cross-tenant "Tenants" management screen |
| APP-02 | Dispatcher Console | **Done (mostly)** | Live queue, map, SLA, exceptions, loading gate | `/dispatch` | many | many | `trip-lifecycle.test.ts` | rich | P2 | Real-time push (WebSockets) instead of polling; drag-drop planning |
| APP-03 | Driver Mobile App | **Partial** | Responsive web only — no PWA manifest, no service worker, no push, no offline queue (confirmed via search) | `/driver` | many | many | `trip-lifecycle.test.ts` | rich | **P1 before pilot** | Offline-tolerant PWA — real field drivers need this in low-connectivity areas |
| APP-04 | Supervisor Mobile App | **Missing** | Zero `SUPERVISOR` role, zero dedicated page anywhere (confirmed via search) | none | none | none | none | none | P2 | A distinct supervisor role/view, or explicitly scope this out of MVP |
| APP-05 | Customer B2C Mobile App | **Missing (deliberately out of scope)** | Never attempted per explicit instruction across every prior task | none | none | none | none | none | P2 (deferred) | Not recommended until a real B2C self-service need is validated |
| APP-06 | Customer B2B Portal | **Done** | Multi-location, bulk orders, statements | `/b2b` | several | several | `customer-locations.test.ts` | Jarir/Al Rajhi portal logins seeded | — | none blocking |
| APP-07 | Executive Dashboard | **Done** | 13 KPIs, real comparative analysis, driver/vehicle ranking, CSV export | Admin Executive tab | `/api/executive/dashboard` | reads across many tables | `executiveDashboard.test.ts`, `executive-dashboard.test.ts`, `seed-data-quality.test.ts` | Fully credible KPIs, confirmed live by the user | — | Scheduled reports/PDF export |

**Score: 16 of 31 modules Done, 11 Partial, 4 Missing** (BR-16, APP-04, APP-05 fully missing; APP-03 partial-bordering-missing on the "mobile app" framing specifically).

---

## What is demo-ready now

Everything needed for an investor/customer **demo** (not a live pilot)
works convincingly: multi-tenant isolation, the Company Switcher, the full
order→dispatch→delivery→invoice lifecycle, SLA monitoring and escalations,
driver/vehicle scorecards, the report builder, workflow automation, the
B2B portal, and — freshly verified — the Executive Dashboard showing
credible, differentiated KPIs for two realistic Saudi/GCC businesses. This
is a genuinely strong demo, not a hollow shell.

## What is not customer-ready yet

Anything that requires a **real external dependency currently unconfigured
or unverified**: Google Maps (BR-06/07/12 are running in fallback mode
in the actual deployed staging right now), Odoo ERP (never tested against
a live instance), and payment gateways (not built). Anything requiring
**real hardware**: GPS/telematics (BR-12, simulated), IoT sensors (BR-13),
safety/security devices (BR-16). Anything requiring **file storage**,
which doesn't exist anywhere in this app: ePOD photos, receipt uploads.
And the driver experience is a **responsive web app, not an
offline-tolerant native/PWA app** — a real risk for field drivers in
low-connectivity areas.

---

## Top 10 gaps before pilot

1. **No Google Maps API key configured in staging** — BR-06/07/12 are demonstrably running in fallback/simulated mode right now, not their real capability.
2. **ERP sync never verified against a live Odoo instance** — a real blocker if the pilot customer actually uses Odoo.
3. **Simulated GPS, no real device/hardware integration** — the single most visible "this isn't real yet" gap for a fleet ops buyer.
4. **No photo/signature capture for ePOD** — and no file storage exists anywhere to build it on.
5. **Driver app is web-only, no offline tolerance** — a real risk if field connectivity is spotty.
6. **BR-16 Safety & Security is completely unbuilt** — often an RFQ-mandatory checkbox for GCC logistics tenders.
7. **No proactive maintenance alerts** — purely manual/reactive today.
8. ~~BR-23 (Tasks/Expenses) has zero demo data~~ **Resolved**: 10 tasks/10 expenses seeded for Demo Water Co., 8/8 for Acme, verified live via the real API with genuine trip-linkage for the failed-delivery scenario, not just synthetic-sounding labels.
9. **No payment gateway** — `ONLINE` payment method is a label with no real processor behind it.
10. **No cross-tenant "Tenants" management screen** — today, provisioning a new tenant only happens via self-service `/signup`; there's no way for a platform operator to administer tenants directly.
11. **No automated demo-data reset for hosted staging** — applying this richer seed to an already-seeded Railway database requires a manual wipe-and-reseed (documented in `STAGING_REPORT.md`), not a one-command refresh.

## Top 10 next Claude implementation tasks

1. Configure and verify a real `GOOGLE_MAPS_API_KEY` in staging; confirm actual optimized routing end-to-end.
2. ~~Seed `tasks` and `expenseClaims` sample data so BR-23 isn't empty in a demo~~ **Done** — see the updated BR-23 row above.
3. Verify ERP sync against a real or trial Odoo instance.
4. Design and scope a minimal photo-upload path for ePOD (this requires picking a storage provider first — a genuine architecture decision, not a quick patch).
5. Build proactive maintenance-due alerts (odometer/date threshold → automation engine event, reusing BR-22's existing infrastructure).
6. Build the mid-trip reassignment flow for Dispatch (BR-07's known gap).
7. Evaluate PWA conversion for the driver app (offline queue + service worker) as a dedicated scoping task before implementation.
8. Build a minimal cross-tenant "Tenants" admin screen for platform admins (list/view tenants they're granted, not full provisioning).
9. Scope a payment gateway integration (Moyasar/PayTabs are common Saudi options) — a real vendor-selection decision, not just code.
10. Address the still-open Next.js dependency findings from the security migration (1 high-severity finding bundled inside `next` itself, no fix available in the 15.5.x line yet) — track for when a future Next.js release resolves it.

---

## Recommendation

**Demo-ready. Not yet pilot-ready. Not production-ready.**

The demo is genuinely strong — real multi-tenant architecture, a complete
operational lifecycle, credible financials, and a Company Switcher that
visibly shows two different businesses. But "pilot-ready" means a real
customer moving real trucks and real money, and three things stand in the
way of that specifically: unverified/unconfigured external dependencies
(Maps, ERP), simulated rather than real GPS, and no photo-based proof of
delivery. None of these are far away, but none should be glossed over
either — this matrix is deliberately not marking any of them Done.
