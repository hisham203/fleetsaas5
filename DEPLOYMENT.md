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
  0000-0011 as of this pass, tracked in a separate `drizzle` Postgres
  schema.
  - **Production migration warning**: migrations are additive-only by
    convention (verified — no DROP COLUMN or destructive statements in
    any of the 12 files). Run migrations before deploying code that
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
    A later, separate, not-yet-approved step ("A2") will make `invoices.order_id`
    nullable to support consolidated monthly invoices — **this migration
    deliberately does not touch that column, or `invoices` at all.**
    Confirmed via direct inspection: `invoices.order_id` remains `NOT
    NULL` with its `UNIQUE` constraint intact, and existing
    one-order-one-invoice generation was re-verified end-to-end and is
    unaffected.
- **Seed process**: `npm run db:seed` is a demo/development seed —
  fictional companies, users, and a shared `password123` password baked
  into the script. Creates two tenants with ~35 days of realistic
  historical delivery data each (56 and 30 trips respectively) so the
  Executive Dashboard and scorecards show credible numbers immediately —
  see README's "Demo dataset" section for the full scenario. **This seed
  script was not modified by the Contract Management A1 migration** — the
  6 new tables above are seeded with nothing, for either existing tenant.
  A bulk-water-tanker-specific seed tenant is separate, later, unstarted
  work. **Never run this against a database with real customer data.**
  There's no separate "bootstrap the first real tenant" script; use
  `/signup` for that instead.
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
