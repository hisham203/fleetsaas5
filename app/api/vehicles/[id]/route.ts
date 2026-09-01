export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { vehicles, warehouses } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

const updateSchema = z.object({
  homeWarehouseId: z.string().nullable(),
});

// BR-09: sets or clears a vehicle's "home depot" — the warehouse the
// Dispatcher's trip planner defaults to when this vehicle is selected
// (still overridable per trip). Only this one field for now; a fuller
// vehicle-edit endpoint is a reasonable future addition if more fields
// need to become editable.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;

  const vehicle = await db.query.vehicles.findFirst({ where: and(eq(vehicles.id, id), eq(vehicles.tenantId, tenantId)) });
  if (!vehicle) return NextResponse.json({ error: "Vehicle not found" }, { status: 404 });

  const body = await req.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  if (parsed.data.homeWarehouseId) {
    const warehouse = await db.query.warehouses.findFirst({
      where: and(eq(warehouses.id, parsed.data.homeWarehouseId), eq(warehouses.tenantId, tenantId)),
    });
    if (!warehouse) return NextResponse.json({ error: "Home warehouse not found" }, { status: 404 });
  }

  await db.update(vehicles).set({ homeWarehouseId: parsed.data.homeWarehouseId }).where(eq(vehicles.id, id));
  const updated = await db.query.vehicles.findFirst({ where: eq(vehicles.id, id) });
  return NextResponse.json(updated);
}
