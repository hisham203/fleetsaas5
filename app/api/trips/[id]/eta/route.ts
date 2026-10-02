export const dynamic = "force-dynamic";
/**
 * GET  /api/trips/[id]/eta — get (possibly cached) live ETA
 * POST /api/trips/[id]/eta — force refresh ETA (dispatcher action)
 *
 * Uses Google Routes API server-side (GOOGLE_ROUTES_API_KEY).
 * Key is NEVER exposed to the client.
 * Results are cached in trips.eta_* columns to avoid excessive API cost.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { trips, tripStops, warehouses } from "@/lib/db/schema";
import { getSessionFromRequest, getSessionTenantId } from "@/lib/auth";
import { checkPermission, PERMISSIONS } from "@/lib/requirePermission";
import { eq, and } from "drizzle-orm";
import {
  calculateRouteEta, etaNeedsRefresh, deriveEtaStatus,
  ETA_CACHE_TTL_SECONDS, type EtaResponse,
} from "@/lib/etaEngine";
import { computeSlaStatus } from "@/lib/sla";
import { createAlertIfNotOpen, resolveOpenAlerts } from "@/lib/alertEngine";

async function resolveDestination(tripId: string, tenantId: string) {
  const stop = await db.query.tripStops.findFirst({
    where: eq(tripStops.tripId, tripId),
    with: {
      order: {
        with: {
          location: { columns: { lat: true, lng: true, label: true } },
        },
      },
    },
  });
  return stop?.order?.location ?? null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = getSessionTenantId(session);
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const deny = await checkPermission(session, tenantId, PERMISSIONS.TRIPS_VIEW_LIVE);
  if (deny) return deny;

  const trip = await db.query.trips.findFirst({
    where: and(eq(trips.id, id), eq(trips.tenantId, tenantId)),
    columns: {
      id: true, status: true, currentLat: true, currentLng: true,
      lastPingAt: true, dispatchedAt: true, estimatedDurationMinutes: true,
      etaCalculatedAt: true, etaDistanceMeters: true, etaDurationSeconds: true,
      etaArrivalAt: true, baselineEtaAt: true,
    },
  });
  if (!trip) return NextResponse.json({ error: "Trip not found" }, { status: 404 });

  // Only active trips have live ETA:
  const activeStatuses = ["STARTED", "DISPATCHED", "ARRIVED_LOADING", "LOADING_COMPLETE", "ARRIVED_SITE"];
  if (!activeStatuses.includes(trip.status)) {
    return NextResponse.json({
      available: false,
      reason: "TRIP_NOT_ACTIVE",
      quality: "UNAVAILABLE",
    } satisfies EtaResponse);
  }

  // No GPS → unavailable:
  if (!trip.currentLat || !trip.currentLng) {
    return NextResponse.json({
      available: false,
      reason: "NO_GPS",
      quality: "UNAVAILABLE",
      lastKnownArrivalAt: trip.etaArrivalAt?.toISOString(),
      lastCalculatedAt: trip.etaCalculatedAt?.toISOString(),
    } satisfies EtaResponse);
  }

  // Get destination:
  const dest = await resolveDestination(id, tenantId);
  if (!dest?.lat || !dest?.lng) {
    return NextResponse.json({
      available: false,
      reason: "NO_DESTINATION",
      quality: "UNAVAILABLE",
    } satisfies EtaResponse);
  }

  // Check if cache is fresh:
  const needsRefresh = etaNeedsRefresh({
    etaCalculatedAt: trip.etaCalculatedAt,
    lastPingAt: trip.lastPingAt,
    currentLat: trip.currentLat,
    currentLng: trip.currentLng,
  });

  let distanceMeters: number;
  let durationSeconds: number;
  let quality: "LIVE" | "CACHED";

  if (needsRefresh) {
    const route = await calculateRouteEta({
      originLat: trip.currentLat,
      originLng: trip.currentLng,
      destLat: dest.lat,
      destLng: dest.lng,
    });

    if (!route) {
      // Routes API failed — return stale cache if available, else unavailable:
      if (trip.etaArrivalAt && trip.etaCalculatedAt) {
        const staleAgeSecs = (Date.now() - trip.etaCalculatedAt.getTime()) / 1000;
        return NextResponse.json({
          available: false,
          reason: "ROUTES_API_UNAVAILABLE",
          quality: "UNAVAILABLE",
          lastKnownArrivalAt: trip.etaArrivalAt.toISOString(),
          lastCalculatedAt: trip.etaCalculatedAt.toISOString(),
        } satisfies EtaResponse);
      }
      return NextResponse.json({
        available: false,
        reason: "ROUTES_API_UNAVAILABLE",
        quality: "UNAVAILABLE",
      } satisfies EtaResponse);
    }

    distanceMeters  = route.distanceMeters;
    durationSeconds = route.durationSeconds;
    quality = "LIVE";

    // Persist cache:
    const arrivalAt = new Date(Date.now() + durationSeconds * 1000);
    await db.update(trips)
      .set({
        etaCalculatedAt:    new Date(),
        etaDistanceMeters:  distanceMeters,
        etaDurationSeconds: durationSeconds,
        etaArrivalAt:       arrivalAt,
      } as any)
      .where(eq(trips.id, id));

    // Alert evaluation: check delay vs baseline:
    if (trip.baselineEtaAt) {
      const delayMs = arrivalAt.getTime() - trip.baselineEtaAt.getTime();
      const delayMins = Math.round(delayMs / 60_000);
      const etaStatus = deriveEtaStatus(delayMins);

      if (etaStatus === "DELAYED") {
        await createAlertIfNotOpen({
          tenantId, eventType: "TRIP_DELAYED", severity: "WARNING",
          tripId: id,
          message: `Trip is ${delayMins} minutes behind ETA.`,
          entityType: "TRIP", entityId: id, entityRoute: `/operations/trips/${id}`,
        });
      } else {
        // Trip is back on time — resolve any open delay alert:
        await resolveOpenAlerts({ tenantId, eventType: "TRIP_DELAYED", tripId: id });
      }
    }

  } else {
    // Use cache:
    distanceMeters  = trip.etaDistanceMeters ?? 0;
    durationSeconds = trip.etaDurationSeconds ?? 0;
    quality = "CACHED";
  }

  const arrivalAt = trip.etaArrivalAt ?? new Date(Date.now() + durationSeconds * 1000);
  const delayMinutes = trip.baselineEtaAt
    ? Math.round((arrivalAt.getTime() - trip.baselineEtaAt.getTime()) / 60_000)
    : null;

  return NextResponse.json({
    available: true,
    quality,
    tripId: id,
    distanceMeters,
    durationSeconds,
    estimatedArrivalAt: arrivalAt.toISOString(),
    calculatedAt: (trip.etaCalculatedAt ?? new Date()).toISOString(),
    baselineEtaAt: trip.baselineEtaAt?.toISOString() ?? null,
    delayMinutes,
    etaStatus: delayMinutes !== null ? deriveEtaStatus(delayMinutes) : null,
  } satisfies EtaResponse);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Force-refresh: clear the cache timestamp and call GET:
  const { id } = await params;
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = getSessionTenantId(session);
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const deny = await checkPermission(session, tenantId, PERMISSIONS.TRIPS_VIEW_LIVE);
  if (deny) return deny;

  // Clear eta_calculated_at to force a fresh Routes API call:
  await db.update(trips)
    .set({ etaCalculatedAt: null } as any)
    .where(and(eq(trips.id, id), eq(trips.tenantId, tenantId)));

  // Re-use GET logic via redirect:
  return GET(req, { params });
}
