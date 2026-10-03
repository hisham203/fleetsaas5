# Smarty1 Physical Road Test — UAT Checklist

**Version:** Milestone I  
**Path:** iPhone → Driver App GPS → Smarty1 GPS ingestion → Live Fleet → Trip360 → Replay → ETA → Analytics  
**Purpose:** Validate that the canonical GPS pipeline, ETA engine, and analytics produce correct results from a real physical vehicle movement.

---

## Pre-Conditions

- [ ] **One Milestone I instance running** at the target URL (demo.smarty1.com or equivalent)
- [ ] **CRON_SECRET** configured in Coolify (device health automation)
- [ ] **GOOGLE_ROUTES_API_KEY** set (required for ETA calculation)

---

## PRE-TEST SETUP

### A. Test Tenant

| Check | How to Verify | Result |
|---|---|---|
| Test tenant exists | Login as admin, confirm tenant name in top-bar | PASS / FAIL |
| Test tenant has at least one contract | Operations → Commercial → Contracts | PASS / FAIL / N/A |
| SLA minutes configured on test order type | Administration → Organization | PASS / FAIL / N/A |

### B. Vehicle Setup

| Check | How to Verify | Result |
|---|---|---|
| Test vehicle exists and is ACTIVE | Fleet → Vehicles | PASS / FAIL |
| Vehicle has no in-progress trip | Trips list — no DISPATCHED/STARTED row for this vehicle | PASS / FAIL |
| Vehicle plate number noted | — | Recorded: ________ |

### C. Driver Setup

| Check | How to Verify | Result |
|---|---|---|
| Test driver exists and has role=DRIVER user | Fleet → Drivers | PASS / FAIL |
| Driver login credentials available | Administration → Users | PASS / FAIL |
| Driver has no active assignment conflicts | Trips list | PASS / FAIL |

### D. iPhone Setup

| Check | How to Verify | Result |
|---|---|---|
| iPhone available, battery > 50% | — | PASS / FAIL |
| Safari or Chrome browser opens | — | PASS / FAIL |
| Location permissions set to "While Using" for browser | iOS Settings → Privacy → Location | PASS / FAIL |
| High Accuracy GPS enabled | — | PASS / FAIL |
| Smarty1 Driver App opens in browser | Navigate to `<domain>/driver` or equivalent | PASS / FAIL |
| Driver login succeeds | Login with driver credentials | PASS / FAIL |

### E. Customer / Site Setup

| Check | How to Verify | Result |
|---|---|---|
| Test customer exists | Commercial → Customers | PASS / FAIL |
| Customer site has coordinates (lat/lng) | Customer detail → Sites | PASS / FAIL |
| Named geofence exists for customer site (optional) | Telematics → Geofences | PASS / N/A |

### F. Loading Point Setup

| Check | How to Verify | Result |
|---|---|---|
| At least one loading point exists with coordinates | Operations → Loading Points | PASS / FAIL |
| Named geofence exists for loading point (optional) | Telematics → Geofences | PASS / N/A |

### G. Order and Trip Setup

| Check | How to Verify | Result |
|---|---|---|
| Test order created | Operations → Orders → Create | PASS / FAIL |
| Order status = VALIDATED or QUEUED | Order detail | PASS / FAIL |
| Trip PLANNED from this order | Operations → Planning & Dispatch | PASS / FAIL |
| Vehicle assigned to trip | Trip detail — Vehicle field | PASS / FAIL |
| Driver assigned to trip | Trip detail — Driver field | PASS / FAIL |
| `estimatedDurationMinutes` set on trip | Check via `/api/trips/[id]` or Trip 360 | PASS / FAIL / N/A |

### H. Analytics Baseline

| Check | How to Verify | Result |
|---|---|---|
| Analytics overview loads without error | /analytics/overview | PASS / FAIL |
| GPS source counts BEFORE test (record) | /analytics/telematics → DEVICE / DRIVER_APP / DEMO | Baseline: D=__ A=__ Demo=__ |

---

## ROAD TEST EXECUTION

### Step 1 — Dispatch

| Check | Action | Result |
|---|---|---|
| Dispatch the trip | Planning & Dispatch → Dispatch | PASS / FAIL |
| Trip status = DISPATCHED | Trip 360 | PASS / FAIL |
| `baselineEtaAt` set on trip | Trip 360 → Live Execution tab → "Baseline" field visible | PASS / FAIL / N/A |
| Screenshot: Trip 360 at dispatch | — | ☐ Captured |

### Step 2 — Driver App GPS Start

| Check | Action | Result |
|---|---|---|
| Driver opens trip on iPhone browser | Navigate to trip in Driver App | PASS / FAIL |
| Driver starts trip (status transition) | Tap "Start Trip" or equivalent | PASS / FAIL |
| Trip status changes to STARTED | Refresh Trip 360 in admin browser | PASS / FAIL |

### Step 3 — Physical Movement + GPS Ingestion

| Check | Evidence | Result |
|---|---|---|
| Vehicle physically moves (walk/drive ≥ 200m) | Confirm physical movement | PASS / FAIL |
| GPS ping received in vehicle_gps_history | Check Trip 360 → GPS Trace (should show > 0 points) | PASS / FAIL |
| `source = DRIVER_APP` on pings | `/api/telematics/trips/[id]/replay` response shows source | PASS / FAIL |
| Trip 360 shows current position updated | Live Execution tab → GPS Coordinates | PASS / FAIL |
| Screenshot: Live Fleet showing vehicle moving | /telematics/live | ☐ Captured |

### Step 4 — Live Fleet Observation

| Check | Evidence | Result |
|---|---|---|
| Vehicle appears in Live Fleet | /telematics/live | PASS / FAIL |
| Operational state shows MOVING or ON_TRIP | Live Fleet → state pill | PASS / FAIL / PARTIAL |
| GPS health shows LIVE (< 5 min stale) | Live Fleet → GPS dot (green) | PASS / FAIL |
| Vehicle visible on map in Control Tower | /control-tower | PASS / FAIL |
| Screenshot: Live Fleet + Control Tower | — | ☐ Captured |

### Step 5 — ETA Observation

| Check | Evidence | Result |
|---|---|---|
| Open Trip 360 → Live Execution tab | — | PASS / FAIL |
| Click "Refresh ETA" button | — | PASS / FAIL |
| ETA shows estimated arrival time | Not "unavailable" | PASS / FAIL |
| ETA quality shows LIVE or CACHED | Tab shows quality label | PASS / FAIL |
| No ETA fabrication (unavailable shows reason) | If no GPS, shows reason not fake time | PASS / FAIL |
| Screenshot: Trip 360 Live Execution with ETA | — | ☐ Captured |

### Step 6 — Geofence Observation (if configured)

| Check | Evidence | Result |
|---|---|---|
| Vehicle enters customer site geofence | Physical arrival at site | PASS / N/A |
| GEOFENCE_ENTER event appears in Events & Alerts | /telematics/alerts | PASS / FAIL / N/A |
| Arrival notification in Notification Center | Bell icon → new notification | PASS / FAIL / N/A |
| Screenshot: Geofence events | — | ☐ Captured |

### Step 7 — POD and Completion

| Check | Action | Result |
|---|---|---|
| Driver completes POD (signature or photo if configured) | Driver App → POD screen | PASS / FAIL / N/A |
| Trip status → COMPLETED | Trip 360 | PASS / FAIL |
| Completion time recorded | Trip 360 → Timeline tab | PASS / FAIL |
| Screenshot: Trip 360 completed | — | ☐ Captured |

---

## POST-TRIP VERIFICATION

### A. Resource Release

| Check | Evidence | Result |
|---|---|---|
| Vehicle status returns to available | Fleet → Vehicles | PASS / FAIL |
| Driver no longer on active trip | Fleet → Drivers | PASS / FAIL |

### B. GPS History and Replay

| Check | Evidence | Result |
|---|---|---|
| GPS history rows exist for completed trip | /telematics/replay?tripId=... | PASS / FAIL |
| Replay shows actual route traversed | Trip Replay V2 page — points visible | PASS / FAIL |
| Source shows DRIVER_APP on all points | Replay data | PASS / FAIL |
| GPS point count > 5 | Replay — point count | PASS / FAIL |
| Screenshot: Trip Replay | — | ☐ Captured |

### C. ETA Evidence

| Check | Evidence | Result |
|---|---|---|
| `baselineEtaAt` is set on completed trip | Trip 360 Live Execution tab | PASS / FAIL / N/A |
| `etaArrivalAt` shows last cached ETA | Trip 360 | PASS / FAIL / N/A |
| Trip is now ETA-analytics-eligible | /analytics/telematics → ETA Eligible count increased by 1 | PASS / FAIL / N/A |

### D. Geofence Evidence (if configured)

| Check | Evidence | Result |
|---|---|---|
| geofence_events table has ENTER/EXIT rows for the trip | /telematics/events?tripId=... | PASS / FAIL / N/A |
| vehicle_geofence_state updated | Internal check | PASS / FAIL / N/A |

### E. Alert Evidence

| Check | Evidence | Result |
|---|---|---|
| No spurious DEVICE_OFFLINE alerts for this vehicle | /telematics/alerts | PASS / FAIL |
| If vehicle went STALE, alert was created then resolved | Alert history | PASS / FAIL / N/A |

### F. Analytics Impact

| Check | Evidence | Result |
|---|---|---|
| Analytics Overview → Trips Completed count increased by 1 | /analytics/overview (same period) | PASS / FAIL |
| Driver analytics row shows tripsCompleted +1 | /analytics/drivers | PASS / FAIL |
| Vehicle analytics row shows tripsCompleted +1 | /analytics/fleet | PASS / FAIL |
| GPS source counts updated (DRIVER_APP +N) | /analytics/telematics | PASS / FAIL |
| GPS_DEMO count unchanged | /analytics/telematics → Demo pings same as baseline | PASS / FAIL |

---

## RESULT CLASSIFICATION

| Section | Status | Notes |
|---|---|---|
| Pre-Test Setup | PASS / PARTIAL / FAIL | |
| Dispatch | PASS / PARTIAL / FAIL | |
| Driver App GPS | PASS / PARTIAL / FAIL | |
| Physical Movement | PASS / PARTIAL / FAIL | |
| Live Fleet | PASS / PARTIAL / FAIL | |
| ETA | PASS / PARTIAL / FAIL | |
| Geofences | PASS / PARTIAL / FAIL / N/A | |
| POD + Completion | PASS / PARTIAL / FAIL | |
| Post-Trip GPS | PASS / PARTIAL / FAIL | |
| Analytics Impact | PASS / PARTIAL / FAIL | |

**Overall UAT Result:** PASS / PARTIAL / FAIL

**Tester:** _______________  
**Date:** _______________  
**Environment:** demo.smarty1.com / other: _______________

---

## KNOWN LIMITATIONS (document before test, not after)

1. **ETA requires `estimatedDurationMinutes`:** If trip was planned without Google Routes ETA, `baselineEtaAt` will be null and ETA analytics eligibility will be zero for this trip. This is correct behavior, not a bug.

2. **GPS accuracy on iPhone Safari:** iOS limits background GPS accuracy. The Driver App must remain foregrounded during movement for best ping cadence.

3. **Geofence precision:** Named geofences require polygon/circle coordinates configured in Telematics → Geofences. A geofence with incorrect or missing coordinates will not generate ENTER/EXIT events.

4. **AirTag is NOT part of this test:** AirTag position cannot be ingested by Smarty1 (by design). Any AirTag present during the road test is for external cross-validation only, not for software verification.

5. **GPS_DEMO isolation:** GPS_DEMO pings from any ongoing demo sessions do not affect this test's GPS history counts.
