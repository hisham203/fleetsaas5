export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { maintenanceWarehouses, workshops } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

const patchSchema = z.object({
  warehouseCode: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  warehouseType: z.enum(["WORKSHOP_STORE", "CENTRAL_SPARES", "TYRE_STORE", "MOBILE_VAN", "OTHER"]).optional(),
  workshopId: z.string().nullable().optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  district: z.string().optional(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  notes: z.string().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;

  const row = await db.query.maintenanceWarehouses.findFirst({ where: and(eq(maintenanceWarehouses.id, id), eq(maintenanceWarehouses.tenantId, tenantId)) });
  if (!row) {
    return NextResponse.json({ error: "Maintenance warehouse not found" }, { status: 404 });
  }

  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  if (data.workshopId) {
    const workshop = await db.query.workshops.findFirst({ where: and(eq(workshops.id, data.workshopId), eq(workshops.tenantId, tenantId)) });
    if (!workshop) {
      return NextResponse.json({ error: "workshopId does not belong to this tenant" }, { status: 400 });
    }
  }

  if (data.warehouseCode && data.warehouseCode !== row.warehouseCode) {
    const dup = await db.query.maintenanceWarehouses.findFirst({ where: and(eq(maintenanceWarehouses.tenantId, tenantId), eq(maintenanceWarehouses.warehouseCode, data.warehouseCode)) });
    if (dup) {
      return NextResponse.json({ error: `A maintenance warehouse with code "${data.warehouseCode}" already exists for this tenant` }, { status: 409 });
    }
  }

  const updates: Record<string, unknown> = {};
  for (const key of Object.keys(body)) {
    if (key in data) updates[key] = (data as Record<string, unknown>)[key];
  }
  updates.updatedAt = new Date();
  await db.update(maintenanceWarehouses).set(updates).where(eq(maintenanceWarehouses.id, id));

  const updated = await db.query.maintenanceWarehouses.findFirst({ where: eq(maintenanceWarehouses.id, id) });
  return NextResponse.json(updated);
}
