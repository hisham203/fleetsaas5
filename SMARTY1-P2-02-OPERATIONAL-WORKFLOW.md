# SMARTY1 P2-02 — Operational Workflow

**Canonical state machine:**

```
PLANNED → [trips.assign] → PLANNED(assigned) → [trips.dispatch] → DISPATCHED
  → ARRIVED_LOADING (driver's first action; auto-sets startedAt)
  → LOADING_COMPLETE → ARRIVED_SITE → UNLOADING_COMPLETE → COMPLETED
  → EXCEPTION (mark failed; reason required; no billing)
```

**No "Start Trip" button.** ARRIVED_LOADING is the driver's first action.

**Concurrency:** Assignment uses `SELECT FOR UPDATE` transaction. Two supervisors cannot simultaneously assign the same driver/vehicle. Returns `409 DRIVER_CONFLICT` or `409 VEHICLE_CONFLICT`.

**Capacity:** Strict equality. 18,000 L vehicle INELIGIBLE for 21,000 L trip. Phase 1 rule preserved.

**Segregation:** Coordinator creates, Supervisor assigns and dispatches, Driver executes, Finance settles.
