export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { trips, drivers, vehicles } from "@/lib/db/schema";
import { enforceRbac } from "@/lib/enforceRbac";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, and, not, isNotNull } from "drizzle-orm";

// P2-01 Workstream A: Batched fleet positions endpoint.
// Returns ALL vehicles in the tenant with their latest GPS position and
// operational state in ONE query — no N+1, no one-request-per-vehicle.
// Used by the Control Tower live map on a 15-second polling interval.

// A vehicle is considered STALE if no GPS ping in 5 minutes.
// OFFLINE if no GPS ping ever or more than 30 minutes ago.
const STALE_MS  = 5  * 60 * 1000;   // 5 min
const OFFLINE_MS = 30 * 60 * 1000;  // 30 min

function gpsStatus(lastPingAt: Date | null): "LIVE" | "STALE" | "OFFLINE" {
  if (!lastPingAt) return "OFFLINE";
  const age = Date.now() - lastPingAt.getTime();
  if (age < STALE_MS)  return "LIVE";
  if (age < OFFLINE_MS) return "STALE";
  return "OFFLINE";
}

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN", "DISPATCHER"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;
  const _deny = await enforceRbac(session, tenantId, "control_tower"); if (_deny) return _deny;

  // Fetch all vehicles with their current active trip (if any):
  const vehicleRows = await db.query.vehicles.findMany({
    where: eq(vehicles.tenantId, tenantId),
  });

  // Fetch all non-completed trips with latest GPS and driver:
  const activeTrips = await db.query.trips.findMany({
    where: and(eq(trips.tenantId, tenantId), not(eq(trips.status, "COMPLETED"))),
    with: {
      driver: { with: { user: { columns: { id: true, name: true } } } },
      warehouse: { columns: { id: true, name: true, lat: true, lng: true, geofenceRadiusMeters: true } },
      stops: {
        with: { order: { columns: { id: true, orderNumber: true, requiredTankerCapacityLtr: true },
          with: {
            customer: { columns: { id: true, name: true } },
            location: { columns: { id: true, label: true, lat: true, lng: true, geofenceRadiusMeters: true } },
          }
        } },
        limit: 1,
      },
    },
    columns: {
      id: true, tripNumber: true, vehicleId: true, driverId: true, status: true,
      currentLat: true, currentLng: true, lastPingAt: true, startedAt: true,
      loadingConfirmed: true, warehouseId: true,
    },
  });

  const tripByVehicle = new Map(activeTrips.map((t) => [t.vehicleId, t]));

  const positions = vehicleRows.map((v) => {
    const trip = tripByVehicle.get(v.id) ?? null;
    const status = gpsStatus(trip?.lastPingAt ?? null);
    const stop = trip?.stops?.[0] ?? null;
    return {
      vehicleId: v.id,
      plateNumber: v.plateNumber,
      capacityLiters: v.capacityLiters,
      vehicleStatus: v.status,
      lat: trip?.currentLat ?? null,
      lng: trip?.currentLng ?? null,
      lastPingAt: trip?.lastPingAt?.toISOString() ?? null,
      gpsStatus: status,
      tripId: trip?.id ?? null,
      tripNumber: trip?.tripNumber ?? null,
      tripStatus: trip?.status ?? null,
      loadingConfirmed: trip?.loadingConfirmed ?? null,
      driverId: trip?.driver?.id ?? null,
      driverName: trip?.driver?.user?.name ?? null,
      customerId: stop?.order?.customer?.id ?? null,
      customerName: stop?.order?.customer?.name ?? null,
      siteLabel: stop?.order?.location?.label ?? null,
      orderId: stop?.order?.id ?? null,
      orderNumber: stop?.order?.orderNumber ?? null,
      requiredTankerCapacityLtr: stop?.order?.requiredTankerCapacityLtr ?? null,
      // Loading point (warehouse) for map rendering:
      loadingPointLat: trip?.warehouse?.lat ?? null,
      loadingPointLng: trip?.warehouse?.lng ?? null,
      loadingPointName: trip?.warehouse?.name ?? null,
      loadingPointRadius: trip?.warehouse?.geofenceRadiusMeters ?? 200,
      // Customer delivery site for map rendering:
      customerSiteLat: stop?.order?.location?.lat ?? null,
      customerSiteLng: stop?.order?.location?.lng ?? null,
      customerSiteLabel: stop?.order?.location?.label ?? null,
      customerSiteRadius: stop?.order?.location?.geofenceRadiusMeters ?? 150,
    };
  });

  return NextResponse.json({
    positions,
    fetchedAt: new Date().toISOString(),
    staleThresholdMs: STALE_MS,
    offlineThresholdMs: OFFLINE_MS,
  });
}
