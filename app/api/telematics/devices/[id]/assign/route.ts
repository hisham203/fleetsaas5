export const dynamic = "force-dynamic";
/**
 * POST /api/telematics/devices/[id]/assign — assign device to a vehicle
 * Enforces: no overlapping active assignments (DB partial unique index)
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import {
  telematicsDevices, vehicleDeviceAssignments, vehicles,
} from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { checkPermission, PERMISSIONS } from "@/lib/requirePermission";
import { eq, and, isNull } from "drizzle-orm";
import { genId } from "@/lib/helpers";
import { z } from "zod";

const assignSchema = z.object({
  vehicleId: z.string().min(1),
  notes: z.string().optional(),
});

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
  const body = await req.json().catch(() => null);
  const parsed = assignSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  // Verify device belongs to tenant:
  const device = await db.query.telematicsDevices.findFirst({
    where: and(eq(telematicsDevices.id, deviceId), eq(telematicsDevices.tenantId, tenantId)),
  });
  if (!device) return NextResponse.json({ error: "Device not found" }, { status: 404 });

  // Verify vehicle belongs to tenant:
  const vehicle = await db.query.vehicles.findFirst({
    where: and(eq(vehicles.id, parsed.data.vehicleId), eq(vehicles.tenantId, tenantId)),
    columns: { id: true },
  });
  if (!vehicle) return NextResponse.json({ error: "Vehicle not found" }, { status: 404 });

  // Check for existing active assignment of this device:
  const existingDeviceAssignment = await db.query.vehicleDeviceAssignments.findFirst({
    where: and(
      eq(vehicleDeviceAssignments.deviceId, deviceId),
      isNull(vehicleDeviceAssignments.unassignedAt)
    ),
    columns: { id: true, vehicleId: true },
  });
  if (existingDeviceAssignment) {
    return NextResponse.json({
      error: "Device already assigned to another vehicle",
      assignedTo: existingDeviceAssignment.vehicleId,
    }, { status: 422 });
  }

  // Check for existing active assignment of this vehicle:
  const existingVehicleAssignment = await db.query.vehicleDeviceAssignments.findFirst({
    where: and(
      eq(vehicleDeviceAssignments.vehicleId, parsed.data.vehicleId),
      isNull(vehicleDeviceAssignments.unassignedAt)
    ),
    columns: { id: true, deviceId: true },
  });
  if (existingVehicleAssignment) {
    return NextResponse.json({
      error: "Vehicle already has an active device assignment",
      existingDeviceId: existingVehicleAssignment.deviceId,
    }, { status: 422 });
  }

  const assignmentId = genId();
  await db.insert(vehicleDeviceAssignments).values({
    id: assignmentId,
    tenantId,
    vehicleId: parsed.data.vehicleId,
    deviceId,
    assignedBy: (session as any)?.user?.id ?? null,
    notes: parsed.data.notes ?? null,
  });

  // Update device status to ACTIVE:
  await db.update(telematicsDevices)
    .set({ status: "ACTIVE" })
    .where(eq(telematicsDevices.id, deviceId));

  return NextResponse.json({ id: assignmentId, vehicleId: parsed.data.vehicleId, deviceId }, { status: 201 });
}
