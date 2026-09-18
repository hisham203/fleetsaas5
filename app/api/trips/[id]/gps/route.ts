export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { trips, drivers } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { validateGpsPing, persistGpsPing, processGpsGeofence } from "@/lib/gpsIngestion";
import { checkGpsRateLimit } from "@/lib/gpsRateLimit";

const bodySchema = z.object({
  lat:      z.number().finite(),
  lng:      z.number().finite(),
  accuracy: z.number().min(0).optional(),
  speed:    z.number().min(0).optional(),
  heading:  z.number().min(0).max(360).optional(),
}).strict();

/**
 * PATCH /api/trips/[id]/gps — Real-device GPS ping.
 *
 * Pipeline order (security-correct):
 *   1. authenticate session
 *   2. resolve tenant
 *   3. resolve trip (tenant-scoped)
 *   4. verify trip is active
 *   5. verify driver owns this trip
 *   6. apply GPS rate limit (identity-aware: tenantId:tripId:driverId)
 *   7. parse + validate GPS payload
 *   8. persist GPS (trips + vehicleGpsHistory)
 *   9. process geofence (async, non-blocking)
 *
 * Unauthenticated and unauthorized requests are rejected at steps 1–5
 * and NEVER reach step 6 — they cannot consume the legitimate driver's
 * rate-limit window.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // ── Step 1: Authenticate ────────────────────────────────────────────────────
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN", "DRIVER"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Step 2: Resolve tenant ───────────────────────────────────────────────────
  const tenantId = getSessionTenantId(session)!;

  // ── Step 3: Resolve trip (tenant-scoped) ────────────────────────────────────
  const trip = await db.query.trips.findFirst({
    where: and(eq(trips.id, id), eq(trips.tenantId, tenantId)),
  });
  if (!trip) return NextResponse.json({ error: "Trip not found" }, { status: 404 });

  // ── Step 4: Verify trip is active ───────────────────────────────────────────
  if (trip.status === "COMPLETED" || trip.status === "CANCELLED") {
    return NextResponse.json({ error: "Trip is not active" }, { status: 422 });
  }

  // ── Step 5: Verify driver owns this trip ────────────────────────────────────
  let effectiveDriverId = trip.driverId;
  if (session!.type === "USER" && (session!.user as any).role === "DRIVER") {
    const driverProfile = await db.query.drivers.findFirst({
      where: (d, { eq: eq2 }) => eq2(d.userId, session!.user.id),
      columns: { id: true },
    });
    if (!driverProfile || driverProfile.id !== trip.driverId) {
      return NextResponse.json({ error: "Not your trip" }, { status: 403 });
    }
    effectiveDriverId = driverProfile.id;
  }

  // ── Step 6: Rate limit — AFTER full auth/authz ──────────────────────────────
  // Key is identity-aware: tenantId:tripId:driverId
  // Unauthenticated/unauthorized requests never reach this line.
  const rateLimitKey = `${tenantId}:${id}:${effectiveDriverId}`;
  const rateResult = checkGpsRateLimit(rateLimitKey);
  if (!rateResult.allowed) {
    return NextResponse.json(
      { error: "GPS ping rate exceeded — try again shortly", retryAfterMs: rateResult.retryAfterMs },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rateResult.retryAfterMs / 1000)) } }
    );
  }

  // ── Step 7: Parse + validate GPS payload ────────────────────────────────────
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten(), errorCode: "INVALID_GPS_COORDINATES" }, { status: 422 });
  }

  const fieldErrors = validateGpsPing(parsed.data);
  if (fieldErrors.length > 0) {
    return NextResponse.json({ errors: fieldErrors, errorCode: "INVALID_GPS_COORDINATES" }, { status: 422 });
  }

  const ping = {
    tenantId,
    tripId: trip.id,
    vehicleId: trip.vehicleId,
    driverId: trip.driverId,
    lat: parsed.data.lat,
    lng: parsed.data.lng,
    accuracy: parsed.data.accuracy ?? null,
    speed: parsed.data.speed ?? null,
    heading: parsed.data.heading ?? null,
  };

  // ── Steps 8–9: Persist + geofence ───────────────────────────────────────────
  await persistGpsPing(ping);
  processGpsGeofence(ping); // non-blocking

  return NextResponse.json({ ok: true, lat: ping.lat, lng: ping.lng, recordedAt: new Date().toISOString() });
}
