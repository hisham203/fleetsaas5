export const dynamic = "force-dynamic";
/**
 * P2-02: Tanker candidates for a planned trip.
 *
 * GET /api/fleet/eligible-vehicles?tripId=<id>   (canonical — capacity derived trip → stop → order)
 * GET /api/fleet/eligible-vehicles?capacity=<L>  (explicit capacity)
 *
 * Response contract (stable — see tests/integration/p2_02DispatchContracts.test.ts):
 *   { results: EligibilityResult<VehicleCandidate>[], eligibleCount, requiredTankerCapacityLtr }
 * Every tenant vehicle is returned with availability AVAILABLE | BUSY | INELIGIBLE and a reason.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { trips } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { getSessionFromRequest, getSessionTenantId } from "@/lib/auth";
import { getVehicleEligibility, getTripCapacityRequirement } from "@/lib/dispatchEligibility";
import { checkPermission, PERMISSIONS } from "@/lib/requirePermission";

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = getSessionTenantId(session)!;
  const _deny = await checkPermission(session, tenantId, PERMISSIONS.TRIPS_ASSIGN);
  if (_deny) return _deny;
  const url = new URL(req.url);
  const tripId = url.searchParams.get("tripId");

  if (tripId) {
    const trip = await db.query.trips.findFirst({ where: and(eq(trips.id, tripId), eq(trips.tenantId, tenantId)), columns: { id: true } });
    if (!trip) return NextResponse.json({ error: "Trip not found" }, { status: 404 });
    const { required, mixed } = await getTripCapacityRequirement(trip.id);
    if (mixed) {
      return NextResponse.json({ error: "Trip orders require different tanker capacities", errorCode: "TANKER_CAPACITY_MIXED" }, { status: 422 });
    }
    const results = await getVehicleEligibility(tenantId, required, { excludeTripId: trip.id });
    return NextResponse.json({ results, eligibleCount: results.filter(r => r.eligible).length, requiredTankerCapacityLtr: required });
  }

  const capacity = parseInt(url.searchParams.get("capacity") ?? "0", 10);
  if (!capacity) return NextResponse.json({ error: "tripId or capacity query parameter required" }, { status: 400 });
  const results = await getVehicleEligibility(tenantId, capacity);
  return NextResponse.json({ results, eligibleCount: results.filter(r => r.eligible).length, requiredTankerCapacityLtr: capacity });
}
