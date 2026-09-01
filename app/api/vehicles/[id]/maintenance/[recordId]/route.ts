export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { maintenanceRecords, vehicles } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

const completeSchema = z.object({
  action: z.literal("complete"),
  cost: z.number().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; recordId: string }> }
) {
  const { id, recordId } = await params;
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;

  const vehicle = await db.query.vehicles.findFirst({ where: and(eq(vehicles.id, id), eq(vehicles.tenantId, tenantId)) });
  if (!vehicle) return NextResponse.json({ error: "Vehicle not found" }, { status: 404 });

  const body = await req.json();
  const parsed = completeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const record = await db.query.maintenanceRecords.findFirst({ where: eq(maintenanceRecords.id, recordId) });
  if (!record || record.vehicleId !== id) {
    return NextResponse.json({ error: "Maintenance record not found" }, { status: 404 });
  }
  if (record.status !== "OPEN") {
    return NextResponse.json({ error: "Record is already completed" }, { status: 422 });
  }

  await db.transaction(async (tx) => {
    await tx
      .update(maintenanceRecords)
      .set({ status: "COMPLETED", completedAt: new Date(), ...(parsed.data.cost != null ? { cost: parsed.data.cost } : {}) })
      .where(eq(maintenanceRecords.id, record.id));
    await tx.update(vehicles).set({ status: "AVAILABLE" }).where(eq(vehicles.id, id));
  });

  const updated = await db.query.maintenanceRecords.findFirst({ where: eq(maintenanceRecords.id, record.id) });
  return NextResponse.json(updated);
}
