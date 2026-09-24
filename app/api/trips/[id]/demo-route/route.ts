export const dynamic = "force-dynamic";

/**
 * Server-side proxy for the Google Routes REST API — P2-01 Package A.
 *
 * Calls routes.googleapis.com/directions/v2:computeRoutes with DRIVE travel mode.
 * Uses GOOGLE_ROUTES_API_KEY (server-only env var) ONLY.
 * Never falls back to NEXT_PUBLIC_GOOGLE_MAPS_API_KEY — fail closed if key absent.
 * The server-side key is NEVER returned to the client.
 * Returns the decoded polyline path as an array of lat/lng points.
 *
 * Called by the GPS Demo controller before starting movement — if this fails,
 * the demo DOES NOT start (no misleading straight-line fallback).
 *
 * ADMIN + GPS_DEMO_ENABLED guard matches the demo-gps endpoint.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { resolveDemoTrip } from "@/lib/resolveDemoTrip";
import { decodePolyline } from "@/lib/routeGeometry";

function demoEnabled() { return process.env.GPS_DEMO_ENABLED === "true"; }

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!demoEnabled()) {
    return NextResponse.json({ error: "GPS Demo Mode is not enabled" }, { status: 403 });
  }

  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN"])) {
    return NextResponse.json({ error: "Unauthorized — ADMIN only" }, { status: 401 });
  }

  const { id } = await params;
  const tenantId = getSessionTenantId(session)!;

  const trip = await resolveDemoTrip(id, tenantId);
  if (!trip) return NextResponse.json({ error: "Trip not found" }, { status: 404 });

  const origin = trip.warehouse;
  const stop = trip.stops?.[0];
  const dest = stop?.order?.location;

  if (!origin?.lat || !origin?.lng || !dest?.lat || !dest?.lng) {
    return NextResponse.json(
      { error: "Trip is missing Loading Point or Customer Site coordinates" },
      { status: 422 }
    );
  }

  // GOOGLE_ROUTES_API_KEY is the ONLY permitted key for server-to-server Routes API calls.
  // NEXT_PUBLIC_GOOGLE_MAPS_API_KEY must NOT be used here — it has browser exposure and
  // different restriction settings appropriate for Maps JS only, not server-to-server calls.
  // Fail closed: if the dedicated key is absent, do not attempt the request and do not
  // fall back to any other key. The GPS Demo will not start, which is the correct behavior.
  const apiKey = process.env.GOOGLE_ROUTES_API_KEY;
  if (!apiKey) {
    // Log a useful server-side message without exposing any secrets:
    console.error(JSON.stringify({ level: "error", event: "demo_route.config_error",
      message: "GOOGLE_ROUTES_API_KEY is not set — GPS Demo road routing is unavailable",
      hint: "Set GOOGLE_ROUTES_API_KEY in Railway environment variables (separate from NEXT_PUBLIC_GOOGLE_MAPS_API_KEY)" }));
    return NextResponse.json({
      error: "GPS Demo road routing is not configured on this server — contact the platform operator",
      errorCode: "ROUTES_API_KEY_MISSING",
    }, { status: 503 });
  }

  // Call Google Routes REST API (POST routes.googleapis.com/directions/v2:computeRoutes):
  const body = {
    origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
    destination: { location: { latLng: { latitude: dest.lat, longitude: dest.lng } } },
    travelMode: "DRIVE",
    computeAlternativeRoutes: false,
    routingPreference: "TRAFFIC_UNAWARE",
  };

  const routesRes = await fetch(
    "https://routes.googleapis.com/directions/v2:computeRoutes",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "routes.polyline.encodedPolyline,routes.distanceMeters,routes.duration", // minimise response payload
      },
      body: JSON.stringify(body),
    }
  ).catch(() => null);

  if (!routesRes?.ok) {
    return NextResponse.json(
      { error: "Google Routes API request failed — check API key and Routes API enablement in Google Cloud Console" },
      { status: 502 }
    );
  }

  const data = await routesRes.json().catch(() => null);
  const route = data?.routes?.[0];
  const encoded = route?.polyline?.encodedPolyline;

  if (!encoded) {
    return NextResponse.json(
      { error: "Routes API returned no route — verify Loading Point and Customer Site coordinates" },
      { status: 422 }
    );
  }

  const path = decodePolyline(encoded);

  return NextResponse.json({
    tripId: trip.id,
    tripNumber: trip.tripNumber,
    path,
    distanceMeters: route.distanceMeters ?? null,
    duration: route.duration ?? null,
    originLat: origin.lat,
    originLng: origin.lng,
    destLat: dest.lat,
    destLng: dest.lng,
  });
}
