export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { trips, vehicleGpsHistory, drivers } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, and, desc, asc } from "drizzle-orm";

const DEFAULT_LIMIT = 200;
const MAX_LIMIT     = 500;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

  // DRIVER can only view their own trip history:
  if (session!.type === "USER" && (session!.user as any).role === "DRIVER") {
    const driverProfile = await db.query.drivers.findFirst({
      where: (d, { eq: eq2 }) => eq2(d.userId, session!.user.id),
      columns: { id: true },
    });
    if (!driverProfile || driverProfile.id !== trip.driverId) {
      return NextResponse.json({ error: "Not your trip" }, { status: 403 });
    }
  }

  const url = new URL(req.url);
  const rawLimit = parseInt(url.searchParams.get("limit") ?? String(DEFAULT_LIMIT), 10);
  const limit = Math.min(isNaN(rawLimit) || rawLimit < 1 ? DEFAULT_LIMIT : rawLimit, MAX_LIMIT);

  // Bounded DB query — fetch only the LATEST N rows (ordered DESC), then reverse for chronological:
  const rows = await db.query.vehicleGpsHistory.findMany({
    where: and(eq(vehicleGpsHistory.tripId, id), eq(vehicleGpsHistory.tenantId, tenantId)),
    orderBy: desc(vehicleGpsHistory.recordedAt),
    limit,
    columns: { lat: true, lng: true, accuracy: true, speed: true, heading: true, recordedAt: true },
  });

  // Return chronologically (oldest first):
  const history = rows.reverse();

  return NextResponse.json({
    tripId: id,
    limit,
    total: history.length,
    history,
  });
}
