export const dynamic = "force-dynamic";

/**
 * GPS Demo Mode API — Production UAT Hotfix.
 *
 * [id] may be either the internal trips.id (UUID) or the business-facing
 * trips.tripNumber (e.g. "TRIP-MU69IH00-697").  Both are resolved
 * tenant-scoped via resolveDemoTrip().
 *
 * All existing commercial safety guarantees are preserved:
 * - Uses shared GPS ingestion: validateGpsPing → persistGpsPing → processGpsGeofence
 * - Never advances lifecycle, creates POD, invoices, or contract usage.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { validateGpsPing, persistGpsPing, processGpsGeofence } from "@/lib/gpsIngestion";
import { resolveDemoTrip } from "@/lib/resolveDemoTrip";

function demoEnabled(): boolean {
  return process.env.GPS_DEMO_ENABLED === "true";
}

// ── GET: resolve trip + return Loading Point / Customer Site coords ────────────
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!demoEnabled()) {
    return NextResponse.json({ error: "GPS Demo Mode is not enabled on this server" }, { status: 403 });
  }

  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN"])) {
    return NextResponse.json({ error: "Unauthorized — GPS Demo requires ADMIN role" }, { status: 401 });
  }

  const { id } = await params;
  const tenantId = getSessionTenantId(session)!;

  // Resolve by trips.id OR trips.tripNumber — always tenant-scoped:
  const trip = await resolveDemoTrip(id, tenantId);
  if (!trip) {
    return NextResponse.json(
      { error: "Trip not found for current tenant — check the Trip Number or contact support" },
      { status: 404 }
    );
  }

  if (trip.status === "COMPLETED") {
    return NextResponse.json(
      { error: "Trip is completed and cannot be used for GPS Demo" },
      { status: 422 }
    );
  }

  const loadingPoint = trip.warehouse
    ? { name: trip.warehouse.name, lat: trip.warehouse.lat, lng: trip.warehouse.lng,
        radius: trip.warehouse.geofenceRadiusMeters }
    : null;

  const stop = trip.stops?.[0];
  const customerSite = stop?.order?.location
    ? { label: stop.order.location.label, lat: stop.order.location.lat,
        lng: stop.order.location.lng, radius: stop.order.location.geofenceRadiusMeters }
    : null;

  return NextResponse.json({
    // Always return the canonical internal trip ID regardless of which identifier was used:
    tripId: trip.id,
    tripNumber: trip.tripNumber,
    vehicleId: trip.vehicleId,
    driverId: trip.driverId,
    status: trip.status,
    loadingConfirmed: trip.loadingConfirmed,
    loadingPoint,
    customerSite,
    demoEnabled: true,
  });
}

// ── POST: receive a single demo GPS coordinate and run the normal pipeline ─────
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!demoEnabled()) {
    return NextResponse.json({ error: "GPS Demo Mode is not enabled on this server" }, { status: 403 });
  }

  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN"])) {
    return NextResponse.json({ error: "Unauthorized — GPS Demo requires ADMIN role" }, { status: 401 });
  }

  const { id } = await params;
  const tenantId = getSessionTenantId(session)!;

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const pingErrors = validateGpsPing(body);
  if (pingErrors.length > 0) {
    return NextResponse.json({ errors: pingErrors, errorCode: "INVALID_GPS_COORDINATES" }, { status: 422 });
  }

  // Resolve trip — [id] may be internal UUID or business tripNumber:
  const trip = await resolveDemoTrip(id, tenantId);
  if (!trip) {
    return NextResponse.json({ error: "Trip not found for current tenant" }, { status: 404 });
  }
  if (trip.status === "COMPLETED") {
    return NextResponse.json({ error: "Cannot demo GPS on a completed trip" }, { status: 422 });
  }

  const ping = {
    tenantId,
    tripId: trip.id,       // canonical internal ID — always
    vehicleId: trip.vehicleId,
    driverId: trip.driverId,
    lat: body.lat,
    lng: body.lng,
    accuracy: body.accuracy ?? null,
    speed: body.speed ?? null,
    heading: body.heading ?? null,
  };

  await persistGpsPing(ping);
  processGpsGeofence(ping); // non-blocking

  return NextResponse.json({
    ok: true,
    lat: ping.lat,
    lng: ping.lng,
    tripId: trip.id,
    source: "DEMO",
    recordedAt: new Date().toISOString(),
  });
}
