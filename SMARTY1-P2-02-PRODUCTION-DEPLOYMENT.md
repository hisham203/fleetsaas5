# SMARTY1 P2-02 — Production Deployment Procedure

> **This document describes the procedure only. No production migration, bootstrap, seed, or deployment has been executed.**

---

## Prerequisites

- [ ] P2-02 ZIP artifact reviewed and approved
- [ ] Database backup/snapshot taken and verified
- [ ] Maintenance window scheduled
- [ ] Rollback plan confirmed

---

## Step 1 — Backup / Checkpoint

```bash
pg_dump $PROD_DATABASE_URL > smarty1_pre_p202_$(date +%Y%m%d_%H%M%S).dump
pg_restore --list smarty1_pre_p202_*.dump | head -20
```

**Rollback decision point:** If backup is unverifiable, STOP.

---

## Step 2 — Apply Schema Migration

Smarty1 Production uses Drizzle migration tracking. Migration `0024_p2_02_dispatch_rbac.sql` is already registered in `drizzle/meta/_journal.json` after `0023`. Use the canonical Drizzle command to preserve migration history:

```bash
DATABASE_URL=<production-public-url> npm run db:migrate
```

**Do NOT** apply `psql ... 0024_p2_02_dispatch_rbac.sql` directly as the primary procedure — this bypasses Drizzle's `_journal.json` tracking and breaks future migrations.

**Migration adds (non-destructive — adds only):**
- `roles.is_active` column
- `permissions.code`, `.category`, `.is_sensitive` columns
- `role_permissions.granted_at`, `.granted_by`
- `user_roles.assigned_at`, `.assigned_by`
- `role_audit_log` table (immutable audit trail)
- `trips.dispatched_at`, `.dispatched_by`

**Verify:**
```sql
SELECT COUNT(*) FROM information_schema.columns
  WHERE table_name = 'roles' AND column_name = 'is_active';  -- must return 1
SELECT COUNT(*) FROM information_schema.tables
  WHERE table_name = 'role_audit_log';                       -- must return 1
```

**Rollback decision point:** If migration fails, restore from backup. The migration is non-destructive and can be re-applied.

---

## Step 3 — Deploy Application Code

Deploy the P2-02 application bundle through your normal Railway pipeline.

**MANDATORY: Do NOT run `npm run db:seed`.** The seed creates demo customers, trips, orders, invoices, and users. It must never run in production.

---

## Step 4 — Run RBAC Bootstrap

```bash
DATABASE_URL=<production-public-url> npm run db:bootstrap:rbac
```

**Expected output:**
```
✅ Bootstrap complete: 71 permissions, 8 roles
```

The bootstrap is **idempotent** — safe to run multiple times. Second run produces 0 duplicates.

**Rollback decision point:** If bootstrap fails, re-run (idempotent). It never deletes data.

---

## Step 5 — Bootstrap Verification

```sql
SELECT COUNT(*) FROM permissions;           -- must be ≥ 71
SELECT COUNT(*) FROM permissions WHERE is_sensitive = true;  -- must be 17
SELECT name FROM roles WHERE is_system_role = true ORDER BY name;
-- Must include: AUDITOR, DRIVER, FINANCE_USER, FLEET_MAINTENANCE,
--   OPERATION_COORDINATOR, OPERATION_SUPERVISOR, PROCUREMENT_USER, TENANT_ADMIN
```

---

## Step 6 — Platform Admin Identity (Critical — Read Before Proceeding)

### What "Platform Admin" means in the current architecture

A user whose `users.role = "ADMIN"` in the database is a **Platform Admin**. This field controls the identity bypass in `checkPermission()`:

```typescript
// lib/requirePermission.ts — Step 2:
if (systemRole === "ADMIN") return null;  // bypasses ALL permission checks
```

This bypass fires **before** any explicit RBAC role lookup. It cannot be overridden by assigning an RBAC role.

### IMPORTANT: Assigning TENANT_ADMIN role to an ADMIN user does NOT make them tenant-scoped

If a user has `users.role = "ADMIN"`, they remain a Platform Admin regardless of what RBAC roles are assigned to them. The `checkPermission()` bypass fires first. Assigning them a TENANT_ADMIN role template has no effect on their authorization scope.

**Documentation in previous versions incorrectly stated that assigning TENANT_ADMIN to an ADMIN user makes them tenant-scoped. This is false.**

### Safe procedure: converting a Platform Admin to Tenant Admin

If an existing `users.role = "ADMIN"` account should become a tenant-scoped administrator:

1. Create a **new user account** for them with `users.role = "DISPATCHER"` (or any non-ADMIN role)
2. Assign the `TENANT_ADMIN` role template to the new account via `/settings/access`
3. Verify the new account has correct tenant-scoped access
4. Disable or delete the old `ADMIN` account

**Do NOT** attempt to change `users.role` on an existing Platform Admin account in production without a full access audit. The `role` field is an identity field, not an authorization field.

---

## Step 7 — Legacy User Transition

Existing users with `users.role = "DISPATCHER"` or `"DRIVER"` are **not locked out**. The `checkPermission()` function includes a legacy fallback that applies when a user has **zero** explicit RBAC role assignments:

- `DISPATCHER` → ~30 operational permissions (no expenses)
- `DRIVER` → 7 permissions + `expenses.view` + `expenses.create`

**Transition procedure (per tenant, after initial deployment is stable):**

```sql
-- Find DISPATCHER users without explicit roles:
SELECT u.id, u.email FROM users u
  WHERE u.tenant_id = 'YOUR_TENANT_ID'
    AND u.role = 'DISPATCHER'
    AND NOT EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id);
```

For each: assign `OPERATION_COORDINATOR`, `OPERATION_SUPERVISOR`, or both via `/settings/access → Users`.

Once **all users in all tenants have explicit role assignments**, remove the legacy fallback block from `lib/requirePermission.ts` in the next release.

---

## Step 8 — Role Assignment Verification

```sql
SELECT t.name, COUNT(ur.id) as assignments
  FROM tenants t LEFT JOIN user_roles ur ON ur.tenant_id = t.id
  GROUP BY t.name;
```

---

## Steps 9–12 — UAT Verification

**Platform Admin:** Login → `/settings/access` loads → Permission Matrix shows 71 permissions.

**Tenant Admin (user with TENANT_ADMIN role assigned):** Can create custom role → assign permissions → assign to user → cannot assign Platform Admin role (403 PLATFORM_ROLE_DENIED) → cannot access another tenant's data (404).

**Coordinator:** Create order → create trip → `trips.assign` denied (403) → `trips.dispatch` denied (403).

**Supervisor:** Assignment Workspace loads → eligible/ineligible candidates shown → 18,000 L vehicle INELIGIBLE for 21,000 L trip → assign + dispatch succeeds.

**Driver:** Dispatched trip visible → first action is **Arrived Loading Point** (no Start button) → wrong driver gets 403 NOT_ASSIGNED → pre-dispatch lifecycle gets 422 TRIP_NOT_DISPATCHED.

---

## Step 13 — Run RBAC Audit

```bash
DATABASE_URL=<prod> npm run audit:rbac
```

Must output: `✅ RBAC AUDIT PASSED`

---

## Step 14 — Rollback Decision Points Summary

| Point | Condition | Action |
|---|---|---|
| After backup | Unverifiable | STOP |
| After migration | SQL errors | Restore from backup |
| After bootstrap | Fails | Re-run (idempotent) |
| After deploy | App fails to start | Roll back code |
| After UAT | Auth failures | Investigate — no seed |

---

## Absolute Restrictions

- **NO `npm run db:seed`** in production under any circumstances
- **NO direct `psql ... 0024_p2_02_dispatch_rbac.sql`** as primary migration — use `npm run db:migrate`
- **NO P2-03 files** in this package
- **NO Production migration executed in this task**
- **NO Production bootstrap executed in this task**
