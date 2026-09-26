export const dynamic = "force-dynamic";
/**
 * P2-02: Driver candidates for a planned trip.
 * GET /api/fleet/eligible-drivers[?tripId=<id>]
 * Response: { results: EligibilityResult<DriverCandidate>[], eligibleCount }
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { trips } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { getSessionFromRequest, getSessionTenantId } from "@/lib/auth";
import { getDriverEligibility } from "@/lib/dispatchEligibility";
import { checkPermission, PERMISSIONS } from "@/lib/requirePermission";

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = getSessionTenantId(session)!;
  const _deny = await checkPermission(session, tenantId, PERMISSIONS.TRIPS_ASSIGN);
  if (_deny) return _deny;
  const tripId = new URL(req.url).searchParams.get("tripId");
  if (tripId) {
    const trip = await db.query.trips.findFirst({ where: and(eq(trips.id, tripId), eq(trips.tenantId, tenantId)), columns: { id: true } });
    if (!trip) return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }
  const results = await getDriverEligibility(tenantId, { excludeTripId: tripId ?? undefined });
  return NextResponse.json({ results, eligibleCount: results.filter(r => r.eligible).length });
}
