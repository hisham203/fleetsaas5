export const dynamic = "force-dynamic";
/**
 * GET /api/cron/device-health
 * Protected cron endpoint — evaluates device health transitions and creates
 * DEVICE_OFFLINE alerts with deduplication.
 *
 * Intended to be called by Coolify's HTTP scheduler every 10 minutes:
 *   GET https://<app-domain>/api/cron/device-health
 *   Header: X-Cron-Secret: <CRON_SECRET>
 *
 * Security: requires X-Cron-Secret header matching CRON_SECRET env var.
 * NEVER called from the browser. Not accessible via navigation.
 *
 * Uses canonical thresholds from lib/fleetState.ts.
 * Uses lib/alertEngine.ts for deduplication.
 *
 * Does NOT auto-advance any trip lifecycle.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { tenants, telematicsDevices, vehicleDeviceAssignments, vehicles } from "@/lib/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { deriveDeviceHealth, DEVICE_OFFLINE_MS } from "@/lib/fleetState";
import { createAlertIfNotOpen, resolveOpenAlerts } from "@/lib/alertEngine";

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error(JSON.stringify({ level: "error", event: "cron.device_health.no_secret",
      message: "CRON_SECRET not set — cron endpoint is disabled" }));
    return NextResponse.json({ error: "Cron not configured" }, { status: 503 });
  }

  const incomingSecret = req.headers.get("x-cron-secret");
  if (incomingSecret !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  let tenantsProcessed = 0;
  let alertsCreated = 0;
  let alertsResolved = 0;

  // Process all tenants:
  const allTenants = await db.query.tenants.findMany({
    columns: { id: true },
  });

  for (const tenant of allTenants) {
    const tenantId = tenant.id;

    // Get all assigned devices with their last communication:
    const assignments = await db.query.vehicleDeviceAssignments.findMany({
      where: and(
        eq(vehicleDeviceAssignments.tenantId, tenantId),
        isNull(vehicleDeviceAssignments.unassignedAt)
      ),
      with: {
        device: {
          columns: { id: true, deviceIdentifier: true, lastCommunication: true },
        },
      },
      columns: { vehicleId: true, deviceId: true },
    });

    for (const assignment of assignments) {
      const device = assignment.device;
      if (!device) continue;

      const health = deriveDeviceHealth({
        lastCommunication: device.lastCommunication,
        assignedVehicleId: assignment.vehicleId,
      });

      if (health === "OFFLINE") {
        // Create a DEVICE_OFFLINE alert (deduplicated — no duplicate if already OPEN):
        const ageMinutes = device.lastCommunication
          ? Math.round((Date.now() - new Date(device.lastCommunication).getTime()) / 60_000)
          : null;

        const created = await createAlertIfNotOpen({
          tenantId,
          eventType: "DEVICE_OFFLINE",
          severity: "WARNING",
          deviceId: device.id,
          vehicleId: assignment.vehicleId,
          message: ageMinutes
            ? `Device ${device.deviceIdentifier} has been offline for ${ageMinutes} minutes.`
            : `Device ${device.deviceIdentifier} has never reported.`,
          entityType: "DEVICE",
          entityId: device.id,
          entityRoute: "/telematics/devices",
        });
        if (created) alertsCreated++;

      } else if (health === "HEALTHY" || health === "STALE") {
        // Device is communicating — resolve any open DEVICE_OFFLINE alert:
        const resolved = await resolveOpenAlerts({
          tenantId,
          eventType: "DEVICE_OFFLINE",
          deviceId: device.id,
        });

        if (resolved > 0) {
          alertsResolved += resolved;
          // Create a DEVICE_RECOVERED event:
          await createAlertIfNotOpen({
            tenantId,
            eventType: "DEVICE_RECOVERED",
            severity: "INFO",
            deviceId: device.id,
            vehicleId: assignment.vehicleId,
            message: `Device ${device.deviceIdentifier} is back online.`,
            entityType: "DEVICE",
            entityId: device.id,
            entityRoute: "/telematics/devices",
          });
        }
      }
    }

    tenantsProcessed++;
  }

  const durationMs = Date.now() - startedAt;
  console.log(JSON.stringify({
    level: "info", event: "cron.device_health.complete",
    tenantsProcessed, alertsCreated, alertsResolved, durationMs,
  }));

  return NextResponse.json({
    ok: true, tenantsProcessed, alertsCreated, alertsResolved, durationMs,
  });
}
