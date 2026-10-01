export const dynamic = "force-dynamic";
/**
 * GET /api/telematics/overview
 * Telematics domain overview — real KPIs from registered devices and
 * live positions. No fake numbers.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import {
  telematicsDevices, vehicleDeviceAssignments, telemetryEvents,
  vehicles, trips,
} from "@/lib/db/schema";
import { getSessionFromRequest, getSessionTenantId } from "@/lib/auth";
import { checkPermission, PERMISSIONS } from "@/lib/requirePermission";
import { eq, and, isNull } from "drizzle-orm";

// GPS status uses the same thresholds as /api/fleet/positions (canonical)
const STALE_MS  = 5  * 60 * 1000;
const OFFLINE_MS = 30 * 60 * 1000;

function gpsStatus(lastPingAt: Date | null): "LIVE" | "STALE" | "OFFLINE" {
  if (!lastPingAt) return "OFFLINE";
  const age = Date.now() - lastPingAt.getTime();
  if (age < STALE_MS)  return "LIVE";
  if (age < OFFLINE_MS) return "STALE";
  return "OFFLINE";
}

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = getSessionTenantId(session)!;
  const permDeny = await checkPermission(session, tenantId, PERMISSIONS.TRIPS_VIEW_LIVE);
  if (permDeny) return permDeny;

  const [allDevices, activeAssignments, allVehicles, openEvents, activeTrips] = await Promise.all([
    db.query.telematicsDevices.findMany({
      where: eq(telematicsDevices.tenantId, tenantId),
      columns: { id: true, status: true, lastCommunication: true, lastGpsFix: true },
    }),
    db.query.vehicleDeviceAssignments.findMany({
      where: and(
        eq(vehicleDeviceAssignments.tenantId, tenantId),
        isNull(vehicleDeviceAssignments.unassignedAt)
      ),
      columns: { vehicleId: true, deviceId: true },
    }),
    db.query.vehicles.findMany({
      where: eq(vehicles.tenantId, tenantId),
      columns: { id: true },
    }),
    db.query.telemetryEvents.findMany({
      where: and(
        eq(telemetryEvents.tenantId, tenantId),
        eq(telemetryEvents.status, "OPEN")
      ),
      columns: { id: true, severity: true },
    }),
    // Get latest GPS from active trips (GPS is stored on trips, not directly on vehicles)
    db.query.trips.findMany({
      where: and(eq(trips.tenantId, tenantId)),
      columns: { vehicleId: true, lastPingAt: true },
    }),
  ]);

  const assignedDeviceIds = new Set(activeAssignments.map(a => a.deviceId));
  const assignedVehicleIds = new Set(activeAssignments.map(a => a.vehicleId));

  // GPS health — use latest trip ping per vehicle
  const latestPingByVehicle = new Map<string, Date | null>();
  for (const t of activeTrips) {
    if (!t.vehicleId) continue;
    const existing = latestPingByVehicle.get(t.vehicleId);
    if (!existing || (t.lastPingAt && t.lastPingAt > existing)) {
      latestPingByVehicle.set(t.vehicleId, t.lastPingAt);
    }
  }
  let live = 0, stale = 0, offline = 0;
  for (const v of allVehicles) {
    const ping = latestPingByVehicle.get(v.id) ?? null;
    const st = gpsStatus(ping);
    if (st === "LIVE") live++;
    else if (st === "STALE") stale++;
    else offline++;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const eventsToday = openEvents.filter(() => true).length; // all open events (simplified)
  const criticalEvents = openEvents.filter(e => e.severity === "CRITICAL").length;

  return NextResponse.json({
    devices: {
      total: allDevices.length,
      assigned: assignedDeviceIds.size,
      unassigned: allDevices.length - assignedDeviceIds.size,
      active: allDevices.filter(d => d.status === "ACTIVE").length,
      offline: allDevices.filter(d => d.status === "OFFLINE").length,
      fault: allDevices.filter(d => d.status === "FAULT").length,
    },
    vehicles: {
      total: allVehicles.length,
      withDevice: assignedVehicleIds.size,
      live,
      stale,
      offline,
    },
    events: {
      openTotal: openEvents.length,
      critical: criticalEvents,
    },
    thresholds: { staleMs: STALE_MS, offlineMs: OFFLINE_MS },
    fetchedAt: new Date().toISOString(),
  });
}
