export const dynamic = "force-dynamic";
/**
 * GET /api/telematics/trips/[id]/replay
 * Trip Replay — returns the ACTUAL GPS trace from vehicleGpsHistory.
 * Returns chronological position history.
 * PLANNED ROUTE ≠ ACTUAL GPS TRACE — this is the actual trace only.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { trips, vehicleGpsHistory } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { checkPermission, PERMISSIONS } from "@/lib/requirePermission";
import { eq, and, asc, desc } from "drizzle-orm";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getSessionFromRequest(req);
  const tenantId = getSessionTenantId(session);
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const _permDeny = await checkPermission(session, tenantId, PERMISSIONS.TRIPS_VIEW_LIVE);
  if (_permDeny) return _permDeny;

  const trip = await db.query.trips.findFirst({
    where: and(eq(trips.id, id), eq(trips.tenantId, tenantId)),
    with: {
      vehicle: { columns: { id: true, plateNumber: true, vehicleType: true } },
      driver: { with: { user: { columns: { id: true, name: true } } } },
    },
    columns: {
      id: true, tripNumber: true, status: true, tenantId: true,
      startedAt: true, completedAt: true, vehicleId: true, driverId: true,
    },
  });
  if (!trip) return NextResponse.json({ error: "Trip not found" }, { status: 404 });

  const history = await db.query.vehicleGpsHistory.findMany({
    where: and(eq(vehicleGpsHistory.tripId, id), eq(vehicleGpsHistory.tenantId, tenantId)),
    orderBy: asc(vehicleGpsHistory.recordedAt),
    columns: {
      lat: true, lng: true, speed: true, heading: true,
      accuracy: true, recordedAt: true, source: true,
    },
  });

  return NextResponse.json({
    trip: {
      id: trip.id,
      tripNumber: trip.tripNumber,
      status: trip.status,
      startedAt: trip.startedAt,
      completedAt: trip.completedAt,
      vehicle: trip.vehicle,
      driver: trip.driver ? { id: trip.driver.id, name: trip.driver.user?.name } : null,
    },
    // IMPORTANT: this is the actual GPS trace recorded from the vehicle/driver.
    // It is NOT the Google Routes planned route (available via /api/trips/[id]/demo-route).
    actualTrace: history,
    traceType: "ACTUAL_GPS",
    pointCount: history.length,
    hasDemoPoints: history.some(p => p.source === "DEMO"),
  });
}
