# Staging Go-Live Report

**Date of this exercise**: as part of this development session, prior to
any real external hosting account being provisioned.

## Read this first — what this report is and isn't

This report is honest about a hard limitation: **the environment this
application was built in has no network access to any hosting platform**
(no Railway, Render, Vercel, Fly.io, AWS, or similar), no ability to
create external accounts, and no ability to obtain a real public domain
or TLS certificate. There is no hosting-provider integration available to
this environment at all — confirmed by checking for one before writing
this report, not assumed absent.

Because of that, **this report does not claim a real external staging URL
exists**, because it doesn't. What it does contain is a full, honest
verification of the application itself running under real production
conditions — genuine `next build`/`next start`, `NODE_ENV=production`, a
dedicated fresh PostgreSQL database used only for this exercise, bound for
external reachability — with every item on the required checklist run
against that real process. This proves the *application* is staging-ready.
It does not and cannot substitute for the account-creation, DNS, and TLS
steps that only someone with real hosting credentials can perform. Those
steps are laid out precisely below so they're a checklist, not a mystery.

---

## 1. Hosting provider / environment used

**No real external hosting provider was used — none is reachable from
this environment.** Verification was performed locally against a
dedicated, freshly-created PostgreSQL database (`fleet_ops_staging`,
separate from the development database) with the application built and
started in genuine production mode (`NODE_ENV=production`, `next build`
+ `next start`), bound to `0.0.0.0` to simulate external reachability.

**Recommended real target**: managed Node hosting (Railway, Render, or
Fly.io), per `DEPLOYMENT.md` Section G — these platforms auto-detect a
Next.js app and run `npm run build`/`npm run start` directly with no
Dockerfile needed, which is the lowest-effort real path given this
repo's current state (Docker support here covers local Postgres only).
Pair with a managed Postgres add-on from the same platform, or an
external provider (Neon, Supabase, Railway Postgres) — nothing in this
codebase is provider-specific.

## 2. Staging URL

**None exists.** No real external deployment was performed. Once a
hosting account is created and the steps in Section "How to complete
this for real" below are followed, the platform will assign a URL
(typically `https://<app-name>.<platform-domain>`, with automatic
HTTPS) — that URL should be recorded here once it exists.

## 3. Environment variables configured (names only, no values)

| Variable | Set for this exercise? |
|---|---|
| `DATABASE_URL` | Yes — pointed at the dedicated staging-simulation database |
| `NODE_ENV` | Yes — `production` |
| `GOOGLE_MAPS_API_KEY` | Not set — none was available in this environment; app degrades gracefully (route optimization falls back to selection order) |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Not set — same reason; live map falls back to a placeholder |
| `PORT` | Yes — set to a non-default port for this exercise |
| `ALLOW_SEED_IN_PRODUCTION` | Yes — set to `true` specifically to seed this staging database (see Section 6) |

No `.env` file was created or committed with real values; every variable
was set as a shell environment variable for the duration of this
exercise only.

## 4. Database setup

A new, dedicated PostgreSQL database was created specifically for this
exercise, separate from the development and test databases used
elsewhere in this project. This mirrors what a real staging deployment
should do: a genuinely separate database instance, not a schema shared
with development.

## 5. Migration result

`npm run db:migrate` run against the fresh staging database: **succeeded
cleanly, all 11 migrations applied**, matching the migration count in
the development database exactly.

## 6. Seed / demo data result

Seeded deliberately, since this is explicitly a non-production staging
database. Staging correctly runs with `NODE_ENV=production` (to get
accurate production behavior — secure cookies, the production build) —
which means `scripts/seed.ts`'s production guard (added during the
backup/restore hardening pass) correctly required its explicit
`ALLOW_SEED_IN_PRODUCTION=true` override before proceeding. **This is
the exact scenario that guard was designed to accommodate** (a
disposable pre-launch environment with `NODE_ENV=production` set) — not
a workaround, the intended path. Seed completed successfully, creating
both demo tenants.

**Update (Clean Demo Dataset pass)**: `scripts/seedData.ts` was
substantially rewritten after this report was first written — both
tenants now come with ~35 days of realistic historical delivery data
(56 and 30 completed/failed trips respectively) instead of only live
pending orders, specifically so the Executive Dashboard shows credible
non-zero KPIs out of the box. Full scenario detail is in README's "Demo
dataset" section. The reseed commands in the "How to complete this for
real" section below have been updated accordingly — if your Railway
staging database already has the older, thinner seed applied, it needs
a full wipe-and-reseed (not just re-running `db:seed`, which fails on
duplicate-key constraints against already-seeded data) to pick up the
richer dataset.

**Update (Tasks & Expenses demo data pass)**: the Go-Live Product Audit
found BR-23 (Task, Expense & Field Activity Management) fully built in
code but seeded with zero demo data — the Field Ops tab showed "No tasks
assigned yet" on first login despite the feature working correctly.
`scripts/seedData.ts` now seeds 10 tasks and 10 expenses for Demo Water
Co. and 8 of each for Acme, with realistic mixed statuses (including a
genuine trip-linked "failed delivery follow-up" example, not just a
plausible-sounding label) — verified via the real API, not just row
counts. This is included in the same seed run as everything else, so
**no additional reseed step is needed beyond the wipe-and-reseed above**
if you're already applying the richer dataset for the first time; if
you already reseeded for the Clean Demo Dataset pass specifically and
want just the tasks/expenses addition, the same wipe-and-reseed sequence
applies (there is no incremental/partial seed option).

## 7. Build / start result

- `npm run build`: **succeeded**, all 63 API routes and 8 pages
  compiled/generated cleanly.
- `npm run start -- -H 0.0.0.0`: **succeeded**, server ready in 387ms,
  bound for external reachability (not just `localhost`).

## 8. Smoke test results

Every item run against the real, running, production-mode process:

| Check | Result |
|---|---|
| `GET /api/health` | `{"status":"ok","database":"connected"}`, HTTP 200 |
| Login (`admin@demo-water.co`) | Succeeded, correct role/name returned |
| `GET /admin` | HTTP 200 |
| Tenant isolation (query-param tampering: Acme requesting Water Co.'s tenant ID as a parameter) | Correctly ignored — Acme saw only its own customer, no leak |
| Company Switcher (platform admin switching into Acme) | Succeeded — `/api/tenant` correctly reflected the switched-to company afterward |
| Executive Dashboard | Loaded real staging-seeded KPI data, including a non-zero `activeVehicleCount` |
| Rate limiting (11 rapid login attempts, one simulated IP) | First 10 resolved normally (401), 11th correctly returned 429 |

## 9. HTTPS / cookie verification

**Cookie security attributes: verified and correct.** The session cookie
returned on login carried `Secure; HttpOnly; SameSite=lax` — confirmed
by inspecting the raw `Set-Cookie` response header, not assumed. This
confirms the `secure` flag (added during the deployment-readiness
hardening pass, conditioned on `NODE_ENV=production`) is genuinely
active under real production settings.

**HTTPS transport itself: not verifiable from this environment**, and
this report does not claim otherwise. This app does not terminate TLS
itself (documented in `DEPLOYMENT.md` Section D) — that's the job of the
hosting platform or a reverse proxy in front of it. Once deployed to a
real host with HTTPS (automatic on Railway/Render/Vercel-style
platforms, or via your own nginx/Caddy + Let's Encrypt on a VPS), the
`Secure` attribute already confirmed above means the browser will
correctly refuse to send the session cookie over any accidental plain-
HTTP connection — this is the correct, verified behavior; only the
transport layer itself needs a human to provision.

## 10. Logging verification

**Confirmed genuinely visible.** Real structured JSON log lines
appeared on the server's stdout during this exercise — including
`auth.login.success`, `auth.login.failure`, and `tenant_switch.success`
events with correct real data (the actual home tenant and
effective/switched-to tenant IDs on the switch event). Grepped the full
captured output for `password`, `secret`, and `postgres(ql)://` — found
**zero matches**, confirming no secrets leaked into the logs during this
exercise. On any real managed hosting platform (Railway, Render, ECS,
Kubernetes), this stdout output is captured automatically and shown in
that platform's own log viewer — this is Next.js/Node's standard
behavior, not something specific to this app that needs separate
configuration.

## 11. Backup readiness

`npm run db:backup` was run directly against the staging-simulation
database and produced a genuine, valid custom-format dump (confirmed via
`pg_restore --list`, showing 115 real TOC entries). This confirms the
backup tooling works correctly against a staging-shaped database, not
just the development one.

**For a real hosted staging environment**, per `BACKUP_RESTORE.md`: if
using a managed Postgres provider (RDS, Neon, Supabase, Railway
Postgres), prefer that provider's own automated/scheduled backup feature
as the primary strategy — `npm run db:backup` is a genuine, working
manual safety net and the tool used for restore-verification, not a
replacement for scheduled, provider-managed backups.

## 12. Remaining staging blockers

1. **No real hosting account exists yet.** This is the actual blocker —
   everything downstream of it (a real URL, real HTTPS, a real
   externally-reachable database) depends on a human creating one. See
   "How to complete this for real" below for the exact steps.
2. **No Google Maps API key was available** in this environment. The app
   works correctly without one (confirmed — route optimization and the
   live map both degrade gracefully), but route optimization and the
   live vehicle map won't show their full functionality in a real
   staging demo without one. **See the dedicated section below for exact
   Railway configuration and verification steps** — this environment has
   no Google Cloud account access either, so obtaining and entering the
   actual key values is a step only you can perform.
3. Every item already listed as a P0/P1 blocker in `DEPLOYMENT.md`
   still applies once real hosting exists (confirm the platform's own
   backup feature is enabled, the dependency vulnerabilities noted
   there, no structured logging outside auth/security routes, etc.) —
   this exercise didn't change any of those, and doesn't re-litigate
   them here.

## 12a. Configuring real Google Maps on Railway

Two **independent** environment variables, each optional on its own —
you can set either without the other, and each degrades gracefully if
missing (confirmed by the existing test suite and by direct code
inspection, not assumed):

| Variable | Purpose | What breaks without it | Where it's read |
|---|---|---|---|
| `GOOGLE_MAPS_API_KEY` | Server-side — calls the Directions API to optimize multi-stop trip order and compute an ETA (BR-06) | Trips still create fine; stops just keep their original (unoptimized) order and no ETA is shown | `lib/googleMaps.ts`, never sent to the browser |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Browser-side — loads the Maps JavaScript SDK for the Dispatcher console's live vehicle map (BR-12) | The map area shows a plain text placeholder instead of an interactive map; nothing else is affected | `components/LiveMap.tsx` — **this one is compiled into client-side JS and visible to anyone who views page source, by Next.js's own `NEXT_PUBLIC_` design.** This is expected, not a leak — restrict it via HTTP referrer in Google Cloud Console rather than treating it as secret. `GOOGLE_MAPS_API_KEY` (no `NEXT_PUBLIC_` prefix) must never be used for this purpose. |

**Exact Railway steps:**

1. In Google Cloud Console, create (or reuse) a project with the
   **Directions API** and **Maps JavaScript API** enabled, and generate
   an API key for each purpose (or one key enabled for both, if you
   prefer — Google allows this; just apply an HTTP referrer restriction
   to whichever key you use client-side).
2. In your Railway project, open the web app service → **Variables** tab.
3. Add `GOOGLE_MAPS_API_KEY` with the server-side key's real value.
4. Add `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` with the browser-side key's
   real value.
5. **Never paste either value into a commit, a Slack message, this chat,
   or a screenshot.** Railway's Variables tab is the only place these
   values should exist outside Google Cloud Console itself.
6. Redeploy (Railway redeploys automatically on a variable change for
   most setups; trigger one manually if it doesn't).

**Verifying it actually worked (no code change needed for this — the
signal already exists in the data)**:

- **Route optimization**: create a trip with 2+ stops via the Dispatcher
  console (or `POST /api/trips` directly), then check the created trip's
  `estimatedDurationMinutes` field. `null` means it's still falling back;
  a real number means a genuine Directions API call succeeded. This is
  already documented in README's "Trying authentication, route
  optimization, and live tracking" section — the same check applies here,
  just against the real Railway URL instead of localhost.
- **Live map**: open the Dispatcher console after dispatching a trip —
  an interactive map with a moving vehicle marker means the browser key
  works; the placeholder text means it's still missing or misconfigured
  (e.g., an HTTP referrer restriction that doesn't include your actual
  Railway domain).
- **No key leakage**: confirm via your browser's dev tools Network tab
  that `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` appears only in the expected
  `maps.googleapis.com/maps/api/js?key=...` script request (expected,
  by design) and that `GOOGLE_MAPS_API_KEY` never appears in any
  browser-visible request at all — it's server-side only. Check
  Railway's log viewer for the same deploy and confirm neither key
  appears in any log line (confirmed by direct code inspection that
  nothing in `lib/googleMaps.ts` or `components/LiveMap.tsx` logs
  anything at all, so there's no code path that could leak either key
  into logs).

## 13. Recommendation

**Not yet demo-ready or pilot-ready, for exactly one reason: no real
hosting account has been created.** Every other acceptance criterion —
application correctness, tenant isolation, Company Switcher, Executive
Dashboard, rate limiting, secure cookies, backup tooling, structured
logging — is verified and working under real production conditions.
Once a human completes the steps below (realistically 15-30 minutes on
Railway or Render, most of it waiting for the first build), this becomes
**demo-ready** immediately, and **pilot-ready** once the P0 items already
tracked in `DEPLOYMENT.md` (confirming provider-managed backups, the
still-open dependency findings) are addressed.

---

## How to complete this for real

1. Create an account on your chosen platform (Railway or Render
   recommended per `DEPLOYMENT.md` Section G).
2. Connect this repository (or push it to a Git provider first if it
   isn't already).
3. Provision a managed Postgres instance on the same platform (or an
   external provider like Neon/Supabase) and copy its connection string.
4. Set the environment variables listed in Section 3 above, with real
   values, in the platform's dashboard — never in a committed file.
5. Deploy. The platform runs `npm ci`, `npm run build`, and `npm run
   start` automatically for a standard Next.js app.
6. Run `npm run db:migrate` against the new database (most platforms
   offer a one-off command/shell feature for this; alternatively run it
   from your own machine with `DATABASE_URL` pointed at the new
   database).
7. Decide deliberately whether to seed demo data (see Section 6 above
   for why the guard requires an explicit override) — appropriate for a
   staging environment used for demos, never for real customer data.

   **If this environment already has the older, thinner seed applied**
   (from before the Clean Demo Dataset pass), re-running `npm run
   db:seed` alone will fail on duplicate-key constraints — it doesn't
   wipe first. To pick up the richer dataset, wipe and reseed
   deliberately (via Railway's CLI, `railway run`, so these execute with
   the real staging `DATABASE_URL`):

   ```bash
   railway run bash -c "psql \$DATABASE_URL -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS drizzle CASCADE;'"
   railway run npm run db:migrate
   railway run bash -c "ALLOW_SEED_IN_PRODUCTION=true npm run db:seed"
   ```

   This is destructive to whatever's currently in that database — correct
   for a demo/staging environment with only seeded data in it, never run
   this against anything with real customer data.
8. Point the platform's health check at `/api/health`.
9. Re-run the exact smoke tests in Section 8 above against the real
   URL, and confirm HTTPS actually loads (`https://` in the browser,
   no certificate warning) — the one check this local exercise could
   not perform. Also confirm the Executive Dashboard for both tenants
   shows non-zero KPIs (see README's "Demo dataset" section for what to
   expect: roughly 2,600 SAR revenue for Demo Water Co., roughly 20,000
   SAR for Acme).
10. Record the resulting URL in Section 2 above.
