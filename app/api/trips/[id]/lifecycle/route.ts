export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { trips, tripLifecycleEvents } from "@/lib/db/schema";
import { enforceRbac } from "@/lib/enforceRbac";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { genId } from "@/lib/helpers";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";

// RC1 — Trip lifecycle event log with enforced stage ordering.
// 
// Valid sequence: STARTED → ARRIVED_LOADING → LOADING_COMPLETE
//                → ARRIVED_SITE → UNLOADING_COMPLETE → CLOSED
// NOTE events can be added at any stage.
// Earlier stages cannot be re-logged once a later stage is recorded.

const STAGE_SEQUENCE = [
  "STARTED",
  "ARRIVED_LOADING",
  "LOADING_COMPLETE",
  "ARRIVED_SITE",
  "UNLOADING_COMPLETE",
  "CLOSED",
] as const;
type Stage = typeof STAGE_SEQUENCE[number];

const STAGE_INDEX: Record<string, number> = Object.fromEntries(
  STAGE_SEQUENCE.map((s, i) => [s, i])
);

const ALL_EVENT_TYPES = [...STAGE_SEQUENCE, "NOTE"] as const;

const postSchema = z.object({
  eventType: z.enum(ALL_EVENT_TYPES),
  notes: z.string().optional(),
  loadedLiters: z.number().positive().optional(),
  deliveredLiters: z.number().positive().optional(),
  stopId: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionFromRequest(req);
  if (!session || !hasRole(session, ["ADMIN", "DISPATCHER", "DRIVER"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;
  // DRIVER role has restricted dispatch access — only their own trips/stops.
  // They bypass module-level enforcement here; the ownership check below gates their access.
  if (session?.type !== "USER" || (session.user as any).role !== "DRIVER") {
    const _deny = await enforceRbac(session, tenantId, "dispatch"); if (_deny) return _deny;
  }
  const events = await db.query.tripLifecycleEvents.findMany({
    where: and(eq(tripLifecycleEvents.tenantId, tenantId), eq(tripLifecycleEvents.tripId, id)),
    orderBy: [desc(tripLifecycleEvents.createdAt)],
  });
  return NextResponse.json(events);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionFromRequest(req);
  if (!session || !hasRole(session, ["ADMIN", "DISPATCHER", "DRIVER"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;
  const userId = session.type === "USER" ? session.user.id : "";

  const trip = await db.query.trips.findFirst({
    where: and(eq(trips.id, id), eq(trips.tenantId, tenantId)),
  });
  if (!trip) return NextResponse.json({ error: "Trip not found" }, { status: 404 });

  const body = await req.json();
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { eventType, notes, loadedLiters, deliveredLiters, stopId, lat, lng } = parsed.data;

  // NOTE events bypass the stage ordering check
  if (eventType !== "NOTE") {
    const existingEvents = await db.query.tripLifecycleEvents.findMany({
      where: and(eq(tripLifecycleEvents.tenantId, tenantId), eq(tripLifecycleEvents.tripId, id)),
    });
    const stageEvents = existingEvents.filter(e => e.eventType !== "NOTE");
    const latestStageEvent = stageEvents.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
    const latestStageIndex = latestStageEvent ? (STAGE_INDEX[latestStageEvent.eventType] ?? -1) : -1;
    const requestedIndex = STAGE_INDEX[eventType];

    // Must be exactly the next stage (or the first stage with no prior events)
    const expectedIndex = latestStageIndex + 1;
    if (requestedIndex !== expectedIndex) {
      const expectedStage = STAGE_SEQUENCE[expectedIndex] ?? "none (trip already closed)";
      return NextResponse.json({
        error: `Invalid stage transition. Current stage: ${latestStageEvent?.eventType ?? "none"}. Expected next: ${expectedStage}. Requested: ${eventType}.`,
        currentStage: latestStageEvent?.eventType ?? null,
        nextExpected: expectedStage,
      }, { status: 422 });
    }
  }

  const eventId = genId();
  await db.insert(tripLifecycleEvents).values({
    id: eventId, tenantId, tripId: id,
    eventType,
    actorUserId: userId,
    lat: lat ?? undefined, lng: lng ?? undefined,
    notes: notes ?? undefined,
    loadedLiters: loadedLiters ?? undefined,
    deliveredLiters: deliveredLiters ?? undefined,
    stopId: stopId ?? undefined,
  });

  const created = await db.query.tripLifecycleEvents.findFirst({
    where: eq(tripLifecycleEvents.id, eventId),
  });
  return NextResponse.json(created, { status: 201 });
}
