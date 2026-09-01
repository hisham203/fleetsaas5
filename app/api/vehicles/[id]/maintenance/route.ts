export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { maintenanceRecords, vehicles } from "@/lib/db/schema";
import { genId } from "@/lib/helpers";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: vehicleId } = await params;
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;

  const vehicle = await db.query.vehicles.findFirst({ where: and(eq(vehicles.id, vehicleId), eq(vehicles.tenantId, tenantId)) });
  if (!vehicle) return NextResponse.json({ error: "Vehicle not found" }, { status: 404 });

  const rows = await db.query.maintenanceRecords.findMany({
    where: eq(maintenanceRecords.vehicleId, vehicleId),
    orderBy: desc(maintenanceRecords.openedAt),
  });
  return NextResponse.json(rows);
}

const createSchema = z.object({
  type: z.enum(["PREVENTIVE", "CORRECTIVE", "EMERGENCY"]).default("PREVENTIVE"),
  description: z.string().min(1),
  odometerReading: z.number().optional(),
  cost: z.number().optional(),
});

// BR-15 rule: "A vehicle under maintenance cannot be assigned to a trip" —
// opening a record puts the vehicle in MAINTENANCE status immediately,
// which the trip-assignment route (BR-02) already checks for.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: vehicleId } = await params;
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const vehicle = await db.query.vehicles.findFirst({ where: and(eq(vehicles.id, vehicleId), eq(vehicles.tenantId, tenantId)) });
  if (!vehicle) return NextResponse.json({ error: "Vehicle not found" }, { status: 404 });
  if (vehicle.status === "IN_TRIP") {
    return NextResponse.json({ error: "Cannot open maintenance while vehicle is on an active trip" }, { status: 422 });
  }

  const id = genId();
  await db.transaction(async (tx) => {
    await tx.insert(maintenanceRecords).values({ id, tenantId, vehicleId, ...parsed.data, status: "OPEN" });
    await tx.update(vehicles).set({ status: "MAINTENANCE" }).where(eq(vehicles.id, vehicleId));
  });

  const created = await db.query.maintenanceRecords.findFirst({ where: eq(maintenanceRecords.id, id) });
  return NextResponse.json(created, { status: 201 });
}
