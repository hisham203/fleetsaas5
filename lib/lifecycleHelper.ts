// RC1 — Reliable lifecycle event persistence for UNLOADING_COMPLETE and CLOSED.
//
// These events are mandatory operational state — they cannot be fire-and-forget.
// This helper ensures:
// - Idempotent insertion (won't create duplicates on retry)
// - Errors are propagated (not silently swallowed)
// - CLOSED follows UNLOADING_COMPLETE in correct sequence

import { db } from "@/lib/db/client";
import { tripLifecycleEvents, trips } from "@/lib/db/schema";
import { genId } from "@/lib/helpers";
import { eq, and } from "drizzle-orm";

const STAGE_SEQUENCE = [
  "STARTED", "ARRIVED_LOADING", "LOADING_COMPLETE",
  "ARRIVED_SITE", "UNLOADING_COMPLETE", "CLOSED",
] as const;

/**
 * Idempotently records a mandatory lifecycle event.
 * Returns the existing event if already recorded (retry-safe).
 * Throws if the DB write fails — callers must handle or propagate.
 */
export async function recordLifecycleEvent(params: {
  tenantId: string;
  tripId: string;
  eventType: string;
  actorUserId?: string;
  stopId?: string;
  deliveredLiters?: number;
  notes?: string;
}) {
  const { tenantId, tripId, eventType } = params;

  // Idempotency: if this stage already exists, return the existing record
  const existing = await db.query.tripLifecycleEvents.findFirst({
    where: and(
      eq(tripLifecycleEvents.tenantId, tenantId),
      eq(tripLifecycleEvents.tripId, tripId),
      eq(tripLifecycleEvents.eventType, eventType)
    ),
  });
  if (existing) return existing;

  const id = genId();
  await db.insert(tripLifecycleEvents).values({
    id,
    tenantId,
    tripId,
    eventType,
    actorUserId: params.actorUserId,
    stopId: params.stopId,
    deliveredLiters: params.deliveredLiters,
    notes: params.notes,
  });

  return db.query.tripLifecycleEvents.findFirst({
    where: eq(tripLifecycleEvents.id, id),
  });
}

/**
 * Records UNLOADING_COMPLETE after successful POD, then CLOSED after all stops resolved.
 * Both are mandatory — errors are thrown, not swallowed.
 *
 * CLOSED is only written when the trip is already in COMPLETED status
 * (i.e., autoCloseTripIfAllStopsResolved has already run).
 */
export async function recordUnloadingComplete(params: {
  tenantId: string;
  tripId: string;
  actorUserId?: string;
  stopId?: string;
  deliveredLiters?: number;
}) {
  // 1. Record UNLOADING_COMPLETE — mandatory, errors propagate
  await recordLifecycleEvent({
    tenantId: params.tenantId,
    tripId: params.tripId,
    eventType: "UNLOADING_COMPLETE",
    actorUserId: params.actorUserId,
    stopId: params.stopId,
    deliveredLiters: params.deliveredLiters,
  });

  // 2. If trip is now COMPLETED (all stops resolved), record CLOSED lifecycle event
  // We check the trip status — autoCloseTripIfAllStopsResolved runs before this helper
  const trip = await db.query.trips.findFirst({
    where: and(eq(trips.id, params.tripId), eq(trips.tenantId, params.tenantId)),
  });
  if (trip?.status === "COMPLETED") {
    await recordLifecycleEvent({
      tenantId: params.tenantId,
      tripId: params.tripId,
      eventType: "CLOSED",
      actorUserId: params.actorUserId,
      notes: "Trip closed automatically after all stops resolved",
    });
  }
}
