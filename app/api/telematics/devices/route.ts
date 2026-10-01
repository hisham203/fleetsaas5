export const dynamic = "force-dynamic";
/**
 * GET  /api/telematics/devices — list all tenant devices with assignment status
 * POST /api/telematics/devices — register new device
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { telematicsDevices, vehicleDeviceAssignments } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { checkPermission, PERMISSIONS } from "@/lib/requirePermission";
import { eq, and, isNull, desc } from "drizzle-orm";
import { genId } from "@/lib/helpers";
import { z } from "zod";

const createSchema = z.object({
  providerId:       z.string().min(1),
  deviceIdentifier: z.string().min(1).max(200),
  externalId:       z.string().optional(),
  deviceType:       z.enum(["GPS_TRACKER", "OBD", "MOBILE", "VIRTUAL"]).default("GPS_TRACKER"),
  serialNumber:     z.string().optional(),
  notes:            z.string().optional(),
});

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  const tenantId = getSessionTenantId(session);
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const _permDeny = await checkPermission(session, tenantId, PERMISSIONS.TRIPS_VIEW_LIVE);
  if (_permDeny) return _permDeny;

  const [devices, activeAssignments] = await Promise.all([
    db.query.telematicsDevices.findMany({
      where: eq(telematicsDevices.tenantId, tenantId),
      with: { provider: { columns: { id: true, name: true, providerType: true } } },
      orderBy: desc(telematicsDevices.createdAt),
    }),
    db.query.vehicleDeviceAssignments.findMany({
      where: and(
        eq(vehicleDeviceAssignments.tenantId, tenantId),
        isNull(vehicleDeviceAssignments.unassignedAt)
      ),
      columns: { deviceId: true, vehicleId: true },
    }),
  ]);

  const assignmentByDevice = new Map(activeAssignments.map(a => [a.deviceId, a.vehicleId]));
  const enriched = devices.map(d => ({
    ...d,
    assignedVehicleId: assignmentByDevice.get(d.id) ?? null,
  }));

  return NextResponse.json({ devices: enriched });
}

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN"])) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = getSessionTenantId(session);
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const id = genId();
  try {
    await db.insert(telematicsDevices).values({
      id, tenantId: tenantId!,
      providerId: parsed.data.providerId,
      deviceIdentifier: parsed.data.deviceIdentifier,
      externalId: parsed.data.externalId ?? null,
      deviceType: parsed.data.deviceType,
      serialNumber: parsed.data.serialNumber ?? null,
      notes: parsed.data.notes ?? null,
      status: "UNASSIGNED",
    });
  } catch (e: any) {
    if (e?.code === "23505") {
      return NextResponse.json({ error: "Device identifier already exists for this tenant" }, { status: 409 });
    }
    throw e;
  }

  const created = await db.query.telematicsDevices.findFirst({
    where: eq(telematicsDevices.id, id),
    with: { provider: { columns: { id: true, name: true, providerType: true } } },
  });
  return NextResponse.json(created, { status: 201 });
}
