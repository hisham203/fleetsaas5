/**
 * lib/geofenceEvaluator.ts — Milestone E: Named Geofence Evaluation
 *
 * Evaluates GPS pings against tenant-defined geofence_definitions and
 * records ENTER/EXIT events using the vehicle_geofence_state table for
 * duplicate-safe state transitions.
 *
 * State machine:
 *   OUTSIDE → INSIDE = ENTER event (record to geofence_events + telemetry_events)
 *   INSIDE  → OUTSIDE = EXIT event
 *   INSIDE  → INSIDE = no event (already inside — deduplicated)
 *   OUTSIDE → OUTSIDE = no event
 *
 * Called async (fire-and-forget) from the GPS ingestion pipeline.
 * Never throws into the calling request path.
 */

import { db } from "@/lib/db/client";
import {
  geofenceDefinitions, vehicleGeofenceState,
  geofenceEvents, telemetryEvents,
} from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { genId } from "@/lib/helpers";
import { checkGeofence } from "@/lib/geofence";

export interface GeofencePing {
  tenantId: string;
  vehicleId: string;
  tripId?: string | null;
  driverId?: string | null;
  deviceId?: string | null;
  lat: number;
  lng: number;
  speed?: number | null;
  pingAt?: Date;
}

export async function evaluateNamedGeofences(ping: GeofencePing): Promise<void> {
  const { tenantId, vehicleId } = ping;
  const eventAt = ping.pingAt ?? new Date();

  // Fetch all active named geofences for this tenant (bounded — no unbounded scan):
  const geofences = await db.query.geofenceDefinitions.findMany({
    where: and(
      eq(geofenceDefinitions.tenantId, tenantId),
      eq(geofenceDefinitions.status, "ACTIVE")
    ),
    columns: {
      id: true, name: true, category: true,
      centerLat: true, centerLng: true, radiusMeters: true,
    },
  });

  if (geofences.length === 0) return;

  for (const gf of geofences) {
    const check = checkGeofence(ping.lat, ping.lng, gf.centerLat, gf.centerLng, gf.radiusMeters);
    const isInside = check.inside;

    // Load or initialize current state for this (vehicle, geofence) pair:
    const existing = await db.query.vehicleGeofenceState.findFirst({
      where: and(
        eq(vehicleGeofenceState.vehicleId, vehicleId),
        eq(vehicleGeofenceState.geofenceId, gf.id)
      ),
    });

    const wasInside = existing?.currentState === "INSIDE";

    if (isInside === wasInside) {
      // No state change — update timestamp only if inside to keep updatedAt fresh:
      if (isInside && existing) {
        await db.update(vehicleGeofenceState)
          .set({ updatedAt: new Date() })
          .where(eq(vehicleGeofenceState.id, existing.id));
      }
      continue;
    }

    // State transition detected:
    const eventType = isInside ? "ENTER" : "EXIT";

    // Upsert state row:
    if (existing) {
      await db.update(vehicleGeofenceState)
        .set({
          currentState:  isInside ? "INSIDE" : "OUTSIDE",
          lastEnteredAt: isInside  ? eventAt : existing.lastEnteredAt,
          lastExitedAt:  !isInside ? eventAt : existing.lastExitedAt,
          updatedAt:     new Date(),
        })
        .where(eq(vehicleGeofenceState.id, existing.id));
    } else {
      await db.insert(vehicleGeofenceState).values({
        id:            genId(),
        tenantId,
        vehicleId,
        geofenceId:    gf.id,
        currentState:  isInside ? "INSIDE" : "OUTSIDE",
        lastEnteredAt: isInside  ? eventAt : null,
        lastExitedAt:  !isInside ? eventAt : null,
        updatedAt:     new Date(),
      });
    }

    // Record geofence_events entry:
    await db.insert(geofenceEvents).values({
      id:          genId(),
      tenantId,
      geofenceId:  gf.id,
      vehicleId,
      deviceId:    ping.deviceId ?? null,
      tripId:      ping.tripId ?? null,
      driverId:    ping.driverId ?? null,
      eventType,
      lat:         ping.lat,
      lng:         ping.lng,
      speed:       ping.speed ?? null,
      eventAt,
    } as any);

    // Record normalized telemetry event for the Event Center:
    await db.insert(telemetryEvents).values({
      id:          genId(),
      tenantId,
      eventType:   eventType === "ENTER" ? "GEOFENCE_ENTER" : "GEOFENCE_EXIT",
      severity:    "INFO",
      status:      "OPEN",
      vehicleId,
      deviceId:    ping.deviceId ?? null,
      tripId:      ping.tripId ?? null,
      driverId:    ping.driverId ?? null,
      source:      "DRIVER_APP",
      lat:         ping.lat,
      lng:         ping.lng,
      eventAt,
      metadata:    { geofenceId: gf.id, geofenceName: gf.name, category: gf.category } as any,
    } as any);
  }
}
