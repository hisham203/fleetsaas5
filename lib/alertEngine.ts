/**
 * lib/alertEngine.ts — Milestone F+G: Operational Alert Engine
 *
 * Creates, deduplicates, and resolves operational alerts.
 *
 * ALERT STORE: telemetry_events (status: OPEN/ACKNOWLEDGED/RESOLVED)
 * NOTIFICATION STORE: notifications (per-user delivery with deep links)
 *
 * DEDUPLICATION RULE:
 * Before creating any alert, query for an OPEN telemetryEvent with the
 * same (eventType, tenantId, [vehicleId|deviceId|tripId]).
 * If found: do not create a duplicate. Update timestamp if needed.
 * If not found: create the alert AND a notification.
 *
 * RESOLUTION RULE:
 * When the condition clears (device recovers, trip completes, etc.):
 * find the OPEN alert and set status=RESOLVED.
 * Create a RESOLVED-type event as a history fact.
 */

import { db } from "@/lib/db/client";
import { telemetryEvents, notifications } from "@/lib/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { genId } from "@/lib/helpers";

export type AlertEventType =
  | "DEVICE_OFFLINE"
  | "DEVICE_RECOVERED"
  | "STALE_TELEMETRY"
  | "TRIP_DELAYED"
  | "TRIP_ON_TIME_RECOVERED"
  | "GEOFENCE_ENTER"    // these come from geofenceEvaluator — not created here
  | "GEOFENCE_EXIT"

export interface CreateAlertParams {
  tenantId: string;
  eventType: AlertEventType;
  severity: "INFO" | "WARNING" | "CRITICAL";
  message: string;
  vehicleId?: string | null;
  deviceId?: string | null;
  tripId?: string | null;
  driverId?: string | null;
  source?: string;
  metadata?: Record<string, unknown>;
  // Notification delivery:
  entityType?: string;  // TRIP | VEHICLE | DRIVER | DEVICE
  entityId?: string;
  entityRoute?: string; // /operations/trips/[id] etc.
}

/**
 * Creates an alert (telemetryEvent) and linked notification IF no matching
 * OPEN alert already exists (deduplication).
 * Returns the alert ID if created, null if deduplicated.
 */
export async function createAlertIfNotOpen(params: CreateAlertParams): Promise<string | null> {
  const { tenantId, eventType, vehicleId, deviceId, tripId } = params;

  // Deduplication check: find any OPEN alert of same type for same entity:
  const conditions: any[] = [
    eq(telemetryEvents.tenantId, tenantId),
    eq(telemetryEvents.eventType, eventType),
    eq(telemetryEvents.status, "OPEN"),
  ];
  if (vehicleId) conditions.push(eq(telemetryEvents.vehicleId, vehicleId));
  if (deviceId)  conditions.push(eq(telemetryEvents.deviceId, deviceId));
  if (tripId)    conditions.push(eq(telemetryEvents.tripId, tripId));

  const existing = await db.query.telemetryEvents.findFirst({
    where: and(...conditions as [any, ...any[]]),
    columns: { id: true },
  });

  if (existing) return null; // already open — no duplicate

  // Create the alert:
  const alertId = genId();
  await db.insert(telemetryEvents).values({
    id: alertId,
    tenantId,
    eventType,
    severity: params.severity,
    status: "OPEN",
    vehicleId: vehicleId ?? null,
    deviceId:  deviceId  ?? null,
    tripId:    tripId    ?? null,
    driverId:  params.driverId ?? null,
    source:    params.source ?? "PLATFORM",
    eventAt:   new Date(),
    metadata:  params.metadata as any ?? null,
  } as any);

  // Create notification (tenant-wide broadcast; future: target specific user roles):
  if (params.entityType || params.entityRoute) {
    await db.insert(notifications).values({
      id:          genId(),
      tenantId,
      message:     params.message,
      type:        eventType,
      severity:    params.severity,
      entityType:  params.entityType ?? null,
      entityId:    params.entityId   ?? null,
      entityRoute: params.entityRoute ?? null,
      alertId,
      read:        false,
    } as any);
  }

  return alertId;
}

/**
 * Resolves all OPEN alerts of a given type for an entity.
 * Called when the condition clears (device recovers, trip completes, etc.).
 */
export async function resolveOpenAlerts(params: {
  tenantId: string;
  eventType: AlertEventType;
  vehicleId?: string | null;
  deviceId?: string | null;
  tripId?: string | null;
  resolvedBy?: string;
}): Promise<number> {
  const { tenantId, eventType, vehicleId, deviceId, tripId } = params;

  const conditions: any[] = [
    eq(telemetryEvents.tenantId, tenantId),
    eq(telemetryEvents.eventType, eventType),
    eq(telemetryEvents.status, "OPEN"),
  ];
  if (vehicleId) conditions.push(eq(telemetryEvents.vehicleId, vehicleId));
  if (deviceId)  conditions.push(eq(telemetryEvents.deviceId, deviceId));
  if (tripId)    conditions.push(eq(telemetryEvents.tripId, tripId));

  const openAlerts = await db.query.telemetryEvents.findMany({
    where: and(...conditions as [any, ...any[]]),
    columns: { id: true },
  });

  if (openAlerts.length === 0) return 0;

  const now = new Date();
  for (const alert of openAlerts) {
    await db.update(telemetryEvents)
      .set({ status: "RESOLVED", resolvedAt: now, resolvedBy: params.resolvedBy ?? null } as any)
      .where(eq(telemetryEvents.id, alert.id));
  }

  return openAlerts.length;
}
