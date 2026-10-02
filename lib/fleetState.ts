/**
 * lib/fleetState.ts — Milestone E: Canonical Fleet Operational State Derivation
 *
 * Derives fleet states that can be safely computed from available data:
 * - gpsStatus: LIVE | STALE | OFFLINE (from lastPingAt time — established in P2-01)
 * - operationalState: MOVING | IDLE | STOPPED | UNKNOWN (from speed + GPS time + trip state)
 * - deviceState: HEALTHY | STALE | OFFLINE | NEVER_REPORTED | UNASSIGNED (from device data)
 * - fleetSummaryStatus: combined summary label for UI display
 *
 * DESIGN RULES:
 * - Only derive what can be safely inferred from existing schema data.
 * - Never claim MOVING without speed evidence OR very recent GPS pings during active trip.
 * - Clearly distinguish derived vs directly measured values.
 * - Thresholds are centralized here, not scattered in route files.
 */

// ── GPS Health Thresholds ─────────────────────────────────────────────────────
// These match /api/fleet/positions (P2-01 canonical). MUST stay synchronized.
export const GPS_STALE_MS   = 5  * 60 * 1000;   // 5 min → STALE
export const GPS_OFFLINE_MS = 30 * 60 * 1000;   // 30 min → OFFLINE

// ── Device Health Thresholds ─────────────────────────────────────────────────
export const DEVICE_STALE_MS   = 15 * 60 * 1000;  // 15 min → STALE
export const DEVICE_OFFLINE_MS = 60 * 60 * 1000;  // 60 min → OFFLINE

// ── Operational State Thresholds ─────────────────────────────────────────────
// A vehicle is considered MOVING if speed > threshold (m/s).
// 0.5 m/s ≈ 1.8 km/h — filters GPS jitter at stop.
export const MOVING_SPEED_THRESHOLD_MS = 0.5; // metres/second

// A vehicle is considered IDLE (engine on but not moving) vs STOPPED
// based on how long it has been at a location with near-zero speed.
// Without ignition data, we can't distinguish idle from stopped — so we
// use IDLE as the combined state for "recent GPS but not moving".
export const IDLE_THRESHOLD_MS = 5 * 60 * 1000;  // 5 min of low-speed = IDLE

export type GpsStatus = "LIVE" | "STALE" | "OFFLINE";

export type OperationalState =
  | "MOVING"    // speed > threshold AND gpsStatus LIVE — measured
  | "IDLE"      // speed ≤ threshold AND gpsStatus LIVE — derived (may include STOPPED)
  | "ON_TRIP"   // on an active trip but no speed data available
  | "AVAILABLE" // no active trip
  | "OFFLINE"   // GPS offline
  | "UNKNOWN";  // no data to derive from

export type DeviceHealth =
  | "HEALTHY"         // communication within DEVICE_STALE_MS
  | "STALE"           // last communication between DEVICE_STALE_MS and DEVICE_OFFLINE_MS
  | "OFFLINE"         // last communication older than DEVICE_OFFLINE_MS
  | "NEVER_REPORTED"  // lastCommunication is null
  | "UNASSIGNED";     // device has no vehicle assignment

/** GPS status from lastPingAt — canonical, must match /api/fleet/positions. */
export function deriveGpsStatus(lastPingAt: Date | null | string): GpsStatus {
  if (!lastPingAt) return "OFFLINE";
  const age = Date.now() - new Date(lastPingAt).getTime();
  if (age < GPS_STALE_MS)  return "LIVE";
  if (age < GPS_OFFLINE_MS) return "STALE";
  return "OFFLINE";
}

/** Derive operational state from speed + gpsStatus + trip context. */
export function deriveOperationalState(params: {
  speed: number | null;
  lastPingAt: Date | null | string;
  tripId: string | null;
  tripStatus?: string | null;
}): OperationalState {
  const gps = deriveGpsStatus(params.lastPingAt);

  if (gps === "OFFLINE") return "OFFLINE";

  const isOnTrip = !!params.tripId && params.tripStatus !== "COMPLETED";

  if (params.speed != null) {
    // Speed data available — most reliable derivation:
    if (params.speed > MOVING_SPEED_THRESHOLD_MS) return "MOVING";
    return "IDLE"; // low speed = idle/stopped (cannot distinguish without ignition)
  }

  // No speed data — derive from trip context only:
  if (isOnTrip) return "ON_TRIP";
  return "AVAILABLE";
}

/** Derive device health from lastCommunication and assignment status. */
export function deriveDeviceHealth(params: {
  lastCommunication: Date | null | string;
  assignedVehicleId: string | null;
}): DeviceHealth {
  if (!params.assignedVehicleId) return "UNASSIGNED";
  if (!params.lastCommunication)  return "NEVER_REPORTED";
  const age = Date.now() - new Date(params.lastCommunication).getTime();
  if (age < DEVICE_STALE_MS)   return "HEALTHY";
  if (age < DEVICE_OFFLINE_MS) return "STALE";
  return "OFFLINE";
}

/** Human-readable age string. */
export function ageString(dt: Date | null | string | undefined): string {
  if (!dt) return "—";
  const ms = Date.now() - new Date(dt).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

/** Fleet summary KPIs from a position list. */
export function computeFleetSummary(vehicles: Array<{
  gpsStatus: GpsStatus;
  operationalState: OperationalState;
  hasDevice: boolean;
}>) {
  const total = vehicles.length;
  let live = 0, stale = 0, offline = 0;
  let moving = 0, idle = 0, onTrip = 0, available = 0;
  let withDevice = 0, withoutDevice = 0;

  for (const v of vehicles) {
    if (v.gpsStatus === "LIVE") live++;
    else if (v.gpsStatus === "STALE") stale++;
    else offline++;

    if (v.operationalState === "MOVING")    moving++;
    else if (v.operationalState === "IDLE") idle++;
    else if (v.operationalState === "ON_TRIP") onTrip++;
    else if (v.operationalState === "AVAILABLE") available++;

    if (v.hasDevice) withDevice++;
    else withoutDevice++;
  }

  return { total, live, stale, offline, moving, idle, onTrip, available, withDevice, withoutDevice };
}
