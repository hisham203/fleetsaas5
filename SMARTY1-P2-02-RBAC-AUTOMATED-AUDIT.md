# SMARTY1 P2-02 — RBAC Automated Audit

**Command:** `npm run audit:rbac`  
**Script:** `scripts/auditRbac.ts`  
**Exits 1 on failure — intended for CI gates.**

---

## What It Checks

**1. Unclassified business role checks (zero-tolerance)**  
Scans every `app/api/**/*.ts` for:
```
hasRole(session, ["ADMIN", "DISPATCHER"])
hasRole(session, ["DISPATCHER"])
session?.user?.role === "DISPATCHER"
```
These are forbidden business-capability checks. Pass condition: **0 findings**.

**2. Old enforceRbac system eliminated**  
Scans for surviving `enforceRbac(` calls. Pass condition: **0 files**.

**3. Per-method API coverage**  
Every file in `app/api/` with exported HTTP methods (`GET/POST/PATCH/PUT/DELETE`) that has no `checkPermission`, `checkTenantAdminPermission`, or `hasRole` call is reported as potentially unprotected. Auth infrastructure routes are in the allowlist and exempt.

**4. Permission catalogue count**  
Reports unique `"module.action"` codes in `lib/permissions.ts`. Expected ≥ 71.

---

## Allowlist (Exempt Routes)

| Route | Classification | Reason |
|---|---|---|
| `app/api/auth/login/route.ts` | AUTHENTICATION_INFRA | Login endpoint |
| `app/api/auth/logout/route.ts` | AUTHENTICATION_INFRA | Logout endpoint |
| `app/api/auth/me/route.ts` | AUTHENTICATION_INFRA | Session probe |
| `app/api/auth/signup/route.ts` | AUTHENTICATION_INFRA | Registration |
| `app/api/health/route.ts` | HEALTH_CHECK | Liveness probe |

---

## Authorization Resolution Order (`lib/requirePermission.ts`)

```
checkPermission(session, tenantId, code):

  1. No session              → 401 Unauthorized

  2. role="ADMIN" (Platform) → BYPASS
     Cross-tenant platform identity. Not a capability check.
     Cannot be removed by assigning an RBAC role.

  3. _checkHasAnyRbacRoles?  → YES → RBAC IS AUTHORITATIVE
      → permission found     → ALLOWED
      → not found            → 403 PERMISSION_DENIED
                               (legacy fallback does NOT apply)

  4. No explicit roles       → legacy role fallback (transitional)
      DISPATCHER → ~30 operational permissions (no expenses)
      DRIVER     → 7 lifecycle + expenses.view + expenses.create

  5. None matched            → 403 PERMISSION_DENIED
```

**Critical invariant:** Explicit RBAC always wins. If a user has any active role assignment, the legacy fallback cannot grant them additional permissions.

---

## Platform Admin vs Tenant Admin

| | Platform Admin | Tenant Admin |
|---|---|---|
| Identified by | `users.role = "ADMIN"` | Assigned TENANT_ADMIN role template |
| Scope | Cross-tenant | Single tenant |
| checkPermission bypass | Yes — unconditional | No — subject to full RBAC check |
| Can manage RBAC | Yes | Yes (roles.manage + users.manage) |
| Can assign Platform Admin role | N/A (is Platform Admin) | No — 403 PLATFORM_ROLE_DENIED |
| Assigning TENANT_ADMIN to a role="ADMIN" user | Has no effect — bypass still fires | — |
