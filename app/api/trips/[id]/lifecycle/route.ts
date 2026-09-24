export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { trips, tripLifecycleEvents, drivers } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, and, asc } from "drizzle-orm";
import { genId } from "@/lib/helpers";
import { z } from "zod";
import { checkPermission, PERMISSIONS } from "@/lib/requirePermission";

// Ordered sequence of operational lifecycle stages.
// NOTE is a free-form annotation that bypasses ordering checks.
const STAGE_SEQUENCE = [
  "STARTED",
  "ARRIVED_LOADING",
  "LOADING_COMPLETE",
  "ARRIVED_SITE",
  "UNLOADING_COMPLETE",
  "CLOSED",
] as const;

const VALID_EVENT_TYPES = ["STARTED","ARRIVED_LOADING","LOADING_COMPLETE","ARRIVED_SITE","UNLOADING_COMPLETE","CLOSED","NOTE","EXCEPTION","GPS_PING"] as const;

const lifecycleSchema = z.object({
  eventType: z.enum(VALID_EVENT_TYPES),
  lat: z.number().optional(),
  lng: z.number().optional(),
  notes: z.string().optional(),
  loadedLiters: z.number().optional(),
  deliveredLiters: z.number().optional(),
});

// ── GET: Trip lifecycle history (P2-01 Control Tower timeline) ────────────────
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionFromRequest(req);
  // P2-02 Final: Capability check — permission system authoritative.
  // DRIVER_IDENTITY (session.user.role === "DRIVER") below is ADDITIONAL identity validation.
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { checkPermission: _cp, PERMISSIONS: _PERMS } = await import("@/lib/requirePermission");
  const { hasRole: _hr } = await import("@/lib/auth");
  if (!_hr(session, ["ADMIN"])) {
    const _lDeny = await _cp(session, getSessionTenantId(session)!, _PERMS.TRIPS_VIEW);
    if (_lDeny) return _lDeny;
  }
  const tenantId = getSessionTenantId(session)!;

  const trip = await db.query.trips.findFirst({
    where: and(eq(trips.id, id), eq(trips.tenantId, tenantId)),
  });
  if (!trip) return NextResponse.json({ error: "Trip not found" }, { status: 404 });

  const driverRole = (session as any)?.user?.role === "DRIVER";
  // Also validate driver identity — a driver cannot execute another driver's trip:
  if (driverRole) {
    const driverRecord = await db.query.drivers.findFirst({
      where: and(eq(drivers.userId, (session as any).user.id), eq(drivers.tenantId, tenantId)),
    });
    if (!driverRecord || driverRecord.id !== trip.driverId) {
      return NextResponse.json({ error: "You are not assigned to this trip", errorCode: "NOT_ASSIGNED" }, { status: 403 });
    }
  }

  const events = await db.query.tripLifecycleEvents.findMany({
    where: and(eq(tripLifecycleEvents.tripId, id), eq(tripLifecycleEvents.tenantId, tenantId)),
    orderBy: asc(tripLifecycleEvents.id),
    columns: {
      id: true, eventType: true, lat: true, lng: true,
      notes: true, loadedLiters: true, deliveredLiters: true, createdAt: true,
    },
  });

  return NextResponse.json({
    tripId: id,
    tripStatus: trip.status,
    startedAt: trip.startedAt,
    completedAt: trip.completedAt,
    loadingConfirmed: trip.loadingConfirmed,
    events,
  });
}

// ── POST: Record a lifecycle stage event ──────────────────────────────────────
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionFromRequest(req);
  // P2-02 Final: Capability check — permission system authoritative.
  // DRIVER_IDENTITY (session.user.role === "DRIVER") below is ADDITIONAL identity validation.
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { checkPermission: _cp, PERMISSIONS: _PERMS } = await import("@/lib/requirePermission");
  const { hasRole: _hr } = await import("@/lib/auth");
  if (!_hr(session, ["ADMIN"])) {
    const _lDeny = await _cp(session, getSessionTenantId(session)!, _PERMS.TRIPS_VIEW);
    if (_lDeny) return _lDeny;
  }
  const tenantId = getSessionTenantId(session)!;
  const _permDeny1 = await checkPermission(session, tenantId, PERMISSIONS.TRIPS_VIEW); if (_permDeny1) return _permDeny1;

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const parsed = lifecycleSchema.safeParse(body);
  const driverRole = (session as any)?.user?.role === "DRIVER";
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { eventType, lat, lng, notes, loadedLiters, deliveredLiters } = parsed.data;

  const trip = await db.query.trips.findFirst({
    where: and(eq(trips.id, id), eq(trips.tenantId, tenantId)),
  });
  if (!trip) return NextResponse.json({ error: "Trip not found" }, { status: 404 });

  // P2-02: DISPATCHED → ARRIVED_LOADING is the first driver action (no separate Start).
  // P2-02: DISPATCHED is the required state before a driver can begin.
  // Also allow STARTED (internal state set when ARRIVED_LOADING is recorded from DISPATCHED).
  if (driverRole && eventType === "ARRIVED_LOADING" && trip.status !== "DISPATCHED" && trip.status !== "STARTED") {
    return NextResponse.json({ error: `Trip not dispatched (status: ${trip.status}). Supervisor must dispatch first.`, errorCode: "TRIP_NOT_DISPATCHED" }, { status: 422 });
  }

  // NOTE and EXCEPTION can be posted at any stage — bypass ordering:
  if (eventType !== "NOTE" && eventType !== "EXCEPTION" && eventType !== "GPS_PING") {
    // Check ordering enforcement against existing events:
    const existing = await db.query.tripLifecycleEvents.findMany({
      where: and(eq(tripLifecycleEvents.tripId, id), eq(tripLifecycleEvents.tenantId, tenantId)),
      columns: { eventType: true },
    });
    const completedStages = existing
      .map((e) => e.eventType)
      .filter((t) => (STAGE_SEQUENCE as readonly string[]).includes(t));

    const stageIdx = STAGE_SEQUENCE.indexOf(eventType as typeof STAGE_SEQUENCE[number]);
    const lastCompleted = completedStages.length > 0
      ? STAGE_SEQUENCE.indexOf(completedStages[completedStages.length - 1] as typeof STAGE_SEQUENCE[number])
      : -1;

    // Must be exactly the next stage (or STARTED for a fresh trip):
    if (stageIdx !== lastCompleted + 1) {
      const nextExpected = STAGE_SEQUENCE[lastCompleted + 1] ?? "NONE";
      return NextResponse.json({
        error: `Invalid stage transition. Current stage: ${completedStages[completedStages.length - 1] ?? "NONE"}. Next expected: ${nextExpected}.`,
        nextExpected,
        current: completedStages[completedStages.length - 1] ?? null,
      }, { status: 422 });
    }
  }

  const actorUserId = session?.type === "USER" ? session.user.id : null;
  const driverProfile = actorUserId
    ? await db.query.drivers.findFirst({
        where: (drivers, { eq: eq2 }) => eq2(drivers.userId, actorUserId),
        columns: { id: true },
      })
    : null;

  // P2-02: lifecycle route does NOT modify trips.status or trips columns directly.
  // Status transitions (STARTED, COMPLETED, loadingConfirmed) happen via PATCH /api/trips/[id].
  // This route only records the lifecycle event — the trip row remains unchanged.
  // NOTE: ARRIVED_LOADING recorded on a DISPATCHED trip signals the driver has begun;
  // the startedAt timestamp is managed by the trip-update mechanism, not here.

  const eventId = genId();
  await db.insert(tripLifecycleEvents).values({
    id: eventId,
    tenantId,
    tripId: id,
    eventType,
    actorUserId,
    driverId: driverProfile?.id ?? trip.driverId ?? null,
    lat: lat ?? null,
    lng: lng ?? null,
    notes: notes ?? null,
    loadedLiters: loadedLiters ?? null,
    deliveredLiters: deliveredLiters ?? null,
  });

  return NextResponse.json({ id: eventId, tripId: id, eventType }, { status: 201 });
}
