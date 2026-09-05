# Deployment Guide & Production Readiness Checklist

This document is based on inspecting the actual repository — package.json
scripts, every process.env reference in the codebase, the migration
system, the auth/session implementation, and every integration point —
not on assumptions. Where something is verified by actually running it,
it says so. Where something is missing, it's listed as missing.

**Last verified**: a fresh-scratch install, lint, migrate, seed, build,
test, `next start` in production mode, and a live HTTP smoke test were
all run against this exact codebase while writing this document. Five
follow-on passes added rate limiting to the auth endpoints (Section E's
"Rate Limiting" subsection), a backup/restore strategy (see
BACKUP_RESTORE.md and Section J rows 14-19), structured logging
(Section E's "Logging & Observability" subsection and Section J rows
20-21), a Next.js 14→15.5.24 security migration (Section E's
"Next.js 15 Migration" subsection and Section J rows 22-30), and closing
a test-coverage gap in the Google Maps integration ahead of configuring
real API keys on Railway (see STAGING_REPORT.md Section 12a), each
re-verifying the full command sequence plus their own dedicated live
tests. Full results are in Section J.

---

## A. Local Development Setup

| Item | Value | Source |
|---|---|---|
| Node version | No `engines` field in package.json — not pinned. Verified working on Node 22.22.2; CI also uses Node 22 explicitly. | package.json, .github/workflows/ci.yml |
| Package manager | npm (package-lock.json is committed; `npm ci` works) | package-lock.json present |
| Database | PostgreSQL 16 (postgres:16-alpine in docker-compose.yml and CI) | docker-compose.yml, CI workflow |
| Install | `npm install` (or `npm ci` for a reproducible install) | package.json |
| Database setup | `docker compose up -d` (Postgres only — see Section G), a native install, or a hosted provider | docker-compose.yml, README |
| Migration | `npm run db:migrate` -> tsx scripts/migrate.ts | package.json |
| Seed | `npm run db:seed` -> tsx scripts/seed.ts (creates 2 demo tenants, demo users incl. a platform admin, demo data) | package.json, scripts/seedData.ts |
| Combined | `npm run setup` or `npm run db:reset` (identical — migrate then seed) | package.json |
| Dev server | `npm run dev` -> next dev, port 3000 by default | package.json |
| Test | `npm test` -> vitest run (needs DATABASE_URL_TEST) | package.json |
| Build | `npm run build` -> next build (also runs ESLint + TypeScript checks; a failing lint or type error fails the build) | package.json, verified Section J |
| Production start | `npm run start` -> next start | package.json |

**Recommendation (not yet done)**: add `"engines": { "node": ">=20" }` to
package.json so an incompatible Node version fails loudly and early. A
one-line fix; not made here since nothing in this pass required it.

---

## B. Environment Variables

Every row below was found by grepping the actual codebase for
`process.env.*` — nothing here is assumed from convention.

| Variable | Required locally? | Required in production? | Purpose | Example format | Status |
|---|---|---|---|---|---|
| DATABASE_URL | Yes | Yes | Postgres connection string for the app's main database. lib/db/client.ts throws immediately on startup if unset. | postgresql://user:password@host:5432/dbname | Used |
| DATABASE_URL_TEST | Yes, only for `npm test` | No | A separate Postgres database the test suite drops and recreates on every run — must never equal DATABASE_URL. | postgresql://user:password@host:5432/dbname_test | Used |
| GOOGLE_MAPS_API_KEY | No | Recommended | Server-side key for the Directions API (trip route optimization/ETA). Without it, trips fall back to selection-order stops — the app still works, just degraded. Never expose to the browser. **Independent of the variable below — either can be set without the other.** | AIzaSy... | Used, optional, degrades gracefully |
| NEXT_PUBLIC_GOOGLE_MAPS_API_KEY | No | Recommended | Browser-side key for the Maps JS SDK (Dispatcher live map). Compiled into client JS and visible to anyone — restrict via HTTP referrer in Google Cloud Console rather than treating as secret. **Independent of the variable above.** See `STAGING_REPORT.md` Section 12a for exact Railway configuration and verification steps. | AIzaSy... | Used, optional, degrades to a placeholder |
| NODE_ENV | Set automatically by Next.js | Same — don't set manually | Gates DB pool caching in lib/db/client.ts, and (as of this pass) whether session/switch cookies are marked `secure`. | production | Used |
| PORT | No | Optional | Standard Next.js behavior — next start binds here if set, default 3000. Not read directly by app code. | 3000 | Used (framework-level) |
| ALLOW_SEED_IN_PRODUCTION | No | No (never set this in real production) | Explicit escape hatch for `scripts/seed.ts`'s production guard — see BACKUP_RESTORE.md's "Never seed production" section. Only ever needed for a disposable pre-launch environment that happens to have NODE_ENV=production set. | true | Used, added in this pass |

**Notably absent, and correctly so**: no SESSION_SECRET or JWT_SECRET.
Sessions are opaque random tokens stored server-side in the `sessions`
table, not signed JWTs — there's no signing secret to manage or rotate.

**No real secrets are committed anywhere in this repo.** `.env` and
`.env.local` are both gitignored (confirmed); `.env.example` contains
only placeholders.

---

## C. Database Deployment

- **Type**: PostgreSQL 16. No Postgres extensions required — every
  migration file was read; none uses pgcrypto, postgis, or similar.
- **Migration process**: `npm run db:migrate` runs Drizzle's migrate()
  against DATABASE_URL. Plain SQL files in `drizzle/*.sql`, numbered
  0000-0015 as of this pass, tracked in a separate `drizzle` Postgres
  schema.
  - **Production migration warning**: migrations are additive-only by
    convention (verified — no DROP COLUMN or destructive statements in
    any of the 16 files; migration 0015 relaxes a NOT NULL constraint on
    an existing column, which loosens a rule rather than removing data or
    a column). Run migrations before deploying code that
    depends on new columns/tables, and snapshot the database first —
    Drizzle has no built-in rollback command.
  - **Migrations 0011-0014 — Contract Management Schema Foundation
    ("A1" + "A1.5")**: 6 tables (`contracts`, `contract_site_scope`,
    `contract_periods`, `distance_bands`, `contract_pricing_rules`,
    `invoice_line_items` — the last two names reflect an A1.5 refinement
    pass; `contract_sites`/`invoice_orders` no longer exist) and nullable
    columns on `orders` (`contract_id`, `invoice_id`) and
    `customer_locations` (`city_code`, `zone_code`, `distance_band_code`)
    — groundwork for a bulk-water-tanker contract/pricing model.
    **Task B added a real Contract API** (`/api/contracts` and its
    sub-routes) — creation, listing, status transitions, and site-scope
    assignment, all tenant-isolated and tested. **Task C added a pure,
    read-only Contract Pricing Engine** (`lib/contractPricing.ts`) plus
    its management APIs (`/api/contract-pricing-rules` and
    `/api/distance-bands`) — the engine can calculate a price from
    contract/tenant-default rules with deterministic specificity/priority
    matching and hard-fails on any ambiguity rather than guessing.
    **Task D connected orders to contracts**: `POST /api/orders` accepts
    an optional `contractId` and `locationId` — the latter is an existing
    column (`orders.locationId`, already wired to `customerLocations`)
    that this route simply hadn't accepted as input before; no schema
    change was needed. A contract is validated for eligibility (same
    tenant, same customer, ACTIVE status, order date within range, and —
    now genuinely enforced — site scope when `appliesToAllSites = false`)
    before the order is created; an invalid explicit request rejects the
    whole order. When a location is provided, its real `cityCode`/
    `zoneCode`/`distanceBandCode` feed the pricing preview instead of
    wildcards, so a more specific, location-matched rule is correctly
    preferred over a generic one. Tanker capacity remains genuinely
    unknown at order time (no vehicle is assigned until trip creation) —
    the response's `pricingPreview.capacityKnown: false` says so
    explicitly and honestly, whether or not a wildcard-capacity rule still
    prices successfully. **Pricing preview creates nothing** — no invoice, no
    `invoice_line_items` row, and a contract's `tripsUsed` is only ever
    read, never incremented, by any of this. **Task D.5 improved pricing
    accuracy once a vehicle is actually assigned**: `POST /api/trips`
    recomputes `pricingPreview` for every contract-linked stop using the
    assigned vehicle's real `capacityLiters` — order-creation-time preview
    still reports `capacityKnown: false` (no vehicle exists yet at that
    point, unchanged from Task D), while the trip-creation response can
    now report `capacityKnown: true` and select a more specific,
    capacity-matched pricing rule. Still creates nothing — no invoice, no
    `invoice_line_items`, no pricing-rule or `tripsUsed` mutation.
    **Contract Management is still not complete and not customer-usable**:
    trip completion and invoice generation remain completely unaware any
    of this exists, no UI, no monthly invoice generation, and no ERP sync
    changes exist yet.
    **S1 hotfix**: `GET /api/invoices` previously had no error handling at
    all — an unexpected error anywhere in its query escaped as an
    unhandled exception, producing a bare, empty-bodied 500 that the
    Admin page's `Promise.all` couldn't recover from, freezing it on
    "Loading…" forever. The route is now wrapped in try/catch and always
    returns valid JSON, success or failure; the Admin page's six data
    fetches now each degrade to an empty list independently instead of
    one failure blocking the rest. This also fixed a third occurrence of
    the same passwordHash-embedding pattern already found in the orders
    and trips routes (Task D / D.5) — `/api/invoices` embedded both a
    customer and, via a deep relation chain, a driver's user record,
    both now using the same shared safe-column constants. No schema,
    migration, or invoice-generation behavior changed.
    **S1 audit** (a deliberate follow-up, since the pattern above had now
    appeared four times incidentally): a systematic search across every
    API route for `with: { user: true }` / `with: { customer: true }`
    found and fixed 8 more confirmed exposures — `/api/drivers` (the
    canonical driver-listing endpoint), `/api/tasks`, `/api/expenses`
    (notably readable by DRIVER-role sessions too), `/api/exceptions`
    (two separate embeds), `/api/trips` (a second leak in the same file
    Task D.5 only partially fixed), `/api/escalations`, `/api/sla`, and
    one unused-but-latent embed removed as cleanup. `lib/scorecards.ts`,
    `lib/reportQuery.ts`, `lib/erp/sync.ts`, and the auth/`users` routes
    were all individually checked and confirmed already safe (each
    flattens to named fields or has its own existing safe-user helper) —
    not touched. No schema, business-logic, or UI changes.
    **S2** added a permanent CI guard (`npm run security:api`, running
    `scripts/checkSensitiveExposure.ts`) so a future route can't
    reintroduce this same class of bug unnoticed — it scans `app/api/**`
    for `user: true` / `customer: true` / `createdBy: true` /
    `updatedBy: true` / `...user` / `...customer`, plus a narrower,
    paren-depth-aware check for `passwordHash` reaching a
    `NextResponse.json(...)` call specifically (deliberately not a bare
    substring check — `passwordHash` has several legitimate internal
    uses, like login verifying a password or signup hashing one before
    insert, that never reach a response). Runs in GitHub Actions right
    after lint, before the database/build/test steps. One pre-existing,
    already-audited-safe line (`/api/erp/sync/status`) needed an explicit,
    documented `SECURITY_EXPOSURE_CHECK_ALLOW` comment — the only
    exception, not a broad allowlist.
    **Task E ("Manual Monthly Billing Foundation")** implemented the
    minimal schema change previously flagged as pending: `invoices.order_id`
    is now nullable, needed so a monthly consolidated invoice (covering
    many orders for a `MONTHLY_ACCUMULATED` contract) can exist at all.
    **Its `UNIQUE` constraint was deliberately kept, not dropped** —
    verified empirically (including directly against this table) that
    PostgreSQL treats multiple `NULL` values as distinct under a `UNIQUE`
    constraint, so this is a narrower, safer change than originally
    planned: every existing single-order invoice keeps a real, unique,
    non-null `order_id`, completely unaffected. `invoices.contract_period_id`
    was added (nullable) as the single owner of the invoice↔period
    relationship, per the A1.5 architecture decision. A new API-only,
    manually-triggered endpoint (`POST /api/contracts/[id]/generate-monthly-invoice`
    — no scheduler, no automatic month-end job, no UI) aggregates
    delivered orders for a requested period, prices each one live via the
    real pricing engine (a missing rule aborts the whole operation before
    anything is written — never a partial invoice), and writes the
    invoice plus its `invoice_line_items` transactionally. The three A2
    safety guards flagged in the earlier audit are now implemented:
    `settle-cash` and ERP sync both cleanly reject a null-order (monthly)
    invoice instead of crashing, and driver scorecards now fall back to
    `invoice_line_items` so revenue from a monthly-billed order is no
    longer silently uncounted. Existing one-order-one-invoice generation
    was re-verified end-to-end and remains completely unaffected.
    **Task E.1 ("Billing Reporting & Invoice Path Reconciliation Audit")**
    was a systematic audit of every reporting/read path touching
    invoices — found and fixed three real issues. Most significantly: the
    delivery route (`app/api/trips/[id]/stops/[stopId]/route.ts`) was
    unconditionally creating a standard, wrongly-priced per-order invoice
    for **every** delivered order, including `MONTHLY_ACCUMULATED`
    contract orders — meaning that order would later be billed a
    **second time** when a monthly consolidated invoice was generated for
    its period. Fixed narrowly: no invoice is created at delivery time
    specifically for a `MONTHLY_ACCUMULATED` contract order; a
    `ONE_TIME_TRIP_COUNT` contract order is deliberately left unchanged
    (still gets the same standard-priced invoice as before — wrong price,
    but not a double-bill; a separate, pre-existing, documented
    limitation, not caused by this task, and out of scope to fix here).
    Also fixed: `GET /api/customers/[id]/statement` was returning the
    customer record raw, including `passwordHash` — a genuinely new
    finding, missed by the S1/S2 sweep because that work specifically
    targeted the `with: { customer: true } }` eager-load pattern, and
    this route fetches the customer directly rather than as an embed.
    Also added (minimal, explicitly requested): `GET /api/invoices` and
    the report builder's invoices dataset now include an explicit
    `invoiceType` (`SINGLE_ORDER` | `MONTHLY_CONSOLIDATED`) and
    `lineItemsCount`, so a caller no longer has to re-derive which kind
    of invoice they're looking at; `GET /api/invoices` also now embeds a
    `contractPeriod` summary (start/end dates, status) for the monthly
    case. Everything else audited — credit notes, scorecards' revenue
    fallback, the Executive Dashboard, `settle-cash`, ERP sync, the
    customer statement's monthly-invoice inclusion and null-order safety,
    and the Admin Billing tab — was confirmed already correct and safe;
    none of those were touched. A follow-up pass added dedicated tests
    directly proving the two most important guarantees end-to-end: the
    Executive Dashboard's revenue delta for a new monthly invoice equals
    exactly that invoice's `total` (never double-counted against its own
    `invoice_line_items`), and a driver's scorecard revenue is `0` before
    a monthly invoice is generated and exactly the line's own total after
    — proving the fallback path is used exactly once, not as an addition
    to a nonexistent direct invoice.
    **Task F ("Bulk Water Tanker Demo Seed")** added a third demo tenant,
    "Riyadh Bulk Water Logistics" — the actual Smarty1 pilot business
    model (bulk tanker delivery), separate from the original bottled-water
    "Demo Water Co." tenant (kept unchanged, since several existing tests
    depend on its exact seeded names/values). 6 tankers with real
    `capacityLiters` (two each at 18,000L/21,000L/28,000L, `capacityUnits`
    left null so the unrelated bottle-capacity check is skipped
    entirely), 6 B2B customers with Riyadh sites, 4 distance bands, 4
    active contracts (both types, both site-restriction modes), and 10
    pricing rules — the first time any of the Contract Management
    infrastructure built across A1 through E.1 has been demonstrated with
    real seed data rather than only test fixtures. No schema changes.
    **A genuinely new, serious finding surfaced along the way**: `GET
    /api/customers` (and its `POST` sibling) — the single most widely-used
    customer-listing endpoint in the app — was returning every customer's
    `passwordHash` raw, for every tenant, undetected by both the S1 and S2
    audits for the same reason `app/api/customers/[id]/statement/route.ts`
    was in Task E.1: the customer is the primary query target there, not
    an eager-loaded relation, so the `with: { customer: true } }` pattern
    those audits specifically searched for never matched it. Found because
    Task F's own seed data gives several B2B customers a real portal
    password for the first time, and a genuinely thorough test caught it.
    Fixed the same way as every prior instance: explicit safe columns,
    reusing the credit-limit-inclusive exception already established for
    the finance-facing case. `npm run security:api` continues to pass —
    this is a structural blind spot in that regex-based guard worth
    knowing about (it only catches broad eager-load embeds, not a direct
    query returning a raw row), not a claim the guard is broken.
- **Seed process**: `npm run db:seed` is a demo/development seed —
  fictional companies, users, and a shared `password123` password baked
  into the script. Creates three tenants: two with ~35 days of realistic
  historical delivery data each (56 and 30 trips respectively) so the
  Executive Dashboard and scorecards show credible numbers immediately —
  see README's "Demo dataset" section for the full scenario — plus a
  third, "Riyadh Bulk Water Logistics" (Task F), seeded with contracts,
  pricing rules, and a modest set of orders/trips rather than a full
  historical delivery run. **Never run this against a database with real
  customer data.** There's no separate "bootstrap the first real tenant"
  script; use `/signup` for that instead.
- **S3 hotfix — adding the Riyadh Bulk Water tenant to an already-seeded
  database**: `npm run db:seed` (above) is NOT idempotent for Demo Water
  Co./Acme — re-running it against a database that already has them fails
  immediately on their duplicate emails, which is exactly what happened
  attempting to add the newer Riyadh tenant to an already-seeded Railway
  database. For that specific situation, run
  **`npm run db:seed:riyadh-bulk-water`** instead (`ALLOW_SEED_IN_PRODUCTION=true`
  required in production, same guard as `db:seed`) — it seeds ONLY the
  Riyadh Bulk Water Logistics tenant (`scripts/seedRiyadhBulkWaterData.ts`,
  find-or-create by stable identifiers: tenant name, user email, driver
  userId, vehicle plate number, distance band code, customer name,
  contract number), never touches Demo Water Co./Acme, and is genuinely
  safe to run more than once — a second run reuses everything it finds
  and creates nothing new, reported explicitly in its printed summary.
  `scripts/seedData.ts`'s own `seedDemoData()` (used by `db:seed` and the
  test suite) calls this same idempotent function internally, so nothing
  about the full/test seed path changed — only this tenant's own
  addability to an existing database was fixed.
- **Task G ("Pilot UI / Copy Cleanup")**: the login screen already showed
  real Riyadh Bulk Water Logistics credentials (admin/dispatcher/driver,
  verified against the actual seed script and confirmed as genuinely
  working logins, not just displayed text) — no change was needed there.
  A handful of high-visibility bottle-era labels were made neutral,
  copy-only, no backend/schema change: "Contract price/bottle" →
  "Contract rate" (admin billing tab header), "Bottles delivered" →
  "Quantity delivered" and "Empty bottles collected" → "Empties collected"
  (driver ePOD form), "Bottles" → "Quantity" and "{n} bottles total" →
  "{n} units total" (B2B order creation), "Delivered N bottle(s)" →
  "Delivered N unit(s)" (driver stop summary), and the admin Warehouses
  tab header → "Warehouses / Loading Points & Stock". Deliberately NOT
  changed: seeded inventory item names ("19L Bottle - Full/Empty") and
  their dropdown options — these are real, functional data for tenants
  that genuinely stock bottles (Demo Water Co./Acme), not incorrect
  wording to clean up; and the generic word "warehouse" elsewhere in the
  UI (dropdowns, buttons) — it's an industry-standard term that already
  applies correctly to a tanker loading point too (the seeded Riyadh Bulk
  Water warehouse row is itself named "Main Loading Point...", which
  already displays correctly wherever a warehouse's own name is shown).
  No schema, seed, pricing, invoice, or lifecycle changes.
  **Follow-up pass**: extended the same copy cleanup to two screens the
  original pass hadn't covered — the Admin vehicles table's "Home
  warehouse" column header (→ "Home warehouse / loading point", matching
  the same dual-naming convention already used on the Warehouses tab
  header) and two Dispatch page labels ("Awaiting warehouse loading" →
  "Awaiting loading", "Confirm warehouse loading" → "Confirm loading" —
  both already redundant with the warehouse-selection dropdown shown
  right next to them). Also added one new option to the inventory
  "Adjust stock" dropdown — "Bulk Water - Tanker Stock (Liters)" —
  alongside the two existing bottle options (kept exactly as they were,
  consistent with the original pass's own reasoning: this doesn't remove
  or rename anything genuinely accurate for Demo Water Co./Acme, it only
  adds a usable choice for a tenant that has no relevant option at all
  today, since Riyadh Bulk Water Logistics has no seeded inventory
  items). Confirmed via direct testing that `v.capacityLiters ?
  liters-display : v.capacityUnits ? units-display : "—"` (vehicles
  table) already handles both business models correctly with zero
  bottle-specific bias — no change needed there. Copy-only; no schema,
  seed, pricing, invoice, or lifecycle changes in this follow-up either.
- **Task G.2 ("Pilot Operational UI & Flow Review")** — three real,
  root-cause fixes found and fixed during a pilot-readiness pass, not
  just wording:
  1. `PATCH /api/trips/[id]/loading` was hardcoded to check for an
     inventory item literally named `"19L Bottle - Full"` — Riyadh Bulk
     Water Logistics's loading point has no inventory items at all, so
     every trip was permanently blocked with a confusing bottle-shortage
     message. This also turned out to be a **pre-existing, previously
     undetected bug affecting Acme** (which tracks "Diesel Tank - Full",
     not bottles) — it never surfaced before because Acme's seeded
     historical trips are built by direct DB inserts that bypass this
     route entirely. Fixed generically, not tenant-specifically: the
     route now looks for whatever item at that warehouse follows the
     existing `"<name> - Full"` naming convention (already used
     consistently by every tenant that tracks anything), and skips the
     check entirely when a warehouse tracks nothing. Demo Water Co.'s
     exact shortage-blocking behavior is unchanged and re-verified.
  2. The driver page only ever distinguished "an active dispatched trip"
     from "nothing assigned" — a trip that's been assigned but is still
     `PLANNED` (awaiting loading confirmation, which remains
     dispatcher-only, unchanged) looked identical to having no trip at
     all. Fixed with a clearer message only; no trip-lifecycle change.
  3. The driver expense form was always fully visible and submittable
     regardless of whether the driver currently has a vehicle assigned
     (only true once a trip is dispatched) — `vehicleId` is a required
     field, so submitting without one was a guaranteed failure, and since
     `/api/expenses` returns a Zod object (not a string) for validation
     failures, the frontend's error handling silently fell back to a
     generic "Failed to submit expense" every time. Fixed on the frontend
     only: the form now explains and disables submission until a vehicle
     is assigned, and real validation messages are now surfaced instead
     of the generic fallback. `vehicleId` remaining required (BR-23) was
     not changed — that's correct, intentional behavior.
  No schema, migration, seed, pricing, invoice, or ERP changes.
- **Task G.3 ("Dispatcher Trip Assignment Fix + Vehicle Capacity Liters
  UI Support")** — a precise root-cause chain, found and fixed:
  Task F's own seed data left the Riyadh Bulk Water ad-hoc demo order in
  `PENDING` status while **also** creating a real trip/tripStop for it
  (intentional, to give the dispatch board something genuine to show) —
  a real data-consistency bug, since it meant that order wrongly appeared
  in the dispatcher's assignable queue. Selecting it and attempting to
  create a trip hit `tripStops.orderId`'s unique constraint at the raw
  database level — an uncaught exception with no try/catch anywhere in
  `POST /api/trips`, producing an empty-bodied 500. The frontend's own
  `res.json()` call then threw on that empty body, skipping
  `setBusy(false)` entirely — permanently disabling "Create & assign
  trip" for the rest of the session, for **any** subsequent selection,
  not just the one that failed. Fixed at every layer: the seed order is
  now correctly `ASSIGNED` (not `PENDING`); `POST /api/trips` gained a
  proactive, direct guard against assigning an order already on any
  non-completed trip (defense-in-depth beyond the pre-existing
  `orders.status` check, which can drift out of sync exactly as this bug
  proved) and a top-level try/catch so it always returns valid JSON; the
  dispatch page's `createTrip()` now wraps its fetch/parse in
  try/catch/finally so `busy` always resets regardless of what the
  server returns. Also fixed a real but separate wording issue while in
  this same code: the dispatch queue's order line dropped the misleading
  "× {bottleSizeLtr}L" (a field that has never once been set to anything
  but its schema default of 19, for any tenant, so nothing informative
  was lost) in favor of neutral "N unit(s)", and "units total" became
  "load(s) total" — both changes are global copy, not tenant-conditional.
  Separately, **vehicle creation already fully supported
  `capacityLiters` at the API level** (`POST /api/vehicles`'s schema
  already had it) — only the admin UI form was missing the field
  entirely. Added a clearly-labeled "Tanker capacity (liters)" input
  alongside the existing "Capacity units" one, genuinely optional and
  independent of it — a legacy bottle-van vehicle's creation flow is
  completely unchanged. No general vehicle-edit UI exists in this app
  (only a home-warehouse dropdown) to extend, so capacityLiters can only
  be set at creation time, not edited afterward — a real, separate gap.
  No schema, migration, pricing engine, invoice, monthly billing, or ERP
  changes.
- **Task H ("Configuration & Pilot Readiness Review")** — a full
  configuration audit across every operational area (tenant/user setup,
  drivers, vehicles, loading points, customers/sites, contracts, distance
  bands, pricing rules, orders, dispatch, billing, reports, inventory),
  producing this gap matrix:

  | Area | Gap | Severity | Fixed now? | Needs schema/seed? |
  |---|---|---|---|---|
  | Vehicle capacity | No way to edit capacityLiters/capacityUnits after creation (creation-only) | High | **Yes** | No |
  | Billing tab | invoiceType/contractPeriod already in the API response but never displayed | Medium | **Yes** | No |
  | Contracts | No UI at all — create/manage only via API | High | No — deferred | No (UI-only, but large) |
  | Pricing rules | No UI at all — create/manage only via API | High | No — deferred | No (UI-only, but large) |
  | Distance bands | No UI at all — create/manage only via API | Medium | No — deferred | No (UI-only, but large) |
  | Customer sites/locations | No UI to create/view sites or their cityCode/zoneCode/distanceBandCode | High | No — deferred | No (UI-only, but large) |
  | Loading points (warehouses) | Can be created but not edited (name/address/coords) after creation | Low | No — deferred | No, but small |
  | Driver/vehicle/customer creation | Fully functional | — | Already fine | — |
  | Inventory tab empty state | Already shows a clear "No stock items yet." for a tracked-nothing loading point | — | Already fine | — |
  | Executive Dashboard | Already free of bottle/unit-specific wording | — | Already fine | — |
  | Dispatch/driver flow (G.2/G.3) | Bottle-shortage blocking, stuck button, misleading wording, driver empty-state | Critical | Already fixed (prior tasks) | No |

  **Fixed this pass**: (1) `PATCH /api/vehicles/[id]` now accepts
  `capacityLiters`/`capacityUnits` (the DB field already existed; this
  is a Zod-schema and route addition only, each field independently
  settable so editing one never touches the other), with a small
  click-to-edit control in the admin vehicles table matching the same
  interaction pattern already used elsewhere in this UI (e.g.
  CustomersTab's contract rate). (2) The admin Billing tab now shows an
  explicit "Type" column (Single order vs. Monthly, with the order count
  and period on hover for monthly invoices) and disables the cash-settle
  control with a tooltip explaining why for monthly invoices — using
  fields `GET /api/invoices` has returned since Task E.1 but the UI never
  surfaced.

  **Deferred, not fixed**: full Contract Management UI (contracts,
  pricing rules, distance bands, customer site/location management).
  This is genuinely the single largest configuration gap found — every
  one of these is currently API-only — but building real CRUD UI for all
  four, with the cross-referencing they need (a contract needs a
  customer, a pricing rule needs a contract or tenant scope, a customer
  location needs city/zone/band codes), is a substantial feature build
  in its own right, not a "small, safe addition." Recommended as its own
  dedicated next task rather than attempted here. Loading-point editing
  (name/address/coordinates after creation) is a smaller, lower-severity
  gap deferred for the same reason — worth a few hours whenever the
  Contract Management UI task happens, not urgent enough to justify on
  its own.
- **Task I ("Contract Management Module Design & Implementation Plan")**
  — the gap flagged at the end of Task H (Contract Management is
  API-only) got its own dedicated module: **`/admin/contracts`**, a
  genuinely standalone route (not a tab bolted onto the already very
  large `app/admin/page.tsx`), linked from the main Admin page via its
  own button rather than folded into the tab bar.

  **Commercial-conditions review** — every factor this task asked about,
  classified:

  | Factor | Classification |
  |---|---|
  | Customer, contract type, status, start/end date, billing cadence | Supported now (schema + API exist) |
  | appliesToAllSites, contract_site_scope, trips purchased/used/remaining | Supported now |
  | Pricing scope/rate type, city/zone/distance-band/capacity matching, priority, effective dates | Supported now (via `lib/contractPricing.ts`) |
  | Distance bands (code, label, range, active/retired) | Supported now |
  | Payment due days, payment method on contract, invoice frequency, grace period, PO requirement, tax/VAT registration | **Needs schema later** — `contracts` has no payment-terms columns at all today; not implemented, documented as a future schema gap per this task's own instruction not to build fields the schema can't hold |
  | Minimum monthly commitment, minimum trips, minimum invoice amount, included trips, free trips, discount % | Can be represented using existing pricing rules (e.g. a discount is just a lower `pricePerTrip`) for the simple cases; a true "minimum commitment" floor is **not** representable today — future feature |
  | Fuel/distance/zone surcharge, waiting-time/urgent/night-weekend charge | Can be represented using existing pricing rules (each is just another rule row matched on the right dimensions) — no new mechanism needed, only UI to manage them (deferred, see below) |
  | Cancellation/failed-delivery/reschedule fee | Not needed for the Riyadh pilot today — no fee concept exists elsewhere in billing either; future feature |
  | Auto-renewal | Needs schema later — no renewal-tracking fields exist |
  | Site access restrictions, delivery time windows, SLA requirement (per-contract) | Needs schema later — SLA today is tenant-wide (`slaMinutes` on orders), not contract-specific |
  | Maximum daily/monthly trips, allowed tanker sizes, allowed loading points, driver/vehicle restrictions | Future enterprise feature — no current pilot need identified |
  | Billing contact, contract attachment/document reference | Needs schema later — no such fields exist on `contracts` or `customers` |

  **Module structure implemented (I.1 + a slice of I.2)**: a contract
  list, a full read-only detail view (period/type-specific summaries,
  trip usage with overage warnings, monthly billing period readiness,
  site scope with city/zone/band and a clear warning when a
  site-restricted contract has zero sites, pricing coverage with
  STANDARD/OVERAGE presence and capacities covered), a basic create
  form, and status transitions respecting the backend's exact allowed-
  transition rules — all against the existing Contract/Pricing-Rules/
  Distance-Bands APIs, unmodified. **Deferred** (each clearly labeled
  "available via API only in this release" in the UI itself, not
  silently missing): site-assignment UI, pricing-rule create/edit UI,
  distance-band create/edit UI, and the monthly invoice generation UI —
  matching the staged I.2 (remainder)/I.3/I.4/I.5 plan, each a
  reasonable-sized follow-up rather than one large risky build.
  No schema, migration, seed, pricing-engine, invoice, monthly-billing,
  or ERP changes.
- **Task I.2/I.3/I.4 ("Contract Sites, Pricing Rules, and Distance
  Bands UI")** — the three deferred pieces from Task I got real UI,
  and every backend piece needed for this already existed and was
  already well-built: site assignment/removal
  (`POST`/`DELETE /api/contracts/[id]/sites[/...]`, with cross-customer
  and duplicate guards already enforced server-side), pricing-rule
  create/edit/retire (`PATCH` already correctly blocks editing a rule's
  price or matching dimensions once it's gone live, guiding toward
  retire-and-recreate instead; `DELETE` already soft-deletes via
  `effectiveEndDate`), distance-band create/edit/retire (`PATCH`
  already blocks range edits once a band is referenced by a rule or
  site; `DELETE` already retires via `isActive`/`retiredAt` rather than
  a hard delete), and `GET /api/customers/[id]/locations` already
  existed for listing a customer's own sites. **Zero API changes were
  needed anywhere** — this was purely wiring the existing, already-
  validated APIs into `/admin/contracts`, replacing three "available
  via API only in this release" notes with real management UI:
  a site picker restricted to the contract's own customer with
  add/remove; a pricing-rule table (rate type, capacity, city/zone/
  band, price, VAT, priority, effective dates) with retire and a
  create form offering capacity quick-picks (18,000/21,000/28,000 L
  plus custom) and a distance-band dropdown; and a distance-band
  table with create (basic client-side range validation backed by the
  API's own authoritative checks) and retire. No schema, migration,
  seed, pricing-engine, invoice, monthly-billing, or ERP changes.
- **Task I.5A ("Monthly Billing Readiness UI & Dry-Run Preview")** —
  deliberately safe and additive, per an explicit owner instruction that
  the deployed Contract Management module hadn't been manually reviewed
  yet: nothing here can create an invoice. Added a new, strictly
  read-only `GET /api/contracts/[id]/monthly-billing-preview`, and
  refactored `POST /api/contracts/[id]/generate-monthly-invoice`'s own
  eligibility query into a shared helper
  (`lib/monthlyBillingEligibility.ts`) that both routes now call —
  guaranteeing the preview and the real generation route can never
  silently disagree about which orders are eligible, since there's only
  one implementation of that logic, not two that could drift apart.
  Pricing itself was already shared (`calculateContractPrice()`), so no
  separate preview pricing model was invented either. The one
  intentional behavioral difference: the real route aborts entirely on
  the first pricing failure (correct for something that writes an
  invoice); the preview continues past a failure so it can report every
  blocking order at once — a deliberate, documented divergence, not
  drift, and the preview writes nothing regardless of how many orders
  fail. Contract Management's monthly-contract detail view now shows a
  real readiness section — READY (order count + expected total),
  NOT_READY (with specific blockers, e.g. a named order with no matching
  pricing rule), or ALREADY_BILLED (with the existing invoice's number
  and total) — replacing what used to just show the raw `contract_periods`
  row. The "Generate invoice" control is present but permanently
  `disabled`, with the exact text this task specified, and never
  references the generation endpoint anywhere in its code path. Verified
  directly: repeated preview calls, including ones that hit a pricing
  failure, leave `invoices`/`invoice_line_items`/`contract_periods` row
  counts and every order's own status/contractId completely unchanged.
  No schema, migration, seed, pricing-engine, or invoice *creation*
  behavior changes — the one existing route touched was refactored to
  call an extracted function with identical inline behavior, not altered.
- **Task J ("Contract Management Advanced Configuration Audit")** — a
  systematic review of every commercial/operational factor a real
  enterprise contract management module could cover, producing this
  matrix (grouped; see the task's own 11-category breakdown for the
  full list every row here summarizes):

  | Area | Factors | Current support | Recommended phase |
  |---|---|---|---|
  | Identity/lifecycle | number, customer, type, status, dates, notes | Fully supported | — |
  | Identity/lifecycle | renewal date, auto-renewal, expiry alerts, termination reason | Schema missing | Future schema |
  | Site scope | customer sites, city/zone/band, applies-to-all-sites | Fully supported (UI since I.2) | — |
  | Site scope | site access restrictions, delivery windows, working hours | Schema missing | Future schema |
  | Vehicle/tanker | capacity dimension in pricing rules | Fully supported | — |
  | Vehicle/tanker | min/max tanker size, specific vehicle restriction, allowed/preferred loading point | Schema missing | Future schema |
  | Pricing | STANDARD/OVERAGE, capacity/city/zone/band, priority, effective dates, VAT | Fully supported (UI since I.3) | — |
  | Pricing | tiered pricing, volume discounts, fixed monthly fee, minimum invoice/commitment | Schema missing | Future schema |
  | Surcharges | fuel/distance/zone/waiting/urgent/night/weekend/holiday/cancellation/reschedule/stop/toll fees | Schema missing entirely — no fee-line-item concept exists | Future schema (significant) |
  | Usage limits | purchased/used/remaining trips, overage | Fully supported | — |
  | Usage limits | max/min daily/weekly/monthly trip caps, min/max order quantity | Schema missing | Future schema |
  | Billing config | billing cadence, monthly vs. trip-count, manual invoice generation, readiness | Fully supported (I.5A preview) | — |
  | Billing config | invoice consolidation/grouping by site or PO, separate overage/surcharge billing | Schema missing | Future enterprise feature |
  | Payment terms | due days, Net terms, advance/prepaid, credit account/limit, grace period, payment method, deposit | **Schema missing entirely** (only `customers.creditLimit` exists, and it's a credit-check input, not a contract term) | Future schema |
  | Billing requirements | PO/reference requirement, cost center, project code, billing contact/email, VAT/tax registration, legal name, invoice language/notes | Schema missing entirely | Future schema |
  | SLA | delivery lead time, guaranteed window, response time, failed-SLA penalty, emergency eligibility | Schema missing (a tenant-wide SLA exists elsewhere in the app, but nothing contract-specific) | Future enterprise feature |
  | Documents/governance | contract/PO attachment, amendment version/date, approver, change history/audit trail | Schema missing (only `createdByUserId`/`createdAt` exist — "created by", not "approved by" or a change log) | Future enterprise feature |

  **Not needed for the Riyadh pilot specifically**: surcharges, tiered
  pricing/volume discounts, SLA penalties, documents/governance — all
  genuinely enterprise-scale concerns beyond a single-tenant tanker
  pilot's immediate needs. **Recommended for enterprise future, in
  rough priority order**: payment terms → billing requirements
  (PO/VAT) → usage limit caps → surcharges → documents/governance.

  **Implemented this pass**: a **Contract Readiness Summary** — an
  informational-only panel (explicitly no scoring, nothing blocks using
  the contract, per this task's own instruction) computed by a newly
  extracted, directly unit-tested pure function
  (`lib/contractReadiness.ts`) from data the module already fetches, no
  new API calls. Covers: customer assigned, contract active, within
  valid date period (flags not-yet-started and expired), site scope
  configured, STANDARD/OVERAGE pricing configured, tanker capacity
  coverage (correctly treats a wildcard-capacity rule as covering
  everything, only flagging a genuine gap), distance band coverage
  (only shown when a rule actually references one), and monthly billing
  readiness for monthly contracts. Also added an explicit "Not yet
  configurable" list naming every schema-missing factor above by
  category, rather than silently omitting them — visible, not editable,
  no fake controls. No schema, migration, seed, invoice-generation, or
  pricing-engine changes; the Monthly Billing preview remains
  strictly read-only, re-verified directly (repeated reads across the
  full contract/pricing/preview path leave every table's row counts
  unchanged).
- **Task K ("Customer & Site Configuration Module Readiness")** — a
  genuinely important gap found: `POST /api/customers/[id]/locations`
  (site creation) never accepted `cityCode`/`zoneCode`/`distanceBandCode`
  in its request schema at all, even though `customer_locations` has
  supported those columns since the A1 Contract Management schema
  foundation — the only way to ever set them was a direct seed/DB
  insert. Extended the route's own schema to accept all three (still
  fully optional, matching the nullable columns), and added one new,
  genuinely safe validation while there: a provided `distanceBandCode`
  is now checked against the tenant's real `distance_bands` — rejecting
  an unknown code and a retired one, each with a clear error, rather
  than silently accepting a value that could never match a
  distance-based pricing rule. No schema change — the columns already
  existed; this only exposed them through the API for the first time.
  Added a new standalone module, **`/admin/customers`** (mirroring
  Contract Management's own precedent from Task I — its own route, not
  a tab on the already very large `app/admin/page.tsx`; the existing
  legacy CustomersTab there is completely untouched), showing each
  customer's sites with city/zone/band, a **Site Readiness** summary per
  site (`lib/siteReadiness.ts`, directly unit-tested — the same extracted,
  testable-pure-function pattern Task J established with
  `lib/contractReadiness.ts`), retired-band sites flagged clearly, and
  **which contracts include each site** — computed read-only from
  existing endpoints only (an "applies to all sites" contract trivially
  includes every site; a site-restricted one is checked via its own
  already-embedded `siteScope`), no new relationship service. **Riyadh
  pilot finding, verified directly and read-only**: all six real seeded
  B2B customers and every one of their sites already have
  cityCode/zoneCode/distanceBandCode and coordinates fully set — nothing
  is missing for contract eligibility, pricing lookup, dispatch, or map
  positioning. No schema, migration, seed, invoice-generation, or
  pricing-engine changes.
- **Task K.2 ("Customer Site Editing & Metadata Maintenance")** — closed
  the one concrete gap Task K's own audit flagged: existing sites could
  be created but never edited. **A genuine historical-pricing-safety
  finding drove the design**: nothing in this schema ever snapshots a
  location's cityCode/zoneCode/distanceBandCode onto an order or
  invoice — `calculateContractPrice()` always live-joins to the
  location's *current* fields at the moment pricing actually runs. An
  already-invoiced order is safe (its dollar amounts are frozen in
  `invoice_line_items` or the invoice's own row and never
  recalculated), but a **delivered-but-not-yet-invoiced** order is a
  real risk window — especially for a `MONTHLY_ACCUMULATED` contract,
  where invoicing is manual and can happen well after delivery. No
  schema-level snapshot exists to detect this properly (building one
  would be a schema change, correctly out of scope here), so the new
  `PATCH /api/customers/[id]/locations/[locationId]` implements the
  safest guard achievable with the existing schema instead: it
  **outright blocks** editing cityCode/zoneCode/distanceBandCode while
  the site has any delivered order not yet billed via *either* invoicing
  path this schema supports (a direct single-order invoice or a line
  item on a monthly consolidated one) — a real, catchable bug in this
  guard's own first draft that a directly-written test caught before
  it shipped: the initial version only checked `invoice_line_items`,
  missing the single-order invoice path entirely. Address, label,
  coordinates, and contact fields carry no pricing meaning and are never
  restricted. Also validates a newly-assigned `distanceBandCode` exactly
  like site creation (Task K) does — unknown or retired codes rejected.
  UI: an "Edit" action per site in `/admin/customers`, prefilled with
  current values, showing this task's exact specified warning text when
  the site is used by any contract, with a retired currently-assigned
  band kept visible (but never offered as a new choice for anyone else).
  Contract scope is never touched by a site edit — verified directly.
  No schema, migration, seed, or pricing-engine changes.
- **Task K.3 ("Customer Site Access-Control & Pricing-Critical Field
  Governance")** — closed a real gap Task K.2's own audit flagged: the
  site creation and edit APIs authorized purely on "does this session
  own this customer", with no awareness of which *fields* were being
  touched. The real B2B portal UI (`app/b2b/page.tsx`'s `LocationsTab`)
  has never sent `cityCode`/`zoneCode`/`distanceBandCode` — a customer
  using the actual product has never been able to set them — but
  nothing stopped a direct API call (CUSTOMER *or* DISPATCHER session)
  from doing so, since "hiding it in the UI" was never a real
  server-side guarantee. **Governance decision**: only ADMIN may set or
  change these three fields, on both creation and edit — enforced in
  `lib/siteFieldGovernance.ts` and checked server-side in both routes,
  never relying on the frontend. DISPATCHER keeps full, unchanged access
  to every operational field (label, address, contact info,
  coordinates) but not these three, since no existing workflow
  demonstrated a need and the safer default is preferred. CUSTOMER keeps
  exactly what the real UI already does — operational fields for their
  own sites only. DRIVER retains zero access, unchanged (already fully
  excluded by the pre-existing tenant/role check in both routes).
  **Execution order in the PATCH route, exactly as specified**:
  (1) authentication/tenant/customer ownership, (2) field-level role
  authorization, (3) the Task K.2 historical-pricing safety guard —
  confirmed to still block even ADMIN when a delivered-but-unbilled
  order exists, since role authorization and financial correctness are
  independent checks, neither overriding the other — (4) Zod
  validation plus the distance-band existence/active check, (5) the
  update itself. The B2B portal's existing "Add a location" form gained
  one small, purely informational line — the exact text this task
  suggested — explaining why city/zone/distance-band aren't there; no
  new portal feature was built, since there was never a field to hide
  in the first place. No schema, migration, seed, pricing-engine, or
  invoice changes.
- **Task K.4 ("Dispatcher Customer/Site Operational Access Review")** —
  closed the UI/API mismatch Task K.3 itself flagged: DISPATCHER already
  had safe, legitimate API access to operational site fields, but
  `/admin/customers` was ADMIN-only at the UI level, leaving no practical
  way to use it. **Chosen model: Model B** — DISPATCHER admitted to the
  module, since `lib/siteFieldGovernance.ts` (Task K.3) already fully
  enforces ADMIN-only for cityCode/zoneCode/distanceBandCode
  server-side; this UI change grants no new server-side permission, it
  only gives an already-authorized role an actual path to use it —
  exactly the condition this task's own instructions required before
  Model B could be chosen at all. For a DISPATCHER session: the add-site
  and edit forms never render an editable cityCode/zoneCode/
  distanceBandCode input — not disabled, not hidden-but-present, wholly
  absent — showing the exact specified note instead
  ("City, zone, and distance band are managed by admins because they
  affect contractual pricing."); the page's own "Contract Management"
  link and the contract-pricing-eligibility warning are both hidden too,
  since neither is relevant or safe to surface to this role; "Back to
  Admin" becomes "Back to Dispatch" (linking to `/admin`, which is
  ADMIN-only, would just redirect a dispatcher away). **A real bug
  caught before shipping**: the site-edit save function originally sent
  cityCode/zoneCode/distanceBandCode as explicit keys unconditionally
  (even unchanged, pre-filled values) — since the server's field-level
  check rejects a request the moment any of these keys is merely
  *present*, this would have wrongly 403'd a DISPATCHER editing just an
  address. Fixed by omitting these keys from the request body entirely
  for a non-admin session, in both the create and edit forms. `GET
  /api/contracts` and `GET /api/distance-bands` remain ADMIN-only,
  untouched — for DISPATCHER those simply return empty arrays via this
  page's existing error-tolerant fetch helper, the intended safe
  degradation. No schema, migration, seed, pricing-engine, invoice, or
  ERP changes.
- **Task L ("Loading Point / Warehouse Operational Configuration")** —
  a real, previously-unnoticed bug found and fixed: `POST
  /api/warehouses` created two "19L Bottle" inventory rows for *every*
  new warehouse unconditionally, regardless of tenant — meaning an
  admin creating a new loading point for Riyadh Bulk Water through this
  same API would have gotten unwanted bottle-specific stock rows forced
  onto a tanker-only operation. Fixed generically, with no hardcoded
  tenant name or sector check: the baseline bottle items are now only
  auto-created when this tenant already has inventory tracking on at
  least one other warehouse. A legacy bottle-water tenant (Demo Water
  Co., Acme) gets exactly the same behavior as before — every new
  warehouse still gets the same starting items, for operational
  consistency — while a tenant with zero inventory tracking anywhere
  (Riyadh today, or any future tanker-only tenant) now gets a clean
  loading point with nothing forced onto it. Also added the smallest
  safe `PATCH /api/warehouses/[id]` this schema supports — name,
  address, and coordinates, tenant-isolated, partial-update, verified to
  never touch inventory rows or any vehicle's `homeWarehouseId` — with a
  matching edit control per loading-point card in the admin Inventory
  tab. Extended `GET`'s existing ADMIN+DISPATCHER policy to this new
  PATCH route too (the same operational-correction trust already
  extended to DISPATCHER for customer sites in Task K.4 — there's no
  pricing-critical field here to protect). Updated visible wording to
  "Loading point / warehouse" throughout the admin Inventory tab and the
  dispatch page's loading-point selector, and replaced the empty-stock
  message with the exact wording this task specified
  ("No tracked inventory. Loading confirmation will not require stock
  deduction.") — shown only when a warehouse genuinely has zero
  inventory rows, so legacy tenants with real stock are completely
  unaffected. No schema, migration, or seedData changes — every fix
  here is a route-behavior or wording change, not a data model change.
- **Task M ("Loading Point Active/Inactive Lifecycle Audit")** —
  primarily an audit/design task; schema was deliberately not touched.
  **Dependency audit**: every consumer of `warehouseId`
  (trip creation, loading confirmation, inventory adjustment, vehicle
  `homeWarehouseId`, the dispatch selector) treats every warehouse as
  unconditionally usable — there is no lifecycle-state check anywhere,
  because no such field exists. This means a historical trip's
  reference to a warehouse is already permanently safe by construction
  (a plain FK, no cascading state), but there is also currently no way
  to signal "don't dispatch from here anymore" other than word of mouth.

  **Business decision matrix** (condensed — full scenario table
  considered temporary closure, permanent retirement, stock-outs,
  inactive vehicle homes, dispatcher selection, in-flight trips,
  historical display, and both tracked/untracked-inventory tenants):
  temporary closure and permanent retirement are the two scenarios with
  real operational risk today (nothing stops a dispatcher from
  selecting a loading point that's physically closed); historical trips
  and reporting are already safe with no changes; inventory stock-outs
  are already handled by the existing per-item quantity check,
  independent of any lifecycle field.

  **Recommended model: Option C** (`operationalAvailability`: AVAILABLE
  / TEMPORARILY_CLOSED / RETIRED) over a plain boolean or a bare
  ACTIVE/INACTIVE/RETIRED enum — a tanker loading point closing for a
  day (e.g. maintenance) is a materially different situation from one
  being permanently decommissioned, and dispatch/reporting should be
  able to tell them apart (temporarily-closed still shows in history
  and vehicle-home displays with a clear label; retired should
  eventually stop being offered as a new vehicle home too). Recommended
  defaults and behavior if ever implemented: every existing row
  defaults to AVAILABLE on migration (zero behavior change on
  deploy); dispatch's loading-point dropdown filters to AVAILABLE only;
  history and completed-trip displays show every status, unfiltered,
  labeled clearly; inventory display and stock validation are
  completely unaffected either way, since they're independent of this
  field; a vehicle whose home loading point becomes TEMPORARILY_CLOSED
  or RETIRED should be flagged in the admin Fleet tab (not blocked —
  homeWarehouseId is just a default suggestion for dispatch, never a
  hard constraint) rather than silently reassigned. **Not implemented
  in this task, deliberately** — this is a real schema/migration
  decision that deserves its own reviewed task, not something to slip
  in as a side effect of an audit.

  **Safe improvement made**: a small, read-only note in the admin
  Inventory tab stating this limitation plainly
  ("Loading points don't yet support an active/inactive status — every
  one listed here is available for dispatch and vehicle assignment.")
  — informational only, no fake toggle, no schema, no migration, no
  seed changes.
- **Task N ("Dispatch Control Tower Readiness Review")** — a real,
  significant gap found and fixed: `dispatchTrip()` and `resolveStop()`
  had **zero error handling at all** — a failed dispatch action or stop
  resolution gave the dispatcher no feedback whatsoever, the button just
  sat there with no visible change and no way to know what went wrong.
  `confirmLoading()` and `completeTrip()` had no try/catch around
  `res.json()` (throws on an empty/unreadable body, matching the exact
  class of bug the S1 hotfix fixed elsewhere in this codebase) and
  didn't type-check `data.error`, risking a raw `[object Object]`
  rendered as the error message. All four now match the same
  try/finally pattern `createTrip()` already used correctly: busy state
  always resets, real string errors are always surfaced, an unreadable
  response is handled gracefully instead of throwing uncaught. Added
  visible busy indicators for dispatch/close-trip actions
  (previously silent) and surfaced the shared error state next to the
  Live Trips list too, not just the trip planner, since these actions
  live there. Added a selected-order summary (customer, site, contract
  number if attached, status) in the trip planner, and a loading-point
  inventory-readiness note next to the loading point selector — both
  using data already embedded in existing API responses, zero new
  endpoints. **Driver/dispatch consistency**: reviewed and confirmed
  already correct — the driver page's PLANNED-trip messaging (from Task
  G.2) already matches dispatch's own "Awaiting loading"/"Loaded"
  labels precisely; no change needed. No schema, migration, seed,
  pricing-engine, invoice, or ERP changes; loading-point lifecycle was
  not implemented, per this task's own explicit boundary.
- **Task N.1 ("LiveMap Marker Clarity & Map Fallback Review")** — a real,
  significant gap found and fixed: `LiveMap.tsx` only ever rendered one
  marker per trip, and that marker's fallback position (the first stop's
  location, used before any GPS ping has landed) was rendered
  **identically** to a genuine live GPS position — same label, same
  title, nothing distinguishing "the vehicle is really here" from "this
  trip was just dispatched, no GPS yet, showing where it's headed."
  `resolveTripMapPosition()` (`lib/mapPosition.ts`) now returns an
  `isLive` flag alongside the coordinates, so both `LiveMap.tsx` and
  `app/dispatch/page.tsx` can be honest about which they're showing —
  its own 6 existing tests were updated for the new shape, plus a 7th
  added for a partial-position edge case reasoned through while making
  the change. Marker titles now read `(live)` vs. `(no GPS yet — showing
  destination: ...)` explicitly, and include the destination and
  loading-point names as context in the same marker's title
  (info-window-style, not a second marker — kept this a targeted clarity
  fix rather than doubling the marker count per trip), using neutral
  "destination" wording per this task's own multi-stop-future-readiness
  guidance. The dispatch page's "View on map" button and "no
  coordinates" message are equally honest now (`"View destination on
  map (no GPS yet)"` vs. plain `"View on map"`). **Also fixed real map
  failure handling that didn't exist at all**: no `script.onerror`, no
  load timeout, and no try/catch around `new google.maps.Map(...)` meant
  a script load failure, a silent hang, or a construction exception all
  left the map container as a blank, unexplained 64px box forever — all
  three now set a distinct failure state with a clear message confirming
  dispatching, loading confirmation, and trip assignment all still work
  normally without the map. Confirmed dispatch's other controls (order
  queue, trip planner, trip list) are structurally independent of
  `LiveMap`'s own render tree — a map failure was already incapable of
  blocking them, this task only had to prove it, not fix it. No schema,
  migration, seed, trip-lifecycle, pricing, invoice, or ERP changes.
- **Task O ("Riyadh Bulk Water End-to-End Pilot Demo Audit")** — a
  genuinely positive result: **the entire target demo journey works
  end-to-end today, with zero application code changes needed.** Verified
  empirically (not just read through) via a real API-level walkthrough of
  every step: admin login → reviewing Riyadh's real customers/contracts/
  loading point → dispatcher login → creating a pending order linked to
  an active MONTHLY_ACCUMULATED contract → assigning a tanker/driver/
  loading point (with the duplicate-assignment guard confirmed still
  firing) → confirming loading at Riyadh's genuinely zero-inventory
  loading point → dispatching the trip → the driver seeing that exact
  trip → completing delivery with the minimum ePOD fields → the trip
  showing COMPLETED to admin/dispatcher, with the delivered stop and
  ePOD visible → the monthly billing preview correctly showing the
  order as READY with a real, non-zero expected total — and confirming
  this preview created zero invoices or line items in the process,
  re-verifying Task I.5A's own guarantee against a genuine completed
  demo trip rather than only a synthetic fixture.

  **Every issue hit while building this walkthrough was a test-authoring
  mistake, not an application bug** — caught and fixed in the course of
  writing it: constructing an isolated driver by hand instead of using
  the established `createIsolatedDriverAndVehicle` helper (a schema
  NOT-NULL constraint on `licenseNumber` correctly rejected the
  shortcut); picking a site-restricted contract without providing a
  matching site (the API's own eligibility validation correctly
  rejected this — genuinely correct behavior, not a bug, though worth
  remembering when choosing a demo customer: prefer one whose contract
  applies to all sites for the simplest path); and misreading the stop
  resolution endpoint's actual `{ stop, order }` response shape.
  **Zero production code was changed as a result of this task** — the
  demo genuinely works as built.

  **One pre-existing, already-documented gap re-confirmed, not newly
  found**: `ONE_TIME_TRIP_COUNT` contract orders still get a
  standard-priced (not contract-priced) invoice at delivery time — a
  real gap Task E.1 already identified and documented as a future
  feature, not a narrow bug. It does not affect the demo journey this
  task audited, since that journey deliberately uses a
  `MONTHLY_ACCUMULATED` contract, which correctly skips per-delivery
  invoicing entirely. No schema, migration, seedData, pricing-engine,
  invoice-generation-behavior, or ERP changes — nothing needed fixing.
- **Task P ("ONE_TIME_TRIP_COUNT Contract-Priced Delivery Invoice
  Design")** — design/audit only, no code changed. Confirmed
  `calculateContractPrice` is pure and safe to call at delivery
  completion; confirmed `tripsUsed` was never incremented by any real
  code path (only read, displayed, and statically seeded); found three
  real dependent gaps beyond the core pricing bug — ERP sync hardcoding
  `order.pricePerBottle`/`bottleSizeLtr`, `creditCheck.ts` (later found,
  on deeper inspection during P.2, to already be safe for the invoiced
  case), and reschedule/reassign silently dropping `contractId`.
  Recommended Option A (minimal fix, reusing existing proven functions,
  no schema change) over line-item or deferred-invoicing alternatives.
- **Task P.2 ("Implement ONE_TIME_TRIP_COUNT Contract-Priced Delivery
  Invoice")** — implemented Task P's Option A in full, plus every
  dependent fix it identified.
  **Core fix** (`app/api/trips/[id]/stops/[stopId]/route.ts`):
  `ONE_TIME_TRIP_COUNT` contract orders are now priced via
  `calculateContractPrice` at delivery completion, with STANDARD/OVERAGE
  selected by the existing `determineRateType`, using the assigned
  vehicle's real `capacityLiters` (now embedded via `trip.vehicle`,
  previously never fetched here) and the order's location dimensions
  (now embedded via `stop.order.location`, previously never fetched
  either — `null` when no location is set, which the pricing engine
  already treats as a wildcard). A missing or ambiguous pricing rule
  never falls back to standard pricing — delivery itself still succeeds
  (ePOD recorded, stop/order marked delivered/partially-delivered
  exactly as before), but the response carries a `billingError` field
  and no invoice is created, exactly matching Task P's own design
  conclusion that a back-office pricing gap should never block a
  driver's real, physical delivery. `MONTHLY_ACCUMULATED` and
  non-contract orders are completely unaffected — same skip-invoice and
  same bottle-priced-invoice behavior as before, respectively.
  **A real, previously-undiscovered bug fixed along the way**: this
  route had *no idempotency guard at all* for a repeat delivery call.
  Since `invoices.orderId` carries a unique database constraint, a
  driver's app retrying after a network timeout (never having received
  the first response) would have thrown an uncaught constraint
  violation on the second attempt — for every order type, not only
  contract-priced ones, and for the `fail` action too. Fixed by checking
  stop status at the top of both the `deliver`/`partial` and `fail`
  branches and returning the already-completed result unchanged on any
  repeat call, rather than reprocessing anything.
  **`tripsUsed`**: now incremented exactly once, in the same transaction
  as a successful contract-priced invoice write — never on assignment,
  loading, dispatch, a failed/ambiguous pricing lookup, or a retried
  delivery call.
  **ERP sync** (`lib/erp/sync.ts`): for a contract-linked order, now uses
  a generic tanker-delivery description and a price derived from the
  invoice's own real `subtotal` (the same "total ÷ quantity" approach
  `generate-monthly-invoice/route.ts` already uses for its own line
  items) instead of the wrong `order.pricePerBottle`/`bottleSizeLtr`. A
  legacy, non-contract invoice syncs with byte-identical description and
  price to before this fix.
  **Credit check** (`lib/creditCheck.ts`): audited in depth during
  implementation and confirmed **already correct** for the case that
  actually matters — `pendingInvoicesTotal` already reads from the real,
  frozen `invoices.total`, not `pricePerBottle`. Task P's own audit had
  slightly overstated this as a definite bug; the only genuinely
  approximate part is the separate *undelivered-order* estimate, which
  this task's own instructions explicitly permit staying as-is. No code
  change was made here — confirmed safe by two new tests instead.
  **Reschedule/reassign** (`app/api/exceptions/[id]/resolve/route.ts`):
  the replacement-order insert now carries `contractId` forward from the
  original order, exactly as `locationId` already did — a rescheduled or
  reassigned contract-linked order no longer silently reverts to
  standard pricing on its next delivery attempt. A legacy, non-contract
  order's reschedule is completely unaffected (`contractId` stays
  `null`, exactly as before).
  One existing test (`billingReconciliationAudit.test.ts`) was updated,
  not just left passing by accident — it had been asserting the exact
  old, buggy behavior this task exists to fix (a bare `ONE_TIME_TRIP_COUNT`
  contract with no pricing rules "still creates its usual invoice");
  updated to add a real pricing rule and assert the new, correct
  contract-priced amount instead.
  No schema, migration, or seedData changes; `MONTHLY_ACCUMULATED`
  behavior, ERP connection settings, and Odoo integration structure are
  all untouched beyond the price-source correction described above.
- **Milestone Q ("Smarty1 Operations Control Tower & Phase-1 Core")** —
  a major, gated milestone. Executed Q0 (pre-flight) through Q6 (Loading
  Points) in full; Q7 (Phase-1 alignment matrix) and the remaining
  documentation-only portions of Q8 are covered below rather than as
  separate implementation work, since nothing in this milestone's core
  slice required code beyond what Q0-Q6 already cover.

  **Q0/Q1 audit finding that shaped everything else**: every status
  column in this schema (orders, trips, trip_stops, invoices,
  exceptions, contracts) is an unconstrained `text` field, confirmed by
  direct inspection — meaning a fully normalized Control Tower
  presentation layer could be built with **zero schema change**, exactly
  the outcome Gate Q2 asked to determine before writing any UI. No git
  repository exists in this working environment (every prior task has
  operated directly on the filesystem, packaged via zip rather than
  git commits) — noted honestly rather than treated as a stop condition,
  since there is no history here to check for unexplained changes.

  **New status-normalization module** (`lib/controlTowerStatus.ts`):
  three pure functions — `deriveOperationalStatus`, `deriveBillingStatus`,
  `deriveDemandSource` — read-only over existing order/trip/stop/
  invoice/exception data, changing nothing about any underlying status
  field. An open exception or a cancelled order always overrides
  whatever the trip/order status alone would suggest. Demand source is
  derived only from `customers.type` (B2B/B2C) and `orders.contractId` —
  both already fully reliable — with anything that doesn't cleanly match
  reported as `UNKNOWN`, never guessed. 21 unit tests cover every branch.

  **Dispatch Control Tower** (`/admin/dispatch`, `GET /api/control-tower`):
  a new, read-mostly aggregation view across the full demand lifecycle —
  new demand through billing — built entirely on the existing order/
  trip/invoice/exception tables via two batched queries (no N+1: the
  same `inArray` batching pattern `lib/monthlyBillingEligibility.ts`
  already uses). Every KPI card is a real count over the tenant's own
  returned rows; none are hardcoded. Every action link points at the
  existing, already-protected `/dispatch` console rather than
  duplicating any assignment/loading/dispatch business logic here.

  **Contract Trip Planner** (`/admin/contract-planner`,
  `GET /api/contract-planner`): reuses `computeReadinessItems` (Task J)
  verbatim — the exact same readiness logic Contract Management's own
  summary already uses, so the two views can never disagree. "Ready for
  Dispatch" is a planner-specific, stricter verdict (every readiness
  item must be `READY`, not merely non-`MISSING`) layered on top of that
  same data. Never creates a trip or order automatically; "Plan in
  Control Tower" links to the real, existing creation flow.

  **Loading Points** (`/admin/loading-points`): deliberately reuses the
  existing `warehouses` table and its `GET /api/warehouses`/
  `PATCH /api/warehouses/[id]` APIs directly — no duplicate entity, no
  new backend at all. Government/private classification and active/
  inactive status are honestly *not* shown as fake KPI splits, since no
  field distinguishes them today (Task M's own prior audit already
  covered the active/inactive question specifically).

  **Reusable UI foundation** (Gate Q3): `components/AdminShell.tsx`
  (persistent sidebar + light workspace header) and `components/
  KpiCard.tsx`, applied *only* to these three new modules — `/admin`,
  `/admin/contracts`, `/admin/customers`, `/dispatch`, and `/driver` are
  completely untouched, exactly matching this milestone's own "avoid a
  giant UI rewrite" and "existing modules migrate incrementally"
  instructions. `components/StatusBadge.tsx` was extended with colors
  for every new normalized status — one duplicate-key build error
  (`IN_TRANSIT` already existed for a different, pre-existing status)
  was caught and fixed before this shipped.

  **P1/P4 Phase-1 alignment** (Gate Q7): P1 (Order/contract operational
  linkage, native dispatch, Loading Points) is now substantially
  represented by the Control Tower + Planner + Loading Points trio built
  here; weighbridge integration remains a genuine gap with no existing
  data model, documented as an integration point rather than built.
  P4's B2B Contract and B2B Cash flows are both fully representable
  today via `deriveDemandSource`; B2C Cash is representable wherever
  `customers.type = "B2C"` is set correctly, though the pilot's real
  orders today are predominantly B2B — this is a data-population
  question, not a code gap. Government royalty tracking has a real,
  minimal, zero-schema-change foundation available today: the existing
  `expenseClaims` table (driverId/vehicleId/tripId/category/amount/
  status) can represent a royalty charge via `category: "ROYALTY"`,
  linked to a trip which itself links to its loading point via
  `warehouseId` — a dedicated `loadingPointId`/configurable-rate model
  is a real future schema change, explicitly deferred and not
  implemented here. Native routing/dispatch, ePOD, and P2/P3's
  near-term scope (driver dossiers, existing operational workflow) all
  already exist and were not regressed. The Saudi compliance gate (Q23)
  was not touched, correctly — no HOS/ELD/DVIR schema was proposed or
  implemented.

  **Explicitly deferred, per this milestone's own instructions**:
  weighbridge integration, a dedicated royalty ledger/settlement model,
  a recurrence/scheduling engine for the Contract Planner, `code`/
  `type`/`operatingHours`/`allowedTankerCapacities`/active-inactive
  fields for Loading Points (all genuinely require schema changes, none
  applied), and every item Section 24 of the milestone prompt itself
  lists as out of scope (EV charging, AI assistant, predictive
  maintenance, HOS/ELD, etc.) — none of these were implemented,
  attempted, or scaffolded.

  No schema, migration, or seedData changes anywhere in this milestone.
- **Milestone R ("Smarty1 Operations Layout")** — Admin layout changed
  from a single horizontal top-tab bar to a persistent left-sidebar
  operations shell (`components/AdminShell.tsx`, extended from
  Milestone Q's version, which had been built but never wired into the
  main `/admin` page — confirmed by direct audit before any change).
  The old 13-tab horizontal bar is fully removed as primary navigation,
  not merely demoted; its 13 sections (Overview, Fleet, Drivers,
  Customers, Billing, Maintenance, Inventory, Reports, Scorecards, ERP
  Sync, Automation, Field Ops, Executive) remain exactly the same
  in-page components, now reachable as sidebar items that call the same
  `setTab(...)` state setter as before, grouped into Operations/Core
  Data/Finance/Platform per this milestone's own suggested structure.
  Dispatch Control Tower, Contract Trip Planner, and Loading Points
  (Milestone Q) are now first-class sidebar items reachable from every
  Admin screen, not just their own pages. `/admin/contracts` and
  `/admin/customers` were switched from their own `TopNav`-based headers
  to the same shared `AdminShell`, for visual consistency across the
  whole cockpit. Sidebar links to in-page tab sections use a `?tab=`
  query parameter so navigating from another Admin page deep-links to
  the right section rather than always landing on Overview. The
  platform-admin `CompanySwitcher` capability — previously only
  reachable via the old `TopNav`'s `extra` slot — was preserved via an
  equivalent `extra` slot on `AdminShell`, so it was not silently
  dropped in the shell swap. A responsive mobile drawer (hamburger
  toggle, slide-in sidebar) was added for tablet/mobile, per this
  milestone's own responsive requirement. Two real build/test issues
  were found and fixed along the way, not shipped broken: Next.js
  requires `useSearchParams()` to sit inside a `Suspense` boundary
  (added, via a thin wrapper component); and one existing test
  (`contractManagementModule.test.ts`) asserted the old literal
  "Contract Management" button text, which this milestone intentionally
  relabeled to "Contracts" in the sidebar — updated to match the new,
  correct wording rather than weakened. No FastFleet reference images
  were available in this session; implementation followed this
  milestone's own explicit fallback instruction — the user-described
  left-sidebar direction and the described current-deployed-screenshot
  issue — rather than direct image inspection. No schema, migration,
  seedData, pricing, billing, contract, dispatch, or ERP logic changes —
  this was a layout-only milestone, confirmed by full-suite regression
  (all pre-existing tests, including every Task P.2 contract-priced
  invoice test and every monthly-billing test, pass unmodified).
- **Reset process**: `npm run db:reset` = migrate + seed, does NOT drop
  existing data first — re-running against an already-seeded database
  fails on unique constraints. No single script does a destructive
  clean-slate reset today.
- **Backup recommendation**: use your hosting provider's managed Postgres
  backup/PITR feature as the primary strategy — still a P0 item to
  confirm is actually enabled, see Section I. As of this pass, this repo
  also has `npm run db:backup` / `npm run db:restore` (thin wrappers
  around `pg_dump`/`pg_restore`) as a tested manual/local safety net and
  for the restore-verification process — see **[BACKUP_RESTORE.md](./BACKUP_RESTORE.md)**
  for the full strategy, including why a production seed-guard was added
  to `scripts/seed.ts` while `db:migrate` deliberately was not touched.
- **Required extensions**: none.

---

## D. Production Build & Start

- **Build**: `npm run build`. Verified to fail on lint or type errors —
  it's a real gate, not just bundling.
- **Start**: `npm run start`. Verified to correctly read PORT and serve
  both pages and API routes with NODE_ENV=production.
- **Health check**: `GET /api/health` — **added during this pass** (did
  not exist before). Returns HTTP 200 `{"status":"ok","database":"connected"}`
  when Postgres is reachable, HTTP 503 `{"status":"error","database":"unreachable"}`
  when it isn't. Verified against both a live and a stopped database in
  this pass. Point load balancer/orchestration health checks here, not at
  `/` or `/login`.
- **Port**: standard Next.js — PORT env var or `next start -p <port>`.
- **Reverse proxy assumptions**: none built in (no CORS headers, no
  proxy-trust config). This app expects a reverse proxy (nginx, Caddy, a
  cloud load balancer) to terminate TLS in front of it. Ensure
  X-Forwarded-Proto is set correctly if your proxy is on a separate host
  — relevant to the `secure` cookie flag added in this pass.
- **Static assets**: served by `next start` from `.next/` automatically.
  No separate CDN required for a small/medium deployment.

---

## E. Security Checklist

| Item | Status | Notes |
|---|---|---|
| Auth/session mechanism | Real | bcrypt-hashed passwords, opaque server-side session tokens (no JWTs, no signing secret) |
| Cookie httpOnly | Set | All 5 cookie-setting call sites confirmed |
| Cookie secure | **Fixed in this pass** | Was not set anywhere before — confirmed by grep across all cookie-setting code. Now conditioned on NODE_ENV==="production", matching the existing convention in lib/db/client.ts. Verify your reverse proxy forwards HTTPS correctly or login silently breaks in production. |
| Cookie sameSite | Set (lax) | Reasonable default |
| HTTPS requirement | Not enforced by the app | Must be handled at the reverse proxy/load balancer |
| CORS | No explicit config | Correct for the current single-origin architecture (one Next.js app serves UI and API); would need real config if a separate frontend origin is introduced later |
| Tenant isolation | Verified extensively | Every route derives tenant from session, never a client-supplied param — covered by dozens of tests including deliberate tampering attempts |
| Company Switcher grants | Verified | Explicit least-privilege allowlist; a forged switch cookie is re-validated server-side every request and falls back to the user's own tenant |
| Secret handling | Correct | .env/.env.local gitignored; no secrets found committed anywhere in this pass |
| Logging | **Implemented (console-based structured JSON) — see below** | Auth login/signup, rate limit hits, Company Switcher, health check failures, and backup/restore/seed scripts now emit structured JSON log lines. No external error-tracking service (Sentry or similar) — see the "Logging & Observability" subsection before assuming this covers every failure mode. |
| Rate limiting | **Implemented (in-memory, single-instance) — see below** | /api/auth/login (10/15min per IP, 5/15min per email) and /api/auth/signup (5/hour per IP) are now rate-limited. In-memory, not distributed — see the dedicated subsection below before scaling to more than one instance. |
| Security headers | Defaults only | No CSP, no X-Frame-Options, poweredByHeader not disabled |
| Backup/restore | Not implemented in-app | Rely on hosting provider's managed Postgres backups |
| Dependency vulnerabilities | **Resolved (Next.js CVEs); 6 remaining, 1 high** | Migrated to next@15.5.24, resolving the 5 high-severity Next.js CVEs and the eslint-config-next-related `glob` finding. **Remaining**: 1 high (Next's own internally-bundled `postcss@8.4.31` — confirmed no 15.5.x release through 15.5.25 fixes this; build-time-only exposure, not part of the deployed runtime) and 4 moderate (unrelated, pre-existing `esbuild` finding via `drizzle-kit`, dev-server-only exposure, unaffected by this migration). See "Next.js 15 Migration" subsection below for full detail. |

**OWASP-relevant observations**: SQL injection risk is low — all queries
go through Drizzle's parameterized query builder, and the report builder
and automation engine both use explicit field whitelists rather than
dynamic SQL (verified by reading lib/reportDatasets.ts and
lib/automation.ts). The two biggest real gaps for a public-facing
deployment are missing rate limiting and the pending dependency upgrade.

---

### Rate Limiting — how it works, and its real limitation

`/api/auth/login` and `/api/auth/signup` are rate-limited as of this pass.
The implementation (`lib/rateLimit.ts`) is a small, dependency-free,
in-memory fixed-window counter — no Redis, no external service, matching
the constraint against adding infrastructure this project doesn't already
have.

**Limits configured**:
- Login, per IP: 10 attempts / 15 minutes
- Login, per email (case-insensitive): 5 attempts / 15 minutes — protects
  one targeted account even if the attacker rotates IPs, checked in
  addition to the IP limit, not instead of it
- Signup, per IP: 5 attempts / hour — tighter, since each call creates a
  real tenant + admin + warehouse, a more expensive and more abuse-prone
  operation than a login attempt

Every attempt counts toward its window regardless of outcome — a
successful login consumes one unit exactly like a failed one does. This is
deliberate: the goal is bounding the *rate* of requests to a sensitive
endpoint, not just failures, which is both simpler and safer against a
mixed success/failure credential-stuffing pattern. A blocked request
receives HTTP 429 with a `Retry-After` header (seconds) and a JSON body:
`{"error": "Too many login attempts. Please try again later."}`.

**Client IP is read from `X-Forwarded-For`** (first address in the list),
falling back to `X-Real-IP`, falling back to a shared `"unknown"` bucket
if neither header is present. In this app's intended deployment topology
(behind a reverse proxy — see Section D), the proxy always sets
`X-Forwarded-For` accurately for every request it forwards, so the
`"unknown"` fallback should only ever be hit in local development (no
proxy in front) or if the proxy is misconfigured — which is itself worth
alerting on, since a misconfigured proxy also breaks the `secure` cookie
logic (Section E).

**The real limitation, stated plainly**: this store is a plain in-memory
`Map`, local to a single Node process. It resets on every restart or
deploy, and — this is the important part — **if this app ever runs as
more than one instance behind a load balancer, each instance has its own
independent counters.** The effective limit becomes (configured limit ×
number of instances), not the configured limit. For a single-instance
deployment (the realistic starting point per Section G), this is a
genuine, working protection. The moment you scale horizontally, it stops
being one.

**The correct fix at that point** is a distributed store — Redis via a
library like `@upstash/ratelimit` or `ioredis` plus a small sliding-window
implementation, or your platform's built-in rate limiting if it offers
one (some managed hosts and CDNs do, at the edge, before a request even
reaches this app). That work is deliberately not done here, per the
constraint against introducing infrastructure the project doesn't already
have — but it should be treated as a real prerequisite for scaling past
one instance, not an optional nice-to-have.

### Logging & Observability — what's covered, and what isn't

As of this pass, this app emits structured JSON log lines to
stdout/stderr for a specific set of security- and operations-relevant
events — no logging platform, no external dependency. `lib/logger.ts` is
the shared helper; every event goes through one of its narrowly-typed
functions (`logLoginSuccess`, `logLoginFailure`, `logRateLimitHit`,
`logSignupSuccess`, `logSignupFailure`, `logTenantSwitchSuccess`,
`logTenantSwitchFailure`, `logHealthCheckFailure`, `logScriptEvent`) —
none of them has a parameter for a password, token, cookie, or connection
string, so there's no accidental path to logging one. A denylist-based
redaction inside the shared `emit()` function is a second, independent
layer underneath that — verified directly in `tests/unit/logger.test.ts`
by deliberately bypassing the type system to prove the redaction still
catches a forbidden-looking field name, not just trusting the types alone.

**Format**: one JSON object per line —
`{"timestamp": "...", "level": "info"|"warn"|"error", "event": "...", ...safe fields}`.
This is deliberately the same format a log aggregator would want to
`JSON.parse()` off stdout — every major hosting platform (Railway,
Render, ECS, Kubernetes) already captures a process's stdout/stderr and
forwards it to its own log viewer, so writing structured JSON there is
the zero-infrastructure way to make that already-captured output
searchable and filterable without this app needing to know anything about
where its logs actually end up.

**Events currently covered**: login success/failure (with reason —
`invalid_credentials`, `rate_limited_ip`, `rate_limited_email`, but never
the attempted password), rate limit hits (which limit, which IP/email,
retry-after), signup success/failure (with reason —
`validation_error`, `email_already_registered`, `rate_limited`), Company
Switcher success (logs both the home tenant and the effective/switched-to
tenant) and failure (with a specific reason — `not_platform_admin`,
`not_authorized_for_tenant`, `tenant_not_found`, etc., not just a generic
"denied"), health check failures only (success is deliberately silent —
a health check polled every few seconds logging every success would be
pure noise for no diagnostic benefit), and backup/restore/seed script
start/success/failure (in addition to, not instead of, those scripts'
existing human-readable console output for someone running them
interactively).

**What's explicitly NOT covered, stated plainly**: every other route in
this application — orders, trips, billing, invoices, the executive
dashboard, and everything else — has zero logging. A failure in any of
those surfaces only as whatever Next.js's own default error handling
does with an unhandled exception, not as a structured event. This pass
covers the events most directly relevant to security and account access,
not general application observability. There is also no external error-
tracking/alerting service (Sentry or similar) — these logs are only
useful if something is actually reading them (via your hosting
platform's log viewer, or piping them into a log aggregation service);
nothing here pages anyone or raises an alert on its own.

**Recommended production log handling**: forward stdout/stderr to
whatever your hosting platform already provides (most managed Node
hosts have a built-in log viewer with retention) or a lightweight log
aggregation service if you want log-based alerting. Because every line
is a single JSON object, this requires no parsing logic on your end
beyond what any JSON-aware log viewer already does — filter on
`"level":"error"` or a specific `"event"` value to build a basic alert
rule.

### Next.js 15 Migration — what changed, what didn't, and what was found

Migrated `next` from `14.2.35` to `15.5.24` and `eslint-config-next` to
the matching `15.5.24`, specifically to resolve 5 high-severity CVEs
present in the old pinned Next.js version (RSC deserialization DoS, HTTP
request smuggling in rewrites, cache poisoning, XSS via CSP nonces, and
SSRF variants). **React, ReactDOM, TypeScript, ESLint, Drizzle,
Tailwind, and Vitest were all deliberately left unchanged** —
`next@15.5.24`'s own peer dependency range accepts `react: ^18.2.0`, so
no React major-version upgrade was needed, and every other dependency
was confirmed (via its published peer dependencies, not assumed) to have
zero coupling to Next or React versions.

**A compatibility inspection was done first**, before touching any
dependency, to scope the actual blast radius rather than guessing. It
found this app's architecture happens to sidestep almost the entire
breaking-change surface that makes most Next 14→15 migrations painful:
every page is a Client Component (no page ever consumes `params` or
`searchParams` as props — the actual breaking-change surface for pages),
there's no usage anywhere of `next/headers`' `cookies()`/`headers()`/
`draftMode()` (this app's cookie handling goes through `NextRequest`/
`NextResponse` instance methods, an entirely different, unaffected API
surface), every one of the 63 Route Handlers already declared
`export const dynamic = "force-dynamic"` (making Next 15's Route Handler
caching-default flip a non-issue), and there's zero usage of Server
Actions, `next/image`, or any React-19-specific API.

**The one real breaking change this app was exposed to**: Route Handler
`params` became a `Promise` in Next 15. This affected 24 files (31
handler functions across GET/POST/PATCH/DELETE) — every dynamic-segment
route (`[id]`, `[stopId]`, `[invoiceId]`, `[recordId]`, `[tyreId]`).
Fixed mechanically: signature changed from `{ params }: { params: { id:
string } }` to `{ params }: { params: Promise<{ id: string }> }`, with
`const { id } = await params;` as the first line of the function body,
replacing in-body `params.id` references with the destructured variable.

**A real bug the mechanical fix would have introduced, caught by the
build, not by luck**: in 5 files (`customers/[id]/locations`,
`invoices/[id]/credit-notes`, `vehicles/[id]/fuel`,
`vehicles/[id]/maintenance`, `vehicles/[id]/tyres`), the route's own
`[id]` segment shares its name with a locally-generated `const id =
genId()` used for a *new* child record being created in a POST handler
(e.g. a new fuel log's own id, vs. the vehicle id it belongs to). A
naive `const { id } = await params` collided with that, and — before
being caught — `next build` correctly refused to compile it as a
duplicate declaration. Left uncaught, the underlying bug would have been
worse than a compile error: in the original code, `vehicleId: id` inside
the insert would have silently written the *new record's own id* as the
foreign key instead of the actual vehicle id, corrupting the
relationship. Each of the 5 files was fixed by renaming the destructured
route parameter (e.g. `const { id: vehicleId } = await params`) rather
than the generated one, and the fix was verified live — not just
compiled — by creating a real fuel log via the API and confirming its
`vehicleId` field matched the target vehicle, not a self-referential or
corrupted value.

**No test files were modified.** The 76 call sites across 14 test files
that pass a plain `{ params: { id: "..." } }` object directly to route
handlers continue to work unchanged: `await` on a non-Promise value
resolves immediately in JavaScript, so passing a plain object where a
`Promise` is now typed works correctly at runtime. This was confirmed
empirically (a real concern flagged during the compatibility inspection,
not assumed safe) — `next build`'s type-checker does not reach into
`tests/**`, so no type mismatch ever surfaced there either.

**Verification performed**: `npm run build` (clean), `npm run lint`
(clean — the legacy `.eslintrc.json` format continues to work, exactly
as `eslint-config-next@15.5.24`'s own peer range predicted), the full
215-test suite (215/215, identical to the pre-migration baseline, run
twice for stability), a real production-mode (`next start`,
`NODE_ENV=production`) smoke test covering login, tenant isolation
(including a deliberate query-param-tampering attempt), the Company
Switcher (a real switch between two tenants), the Executive Dashboard,
rate limiting (11 rapid login attempts, confirmed the 11th returns 429),
and — as described above — a real API call proving the exact bug class
that was found and fixed is genuinely correct now, not just compiling.

**A `next lint` deprecation notice appeared** ("`next lint` is deprecated
and will be removed in Next.js 16... migrate to the ESLint CLI") — this
is informational only, does not fail the build or lint command, and was
not acted on, since migrating the lint invocation is unrelated to this
security migration and this app is deliberately staying on the 15.x
line, not moving to 16.

---

## F. Integration Readiness

| Integration | Status | Notes |
|---|---|---|
| ERP / Odoo | Real client, unverified live | lib/erp/odoo.ts implements Odoo's documented JSON-RPC protocol correctly (unit-tested against a mock) but has never run against a real Odoo server — none was reachable while building this. Use the in-app "Test connection" button before relying on it. |
| GPS / Telematics | Simulated | No hardware integration. Driver app interpolates a fake position client-side. Needs real hardware or a navigator.geolocation.watchPosition() swap-in. |
| Maps (Google) | Real, needs credentials | Genuinely calls the Directions API and Maps JS SDK. |
| WASL / TGA | Not started | Not referenced in the original BRD or anywhere in this codebase. Needs dedicated vendor research if targeting Saudi regulatory compliance. |
| SMS | Not started | No provider integrated. "Notified" flags are simulated booleans, documented as such in code. |
| WhatsApp | Not started | No integration. |
| Email | Not started | No provider integrated anywhere. |
| Payment | Not started | ONLINE exists as a payment-method label only; no gateway is called. |
| Fuel cards | Not started | Fuel logs are manually entered; no provider API. |
| File / receipt storage | Not started | No blob storage configured. ePOD and expense receipts are text-only fields. |

---

## G. Deployment Options

### Simple VPS (recommended starting point)

Standard Next.js app plus Postgres, no unusual runtime requirements:

```
git clone <your-repo>
cd water-fleet-platform
npm ci
cp .env.example .env.local
npm run db:migrate
npm run build
```

Run `npm run start` under a process manager (pm2 or systemd — neither is
currently configured in this repo; you'll need to write one) so it
restarts on crash/reboot. Put nginx or Caddy in front for TLS and to
proxy to whatever port next start listens on.

### Docker

**Docker support in this repo is for the local Postgres database only —
there is no Dockerfile for the app itself.** docker-compose.yml exists
purely for local dev convenience (`docker compose up -d`); it does not
build or run the Next.js app. Containerizing the app is new work not done
here — Next.js supports an `output: "standalone"` build mode for a lean
image, which next.config.js does not currently enable.

### Managed Node hosting (Railway, Render, Fly.io, etc.)

Likely the lowest-effort real deployment path given the current repo
state — these platforms generally auto-detect Next.js and run `npm run
build`/`npm run start` directly, no Dockerfile needed. Point the
platform's health check at /api/health (added in this pass). You'll still
need a separate managed Postgres instance.

### Cloud deployment (AWS/GCP/Azure)

Viable but more setup; nothing in this repo is provider-specific (no
CDK/Terraform/ARM templates exist).

### Database hosting

Any managed Postgres 16-compatible provider works — no
provider-specific dependencies exist. Neon, Supabase, Railway Postgres,
and RDS are all compatible.

---

## H. Staging Go-Live Checklist

- [ ] Fresh clone on the target server
- [ ] `npm ci`
- [ ] Copy .env.example to .env.local (or set equivalent platform env vars); fill in DATABASE_URL at minimum
- [ ] Create the production database (DATABASE_URL_TEST is test-only, not needed in production)
- [ ] `npm run db:migrate` against the production database
- [ ] Decide deliberately whether to run `npm run db:seed` — appropriate for staging demos, never for a production database with real customers
- [ ] `npm run build`
- [ ] Start the app under a process manager or your platform's start mechanism
- [ ] Login smoke test: confirm redirect to /admin and tenant data loads
- [ ] Tenant switch smoke test (staging only, platform-admin@fleetops-demo.co): confirm the "Viewing:" dropdown appears, switch tenants, confirm /api/tenant and /api/customers both reflect the switch, then switch back
- [ ] Executive dashboard smoke test: KPIs load without error (all-zero on a fresh database is correct, not a bug)
- [ ] API smoke test: GET /api/health returns 200 {"status":"ok"}
- [ ] Take a manual backup with `npm run db:backup` before this deployment touches any existing data, and confirm your hosting provider's automated Postgres backup is also enabled (see BACKUP_RESTORE.md)

**See [STAGING_REPORT.md](./STAGING_REPORT.md)** for a full run-through of
every item on this checklist verified against a real production-mode
build — an honest account of what was and wasn't possible to verify
without an actual external hosting account (this environment has no
network access to any hosting platform), plus the exact step-by-step
procedure to complete a real deployment.

---

## I. Production Blockers

### P0 — before any real production deployment

1. ~~No backup strategy configured~~ **Partially resolved**: `npm run db:backup`/`npm run db:restore` exist and were verified end-to-end (backup → restore into a separate database → confirmed row counts, migration state, and a real login all matched — see Section J and BACKUP_RESTORE.md). **Still required before go-live**: confirm your hosting provider's own automated/managed backup is enabled — these scripts are a tested manual safety net, not a replacement for provider-managed backups running on a schedule without a human remembering to run them.
2. ~~Dependency vulnerabilities, 5 high severity, largely from pinned Next.js 14.2.35~~ **Resolved**: migrated to next@15.5.24 — the 5 high-severity Next.js CVEs and the eslint-config-next `glob` finding are gone. **Remaining, not blocking**: 1 high-severity finding is Next's own internally-bundled `postcss@8.4.31` (build-time-only, no fix available in any current 15.5.x release); 4 moderate findings are a pre-existing, unrelated `esbuild`-via-`drizzle-kit` dev-server-only issue. See "Next.js 15 Migration" below.
3. ~~No rate limiting anywhere~~ **Resolved**: /api/auth/login and /api/auth/signup are now rate-limited (see the "Rate Limiting" subsection below) — but it's in-memory, single-instance only; re-evaluate before running more than one instance (P1 item 10 below).
4. No production tenant-bootstrap script — use /signup for the first real company, never the demo seed script.
5. HTTPS is not enforced by the app itself — must be handled by your reverse proxy; verify this before go-live, since cookies won't be sent over plain HTTP once `secure` is set.

### P1 — before first real customer

6. ~~No structured logging or error tracking~~ **Partially resolved**: auth, rate limiting, Company Switcher, health checks, and backup/restore/seed now emit structured JSON logs (see "Logging & Observability" subsection below). **Still a gap**: no logging on most other routes (orders, trips, billing, etc.), and no external error-tracking service (Sentry or similar) to alert on failures — this is observable-if-you're-watching-logs, not alerting.
7. ERP sync has never been verified against a live Odoo instance.
8. No security headers configured (CSP, X-Frame-Options, etc.) beyond Next.js defaults.
9. No `engines` field in package.json.
10. **Rate limiting is in-memory and single-instance only** (see the "Rate Limiting" subsection below) — if this app ever scales horizontally to more than one instance behind a load balancer, move to a distributed store before that happens, not after.

### P2 — after launch

11. Every integration marked "Not started" in Section F (SMS, WhatsApp, email, payment, fuel cards, file storage, WASL/TGA).
12. Docker support for the app itself.
13. A dedicated clean-slate environment reset script.

---

## J. Commands Verification

Every command below was run fresh, from a clean node_modules/.next state,
against a brand-new Postgres database, while writing this document.

| # | Command | Result |
|---|---|---|
| 1 | npm ci | Succeeded. 9 known vulnerabilities reported (4 moderate, 5 high) |
| 2 | npm run lint | Zero warnings or errors |
| 3 | npm run db:migrate (fresh DB) | All 11 migrations applied cleanly |
| 4 | npm run db:seed (freshly migrated DB) | Succeeded, both demo tenants created |
| 5 | npm run build | Succeeded (includes type-checking + lint) |
| 6 | npm test | 181/181 passed, 28 test files |
| 7 | npm run start, NODE_ENV=production, custom PORT | Started correctly, bound to specified port |
| 8 | Live smoke test: /, /login, real login, /api/tenant, /admin | All returned expected status codes and data |
| 9 | GET /api/health, database up | HTTP 200, status ok |
| 10 | GET /api/health, database stopped | HTTP 503, status error — genuinely detects the outage |
| 11 | Live rate-limit smoke test: 11 rapid login attempts from one simulated IP against the running dev server | First 10 resolved normally (401 for wrong credentials), 11th returned HTTP 429 with `Retry-After: 900` |
| 12 | Live rate-limit smoke test: a different simulated IP immediately after | Unaffected — HTTP 200 |
| 13 | Live rate-limit smoke test: 6 signups from one simulated IP (limit 5/hour) | First 5 succeeded (201), 6th returned 429 |
| 14 | `npm run db:backup` against the seeded dev database | Succeeded — produced a 118-TOC-entry custom-format dump, confirmed valid via `pg_restore --list` |
| 15 | `npm run db:restore` of that backup into a separate, freshly-created database | Exit code 0; row counts for tenants/users/customers/vehicles matched the source exactly; the platform admin user and its `platform_admin_tenant_grants` row survived; Drizzle's migration-tracking table showed all 11 migrations |
| 16 | Real login + `/api/tenant` + `/admin` against the *restored* database (not the original) | All succeeded — proves the restore is functionally usable, not just structurally present |
| 17 | `npm run db:seed` with `NODE_ENV=production`, no override | Correctly refused, exit code 1, clear message |
| 18 | `npm run db:seed` with `NODE_ENV=production` and `ALLOW_SEED_IN_PRODUCTION=true` | Correctly proceeded and seeded |
| 19 | `npm run db:restore` with the confirmation prompt answered "no" | Correctly aborted, exit code 1, no changes made |
| 20 | Real login + failed login against the running dev server with a real `X-Forwarded-For` header, then grep the server's actual stdout | Found genuine `auth.login.success` and `auth.login.failure` JSON lines with the correct real IP; the wrong password used in the failed attempt did not appear anywhere in the output |
| 21 | Health check with database up, then genuinely stopped, then hit again, then grep stdout | Success produced no log line (by design); the real outage produced a `health_check.failure` line with a safe message (`connect ECONNREFUSED ...`) — no credentials, no connection string |
| 22 | `npm install next@15.5.24 eslint-config-next@15.5.24 --save-exact` | Succeeded with no `--force`/`--legacy-peer-deps` needed — React 18.3.1 confirmed unchanged in the resulting package.json |
| 23 | `npm run build` immediately after the version bump, before any code changes | Failed as expected — Route Handler `params` type errors across dynamic-segment routes, confirming the compatibility inspection's prediction |
| 24 | `npm run build` after fixing all 24 dynamic route files | Failed again — 5 files had a naming collision the mechanical fix introduced (see "Next.js 15 Migration" above) |
| 25 | `npm run build` after fixing the 5 collisions | Clean — all 63 routes compiled, all pages generated |
| 26 | `npm run lint` post-upgrade | Zero warnings/errors; confirmed the legacy `.eslintrc.json` format works unchanged |
| 27 | `npm test` post-upgrade, run twice | 215/215 both times, identical to the pre-migration baseline — zero test files modified |
| 28 | `npm audit` post-upgrade | 6 vulnerabilities (5 moderate, 1 high), down from 9 (4 moderate, 5 high) — full breakdown in the "Next.js 15 Migration" subsection |
| 29 | Production-mode (`next start`, `NODE_ENV=production`) smoke test: login, tenant-isolation tampering attempt, Company Switcher, Executive Dashboard, a `params`-Promise-fixed dynamic route, rate limiting (11 attempts → 429) | All passed live against the real running server |
| 30 | Real API call creating a fuel log via a `params`-Promise-fixed route, checking the returned `vehicleId` | Matched the target vehicle exactly — confirms the collision-bug fix is correct in practice, not just compiling |

**Fixes made in the original deployment-readiness pass** (both minimal,
both required for a safe deployment, neither changes business
functionality):

- Added `secure: process.env.NODE_ENV === "production"` to all 5
  session/switch-cookie call sites across app/api/auth/login/route.ts (x2),
  app/api/auth/signup/route.ts, app/api/auth/logout/route.ts, and
  app/api/platform/switch-tenant/route.ts. Full test suite re-verified
  passing after this change.
- Added GET /api/health (app/api/health/route.ts) — did not exist before.
  Verified against both a live and a stopped database.

**Added in the follow-on rate-limiting pass**: `lib/rateLimit.ts` plus
its wiring into `/api/auth/login` and `/api/auth/signup` — see the "Rate
Limiting" subsection under Section E for full detail. 16 new tests (8
unit, 8 integration); the full suite (197 tests as of this pass) was
re-verified passing both before and after, including a dedicated rerun of
`tests/integration/tenant-isolation.test.ts` and
`tests/integration/company-switcher.test.ts` to confirm no interaction
with either.

**Added in the follow-on backup/restore pass**: `scripts/backup.ts`
(`npm run db:backup`), `scripts/restore.ts` (`npm run db:restore`), and a
production guard in `scripts/seed.ts` — see BACKUP_RESTORE.md for the
full strategy. No new automated tests were added for these (they shell
out to `pg_dump`/`pg_restore`, which is better proven by actually running
them than by mocking a subprocess call) — instead, rows 14-19 above
document a real backup → restore-into-a-separate-database →
functional-login verification, plus both the seed guard and the restore
confirmation prompt tested in both their allow and deny paths. The
existing 197-test suite was re-verified passing unchanged, since none of
this touches application code paths the tests exercise.

**Added in the follow-on logging pass**: `lib/logger.ts` plus its wiring
into login, signup, rate limiting, the Company Switcher, health checks,
and the backup/restore/seed scripts — see the "Logging & Observability"
subsection under Section E for full detail on what's covered and what
isn't. 18 new tests (12 unit — including one that deliberately bypasses
TypeScript to prove the redaction backstop works even when a caller
ignores the types, not just when they cooperate with them — and 6
integration, proving events fire from the real routes with real
session/tenant data). Rows 20-21 above document live verification against
the actual running server's stdout, not just spied-on test output. The
full suite (215 tests as of this pass) was re-verified passing both
before and after.

**Added in the follow-on Next.js 15 migration pass**: `next` and
`eslint-config-next` bumped to `15.5.24`; 24 Route Handler files updated
for the `params`-Promise breaking change; a real naming-collision bug the
mechanical fix would have introduced was found and corrected in 5 of
those files (full detail in the "Next.js 15 Migration" subsection under
Section E). No new automated tests were added — the fix is mechanical and
its correctness was proven instead by the full existing suite passing
unchanged (215/215) plus a real, live API call verifying the exact
corrected field. Rows 22-30 above document the complete before/during/
after verification sequence, including two build failures encountered
and resolved along the way (not hidden). React, ReactDOM, TypeScript,
ESLint, Drizzle, Tailwind, and Vitest were all confirmed unchanged.

**Added in the follow-on Google Maps configuration pass**: no application
code changed — `lib/googleMaps.ts` and `components/LiveMap.tsx` were
already correctly built and already degrade gracefully without a key
(confirmed by re-reading both files line by line, not assumed). What was
missing was test coverage for the actual *successful* API-response path:
every existing test hit either the no-key or single-stop fallback, so a
real bug in parsing `waypoint_order` or summing leg durations could have
shipped undetected. 3 new tests in `tests/unit/googleMaps.test.ts` close
this — a mocked realistic success response, a mocked non-OK API status,
and a mocked network failure, all verified passing. `STAGING_REPORT.md`
gained a full "Configuring real Google Maps on Railway" section (12a)
with exact steps and a verification method that needed no new code, since
`estimatedDurationMinutes` being non-null on a real trip is already a
reliable, existing signal that a real API call succeeded. Full suite
(221 tests as of this pass) reverified passing. No API key was available
in this environment to test against the real Google API end-to-end —
that verification is documented precisely for you to perform once real
keys are in Railway's Variables tab.

The table above reflects the final state after all of these changes,
re-verified end to end.
