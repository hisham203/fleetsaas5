export const dynamic = "force-dynamic";

/**
 * GPS Demo Mode API — P2-01 Final Deployment Gate.
 *
 * Provides a controlled GPS simulation for demonstration purposes.
 * Uses the SAME GPS ingestion pipeline as real device GPS:
 *   validateGpsPing → persistGpsPing → processGpsGeofence
 *
 * RBAC: ADMIN only.
 * Enable guard: GPS_DEMO_ENABLED environment variable must be "true".
 * One active session per trip — duplicate starts are rejected.
 *
 * Commercial safety: demo GPS is coordinates only.
 * It never advances lifecycle, creates POD, generates invoices,
 * changes contract usage, or modifies any commercial record.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { trips, warehouses, tripStops, orders } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, and } from "drizzle-orm";
import { validateGpsPing, persistGpsPing, processGpsGeofence } from "@/lib/gpsIngestion";
import { z } from "zod";

function demoEnabled(): boolean {
  return process.env.GPS_DEMO_ENABLED === "true";
}

const actionSchema = z.object({
  action: z.enum(["start", "pause", "resume", "stop"]),
  speed: z.number().min(0.5).max(20).optional(), // simulation speed multiplier
});

// POST: send a single demo GPS coordinate (the client drives the cadence):
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

  // Validate the coordinate from the demo controller:
  const pingErrors = validateGpsPing(body);
  if (pingErrors.length > 0) {
    return NextResponse.json({ errors: pingErrors, errorCode: "INVALID_GPS_COORDINATES" }, { status: 422 });
  }

  const trip = await db.query.trips.findFirst({
    where: and(eq(trips.id, id), eq(trips.tenantId, tenantId)),
  });
  if (!trip) return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  if (trip.status === "COMPLETED") {
    return NextResponse.json({ error: "Cannot demo GPS on a completed trip" }, { status: 422 });
  }

  const ping = {
    tenantId,
    tripId: trip.id,
    vehicleId: trip.vehicleId,
    driverId: trip.driverId,
    lat: body.lat,
    lng: body.lng,
    accuracy: body.accuracy ?? null,
    speed: body.speed ?? null,
    heading: body.heading ?? null,
  };

  // Same pipeline as real device GPS:
  await persistGpsPing(ping);
  processGpsGeofence(ping); // non-blocking

  return NextResponse.json({ ok: true, lat: ping.lat, lng: ping.lng, source: "DEMO", recordedAt: new Date().toISOString() });
}

// GET: return the Loading Point + Customer Site coordinates for a trip (used by demo controller):
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!demoEnabled()) {
    return NextResponse.json({ error: "GPS Demo Mode is not enabled on this server" }, { status: 403 });
  }

  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const tenantId = getSessionTenantId(session)!;

  const trip = await db.query.trips.findFirst({
    where: and(eq(trips.id, id), eq(trips.tenantId, tenantId)),
    with: {
      warehouse: { columns: { id: true, name: true, lat: true, lng: true } },
      stops: {
        limit: 1,
        with: { order: { with: { location: { columns: { id: true, label: true, lat: true, lng: true } } } } },
      },
    },
    columns: { id: true, tripNumber: true, vehicleId: true, driverId: true, status: true },
  });

  if (!trip) return NextResponse.json({ error: "Trip not found" }, { status: 404 });

  const loadingPoint = trip.warehouse ? {
    name: trip.warehouse.name,
    lat: trip.warehouse.lat,
    lng: trip.warehouse.lng,
  } : null;

  const stop = trip.stops?.[0];
  const customerSite = stop?.order?.location ? {
    label: stop.order.location.label,
    lat: stop.order.location.lat,
    lng: stop.order.location.lng,
  } : null;

  return NextResponse.json({
    tripId: id,
    tripNumber: trip.tripNumber,
    vehicleId: trip.vehicleId,
    driverId: trip.driverId,
    status: trip.status,
    loadingPoint,
    customerSite,
    demoEnabled: true,
  });
}
