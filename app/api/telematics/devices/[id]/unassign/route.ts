export const dynamic = "force-dynamic";
/**
 * POST /api/telematics/devices/[id]/unassign — end current device assignment
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { telematicsDevices, vehicleDeviceAssignments } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { checkPermission, PERMISSIONS } from "@/lib/requirePermission";
import { eq, and, isNull } from "drizzle-orm";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: deviceId } = await params;
  const session = await getSessionFromRequest(req);
  const tenantId = getSessionTenantId(session);
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const _permDeny = await checkPermission(session, tenantId, PERMISSIONS.TRIPS_VIEW_LIVE);
  if (_permDeny) return _permDeny;
  const device = await db.query.telematicsDevices.findFirst({
    where: and(eq(telematicsDevices.id, deviceId), eq(telematicsDevices.tenantId, tenantId)),
    columns: { id: true },
  });
  if (!device) return NextResponse.json({ error: "Device not found" }, { status: 404 });

  const activeAssignment = await db.query.vehicleDeviceAssignments.findFirst({
    where: and(
      eq(vehicleDeviceAssignments.deviceId, deviceId),
      isNull(vehicleDeviceAssignments.unassignedAt)
    ),
  });
  if (!activeAssignment) return NextResponse.json({ error: "No active assignment found" }, { status: 404 });

  await db.update(vehicleDeviceAssignments)
    .set({ unassignedAt: new Date() })
    .where(eq(vehicleDeviceAssignments.id, activeAssignment.id));

  await db.update(telematicsDevices)
    .set({ status: "UNASSIGNED" })
    .where(eq(telematicsDevices.id, deviceId));

  return NextResponse.json({ ok: true, unassignedAt: new Date().toISOString() });
}
