# Database Backup & Restore Strategy

This document is scoped to what this project actually has: a PostgreSQL
database, a Drizzle migration system, and — as of this pass — two small
npm scripts (`db:backup`, `db:restore`) that wrap the standard PostgreSQL
tools (`pg_dump`/`pg_restore`). It does not introduce paid infrastructure,
a backup service, or anything beyond what's needed to protect real data
before a public demo or pilot.

**Read this first, honestly**: for a real production deployment, your
managed Postgres provider's built-in automated backups (RDS snapshots,
Neon/Supabase/Railway's backup features, point-in-time recovery) are more
reliable than a manually-run script, and should be your primary strategy
— confirming they're actually enabled is a P0 item in `DEPLOYMENT.md`.
What's in this document is a genuine, tested manual/local safety net and
the process for actually restoring and verifying data when needed — not
a replacement for provider-managed backups.

---

## What was added

- `scripts/backup.ts` (`npm run db:backup`) — runs `pg_dump` against
  whatever `DATABASE_URL` currently points at, in custom format (`-Fc`:
  compressed, restorable with `pg_restore`), writing a timestamped file to
  `backups/` (gitignored — dumps can contain real customer data and must
  never be committed).
- `scripts/restore.ts` (`npm run db:restore -- <file>`) — runs
  `pg_restore --clean --if-exists` to load a dump file into whatever
  `DATABASE_URL` currently points at. **This is destructive** — see the
  Safety section below for exactly what protects against running it by
  mistake.
- A production guard added to `scripts/seed.ts` — see the "Never seed
  production" section below.

Both scripts read `DATABASE_URL` from the already-loaded environment
(same as every other script in this project) — the connection string
never needs to be typed as a separate flag, so it doesn't show up as an
extra token in shell history beyond what running the npm command itself
shows.

**Prerequisite**: `pg_dump`/`pg_restore` (part of the standard PostgreSQL
client tools) must be installed and on `PATH` wherever you run these
scripts. They're included with any Postgres server install and with the
`postgresql-client` package on Debian/Ubuntu; both scripts print a clear
error rather than a cryptic one if they're missing.

---

## Creating a manual backup

```bash
npm run db:backup
```

This writes `backups/backup-<ISO-timestamp>.dump`. **A backup that only
exists on the same machine as the database is not a real backup** — copy
it somewhere else (your own machine, S3/cloud storage, wherever) as part
of your actual process. This script creates the file; it does not upload
it anywhere.

For a staging/production server where you don't want to expose
`DATABASE_URL` in a `.env.local` file at all, you can also run `pg_dump`
directly with an explicit connection string, achieving the same result
without going through this repo's scripts:

```bash
pg_dump "postgresql://user:password@host:5432/dbname" -Fc -f backup.dump
```

---

## Restoring from a backup

```bash
npm run db:restore -- backups/backup-2026-08-31T19-16-09-291Z.dump
```

This prints exactly which database (password redacted) is about to be
overwritten and requires you to type `yes` before doing anything. For
scripted/CI use where no human is present to type a confirmation, pass
`--force` to skip the prompt — use this deliberately, not as a default
habit.

**What actually happens**: `pg_restore --clean --if-exists --no-owner`
drops existing objects before recreating them from the dump file, then
loads all data. Anything in the target database that isn't in the backup
file is gone afterward. This is why the confirmation step exists and is
not skippable except by an explicit flag.

A non-zero exit code from `pg_restore` is not automatically fatal —
`pg_restore` commonly reports warnings (e.g. a role that doesn't exist for
`--no-owner`, or nothing to drop on a first-ever restore) as a non-zero
exit even when the restore actually succeeded. **Always read the printed
output**, and always run the verification steps below — don't trust exit
code 0 alone, and don't panic at a non-zero one without reading what it
actually says.

---

## Verifying a restored database

Don't consider a restore trustworthy until you've checked it actually
worked. In order of increasing confidence:

1. **Row counts on a few key tables**, compared against what you expect:
   ```bash
   psql "$DATABASE_URL" -c "SELECT count(*) FROM tenants;"
   psql "$DATABASE_URL" -c "SELECT count(*) FROM users;"
   psql "$DATABASE_URL" -c "SELECT count(*) FROM orders;"
   ```
2. **Migration state matches** — confirm Drizzle's tracking table shows
   the same number of applied migrations as your source database:
   ```bash
   psql "$DATABASE_URL" -c "SELECT count(*) FROM drizzle.__drizzle_migrations;"
   ```
3. **The application actually works against it** — point `DATABASE_URL`
   at the restored database, start the app, and log in as a real user.
   This is the check that actually matters; the two above are fast
   sanity checks, this one proves the restore is genuinely usable, not
   just structurally present. This exact sequence (`npm run db:backup`,
   restore into a separate throwaway database, then a real login against
   it) was run as part of verifying this document — see `DEPLOYMENT.md`'s
   Section J for the results.

If you're restoring into a database that will be used for the Company
Switcher (`platform_admin_tenant_grants`), also confirm that table's row
count matches — it's easy to overlook since it's small and new.

---

## Staging vs production backups

This project seeds two demo tenants in any non-production environment
(see "Never seed production" below) — staging and production backups
should never be mixed up or restored into the wrong place:

- **Name backup files by environment**, not just by timestamp — e.g.
  `staging-backup-...` vs `prod-backup-...` — the scripts here don't
  enforce a naming convention, so this is a process discipline, not a
  technical guardrail.
- **Never restore a staging backup into production**, or vice versa. A
  staging backup contains the seeded demo tenants (including the shared
  `password123` password documented throughout this repo) — restoring it
  into production would put those fictional-but-publicly-documented
  credentials into a real, internet-reachable database.
- **Retention**: this document doesn't prescribe a specific retention
  policy — that's a business decision — but at minimum, keep more than
  one recent production backup (not just the latest), since a corruption
  or bad migration might not be noticed until after the next backup
  cycle has already overwritten the last good one.

---

## Never seed production

`npm run db:seed` (and therefore `npm run db:reset`, which just runs
migrate then seed) creates two fictional demo companies and a shared,
**publicly documented in this very repository's README**, password
(`password123`). There is no legitimate reason to ever run this against
a real production database.

**As of this pass, this is enforced, not just documented**:
`scripts/seed.ts` refuses to run when `NODE_ENV=production`, unless
`ALLOW_SEED_IN_PRODUCTION=true` is explicitly set. This was verified
directly — the guard blocks with a clear message by default, and the
explicit override correctly allows it through when genuinely intended
(e.g. a disposable pre-launch environment that happens to have
`NODE_ENV=production` set for other reasons).

This guard does **not** exist on `npm run db:migrate` — migrations are
supposed to run in production; blocking them would break the actual
deployment process described in `DEPLOYMENT.md`.

---

## Pre-deployment backup checklist

- [ ] Take a backup **before** running migrations against a production
  database with real data (`npm run db:migrate` doesn't have an
  automatic rollback — see `DEPLOYMENT.md` Section C)
- [ ] Confirm the backup file is non-trivial in size (an empty or
  near-empty file usually means something went wrong silently)
- [ ] Copy the backup file off the source machine before proceeding
- [ ] If this is a first deployment, confirm your hosting provider's
  automated backup feature is also enabled — don't rely on manual
  backups alone (see `DEPLOYMENT.md` Section C and P0 blocker #1)

## Post-restore validation checklist

- [ ] Row counts on key tables are non-zero and plausible
- [ ] Drizzle's migration-tracking table shows the expected number of
  applied migrations
- [ ] A real login against the restored database succeeds
- [ ] Tenant-scoped data loads correctly for at least one real tenant
  (not just that the query returns 200 — check the actual data is what
  you expect)
- [ ] If Company Switcher / platform admin access is in use, confirm
  `platform_admin_tenant_grants` rows survived
