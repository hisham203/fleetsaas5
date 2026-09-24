# SMARTY1 P2-02 — Hard-Coded Role Debt Report

**Version:** P2-02 Final Closure · **Date:** 2026-09-21
**Methodology:** Full grep of `app/api/**/*.ts` for `hasRole(` calls, post-migration.

---

## Summary: Business-Capability Debt = ZERO

| Category | Count | Status |
|---|---|---|
| PLATFORM_IDENTITY (`hasRole(["ADMIN"])`) | ~98 | **KEEP** — platform boundary |
| DRIVER_IDENTITY (includes `"DRIVER"` gate before identity check) | ~13 | **KEEP** — identity check |
| AUTH_TENANT_BOUNDARY (any-member gate) | ~4 | **KEEP** — membership gate |
| BUSINESS CAPABILITY — MIGRATED | ~100 files | ✅ All migrated to `checkPermission()` |
| **Business-capability `hasRole()` remaining** | **0** | ✅ Zero |

**`npm run audit:rbac` confirms: 0 unclassified business role checks.**

---

## What Changed: Dual RBAC System Eliminated

Before P2-02, there were **two** competing authorization systems:

**System 1 (old):** `lib/enforceRbac.ts` + `lib/rbac.ts`
- `ROLE_MODULE_MAP` — 12 named roles mapped to module lists
- `canAccess(userId, tenantId, "module")` — module-level check
- `enforceRbac(session, tenantId, "module")` — API route helper
- Used in ~100 API files

**System 2 (new, P2-02):** `lib/requirePermission.ts`
- 71 granular permission codes
- `checkPermission(session, tenantId, PERMISSIONS.CODE)` — per-capability check
- Explicit RBAC DB lookup → legacy fallback → 403

System 1 is **completely eliminated**. Zero `enforceRbac()` calls remain in `app/api/`. The old `lib/enforceRbac.ts` and `lib/rbac.ts` files remain as dead code until they are formally removed in a cleanup sprint (no functional impact — nothing calls them).

---

## Remaining `hasRole()` calls — all justified

### PLATFORM_IDENTITY (KEEP)
Any `hasRole(session, ["ADMIN"])` call that performs platform administration.

| Pattern | Count | Examples |
|---|---|---|
| `hasRole(["ADMIN"])` sole gate | ~25 | `/api/roles`, `/api/user-roles`, `/api/users` |
| Dual gate (ADMIN + `checkTenantAdminPermission`) | ~7 | `/api/roles/[id]`, `/api/role-audit-log`, `/api/permissions` |
| GPS Demo (ADMIN only, dev tool) | 2 | `/api/trips/[id]/demo-gps`, `/api/trips/[id]/demo-route` |
| Auth + settings (ADMIN only) | ~8 | `/api/auth/**`, `/api/settings/**` |

These are identity-boundary checks, not capability checks. The Platform Admin (`role="ADMIN"`) has cross-tenant authority that cannot be expressed as a per-tenant permission.

### DRIVER_IDENTITY (KEEP)
| Pattern | Count | Reason |
|---|---|---|
| `hasRole(["ADMIN","DRIVER"])` | 2 | GPS ping fast path — DRIVER session type gate |
| `hasRole(["ADMIN","DISPATCHER","DRIVER"])` | 4 | Broad authenticated gate before driver identity validation |
| `session.user.role === "DRIVER"` | 7 | Driver session type check inside lifecycle, expenses |

These are session-type checks, not capability checks. The driver identity validation (`driverRecord.id !== trip.driverId`) is the actual security enforcement.

### AUTHENTICATION_TENANT_BOUNDARY (KEEP)
| Pattern | Count | Reason |
|---|---|---|
| `hasRole(["ADMIN","DISPATCHER","DRIVER","CUSTOMER"])` | 4 | Tenant membership gate — any authenticated user |

---

## Legacy Fallback Policy

The `checkPermission()` function includes a legacy fallback for users with NO explicit RBAC role assignments:

**DISPATCHER legacy permissions (~30 codes):** All operational permissions except expenses. Covers: orders, trips, assign, dispatch, vehicles, drivers, customers, contracts, billing.view, reports, scorecards, maintenance, inventory, procurement.

**DRIVER legacy permissions (7 codes):** trips.view, 5 lifecycle actions, expenses.view, expenses.create.

**Critical invariant:** When a user has ANY active explicit role assignment, the legacy fallback does NOT apply. RBAC is fully authoritative. This prevents a restrictive explicit role from being bypassed by the legacy fallback.

**Removal target:** Once all tenant users have explicit role assignments (verifiable via the `/settings/access` Users tab), the legacy fallback is dead code and should be removed in the next release.

---

## What `npm run audit:rbac` Would Catch

The automated audit fails on:
- Any `hasRole(session, ["ADMIN","DISPATCHER"])` — business capability check
- Any `hasRole(session, ["DISPATCHER"])` — single-role business check
- Any `session.user.role === "DISPATCHER"` — role-name–based access decision
- Any surviving `enforceRbac(` call — old system remnant

The audit **does not flag** Platform Admin checks, driver identity checks, or tenant membership gates — these are in the allowlist.
