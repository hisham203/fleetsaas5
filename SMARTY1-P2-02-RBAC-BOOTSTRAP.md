# SMARTY1 P2-02 — RBAC Bootstrap

**Command:** `npm run db:bootstrap:rbac` · **Script:** `scripts/bootstrapRbac.ts`

---

## What It Does

Seeds the canonical permission catalogue (71 permissions with sensitivity flags) and 8 system role templates. Fully idempotent — safe to run multiple times, produces zero duplicates.

**Does NOT:** create demo users, customers, orders, or trips.

---

## Expected Counts

| Item | Expected |
|---|---|
| Total permissions | 71 |
| Sensitive permissions | 17 |
| System roles (isSystemRole=true) | 8 |
| TENANT_ADMIN permissions | 71 |

---

## System Role Templates

TENANT_ADMIN · OPERATION_COORDINATOR · OPERATION_SUPERVISOR · DRIVER · FLEET_MAINTENANCE · FINANCE_USER · PROCUREMENT_USER · AUDITOR

---

## Idempotency

Second run output: `0 created, 71 synced` — no duplicates, no errors.

---

## Legacy User Transition

Existing `DISPATCHER`/`DRIVER` users have legacy fallback permissions in `checkPermission()`. Assign explicit role templates to complete the RBAC rollout, then remove the fallback.
