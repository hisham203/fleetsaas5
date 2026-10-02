export const dynamic = "force-dynamic";
/**
 * GET /api/fleet/intelligence
 * Enhanced fleet state endpoint for Milestone E Fleet Intelligence Dashboard.
 * Returns all vehicles with derived operational state, GPS health, device state,
 * and trip context in a single batched query (no N+1).
 *
 * Extends /api/fleet/positions with:
 * - operationalState derivation (MOVING|IDLE|ON_TRIP|AVAILABLE|OFFLINE|UNKNOWN)
 * - device health (HEALTHY|STALE|OFFLINE|NEVER_REPORTED|UNASSIGNED)
 * - fleet summary KPIs
 * - telemetry source
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { trips, vehicles, telematicsDevices, vehicleDeviceAssignments } from "@/lib/db/schema";
import { getSessionFromRequest, getSessionTenantId } from "@/lib/auth";
import { checkPermission, PERMISSIONS } from "@/lib/requirePermission";
import { eq, and, isNull, not } from "drizzle-orm";
import {
  deriveGpsStatus, deriveOperationalState, deriveDeviceHealth,
  ageString, computeFleetSummary, type GpsStatus, type OperationalState, type DeviceHealth,
} from "@/lib/fleetState";

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = getSessionTenantId(session);
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const deny = await checkPermission(session, tenantId, PERMISSIONS.TRIPS_VIEW_LIVE);
  if (deny) return deny;

  const [allVehicles, activeTrips, activeAssignments, allDevices] = await Promise.all([
    db.query.vehicles.findMany({
      where: eq(vehicles.tenantId, tenantId),
      columns: { id: true, plateNumber: true, vehicleType: true, status: true, capacityLiters: true },
    }),
    db.query.trips.findMany({
      where: and(eq(trips.tenantId, tenantId), not(eq(trips.status, "COMPLETED"))),
      with: {
        driver: { with: { user: { columns: { id: true, name: true } } } },
        stops: {
          limit: 1,
          with: { order: { columns: { id: true, orderNumber: true },
            with: { customer: { columns: { id: true, name: true } } } } },
        },
      },
      columns: {
        id: true, tripNumber: true, vehicleId: true, driverId: true, status: true,
        currentLat: true, currentLng: true, lastPingAt: true, startedAt: true,
        operationalState: true,
      },
    }),
    db.query.vehicleDeviceAssignments.findMany({
      where: and(
        eq(vehicleDeviceAssignments.tenantId, tenantId),
        isNull(vehicleDeviceAssignments.unassignedAt)
      ),
      columns: { vehicleId: true, deviceId: true },
    }),
    db.query.telematicsDevices.findMany({
      where: eq(telematicsDevices.tenantId, tenantId),
      columns: { id: true, deviceIdentifier: true, status: true, lastCommunication: true },
    }),
  ]);

  const tripByVehicle = new Map(activeTrips.map(t => [t.vehicleId, t]));
  const assignmentByVehicle = new Map(activeAssignments.map(a => [a.vehicleId, a.deviceId]));
  const deviceById = new Map(allDevices.map(d => [d.id, d]));

  const result = allVehicles.map(v => {
    const trip = tripByVehicle.get(v.id) ?? null;
    const deviceId = assignmentByVehicle.get(v.id) ?? null;
    const device = deviceId ? deviceById.get(deviceId) ?? null : null;

    const gpsStatus = deriveGpsStatus(trip?.lastPingAt ?? null);
    const operationalState = deriveOperationalState({
      speed: null, // speed is on vehicleGpsHistory, not trips — no speed on current position
      lastPingAt: trip?.lastPingAt ?? null,
      tripId: trip?.id ?? null,
      tripStatus: trip?.status ?? null,
    });
    const deviceHealth = deriveDeviceHealth({
      lastCommunication: device?.lastCommunication ?? null,
      assignedVehicleId: v.id,
    });

    const stop = trip?.stops?.[0] ?? null;
    const customer = stop?.order?.customer ?? null;

    return {
      vehicleId: v.id,
      plateNumber: v.plateNumber,
      vehicleType: v.vehicleType,
      vehicleStatus: v.status,
      capacityLiters: v.capacityLiters,
      // GPS:
      gpsStatus,
      lat: trip?.currentLat ?? null,
      lng: trip?.currentLng ?? null,
      lastPingAt: trip?.lastPingAt?.toISOString() ?? null,
      lastPingAge: ageString(trip?.lastPingAt),
      // Derived state:
      operationalState,
      // Trip:
      tripId: trip?.id ?? null,
      tripNumber: trip?.tripNumber ?? null,
      tripStatus: trip?.status ?? null,
      startedAt: trip?.startedAt?.toISOString() ?? null,
      driverId: trip?.driver?.id ?? null,
      driverName: trip?.driver?.user?.name ?? null,
      customerName: customer?.name ?? null,
      // Device:
      hasDevice: !!device,
      deviceId: device?.id ?? null,
      deviceIdentifier: device?.deviceIdentifier ?? null,
      deviceHealth,
      lastDeviceCommunication: device?.lastCommunication?.toISOString() ?? null,
    };
  });

  const summary = computeFleetSummary(result.map(v => ({
    gpsStatus: v.gpsStatus as GpsStatus,
    operationalState: v.operationalState as OperationalState,
    hasDevice: v.hasDevice,
  })));

  return NextResponse.json({
    vehicles: result,
    summary,
    thresholds: {
      gpsStalMs: 5 * 60 * 1000,
      gpsOfflineMs: 30 * 60 * 1000,
      deviceStaleMs: 15 * 60 * 1000,
      deviceOfflineMs: 60 * 60 * 1000,
    },
    fetchedAt: new Date().toISOString(),
  });
}
