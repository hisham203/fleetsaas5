export const dynamic = "force-dynamic";
/**
 * GET /api/alerts — operational alert workspace
 * Returns telemetry_events acting as operational alerts.
 * Supports filter by status, severity, eventType, vehicleId, tripId, deviceId.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { telemetryEvents } from "@/lib/db/schema";
import { getSessionFromRequest, getSessionTenantId } from "@/lib/auth";
import { checkPermission, PERMISSIONS } from "@/lib/requirePermission";
import { eq, and, desc } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = getSessionTenantId(session);
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const deny = await checkPermission(session, tenantId, PERMISSIONS.CONTROL_TOWER_VIEW);
  if (deny) return deny;

  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const severity = url.searchParams.get("severity");
  const vehicleId = url.searchParams.get("vehicleId");
  const tripId = url.searchParams.get("tripId");
  const deviceId = url.searchParams.get("deviceId");
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "100"), 500);

  const conditions: any[] = [eq(telemetryEvents.tenantId, tenantId)];
  if (status) conditions.push(eq(telemetryEvents.status, status));
  if (severity) conditions.push(eq(telemetryEvents.severity, severity));
  if (vehicleId) conditions.push(eq(telemetryEvents.vehicleId, vehicleId));
  if (tripId) conditions.push(eq(telemetryEvents.tripId, tripId));
  if (deviceId) conditions.push(eq(telemetryEvents.deviceId, deviceId));

  const events = await db.query.telemetryEvents.findMany({
    where: and(...conditions as [any, ...any[]]),
    orderBy: desc(telemetryEvents.eventAt),
    limit,
  });

  const openCount = events.filter(e => e.status === "OPEN").length;
  const criticalOpen = events.filter(e => e.status === "OPEN" && e.severity === "CRITICAL").length;

  return NextResponse.json({ alerts: events, openCount, criticalOpen, total: events.length });
}
