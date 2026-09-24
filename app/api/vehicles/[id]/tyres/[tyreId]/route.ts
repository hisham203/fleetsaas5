export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { tyreRecords, vehicles } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { checkPermission, PERMISSIONS } from "@/lib/requirePermission";

const retireSchema = z.object({ action: z.literal("retire") });

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; tyreId: string }> }
) {
  const { id, tyreId } = await params;
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = getSessionTenantId(session)!;
  const _permDeny1 = await checkPermission(session, tenantId, PERMISSIONS.VEHICLES_VIEW); if (_permDeny1) return _permDeny1;

  const vehicle = await db.query.vehicles.findFirst({ where: and(eq(vehicles.id, id), eq(vehicles.tenantId, tenantId)) });
  if (!vehicle) return NextResponse.json({ error: "Vehicle not found" }, { status: 404 });

  const body = await req.json();
  const parsed = retireSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const record = await db.query.tyreRecords.findFirst({ where: eq(tyreRecords.id, tyreId) });
  if (!record || record.vehicleId !== id) {
    return NextResponse.json({ error: "Tyre record not found" }, { status: 404 });
  }
  await db.update(tyreRecords).set({ status: "RETIRED", retiredAt: new Date() }).where(eq(tyreRecords.id, record.id));
  const updated = await db.query.tyreRecords.findFirst({ where: eq(tyreRecords.id, record.id) });
  return NextResponse.json(updated);
}
