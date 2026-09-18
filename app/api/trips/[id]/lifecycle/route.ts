export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { trips, tripLifecycleEvents } from "@/lib/db/schema";
import { enforceRbac } from "@/lib/enforceRbac";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, and, asc } from "drizzle-orm";
import { genId } from "@/lib/helpers";
import { z } from "zod";

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
  if (!hasRole(session, ["ADMIN", "DISPATCHER", "DRIVER"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;

  const trip = await db.query.trips.findFirst({
    where: and(eq(trips.id, id), eq(trips.tenantId, tenantId)),
  });
  if (!trip) return NextResponse.json({ error: "Trip not found" }, { status: 404 });

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
  if (!hasRole(session, ["ADMIN", "DISPATCHER", "DRIVER"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;
  const _deny = await enforceRbac(session, tenantId, "dispatch"); if (_deny) return _deny;

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const parsed = lifecycleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { eventType, lat, lng, notes, loadedLiters, deliveredLiters } = parsed.data;

  const trip = await db.query.trips.findFirst({
    where: and(eq(trips.id, id), eq(trips.tenantId, tenantId)),
  });
  if (!trip) return NextResponse.json({ error: "Trip not found" }, { status: 404 });

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
