# SMARTY1 P2-02 — UAT Checklist

## Part 1 — Bootstrap
- [ ] `npm run db:bootstrap:rbac` → 71 permissions, 8 roles, ✅

## Part 2 — Tenant Admin Creates a Role
- [ ] `/settings/access` loads with 4 tabs
- [ ] Create `OPERATION_SUPERVISOR` role
- [ ] Assign `trips.assign` + `trips.dispatch` via Permission Matrix
- [ ] Assign role to user → effective permissions visible
- [ ] Audit tab shows all changes

## Part 3 — Privilege Escalation Blocked
- [ ] Assign `ADMIN` role → 403 PLATFORM_ROLE_DENIED
- [ ] Cross-tenant user assignment → 404

## Part 4 — Coordinator Blocked
- [ ] `POST /api/trips/{id}/assign` [Coordinator] → 403
- [ ] `POST /api/trips/{id}/dispatch` [Coordinator] → 403

## Part 5 — Supervisor Assignment Workspace
- [ ] `/dispatch/assign` shows PLANNED trips
- [ ] 18,000 L vehicle → INELIGIBLE for 21,000 L trip
- [ ] ⭐ Recommendation shown
- [ ] Assign + Dispatch → success

## Part 6 — Concurrency
- [ ] Two simultaneous dispatch requests → one 200, one 409 (DRIVER_CONFLICT or VEHICLE_CONFLICT)

## Part 7 — Driver Workflow
- [ ] First action: Arrived Loading Point (no Start Trip button)
- [ ] Wrong driver → 403 NOT_ASSIGNED
- [ ] Pre-dispatch → 422 TRIP_NOT_DISPATCHED
- [ ] Full lifecycle → COMPLETED; invoice generated

## Part 8 — RBAC Audit
- [ ] `npm run audit:rbac` → ✅ RBAC AUDIT PASSED

## Part 9 — Regression
- [ ] Commercial/billing/pricing unchanged
- [ ] ePOD enforced
- [ ] Strict capacity equality confirmed
- [ ] P2-01 GPS route duplication absent
