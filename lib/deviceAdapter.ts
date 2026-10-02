/**
 * lib/deviceAdapter.ts — Milestone H: Hardware Device Adapter
 *
 * Isolates hardware-specific payload parsing and IMEI resolution from the
 * generic GPS ingestion pipeline (lib/gpsIngestion.ts), which is never
 * modified by this milestone.
 *
 * Supports two Teltonika HTTP payload shapes:
 *   1. Teltonika Codec 8 JSON (direct HTTP): { ident, position: { latitude, longitude, speed, direction, hdop } }
 *   2. Flespi-style (Teltonika cloud): { device: { ident }, position: { latitude, longitude, speed } }
 *
 * Speed conversion: Teltonika sends km/h; GpsPing requires m/s.
 */

import { db } from "@/lib/db/client";
import { telematicsDevices, vehicleDeviceAssignments, trips } from "@/lib/db/schema";
import { eq, and, isNull, inArray, sql } from "drizzle-orm";

// ── Normalised device ping ────────────────────────────────────────────────────

export interface NormalizedDevicePing {
  imei: string;
  lat: number;
  lng: number;
  speedMps: number | null;    // converted from km/h; null if unavailable
  heading: number | null;     // degrees 0–360; null if unavailable
  hdop: number | null;        // horizontal dilution of precision (accuracy proxy)
  recordedAt: Date;
}

/** Resolved platform context for a device ping. */
export interface DeviceContext {
  tenantId: string;
  deviceId: string;
  vehicleId: string;
  tripId: string | null;      // null when no active trip exists
  driverId: string | null;    // null when no active trip exists
}

// ── Active trip status set ────────────────────────────────────────────────────
const ACTIVE_TRIP_STATUSES = [
  "DISPATCHED",
  "STARTED",
  "ARRIVED_LOADING",
  "LOADING_COMPLETE",
  "ARRIVED_SITE",
];

// ── Speed conversion ──────────────────────────────────────────────────────────
/** Convert km/h to m/s. Returns null for null/undefined input. */
export function kmhToMps(kmh: number | null | undefined): number | null {
  if (kmh == null || !isFinite(kmh) || kmh < 0) return null;
  return kmh / 3.6;
}

// ── Payload parsing ───────────────────────────────────────────────────────────

/**
 * Parse a Teltonika FMB HTTP JSON payload into a normalised ping.
 * Returns null if the payload is missing required fields.
 * Handles both direct-HTTP and Flespi-forwarded formats.
 */
export function parseTeltonikaPayload(body: unknown): NormalizedDevicePing | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;

  // Resolve IMEI — either top-level `ident` or nested `device.ident`:
  const imei: string =
    (typeof b["ident"] === "string" ? b["ident"] : null) ??
    ((b["device"] as any)?.["ident"] ?? null);
  if (!imei || typeof imei !== "string" || imei.trim().length < 10) return null;

  // Resolve position — try top-level `position` object first:
  const pos: Record<string, unknown> =
    (b["position"] && typeof b["position"] === "object"
      ? b["position"]
      : b) as Record<string, unknown>;

  const lat = typeof pos["latitude"] === "number" ? pos["latitude"] : null;
  const lng = typeof pos["longitude"] === "number" ? pos["longitude"] : null;
  if (lat == null || lng == null) return null;
  if (!isFinite(lat) || lat < -90 || lat > 90) return null;
  if (!isFinite(lng) || lng < -180 || lng > 180) return null;

  // Speed: Teltonika sends km/h; null means unavailable:
  const speedKmh =
    typeof pos["speed"] === "number" ? pos["speed"] :
    typeof pos["Speed"] === "number" ? pos["Speed"] : null;
  const speedMps = kmhToMps(speedKmh);

  // Heading:
  const heading =
    typeof pos["direction"] === "number" ? pos["direction"] :
    typeof pos["angle"] === "number" ? pos["angle"] :
    typeof pos["Direction"] === "number" ? pos["Direction"] : null;

  // HDOP (accuracy proxy — lower is better; < 1.5 is good; > 5 is poor):
  const hdop =
    typeof pos["hdop"] === "number" ? pos["hdop"] :
    typeof pos["Hdop"] === "number" ? pos["Hdop"] : null;

  // Timestamp: use device timestamp if available; fall back to server time:
  const ts = b["timestamp"] ?? pos["timestamp"];
  const recordedAt =
    typeof ts === "number" && ts > 1_000_000_000
      ? new Date(ts * 1000)       // Unix seconds
      : new Date();

  return {
    imei: imei.trim(),
    lat,
    lng,
    speedMps,
    heading: heading != null && isFinite(heading) ? heading : null,
    hdop: hdop != null && isFinite(hdop) ? hdop : null,
    recordedAt,
  };
}

// ── IMEI resolution chain ─────────────────────────────────────────────────────

/**
 * Resolves a device IMEI to platform context (tenantId, vehicleId, tripId, driverId).
 *
 * Resolution chain:
 *   IMEI → telematicsDevices.device_identifier
 *       → vehicleDeviceAssignments (unassigned_at IS NULL)
 *       → trips (active status, tenant-scoped)
 *
 * Returns null if the IMEI is unknown or the device has no active assignment.
 * Returns DeviceContext with tripId/driverId = null when no active trip exists
 * (the device is communicating from a vehicle not currently on a trip).
 */
export async function resolveDeviceContext(imei: string): Promise<DeviceContext | null> {
  // Step 1: IMEI → device:
  const device = await db.query.telematicsDevices.findFirst({
    where: eq(telematicsDevices.deviceIdentifier, imei),
    columns: { id: true, tenantId: true, status: true },
  });
  if (!device) return null;
  if (device.status === "INACTIVE") return null;

  // Step 2: device → active vehicle assignment:
  const assignment = await db.query.vehicleDeviceAssignments.findFirst({
    where: and(
      eq(vehicleDeviceAssignments.deviceId, device.id),
      isNull(vehicleDeviceAssignments.unassignedAt)
    ),
    columns: { vehicleId: true, tenantId: true },
  });
  if (!assignment) return null;
  if (assignment.tenantId !== device.tenantId) return null; // tenant mismatch guard

  const { tenantId, vehicleId } = assignment;

  // Step 3: vehicle → active trip:
  const activeTrip = await db.query.trips.findFirst({
    where: and(
      eq(trips.vehicleId, vehicleId),
      eq(trips.tenantId, tenantId),
      inArray(trips.status, ACTIVE_TRIP_STATUSES)
    ),
    columns: { id: true, driverId: true, status: true },
  });

  return {
    tenantId,
    deviceId: device.id,
    vehicleId,
    tripId: activeTrip?.id ?? null,
    driverId: activeTrip?.driverId ?? null,
  };
}

// ── Device heartbeat update ───────────────────────────────────────────────────

/**
 * Updates device's last communication time and position.
 * Called on every accepted ping — even when no active trip exists.
 * This is what makes the device health cron accurate.
 */
export async function updateDeviceHeartbeat(params: {
  deviceId: string;
  lat: number;
  lng: number;
  recordedAt: Date;
}): Promise<void> {
  await db.update(telematicsDevices)
    .set({
      lastCommunication: params.recordedAt,
      lastGpsFix: params.recordedAt,
      lastLat: params.lat,
      lastLng: params.lng,
      status: "ACTIVE",
      totalPingsReceived: sql`total_pings_received + 1`,
    } as any)
    .where(eq(telematicsDevices.id, params.deviceId));
}
