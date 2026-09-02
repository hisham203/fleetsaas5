# Fleet, Logistics & Delivery Ops Platform — Phase 1

Working reference implementation of **Phase 1: Core Operations** from the
Enterprise Fleet, Logistics & Delivery Operations Platform BRD, shaped around
the **water delivery** sector (subscriptions, bottle refills, empty-bottle
collection).

Covers the end-to-end flow: **Order → Validate → Dispatch → Trip → ePOD →
Auto-Invoice**, across three working consoles (Admin, Dispatcher, Driver).

## What's implemented (maps to BRD sections)

| BR # | Requirement | Status |
|---|---|---|
| BR-01 | Multi-Tenant architecture | Schema is tenant-scoped throughout. **Company Switcher**: a small, explicitly-provisioned set of platform admins can switch between authorized tenants from the Admin console — see "Company Switcher" below for the full security model. Every ordinary tenant Admin remains permanently confined to their own company |
| BR-02 | Fleet Management | Vehicle CRUD, status engine, capacity validation on trip assignment |
| BR-03 | Driver Management | Driver CRUD, status engine (Available/On Trip/Off Duty) |
| BR-04 | Customer Management (B2B/B2C) | Customer CRUD, B2B credit limits enforced at order creation |
| BR-05 | Order Management | Full status lifecycle, validation before entering dispatch queue |
| BR-06/07 | Dispatch & Trip Planning | Manual trip planner with driver/vehicle/order selection, capacity checks |
| BR-08 | Trip Management | Trip lifecycle: Planned → Dispatched → Completed, with stop sequencing |
| BR-10 | Electronic Proof of Delivery | ePOD capture (qty, recipient, notes, empties collected) required to close a stop |
| BR-11 | Delivery Exceptions & Returns | Every failed or partially-delivered stop automatically opens an exception in the Dispatcher console's Exception Center. Four closing actions — **Reschedule** and **Reassign** create a follow-up order sized to the undelivered quantity; **Return** and **Cancel** reconcile the undelivered bottles back to the trip's warehouse stock (fixing what would otherwise be a permanent inventory shortfall) and generate a return note. **Escalate** is separate and doesn't close the case — it flags the exception for a supervisor while leaving it open to resolve afterward |
| BR-18 | Billing, Invoicing & Collections | Auto-generated invoice on delivery, VAT-inclusive (15%), cash vs. account-credit handling. **Refinements**: flat per-order discounts (applied before VAT, clamped at zero); **per-contract pricing** for B2B customers — a negotiated rate silently overrides whatever price an order request supplies, closing a real gap where any dispatcher could otherwise set any price on any order; **Credit Notes** as a genuine adjustment against an issued invoice, balance-validated and reducing B2B credit exposure; **cash settlement with driver** — an explicit reconciliation step for CASH-paid orders |
| APP-06 | B2B Customer Portal | Multi-location accounts, bulk ordering across sites in one action, order history, statement with live credit exposure |
| BR-20 | SLA & Escalation Management | Live SLA status per order (on-track/at-risk/breached/met/missed), computed on read. **Real, persisted escalations**: an order crossing into at-risk or breached automatically creates an escalation record (severity MEDIUM/HIGH), auto-assigned to an Admin, with a full acknowledge → resolve audit trail — not just a badge that disappears. Triggering happens as a side effect of the existing SLA polling, so no background job scheduler is needed (documented honestly as the mechanism, not claimed as a true cron) |
| BR-09 | Warehouse, Loading & Inventory | Tenant-wide bottle stock ledger; a trip cannot be dispatched until the warehouse confirms loading (which deducts stock); empty bottles collected on delivery return to stock automatically |
| BR-13/14/15 | Fuel, Tyre & Maintenance | Per-vehicle maintenance records (opening one takes the vehicle out of service, completing it returns it), fuel fill-up logs, tyre install/retire tracking — all in the Admin console's Maintenance tab |
| — | Authentication | Real login (email/password, hashed with bcrypt, session cookies) covering internal users (Admin/Dispatcher/Driver) and B2B customer portal accounts, with server-side role checks on every API route and B2B data isolation (a customer can never see another customer's data) |
| BR-06 | Route Optimization | Google Maps Directions API (`optimize:true` waypoints) computes stop order as a round trip from the tenant depot when a trip is created; falls back to selection order if no API key is configured |
| BR-12 | Live Location Tracking | Simulated GPS: the driver app interpolates a position along the trip's stops and pings the server every few seconds; the Dispatcher console shows live vehicle positions on a Google Map |
| BR-01/09 | Multi-Tenant Onboarding + Per-Warehouse Inventory | Self-serve `/signup` creates a brand-new, fully isolated company (tenant + admin + first warehouse) in one step; every API route derives its tenant scope from the session — never a client-supplied ID — so one company's data is structurally unreachable from another's; each tenant can run multiple warehouses, each with its own stock ledger and its own coordinates for route optimization. Vehicles can have a "home warehouse" default, which the Dispatcher's trip planner auto-fills (still overridable per trip) |
| BR-21 | Custom Report Builder | Admin console lets you pick a dataset (Orders, Invoices, Trips, Vehicles, Fuel Logs, Maintenance), choose columns, add filters, sort, preview, export CSV, and save/reload report configs. Datasets and their columns are whitelisted server-side — never dynamic SQL — so this can't become an injection vector |
| BR-17 | Driver & Vehicle Scorecards | Drivers get a 0–100 composite score (on-time rate, delivery success rate, trip volume) with **per-tenant configurable weights** — Admin can adjust how much each factor counts, with automatic normalization so weights don't need to sum to 100 — and are ranked highest-first; vehicles are ranked by cost-per-completed-trip (fuel + maintenance), lowest first |
| BR-19 | ERP/Accounting Sync (Odoo) | Pushes delivered-order invoices to Odoo as customer invoices (creating the customer as a res.partner if needed), with per-invoice and bulk sync, connection testing, and error tracking. **Built against Odoo's documented JSON-RPC protocol and unit-tested with a mocked server — not yet verified against a real, live Odoo instance** (none was reachable from where this was built). See "ERP sync" below before relying on this. |
| BR-22 | Workflow Automation Engine | A genuine configurable rule engine — Admin defines rules through the UI (event type + optional conditions + an action), not hardcoded automations. 6 real event types (Order Created, Delivery Failed/Completed, Trip Dispatched, Invoice Created, Expense Submitted), condition matching against a whitelisted set of fields per event (same injection-safety pattern as the report builder), two actions (Notify with a `{{field}}` templated message, or Escalate — reusing the BR-20 escalation table), and an audit-trail log of every firing **and every deliberately-skipped duplicate**, satisfying the BRD's explicit "must prevent excessive repetition of alerts" requirement |
| BR-23 | Task, Expense & Field Activity Management | Drivers get field tasks beyond ordinary delivery stops (inspection, collection, visit, refuel, exception handling) with a start/complete lifecycle, and can submit expense claims (fuel, tolls, emergency maintenance) that must link to a driver, vehicle, and either a trip or a stated reason — enforced server-side, not just in the UI. Every claim requires explicit Admin approval or rejection. The BRD's "Field Activity Report" output is satisfied by adding Tasks and Expense Claims as two more datasets in the BR-21 report builder, reusing tested infrastructure rather than a bespoke report screen |
| APP-07 | Executive Dashboard | A single aggregated view for leadership (Admin-only — the closest role mapping to the BRD's CEO/COO/CFO audience) with 13 KPIs — trips, deliveries, SLA compliance, revenue, fuel/maintenance cost, cost per delivery, revenue per vehicle, fleet utilization, and **cost per km** (a genuine haversine straight-line distance estimate — warehouse → each stop → back — clearly labeled as an estimate, since this system doesn't track actual GPS route mileage). Real comparative analysis: pick a date range and it automatically computes the equal-length prior period and shows a percent-change trend arrow for every metric, with null-safe handling when a prior value was zero. Reuses the BR-17 scorecard functions for driver/vehicle ranking rather than duplicating that logic, and offers a CSV export of everything visible |

Not yet built (Phase 3+ per the BRD roadmap): real GPS/IoT hardware
integration (this prototype simulates it — see below), native
mobile apps.

### Company Switcher — security model

**The gap this closes**: nothing in the original data model supported a
user operating across more than one company. Every user row has exactly
one fixed `tenantId`, and roles are only `ADMIN | DISPATCHER | DRIVER` —
there was no "platform admin" concept at all. Rather than bolt a switcher
onto a model that structurally can't support it safely, this adds the
minimal real schema needed:

- `users.isPlatformAdmin` (boolean, default `false`) — nobody gets this by
  accident; it's off for every ordinary tenant Admin, Dispatcher, and
  Driver, with no exceptions.
- `platform_admin_tenant_grants` — an explicit, least-privilege allowlist.
  A platform admin's own home tenant is always implicitly allowed; every
  *other* tenant requires its own grant row. There is no "access every
  tenant" mode — provisioning a broadly-scoped platform admin means
  inserting one grant row per company they should reach.

**How it's enforced, not just offered**: every existing API route already
derived its tenant scope from one function, `getSessionTenantId()` in
`lib/auth.ts` — this predates the switcher and is what makes ordinary
tenant isolation work at all. The switcher hooks into that same single
choke point rather than touching routes individually:

1. `POST /api/platform/switch-tenant` re-validates authorization (home
   tenant, or an explicit grant row — checked fresh against the database,
   never assumed) before setting an `active_tenant_id` cookie. This is a
   separate cookie from the session token, `httpOnly`, with no explicit
   expiry — it's a per-browser-session UI preference, not a credential,
   so it clears when the browser closes rather than persisting like a
   long-lived grant would.
2. `getSessionFromRequest()` reads that cookie on **every subsequent
   request** and re-validates it against the database again — a stale or
   deliberately forged cookie is never trusted at face value. If the
   cookie names a tenant the user isn't authorized for, or the user isn't
   a platform admin at all, it's silently ignored and the request falls
   back to the user's own home tenant — never a 500, and never a leak.
3. Because every other route already calls `getSessionTenantId()`, none of
   them needed to change to become switch-aware — `/api/customers`,
   `/api/orders`, `/api/executive/dashboard`, all of it. One choke point,
   validated on every read.

**What this means concretely**: an ordinary tenant Admin can never see the
switcher UI (the Admin console only renders it when `isPlatformAdmin` is
true), can never successfully call the switch endpoint even by hand
(403), and a forged `active_tenant_id` cookie on their own session is
ignored outright. A platform admin can only ever switch into their home
tenant or a tenant they have an explicit grant for — verified directly in
`tests/integration/company-switcher.test.ts`, including forged-cookie
attempts from both an ordinary admin and a platform admin targeting an
ungranted tenant.

**Demo credentials**: `platform-admin@fleetops-demo.co` / `password123` —
home tenant is Demo Water Co., with an explicit grant to Acme Fuel
Delivery Co. Log in and use the "Viewing:" dropdown in the Admin console's
top bar (only visible for this account) to switch between them.

### How the SLA engine works

SLA status isn't polled by a background job — Phase 2 has no job runner, so
`lib/sla.ts` computes it live on every read from `createdAt`, `slaMinutes`,
and (if delivered/failed) `completedAt`. Statuses: **ON_TRACK** → **AT_RISK**
(80% of the window elapsed) → **BREACHED** (past due, still not delivered),
or **MET**/**MISSED** once resolved. The Dispatcher console shows a summary
bar and per-order badges; `/api/sla?tenantId=...` returns the full computed
list sorted by urgency.

### How the warehouse loading gate works

Every trip starts `loadingConfirmed: false`. The Dispatcher console shows
"Confirm warehouse loading" instead of "Dispatch trip" until that happens —
confirming checks the tenant's `19L Bottle - Full` stock against the trip's
total bottle demand, blocks with a shortage message if insufficient, and
deducts stock on success. The dispatch action itself also re-checks this
server-side, so there's no way to bypass the gate by calling the API
directly. On delivery, `emptiesCollected` from the ePOD flows back into the
`19L Bottle - Empty` stock line automatically.

### A credit-limit bug worth knowing about (found and fixed during testing)

The first version of the B2B credit check only counted **invoiced** amounts
against a customer's limit. Since invoices are only generated at delivery
(BR-18), a customer could place unlimited *pending* orders and never trip
their limit — the check was effectively a no-op until something actually got
delivered. Fixed in `lib/creditCheck.ts`: exposure now = unpaid invoices +
the value of any order still awaiting delivery. This is used consistently by
single-order creation, bulk-order creation, and the B2B statement view.

## Tech stack

- **Next.js 15** (App Router) + TypeScript
- **PostgreSQL** via **Drizzle ORM** + `pg` (node-postgres) — see "Database:
  Postgres" below for setup
- **Tailwind CSS** for styling
- **Zod** for API input validation
- **Vitest** for the automated test suite (see "Testing" below)

**Migrated from Next.js 14.2.35 to 15.5.24** to resolve 5 high-severity
CVEs present in the old pinned version (RSC deserialization DoS, HTTP
request smuggling, cache poisoning, and others). React was deliberately
kept at 18.3.1 — Next 15.5.24's peer range accepts React 18.2+, so no
React major-version upgrade was needed or attempted. The only code
changes required were mechanical: Route Handler `params` became a
`Promise` in Next 15, so all 24 dynamic-segment route files (`[id]`,
`[stopId]`, etc.) needed `await params` instead of direct synchronous
access. Full detail, including a real naming-collision bug the mechanical
`params` transformation itself would have introduced in 5 files (caught
by the build failing to compile, not by luck), in DEPLOYMENT.md's
"Next.js 15 Migration" section.

### Why Drizzle (not Prisma)

Prisma requires downloading a native query-engine binary at setup time,
which wasn't reachable from the sandboxed environment this project was
originally built in. Drizzle has no such external binary dependency and
generates real, readable SQL migrations — both are good reasons to keep it
even outside that constraint.

## Database: Postgres

This project runs on Postgres. Two options to get one running locally:

**Option A — Docker (recommended, one command):**
```bash
docker compose up -d
cp .env.example .env.local   # defaults already match docker-compose.yml
```

**Option B — a native local install:**
```bash
# macOS
brew install postgresql@16 && brew services start postgresql@16
# Debian/Ubuntu
sudo apt install postgresql postgresql-contrib && sudo service postgresql start
```
Then create the two databases this project needs (one for dev, one — kept
completely separate — for the test suite, which drops and recreates its
schema on every run):
```bash
createdb fleet_ops
createdb fleet_ops_test
cp .env.example .env.local   # then edit DATABASE_URL / DATABASE_URL_TEST
                              # to match your local user/password
```

**Option C — a hosted provider** (Neon, Supabase, Railway, RDS, etc.): just
put that connection string in `DATABASE_URL` in `.env.local`, and a second
database's connection string in `DATABASE_URL_TEST`.

Either way, `.env.local` needs both `DATABASE_URL` and `DATABASE_URL_TEST`
before anything else works — see `.env.example` for the exact format.

### A real migration bug, found by actually testing against Postgres

Drizzle tracks which migrations have been applied in a separate `drizzle`
schema, apart from your actual tables (which live in `public`). The test
suite's reset step originally only dropped and recreated `public` — which
worked on the *first* run, but on every run after that, Drizzle's migrator
saw migration `0000` already marked as applied in the untouched `drizzle`
schema and skipped re-running it, leaving `public` with zero tables. Running
the suite twice in a row (not just once) is what caught this — `tests/globalSetup.ts`
now drops both schemas.

## Getting started

```bash
npm install
npm run setup      # migrates & seeds your Postgres database
npm run dev        # http://localhost:3000
```

Then open `http://localhost:3000` — you'll be redirected to `/login`. Use
any of the demo credentials below (all seeded with `password123`):

| Role | Email | Company |
|---|---|---|
| Admin | admin@demo-water.co | Demo Water Co. |
| Dispatcher | dispatch@demo-water.co | Demo Water Co. |
| Driver | khalid@demo-water.co (5 total: khalid, fahad, nasser, turki, bandar) | Demo Water Co. |
| B2B Portal | portal@jarir-demo.co (or portal@alrajhi-demo.co) | Demo Water Co. |
| Admin (2nd company) | admin@acme-fuel-demo.co | Acme Fuel Delivery Co. |
| Dispatcher (2nd company) | dispatch@acme-fuel-demo.co | Acme Fuel Delivery Co. |
| Driver (2nd company) | saeed@acme-fuel-demo.co (3 total: saeed, majed, faris) | Acme Fuel Delivery Co. |
| Platform Admin (Company Switcher) | platform-admin@fleetops-demo.co | Home: Demo Water Co. — granted: Acme Fuel Delivery Co. |

**All demo accounts share the password `password123` — this is intentionally
public, documented, demo-only data, never a real credential.** The second
company (Acme) is seeded on purpose — log in as its admin and confirm you
see none of Demo Water Co.'s customers, vehicles, or orders. Both tenants
come seeded with ~35 days of realistic delivery history (56 historical
trips for Demo Water Co., 30 for Acme — see "Demo dataset" below) so the
Executive Dashboard, driver/vehicle scorecards, and SLA compliance all
show real, non-zero numbers immediately, not an empty state.
Or click **Set up your account** on the login page to onboard a brand-new
company yourself via `/signup`.

### Demo dataset

Built for a credible investor/customer demo, not just enough rows to
avoid an empty screen. Both tenants are Saudi/GCC operations with real
district/city names (Riyadh for Demo Water Co.; Jeddah and Dammam for
Acme) and deliberately different economics, so the Company Switcher shows
two visibly different businesses rather than the same data twice:

- **Demo Water Co.** (retail bottled water, Riyadh): 5 vehicles, 5
  drivers, 8 customers (a mix of B2C households and B2B accounts like
  Jarir Bookstore and Al Rajhi Office Tower), 2 warehouses. 56 historical
  deliveries over the past 35 days (~92% delivered, ~7% failed, ~88% SLA
  compliance) plus a handful of live pending orders for the Dispatcher
  console to work with right now.
- **Acme Fuel Delivery Co.** (wholesale fuel, Jeddah/Dammam): 3 tanker
  vehicles, 3 drivers, 3 B2B customers, 2 warehouses (Jeddah and a
  regional Dammam depot — deliveries to the Dammam customer are routed
  from there, not hauled ~860km from Jeddah, so the estimated
  distance/cost-per-km stays realistic). 30 historical deliveries over the
  same 35-day window, priced as bulk wholesale transactions rather than
  retail bottles — noticeably higher revenue per delivery than Demo Water
  Co., on purpose.
- Every historical delivery is built from the same order → trip → stop →
  epod/invoice shapes the real API produces (see `scripts/seedData.ts`),
  so the Executive Dashboard, driver/vehicle scorecards, and SLA monitor
  all compute genuine numbers from this data — nothing is hardcoded or
  faked to make a KPI look non-zero.
- BR-23 (Task, Expense & Field Activity) is seeded too — 10 tasks and 10
  expenses for Demo Water Co., 8 of each for Acme, with realistic mixed
  statuses (open, in progress, completed, overdue, cancelled for tasks;
  pending, approved, rejected for expenses) so the Admin console's Field
  Ops tab shows a real working operation on first login rather than "No
  tasks assigned yet."
- `tests/integration/seed-data-quality.test.ts` guards this: it fails if
  a future change reverts the seed to an all-pending, zero-revenue state,
  reintroduces an unrealistic cost-per-km from a cross-country haul
  distance, or lets the Field Ops tab go back to empty (the exact bugs
  caught while building this dataset).

### Authentication

Every role now requires a real login — email/password, bcrypt-hashed,
session cookies, and server-side checks on every single API route (not just
the pages). See the seed output or the login page for demo credentials;
the short version: every seeded account uses the password `password123`.

**B2B data isolation is enforced at the API layer**, not just the UI: a
logged-in B2B customer can only ever read or write their own account's
locations, orders, and statement — verified by direct API testing during
development, not just by hiding the option in the UI.

**A driver can only act on their own trips** — the stop-update and GPS-ping
endpoints check that the session's driver profile matches the trip's
assigned driver, not just that *some* driver is logged in.

### Route optimization & live map setup (optional)

Both features degrade gracefully without any configuration — trips just use
selection order for stops, and the Dispatcher's map shows a placeholder. To
enable them:

```bash
cp .env.example .env.local
# then fill in:
#   GOOGLE_MAPS_API_KEY=...        (server-side, Directions API)
#   NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=...  (browser, Maps JS SDK)
```

Get both from the [Google Cloud Console](https://console.cloud.google.com/)
— enable the Directions API and Maps JavaScript API on the same project.
Restrict the `NEXT_PUBLIC_` one to your domain (HTTP referrer restriction)
since it's exposed to the browser by design; keep the server-side one
unrestricted or IP-restricted, and never commit either to source control
(`.env.local` is gitignored).

### GPS simulation — how it works and how to replace it with real hardware

There's no real GPS/IoT hardware in this prototype. Instead, the driver app
(`app/driver/page.tsx`) runs a client-side interval that interpolates a
position along the trip's stop sequence and calls `PATCH
/api/trips/[id]/gps` every 3 seconds while a trip is dispatched. The
Dispatcher console polls trip data (which includes `currentLat`/
`currentLng`) and plots it on the map.

To swap in real hardware later: the GPS endpoint's contract (`{lat, lng}`,
latest-wins, driver-authenticated) is exactly what a real device or mobile
GPS integration would call — you'd replace the simulation loop in the driver
app with a `navigator.geolocation.watchPosition()` call (or a real IoT
device webhook), and nothing else in the system needs to change.

### Demo data

The seed script creates one tenant ("Demo Water Co.") with:
- 5 customers (3 B2C residential, 2 B2B commercial with credit limits)
- 2 vehicles (refill vans, 120 and 90 bottle capacity)
- 2 drivers
- 5 pending orders ready to dispatch

### Useful scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` | Production build (also type-checks everything) |
| `npm run db:migrate` | Apply schema migrations to your Postgres database |
| `npm run db:seed` | Load demo data |
| `npm run db:reset` | Re-migrate & re-seed (does not wipe — see Postgres reset notes above) |
| `npm run db:backup` | Dump the current database to `backups/` — see [BACKUP_RESTORE.md](./BACKUP_RESTORE.md) |
| `npm run db:restore -- <file>` | Restore a backup file (destructive — requires confirmation) — see [BACKUP_RESTORE.md](./BACKUP_RESTORE.md) |
| `npm run db:generate` | Regenerate SQL migrations after editing `lib/db/schema.ts` |
| `npm test` | Run the automated test suite once |
| `npm run test:watch` | Run tests in watch mode while developing |
| `npm run lint` | Run ESLint (also runs as a CI step on every push/PR) |

## Testing

```bash
npm test
```

This runs standalone — it doesn't need `npm run setup` first, and it never
touches your dev database. A `globalSetup` step drops, recreates, migrates,
and seeds the separate database at `DATABASE_URL_TEST` once before the suite
runs, so tests and your local dev data can't interfere with each other
(verified directly: `tenants` row count in the dev database was identical
before and after running the full suite).

**How it works:** rather than starting a real HTTP server (which turned out
to be fragile in some sandboxed environments during development — a
backgrounded `next dev` process didn't reliably survive between shell
calls), tests import each API route's handler function directly and call it
with a constructed `NextRequest`, including real session cookies from a
real login call. This exercises the actual route logic — auth checks,
tenant scoping, business rules — without the overhead or flakiness of a
live server.

**What's covered** (276 tests across 37 files):
- `tests/unit/` — pure logic with no database: SLA status calculation (all
  five states), VAT/invoice math, Google Maps route-optimization fallback
  behavior, the report-dataset registry's column whitelist validation
  (including that injection-shaped column names are rejected), and the
  Odoo JSON-RPC client's request/response handling against a mocked server
  (see the "ERP sync" section above for exactly what this does and doesn't
  prove), the workflow automation engine's event-field whitelist
  validation (BR-22), and the executive dashboard's comparative-analysis
  percent-change math (positive/negative/zero-safe/null-safe).
- `tests/integration/` — real database, real route handlers:
  - **Multi-tenant isolation**, including the critical case: a session from
    one company passing another company's ID as a query parameter is
    correctly ignored, not honored.
  - **Authentication**: login (correct/incorrect/unknown credentials), B2B
    portal login through the same endpoint, session inspection, logout,
    role-based route blocking, new-company signup, duplicate-email
    rejection.
  - **B2B credit exposure** — a regression test for the actual bug found and
    fixed earlier in this project's development: the credit check must
    count undelivered order value, not just invoiced amounts.
  - **Full trip lifecycle** — capacity rejection, the happy path through
    warehouse loading, dispatch, delivery, and invoice generation, and
    driver-ownership enforcement (a driver can't act on someone else's trip).
  - **Per-warehouse inventory** — stock deduction is scoped to the specific
    warehouse a trip loads from, not tenant-wide.
  - **Custom report builder** — column selection, filtering, joins (e.g.
    customer name on an orders report), CSV export, save/list/delete, and
    the injection-rejection case above exercised end to end through the API.
  - **Scorecards** — every driver/vehicle gets a scorecard, driver rankings
    are score-descending, vehicle rankings are cost-per-trip-ascending with
    zero-trip vehicles correctly sorted last.
  - **ERP sync** — connection config save/load with API key masking on
    read, single and idempotent invoice sync, bulk sync, and error-state
    recording, all with Odoo's actual network calls mocked (the real
    Odoo wire protocol is covered separately in `tests/unit/odoo.test.ts`
    against a mocked server — see "ERP sync" above for the honest caveat).
  - **Configurable scorecard weights** — defaults, validation (rejects
    all-zero weights), role-gating (Dispatcher can view but not change),
    and that saving custom weights actually changes the computed rankings
    to match, verified against the exact expected score.
  - **Vehicle home-warehouse defaults** — setting one at creation or via
    update, rejecting a warehouse id from a different tenant, and
    role-gating.
  - **Maintenance/fuel/tyre records** — opening a maintenance record takes
    the vehicle out of service and completing it returns it to AVAILABLE,
    fuel log validation, tyre install/retire, and cross-tenant rejection
    (a fuel log can't be created against another tenant's vehicle).
  - **B2B customer locations CRUD** — a customer managing its own
    locations, internal staff acting on a customer's behalf, validation,
    and rejecting a customer trying to add a location for someone else's
    account.
  - **Plain CRUD happy paths** — customers (B2C/B2B), vehicles, users, and
    drivers: create, list, validation rejection, role-gating, and — for
    drivers specifically — rejecting a driver profile built from another
    tenant's user account.
  - **Delivery exception workflow (BR-11)** — auto-creation on failed and
    partially-delivered stops, all four closing actions (Reschedule,
    Return, Reassign, Cancel) including the inventory reconciliation each
    one performs, escalation not closing the case, idempotency (can't
    resolve an already-resolved exception), and follow-up orders correctly
    sized to the undelivered remainder for partial deliveries.
  - **SLA escalation workflow (BR-20)** — automatic escalation creation for
    orders crossing into AT_RISK/BREACHED (using deterministically backdated
    test orders rather than the shared seed fixtures, to avoid depending on
    which order other test files happen to run in), correct severity
    assignment, no duplicate escalations on repeated polling, acknowledge
    and resolve with their own idempotency guards, and tenant isolation.
  - **Workflow automation engine (BR-22)** — rule creation with condition
    validation, a rule actually firing (and producing a real notification
    with its `{{field}}` template correctly filled in) when a matching
    event occurs, correctly NOT firing for a non-matching event, the
    anti-spam duplicate-prevention guard verified directly against the
    engine function, disabled rules never firing, and rule
    enable/disable/delete.
  - **Field task and expense management (BR-23)** — task assignment and
    driver-scoped isolation (a driver only sees their own tasks), the
    start/complete/cancel lifecycle with correct role gating, expense
    claims rejecting a submission with neither a trip nor a reason,
    driver-to-driver isolation on claims, approve/reject with idempotency
    guards, Dispatcher-can-view-but-not-approve, the Expense Submitted
    automation hook actually firing, and both new report-builder datasets
    (Tasks, Expense Claims) returning real data.
  - **Billing refinements (BR-18)** — exact discount math verified against
    hand-computed expected totals (including the zero-clamp edge case), a
    B2B contract rate overriding a deliberately wrong client-supplied
    price, credit notes rejecting an amount exceeding the invoice's
    remaining balance and correctly reducing B2B credit exposure, cash
    settlement idempotency and its CASH-only restriction, and the new
    Credit Notes report-builder dataset.
  - **Executive dashboard (APP-07)** — all-time KPIs with no comparison
    when no date range is given, a real completed delivery actually moving
    revenue/delivered-order-count/the haversine distance estimate off
    zero, comparative analysis producing a real prior-period delta when a
    date range is given, and role/tenant isolation (Dispatcher and Driver
    both blocked, Admin-only).
  - **Company Switcher** — an authorized platform admin switching into a
    granted tenant and every subsequent request (not just `/api/tenant`)
    reflecting it, switching back to home clearing the override, listing
    only authorized tenants, an ordinary tenant Admin blocked from the
    switch endpoint entirely, a platform admin blocked from an *ungranted*
    tenant, and — the two tests that matter most here — a forged
    `active_tenant_id` cookie being silently ignored both for an ordinary
    admin and for a platform admin targeting a tenant they have no grant
    for, in each case falling back to the user's own tenant rather than
    erroring or leaking.
  - **Auth rate limiting** — a normal login working before any limit is
    hit, the 11th attempt from one IP within 15 minutes returning 429
    with a `Retry-After` header, a successful login consuming the same
    limit as a failed one (proven by exhausting 9/10 then confirming the
    10th succeeds and the 11th doesn't), the per-email limit not
    affecting a different email from the same IP, distinct IPs tracked
    independently, and the same shape of coverage for signup's per-IP
    limit. This suite deliberately re-enables rate limiting for its own
    duration only (it's off by default under `NODE_ENV=test` — see
    `lib/rateLimit.ts` for why) and confirmed no interaction with tenant
    isolation or the Company Switcher by rerunning both of those suites
    afterward.
  - **Structured logging** — every event type emits the correct shape at
    the correct level; a test that deliberately casts through `any` to
    bypass the logger's typed function signatures, proving the
    denylist-based redaction backstop still catches a forbidden field
    even when a caller ignores the types rather than only when they
    cooperate with them; and integration tests confirming real routes
    (login, Company Switcher, rate limiting, a genuinely mocked health
    check failure) actually emit these events with real data, not just
    that the logger functions work when called directly.
  - **Seed data quality** — both tenants' Executive Dashboards show real,
    non-trivial activity (not all-zero), realistic-but-imperfect SLA
    compliance and failure rates, more than one distinct driver
    score/vehicle cost (not flat filler data), and a sanity ceiling on
    cost-per-km that would catch a regression into the unrealistic
    cross-country-haul-distance bug found while building this dataset.
  - **Contract Management schema foundation ("A1")** — every new table
    exists with correct nullability; tenant-scoped tables carry
    `tenant_id`, and the tables scoped transitively via a parent
    relationship (`contract_sites`, `contract_periods`, `invoice_orders`)
    correctly follow this codebase's existing `trip_stops` precedent
    instead. Most importantly: a full real order→trip→delivery→invoice
    flow is re-run end-to-end and proven byte-for-byte unaffected —
    `invoices.order_id` is confirmed still `NOT NULL` and `UNIQUE`, and
    `invoice_orders` stays empty throughout, since nothing yet writes to
    it. Contract Management itself is schema-only at this stage — no
    API, UI, pricing engine, or invoicing behavior exists yet.

**What's not covered yet** — a few lower-risk edges: update/delete on
customers and vehicles (only create/list are exercised), and some of the
rarer validation branches in less-visited routes. These were deprioritized
in favor of covering every route's core happy path and its most
security-relevant failure mode (tenant isolation, role-gating).

### CI: tests run automatically on every push

`.github/workflows/ci.yml` runs on every push and pull request against
`main`: it starts a real Postgres 16 service container (not SQLite, not a
mock — the same thing dev/production use), creates the test database,
applies migrations, runs the build, then runs the full test suite. If any
step fails, the PR/commit is marked failing.

This isn't just a YAML file written on faith — every step in it (`npm ci`,
create test database, `npm run db:migrate`, `npm run build`, `npm test`)
was run manually in sequence with matching environment variables before
being committed, to confirm the workflow actually works end to end rather
than assuming it does. Once you push this repo to GitHub, Actions picks up
the workflow automatically — no further setup needed. Check the "Actions"
tab on GitHub to see run history.

**Extending it:** if you add `next lint`'s ESLint config (skipped here — it
needs an interactive setup step this project hasn't gone through yet), add
a `- name: Lint` step calling `npm run lint` alongside the existing steps.

## Trying the full flow

1. Go to **Dispatcher** → you'll see 5 orders in the queue.
2. Select 1–2 orders, pick a driver + vehicle, click **Create & assign trip**.
   (Try selecting orders that together exceed a vehicle's capacity — you'll
   get a validation error, per BR-02.)
3. Click **Dispatch trip** on the new trip card.
4. Go to **Driver** → select the driver you assigned → you'll see the trip
   with its stops.
5. Click **Arrived at stop**, then **Confirm delivery** and fill in the ePOD
   form (delivered qty, recipient, empties collected).
6. Go to **Admin → Billing** → the invoice is there, VAT-calculated, marked
   Paid (cash) or Pending (account credit for B2B).

Try also: creating a new order for a B2B customer that would exceed their
credit limit (Al Rajhi Office Tower has an SAR 8,000 limit) — the order
creation will be blocked, per BR-04.

## Trying the B2B Portal

1. Go to **B2B Portal** → select "Jarir Bookstore HQ" (seeded with 3
   delivery locations and an SAR 5,000 credit limit).
2. **Bulk order** tab: check 2–3 locations, set a bottle quantity for each,
   and place the order — one order is created per location, all at once.
3. Watch it land in the **Dispatcher** queue exactly like any other order,
   addressed to the specific location you selected.
4. **Statement** tab: see the exposure breakdown update in real time as
   orders move from "awaiting delivery" to "unpaid invoice" once delivered.
5. Try placing a bulk order large enough to exceed the SAR 5,000 limit —
   it's blocked with the combined batch value, current exposure, and limit
   shown in the error.

## Trying SLA, escalations, warehouse loading, and maintenance

1. **Dispatcher console**: the seed data includes one deliberately breached
   and one at-risk order — you'll see the SLA summary bar and per-order
   badges immediately, and above them, a red/amber **Escalations** panel
   with those same two orders already flagged (HIGH for the breached one,
   MEDIUM for at-risk) — this happens automatically, nothing to click.
2. Click **Acknowledge** on one — it stays visible but shows
   "Acknowledged" instead of action buttons for anyone else. Click
   **Resolve**, optionally add notes, and it drops off the open list.
3. Reload the page (or just wait — it polls every 4s): no duplicate
   escalations get created for orders that already have one open, but if
   an order's severity gets worse (AT_RISK → BREACHED) while its
   escalation is still open, the existing record upgrades in place instead
   of creating a second one.
4. Assign a trip, then notice the trip card says **"Confirm warehouse
   loading"** instead of "Dispatch trip" — dispatch is blocked until this
   happens (BR-09). Click it; stock is deducted and the button switches to
   "Dispatch trip".
5. **Admin → Inventory**: watch the "19L Bottle - Full" count drop after
   loading confirmation, and the "Empty" count rise after a driver logs
   `emptiesCollected` on delivery.
6. **Admin → Maintenance**: open a maintenance record on a vehicle — its
   status flips to `MAINTENANCE` immediately, and the Dispatcher's trip
   planner will no longer offer it. Mark the record completed to return it
   to service. The same tab also has Fuel and Tyres sub-tabs.

## Trying the workflow automation engine

1. **Admin → Automation**: build a rule — e.g. "When Order Created, if
   Customer Type = B2B and Quantity > 5, Notify: `B2B order for
   {{qtyOrdered}} bottles just came in`". Save it.
2. Create a matching order (as Dispatcher) — the notification appears
   immediately in the Notifications panel with the template filled in, and
   the Automation Logs panel shows a FIRED entry. Create a non-matching
   order (wrong customer type or too small) — nothing fires.
3. Try the same order a second time (or trigger the same rule for the same
   order again) — the log shows SKIPPED_DUPLICATE instead of a second
   notification. This is the BRD's explicit "must prevent excessive
   repetition of alerts" requirement, made visible rather than assumed.
4. Build an Escalate rule instead (e.g. "When Delivery Failed → Escalate,
   High severity") — the resulting escalation shows up in the Dispatcher
   console's Escalations panel from BR-20, going through the exact same
   acknowledge/resolve workflow regardless of whether an escalation came
   from an SLA breach or a custom rule.
5. Disable a rule and confirm matching events stop firing; re-enable it
   and they resume.

## Trying the Executive Dashboard

1. **Admin → Executive**: loads immediately with all-time KPIs — trip
   counts, SLA compliance, revenue, fuel and maintenance cost, cost per
   delivery, and cost per km. The cost-per-km card is explicitly labeled
   as an estimate; hover context aside, the caveat text right above the
   KPI grid explains why (no GPS route mileage is tracked, so it's a
   straight-line distance estimate from stop coordinates instead).
2. Pick a "From" and "To" date and click **Apply range** — every KPI
   recalculates for that window, and a comparison against the prior
   period of equal length appears automatically: each card shows a
   green/red/gray arrow with a percent change. Green means "moved the
   right direction" for that specific metric (e.g. revenue up is green,
   but failed deliveries up is red) — not just "any increase is green."
3. If a metric's prior-period value was zero, the trend shows "—" instead
   of a nonsensical percentage — try this on a metric with no historical
   data yet.
4. **Top drivers** and **Vehicle ranking** below the KPI grid pull
   directly from the same BR-17 scorecard engine used elsewhere — no
   duplicated ranking logic.
5. Click **Export CSV** to download everything currently on screen —
   KPIs, the trend percentages, and both ranking tables.

## Trying the billing refinements (discounts, contract pricing, credit notes, cash settlement)

1. **Admin → Customers**: set a "Contract price/bottle" on a B2B customer
   (e.g. Jarir Bookstore HQ). Every order for that customer from then on
   uses this rate — try passing a different price when creating an order
   via the API and confirm the stored order still shows the contract rate,
   not what you sent.
2. **Dispatcher → New order**: add a discount amount when creating an
   order. Once delivered, the generated invoice shows the discount applied
   before VAT (and it's shown separately, not just folded into the total).
3. **Admin → Billing**: click "Credit note" on any invoice, enter an
   amount and reason. Try entering more than the invoice's remaining
   balance — it's rejected. For a CASH-paid invoice, click "Settle" to
   record that the driver handed over the cash — this is separate from
   the invoice's PAID/PENDING status, which reflects whether the customer
   owes money at all.
4. **Admin → Reports**: the "Credit Notes" dataset is BR-18's "Collection
   Report" output, built the same way as every other report — reused
   infrastructure, not a new screen.

## Trying field task and expense management

1. **Admin → Field Ops → Tasks**: assign a driver a non-delivery task —
   an inspection, a site visit, a refuel. Log in as that driver (Driver
   app) and it appears above their trip card with Start/Complete buttons.
2. As the driver, submit an expense claim. If they have an active
   dispatched trip, it links to that automatically; otherwise the form
   requires a typed reason — this mirrors the BRD's rule that every
   expense must link to a driver, vehicle, and either a trip or a reason,
   enforced server-side (try submitting via the API with neither and
   you'll get a 400, not just a disabled button).
3. Back in **Admin → Field Ops → Expenses**, the claim shows up Pending —
   Approve or Reject it (rejection requires a reason). Only Admin can do
   this; Dispatcher can view the queue but not act on it.
4. **Admin → Reports**: pick the "Tasks" or "Expense Claims" dataset —
   this is the BRD's "Field Activity Report" output, built by reusing the
   same report builder every other dataset goes through rather than a
   separate screen.
5. Build an automation rule on "Expense Submitted" (e.g. notify when a
   fuel expense exceeds 200 SAR) — submitting a matching claim fires it
   immediately, same as any other automation event.

## Trying delivery exceptions (Reschedule / Return / Reassign / Cancel)

1. Dispatch a trip, then as the driver, mark a stop **Failed** (with a
   reason) instead of delivering it. Back in the Dispatcher console, a red
   **Exception Center** panel appears above the live map — you don't need
   to do anything to create it, it's automatic.
2. Click **Act on this** and try each action:
   - **Reschedule** or **Reassign** creates a new PENDING order sized to
     what wasn't delivered, ready to assign to a fresh trip from the order
     queue below.
   - **Return** or **Cancel** sends the undelivered bottles back to that
     trip's warehouse stock — check **Admin → Inventory** before and after
     to see the count go back up.
3. Click **Escalate** on an open exception instead — notice it stays in
   the Exception Center (escalating flags it for a supervisor, it doesn't
   resolve it), and you can still apply one of the four closing actions
   afterward.
4. Try a **partial** delivery (deliver fewer bottles than ordered) — this
   also opens an exception, sized to exactly the undelivered remainder.

## Trying authentication, route optimization, and live tracking

1. Log in as each role in turn (see credentials table above) — notice each
   one lands on a different page and can't reach the others' pages/data even
   by guessing the URL.
2. Log in as one B2B customer, open browser dev tools, and try calling
   `/api/customers/<the other customer's id>/statement` directly — you'll
   get a 401, confirming isolation is enforced server-side, not just hidden
   in the UI.
3. With `GOOGLE_MAPS_API_KEY` set: create a multi-stop trip and check the
   `estimatedDurationMinutes` field in the API response — that came from a
   real Directions API call. Without the key: trip creation still works
   fine, just without an ETA or optimized ordering.
4. With `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` set: dispatch a trip, then watch
   the Dispatcher console's map — the driver app's simulated GPS loop moves
   the marker every 3 seconds as it "travels" between stops.

## Trying multi-tenant onboarding and per-warehouse inventory

1. Log in as `admin@demo-water.co` and as `admin@acme-fuel-demo.co` in two
   separate browser sessions (or one normal + one incognito window) —
   confirm each only ever sees their own company's customers, vehicles,
   and orders. This is enforced in the API layer (every route derives its
   tenant from the session), not just hidden by the UI.
2. **Admin → Inventory**: Demo Water Co. has two warehouses ("Main Warehouse
   - Riyadh Central" and "North Depot - Al Yasmin"), each with its own
   full/empty bottle stock. Adjust stock at one and confirm the other is
   untouched.
3. **Dispatcher**: when creating a trip, pick which warehouse it loads from
   — the route-optimization origin/destination and the loading-confirmation
   stock deduction both use that specific warehouse's coordinates and stock,
   not a tenant-wide total.
4. **Admin → Fleet**: set a "home warehouse" on a vehicle (a dropdown right
   in the vehicle table). Back on the Dispatcher's trip planner, selecting
   that vehicle auto-fills the warehouse dropdown to its home depot — still
   fully editable if this particular trip should load from somewhere else.
5. Click **Set up your account** from the login page to onboard a brand new
   company — you'll get an isolated tenant, your own Admin login, and a
   first warehouse with zero starting inventory, ready to configure.

## Trying the custom report builder and scorecards

1. **Admin → Reports**: pick a dataset (e.g. Orders), check off the columns
   you want, add a filter (e.g. status = PENDING), run it, and the results
   table appears below. Export to CSV, or give it a name and save it — it'll
   show up in "Saved reports" on the right, ready to reload later.
2. **Admin → Scorecards**: two ranked tables — drivers by a 0–100 composite
   score (on-time rate, delivery success, trip volume), vehicles by cost
   per completed trip (fuel + maintenance combined), lowest first. Both
   update live from real trip/order/invoice/fuel/maintenance data — nothing
   here is precomputed or cached. Click **Adjust weights** to change how
   much each factor counts toward the driver score — weights don't need to
   sum to 100 (they're normalized automatically), so entering 5/3/2 gives
   the same ranking as 50/30/20.

## ERP sync (Odoo) — what's actually been verified, and what hasn't

**Admin → ERP Sync**: connect an Odoo instance (base URL, database name,
username, API key, and an optional Odoo tax id for VAT), test the
connection, then sync individual invoices or all unsynced invoices in bulk.
Each delivered order's invoice becomes an Odoo customer invoice
(`account.move`, `move_type: "out_invoice"`), with the customer created as
a `res.partner` on first sync if one doesn't already exist (matched by
exact name).

**Read this before connecting a real Odoo instance:**

- The client (`lib/erp/odoo.ts`) talks to Odoo's [documented external
  API](https://www.odoo.com/documentation/17.0/developer/reference/external_api.html)
  via JSON-RPC — the same `service`/`method`/`args` contract Odoo has
  supported stably across versions. The request/response shapes are built
  to match that documentation precisely, and `tests/unit/odoo.test.ts`
  verifies the client sends the correct payloads and handles Odoo's error
  responses correctly — but those tests run against a **mocked** `fetch`,
  not a real server.
- **No live Odoo instance was reachable from the environment this was built
  in** (Odoo isn't in Ubuntu's package repositories, and odoo.com's
  infrastructure isn't in this environment's network allowlist) — so unlike
  almost everything else in this project, the actual wire-level behavior
  against a real Odoo server has not been verified end to end.
- **Before relying on this**, connect it to your real (or a sandbox/trial)
  Odoo instance and use the **"Test connection"** button — that's a real
  network call to Odoo's `authenticate` endpoint, not a mock, and it's the
  one place in this codebase that can actually tell you whether the
  integration works against your specific instance.
- **VAT/tax handling is simplified.** The invoice line is pushed with just
  quantity × unit price; if you set a Default VAT Tax ID (the numeric id of
  your 15% KSA VAT tax in Odoo — find it under Odoo's Accounting →
  Configuration → Taxes), Odoo will apply it and compute VAT itself. If you
  don't set one, the invoice is pushed untaxed and your Odoo instance's
  fiscal-position defaults (if any) apply instead — the pushed total may not
  match this system's own VAT-inclusive total unless you configure this.
- **Customer matching is by exact name only.** A more robust integration
  would add a custom field on Odoo's `res.partner` to store this system's
  internal customer id and match on that instead — a reasonable next step
  once this is in real use, noted below.

## Known simplifications (still open)

- **No company switcher / multi-company users.** Each user (and each B2B
  customer) belongs to exactly one tenant — there's no concept of one person
  administering multiple companies from a single login. Onboarding a second
  company means a separate signup with a separate email.
- **GPS is simulated, not real.** See the "GPS simulation" section above —
  the contract is realistic, but there's no actual device/hardware
  integration. This is inherent to a software prototype, not a shortcut.
- **No offline mode.** The Driver app is a web page, not the offline-capable
  native app the BRD specifies (BR-03, APP-03). It requires a live
  connection — including for the GPS simulation ping.
- **Session tokens don't rotate/refresh.** A 7-day session cookie is issued
  at login and used as-is until it expires or the user logs out — no sliding
  expiration, no refresh tokens. Fine for this scope; a production system
  would want shorter-lived tokens with refresh.

## Deployment

See **[DEPLOYMENT.md](./DEPLOYMENT.md)** for the full deployment guide and
production readiness checklist — environment variables (every one
verified against actual code usage, not assumed), database migration and
backup guidance, a security checklist (including gaps found and fixed
while writing it — cookies weren't marked `secure`, there was no
health-check endpoint, and `/api/auth/login`/`/api/auth/signup` had no
rate limiting), integration readiness for every external system (ERP,
GPS, Maps, SMS, email, payment, and others — each honestly marked
real/simulated/not-started), deployment options (a plain VPS or managed
Node hosting are the realistic paths today — Docker support in this repo
covers local Postgres only, not the app itself), a staging go-live
checklist, and a brutally honest list of what actually blocks a real
production launch versus what can wait.

**Rate limiting**: login and signup are protected by a small in-memory
limiter (`lib/rateLimit.ts`) — 10 attempts/15min per IP and 5/15min per
email for login, 5/hour per IP for signup. It's genuinely enforced (see
DEPLOYMENT.md for live-tested proof, not just unit tests) but is
single-instance only by design — see DEPLOYMENT.md's "Rate Limiting"
subsection before running more than one instance behind a load balancer.

**Backup & restore**: see **[BACKUP_RESTORE.md](./BACKUP_RESTORE.md)** —
`npm run db:backup`/`npm run db:restore` wrap `pg_dump`/`pg_restore`,
tested end-to-end (backup → restore into a separate database → confirmed
a real login works against the restored data, not just that row counts
matched). `scripts/seed.ts` now refuses to run against a database with
`NODE_ENV=production` set, since it creates demo companies with a shared,
publicly-documented password.

**Logging**: `lib/logger.ts` emits structured JSON log lines (no external
logging platform) for login/signup success and failure, rate limit hits,
Company Switcher success and failure, health check failures, and
backup/restore/seed script events — none of them ever include a
password, token, cookie, or connection string, verified both by the
logger's own typed function signatures (there's no parameter to leak one
through) and by a test that deliberately bypasses TypeScript to confirm
the redaction backstop still catches it. See DEPLOYMENT.md's "Logging &
Observability" subsection for exactly what is and isn't covered — most
routes outside auth/security still have no logging at all.

**Staging deployment**: see **[STAGING_REPORT.md](./STAGING_REPORT.md)**.
The development environment this app was built in has no network access
to any hosting platform, so a real external staging URL doesn't exist
yet — but every piece of application behavior (health check, login,
tenant isolation, Company Switcher, Executive Dashboard, rate limiting,
secure cookies, structured logging, backup tooling) was verified against
a real production-mode build and a dedicated staging-simulation
database. The report includes the exact step-by-step procedure to
complete a real deployment once hosting credentials exist.

## Project structure

```
.github/workflows/ci.yml   Runs lint + build + full test suite against Postgres on every push/PR
.eslintrc.json               ESLint config (next/core-web-vitals) — npm run lint is clean
DEPLOYMENT.md                 Full deployment guide, security checklist, integration readiness, production blockers
BACKUP_RESTORE.md             Backup/restore strategy, tested against a real database, plus the seed production-guard
STAGING_REPORT.md             Honest staging deployment verification and exact real-hosting steps
docker-compose.yml          One-command local Postgres (dev + test databases)
docker/init-test-db.sql      Creates the test database on first container start
app/
  admin/page.tsx          Admin console (fleet, drivers, customers, billing, warehouses)
  dispatch/page.tsx        Dispatcher console (queue, trip planner, live map)
  driver/page.tsx          Driver app (stop execution, ePOD, GPS simulation)
  b2b/page.tsx             B2B portal (locations, bulk orders, statement)
  login/page.tsx           Login (internal users + B2B customers)
  signup/page.tsx          New-company onboarding (tenant + admin + warehouse)
  api/                     REST API routes (one folder per resource)
  api/auth/                login / logout / me / signup
lib/
  db/schema.ts             Drizzle schema — the data model (start here)
  db/client.ts              Postgres connection (pg + drizzle-orm/node-postgres)
  loadEnv.ts                 Loads .env.local for standalone scripts/tests (Next.js does this
                              automatically for the app itself, but tsx/vitest don't)
  helpers.ts                 ID generation, VAT calc
  creditCheck.ts              Shared B2B credit exposure calculation
  auth.ts                     Password hashing, sessions, role + tenant scoping, Company Switcher validation
  logger.ts                    Structured JSON logging for auth/rate-limit/Company Switcher/health-check events
  useSession.ts                Client-side page-guard hook
  sla.ts                       BR-20 SLA status calculation
  googleMaps.ts                BR-06 route optimization (Directions API)
  reportDatasets.ts             BR-21 whitelisted dataset/column registry for the report builder
  reportQuery.ts                BR-21 report execution: fetch, filter, sort, project, CSV export
  scorecards.ts                 BR-17 driver/vehicle scorecard computation, configurable weights
  erp/odoo.ts                    BR-19 Odoo JSON-RPC client (low-level protocol)
  erp/sync.ts                    BR-19 sync orchestration: connection lookup, invoice push, error tracking
  escalations.ts                 BR-20 automatic escalation creation, triggered by SLA polling
  automation.ts                  BR-22 configurable rule engine: event registry, condition matching, anti-spam dedup
  executiveDashboard.ts          APP-07 KPI engine: aggregation, haversine distance estimate, comparative analysis
scripts/
  migrate.ts                Applies SQL migrations (also exports runMigrations() for tests)
  seed.ts                    CLI wrapper — seeds your Postgres database
  seedData.ts                 Reusable seed logic (seedDemoData()), shared by seed.ts and tests
drizzle/                    Generated SQL migrations
components/                TopNav, StatusBadge, LiveMap
tests/
  globalSetup.ts             Drops, recreates, migrates, and seeds DATABASE_URL_TEST once
                              before the suite runs
  helpers/request.ts          Builds NextRequest objects, logs in, extracts session cookies
  unit/                       Pure logic — SLA, VAT math, route-optimization fallback,
                                report-dataset whitelist validation, Odoo JSON-RPC client (mocked),
                                configurable scorecard weight formula, automation event-field whitelist
  integration/                 Real DB + real route handlers — auth, tenant isolation, credit
                                exposure, trip lifecycle, warehouse inventory, reports, scorecards,
                                scorecard weight config, vehicle home-warehouse defaults,
                                maintenance/fuel/tyres, B2B locations CRUD, plain CRUD happy paths,
                                delivery exceptions (BR-11 — Reschedule/Return/Reassign/Cancel),
                                SLA escalations (BR-20 — automatic creation, acknowledge/resolve),
                                workflow automation (BR-22 — rule firing, anti-spam dedup, enable/disable),
                                field task/expense management (BR-23 — driver isolation, approval workflow),
                                billing refinements (BR-18 — discounts, contract pricing, credit notes, cash settlement),
                                executive dashboard (APP-07 — KPI aggregation, comparative analysis, role gating),
                                Company Switcher (authorized switching, forged-cookie rejection, grant enforcement),
                                ERP sync (Odoo calls mocked — see "ERP sync" above)
```

## Suggested next steps (Phase 3 per the BRD roadmap)

1. **Verify ERP sync against a real Odoo instance** — the highest-priority
   item here, since it's the one piece of this build that couldn't be
   tested end to end (see "ERP sync" above)
2. Real GPS/IoT hardware integration, replacing the simulation
3. Match Odoo customers by a custom external-id field rather than exact
   name, and let the VAT tax mapping be less manual
4. Native offline-capable mobile apps (BR-03, APP-03)
5. Company switcher (one user administering multiple tenants)
6. Deployment guide (hosting, backups) for a real production rollout
