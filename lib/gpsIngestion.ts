/**
 * Shared GPS ingestion pipeline — P2-01 Live Operations.
 *
 * Normalised GPS data flows through three stages regardless of source:
 *
 *   validateGpsPing()    — coordinate bounds, field checks
 *   persistGpsPing()     — writes to trips + vehicleGpsHistory
 *   processGpsGeofence() — async, non-blocking geofence check → operational events
 *
 * INTEGRATION CONTRACT for future telematics adapters (Wialon, Samsara,
 * Teltonika, Traccar, native mobile, etc.):
 *
 *   1. Normalise incoming telemetry to { tenantId, tripId, vehicleId, driverId,
 *      lat, lng, accuracy?, speed?, heading?, recordedAt? }
 *   2. Call validateGpsPing() — reject on error
 *   3. Call persistGpsPing() — dual write to trips + vehicleGpsHistory
 *   4. Fire processGpsGeofence() — async, never await in the request path
 *
 * Source (DEVICE vs DEMO) is currently tracked at the application layer only.
 * Persistent source provenance would require a schema change (adding a `source`
 * column to vehicle_gps_history). See final report note: "PERSISTENT GPS SOURCE
 * REQUIRES SCHEMA CHANGE". Until then, the Control Tower DEMO badge is the
 * authoritative runtime indicator that a vehicle is being demo-simulated.
 */

import { db } from "@/lib/db/client";
import { trips, vehicleGpsHistory } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { genId } from "@/lib/helpers";
import { checkAndEmitGeofenceEvents } from "@/lib/operationalEventHelper";

// ── Normalised GPS payload ────────────────────────────────────────────────────
export type GpsPing = {
  tenantId: string;
  tripId: string;
  vehicleId: string;
  driverId: string;
  lat: number;
  lng: number;
  accuracy?: number | null;
  speed?: number | null;
  heading?: number | null;
  recordedAt?: Date;
};

export type ValidationError = { field: string; message: string };

// ── Stage 1: Validate ─────────────────────────────────────────────────────────
export function validateGpsPing(data: Partial<GpsPing>): ValidationError[] {
  const errors: ValidationError[] = [];
  const { lat, lng, accuracy, speed, heading } = data;

  if (lat == null || !isFinite(lat) || lat < -90 || lat > 90)
    errors.push({ field: "lat", message: "latitude must be a finite number between -90 and 90" });

  if (lng == null || !isFinite(lng) || lng < -180 || lng > 180)
    errors.push({ field: "lng", message: "longitude must be a finite number between -180 and 180" });

  if (accuracy != null && (accuracy < 0 || !isFinite(accuracy)))
    errors.push({ field: "accuracy", message: "accuracy must be a non-negative finite number" });

  if (speed != null && (speed < 0 || !isFinite(speed)))
    errors.push({ field: "speed", message: "speed must be a non-negative finite number" });

  if (heading != null && (!isFinite(heading) || heading < 0 || heading > 360))
    errors.push({ field: "heading", message: "heading must be between 0 and 360" });

  return errors;
}

// ── Stage 2: Persist ──────────────────────────────────────────────────────────
export async function persistGpsPing(ping: GpsPing): Promise<void> {
  const now = ping.recordedAt ?? new Date();
  await Promise.all([
    // Latest position on the trip (fast map lookup):
    db.update(trips)
      .set({ currentLat: ping.lat, currentLng: ping.lng, lastPingAt: now })
      .where(eq(trips.id, ping.tripId)),
    // Historical trail (operational review + route replay):
    db.insert(vehicleGpsHistory).values({
      id: genId(),
      tenantId: ping.tenantId,
      tripId: ping.tripId,
      vehicleId: ping.vehicleId,
      driverId: ping.driverId,
      lat: ping.lat,
      lng: ping.lng,
      accuracy: ping.accuracy ?? null,
      speed: ping.speed ?? null,
      heading: ping.heading ?? null,
      recordedAt: now,
    }),
  ]);
}


// ── Stage 3: Geofence (async, non-blocking) ───────────────────────────────────
export function processGpsGeofence(ping: GpsPing): void {
  checkAndEmitGeofenceEvents({
    tenantId: ping.tenantId,
    tripId: ping.tripId,
    vehicleId: ping.vehicleId,
    driverId: ping.driverId,
    lat: ping.lat,
    lng: ping.lng,
  }).catch(() => {}); // never throw in the calling request path
}
