export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { vehicles, warehouses } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

const updateSchema = z.object({
  homeWarehouseId: z.string().nullable().optional(),
  // Task H audit finding: the schema field has existed since Task D.5,
  // but there was no way to edit it after a vehicle's creation — only
  // homeWarehouseId was ever editable here. Both optional and
  // independent, matching how they already work at creation time
  // (POST /api/vehicles): a legacy bottle van never needs capacityLiters
  // touched, and a tanker never needs capacityUnits touched.
  capacityLiters: z.number().int().positive().nullable().optional(),
  capacityUnits: z.number().int().positive().nullable().optional(),
});

// BR-09/Task H: sets or clears a vehicle's "home depot" (the warehouse
// the Dispatcher's trip planner defaults to when this vehicle is
// selected, still overridable per trip), and/or its capacity fields.
// Each field is only touched when actually present in the request body —
// a capacity-only edit never accidentally clears homeWarehouseId, and
// vice versa.
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

  const updates: Record<string, unknown> = {};
  if ("homeWarehouseId" in body) updates.homeWarehouseId = parsed.data.homeWarehouseId;
  if ("capacityLiters" in body) updates.capacityLiters = parsed.data.capacityLiters;
  if ("capacityUnits" in body) updates.capacityUnits = parsed.data.capacityUnits;

  if (Object.keys(updates).length > 0) {
    await db.update(vehicles).set(updates).where(eq(vehicles.id, id));
  }
  const updated = await db.query.vehicles.findFirst({ where: eq(vehicles.id, id) });
  return NextResponse.json(updated);
}
