export const dynamic = "force-dynamic";
/**
 * GET /api/telematics/fleet-dashboard
 * Fleet Intelligence Dashboard — aggregated operational intelligence.
 * Answers: "What requires fleet/telematics operations attention right now?"
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import {
  trips, vehicles, telematicsDevices, vehicleDeviceAssignments,
  telemetryEvents, geofenceEvents,
} from "@/lib/db/schema";
import { getSessionFromRequest, getSessionTenantId } from "@/lib/auth";
import { checkPermission, PERMISSIONS } from "@/lib/requirePermission";
import { eq, and, isNull, gte, not, desc } from "drizzle-orm";
import { deriveGpsStatus, deriveDeviceHealth, GPS_OFFLINE_MS, DEVICE_OFFLINE_MS } from "@/lib/fleetState";

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = getSessionTenantId(session);
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const deny = await checkPermission(session, tenantId, PERMISSIONS.TRIPS_VIEW_LIVE);
  if (deny) return deny;

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [allVehicles, activeTrips, allDevices, activeAssignments,
         openEvents, recentGfEvents] = await Promise.all([
    db.query.vehicles.findMany({
      where: eq(vehicles.tenantId, tenantId),
      columns: { id: true, plateNumber: true, status: true },
    }),
    db.query.trips.findMany({
      where: and(eq(trips.tenantId, tenantId), not(eq(trips.status, "COMPLETED"))),
      columns: { id: true, tripNumber: true, vehicleId: true, driverId: true, status: true, lastPingAt: true },
    }),
    db.query.telematicsDevices.findMany({
      where: eq(telematicsDevices.tenantId, tenantId),
      columns: { id: true, status: true, lastCommunication: true, deviceIdentifier: true },
    }),
    db.query.vehicleDeviceAssignments.findMany({
      where: and(
        eq(vehicleDeviceAssignments.tenantId, tenantId),
        isNull(vehicleDeviceAssignments.unassignedAt)
      ),
      columns: { vehicleId: true, deviceId: true },
    }),
    db.query.telemetryEvents.findMany({
      where: and(eq(telemetryEvents.tenantId, tenantId), eq(telemetryEvents.status, "OPEN")),
      orderBy: desc(telemetryEvents.eventAt),
      limit: 20,
      columns: { id: true, eventType: true, severity: true, vehicleId: true, eventAt: true, source: true },
    }),
    db.query.geofenceEvents.findMany({
      where: and(eq(geofenceEvents.tenantId, tenantId), gte(geofenceEvents.eventAt, since24h)),
      orderBy: desc(geofenceEvents.eventAt),
      limit: 15,
      columns: { id: true, eventType: true, vehicleId: true, geofenceId: true, eventAt: true, tripId: true },
      with: { geofence: { columns: { name: true, category: true } } },
    }),
  ]);

  const tripByVehicle = new Map(activeTrips.map(t => [t.vehicleId, t]));
  const assignedDeviceByVehicle = new Map(activeAssignments.map(a => [a.vehicleId, a.deviceId]));
  const deviceById = new Map(allDevices.map(d => [d.id, d]));

  // GPS health:
  let gpsLive = 0, gpsStale = 0, gpsOffline = 0;
  const offlineVehicles: { vehicleId: string; plateNumber: string; lastPingAt: string | null }[] = [];
  for (const v of allVehicles) {
    const trip = tripByVehicle.get(v.id);
    const gps = deriveGpsStatus(trip?.lastPingAt ?? null);
    if (gps === "LIVE") gpsLive++;
    else if (gps === "STALE") gpsStale++;
    else {
      gpsOffline++;
      if (trip) offlineVehicles.push({ vehicleId: v.id, plateNumber: v.plateNumber, lastPingAt: trip.lastPingAt?.toISOString() ?? null });
    }
  }

  // Device health:
  let devHealthy = 0, devStale = 0, devOffline = 0, devNeverReported = 0, devUnassigned = 0;
  const attentionDevices: { id: string; identifier: string; health: string }[] = [];
  for (const d of allDevices) {
    const assignedToVehicle = activeAssignments.find(a => a.deviceId === d.id)?.vehicleId ?? null;
    const health = deriveDeviceHealth({ lastCommunication: d.lastCommunication, assignedVehicleId: assignedToVehicle });
    if (health === "HEALTHY") devHealthy++;
    else if (health === "STALE") { devStale++; attentionDevices.push({ id: d.id, identifier: d.deviceIdentifier, health }); }
    else if (health === "OFFLINE") { devOffline++; attentionDevices.push({ id: d.id, identifier: d.deviceIdentifier, health }); }
    else if (health === "NEVER_REPORTED") devNeverReported++;
    else devUnassigned++;
  }

  // Active trips summary:
  const tripsByStatus = activeTrips.reduce((acc, t) => {
    acc[t.status] = (acc[t.status] ?? 0) + 1; return acc;
  }, {} as Record<string, number>);

  return NextResponse.json({
    fleet: {
      total: allVehicles.length,
      onTrip: activeTrips.length,
      gps: { live: gpsLive, stale: gpsStale, offline: gpsOffline },
    },
    devices: {
      total: allDevices.length,
      assigned: activeAssignments.length,
      healthy: devHealthy, stale: devStale, offline: devOffline,
      neverReported: devNeverReported, unassigned: devUnassigned,
    },
    activeTrips: {
      total: activeTrips.length,
      byStatus: tripsByStatus,
    },
    openEvents: {
      total: openEvents.length,
      critical: openEvents.filter(e => e.severity === "CRITICAL").length,
      warning: openEvents.filter(e => e.severity === "WARNING").length,
      recent: openEvents.slice(0, 5),
    },
    recentGeofenceEvents: recentGfEvents,
    attention: {
      vehiclesOfflineOnTrip: offlineVehicles,
      devicesNeedingAttention: attentionDevices.slice(0, 10),
    },
    fetchedAt: new Date().toISOString(),
  });
}
