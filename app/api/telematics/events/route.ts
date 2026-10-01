export const dynamic = "force-dynamic";
/**
 * GET /api/telematics/events — list telemetry events with filter support
 * PATCH /api/telematics/events — bulk acknowledge
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { telemetryEvents } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { checkPermission, PERMISSIONS } from "@/lib/requirePermission";
import { eq, and, desc, inArray } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  const tenantId = getSessionTenantId(session);
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const _permDeny = await checkPermission(session, tenantId, PERMISSIONS.TRIPS_VIEW_LIVE);
  if (_permDeny) return _permDeny;

  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const vehicleId = url.searchParams.get("vehicleId");
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "100"), 500);

  const conditions = [eq(telemetryEvents.tenantId, tenantId)];
  if (status) conditions.push(eq(telemetryEvents.status, status));
  if (vehicleId) conditions.push(eq(telemetryEvents.vehicleId, vehicleId));

  const events = await db.query.telemetryEvents.findMany({
    where: and(...conditions as [any, ...any[]]),
    orderBy: desc(telemetryEvents.eventAt),
    limit,
  });
  return NextResponse.json({ events, total: events.length });
}

export async function PATCH(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  const tenantId = getSessionTenantId(session);
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const _permDeny = await checkPermission(session, tenantId, PERMISSIONS.TRIPS_VIEW_LIVE);
  if (_permDeny) return _permDeny;

  const { eventIds } = await req.json().catch(() => ({}));
  if (!Array.isArray(eventIds) || eventIds.length === 0) {
    return NextResponse.json({ error: "eventIds required" }, { status: 400 });
  }
  const now = new Date();
  await db.update(telemetryEvents)
    .set({
      status: "ACKNOWLEDGED",
      acknowledgedBy: (session as any)?.user?.id ?? null,
      acknowledgedAt: now,
    })
    .where(and(
      eq(telemetryEvents.tenantId, tenantId),
      inArray(telemetryEvents.id, eventIds)
    ));
  return NextResponse.json({ ok: true, acknowledged: eventIds.length });
}
