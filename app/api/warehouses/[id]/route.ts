export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { warehouses } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

// Task L, Part 4 — the smallest safe PATCH route the existing schema
// supports: name, address, and coordinates. All operational metadata,
// none of it pricing-relevant (unlike customer_locations' cityCode/
// zoneCode/distanceBandCode from Task K.3, there is no commercial
// dimension here to gate by role) and none of it touches inventory or
// vehicle assignment — a loading point's own inventory rows and any
// vehicle's homeWarehouseId are both untouched by this route entirely.
// isDefault is deliberately not editable here — changing which
// warehouse is "the" default is a bigger operational decision than a
// metadata fix and is out of this task's scope.
const patchSchema = z.object({
  name: z.string().min(1).optional(),
  address: z.string().min(1).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionFromRequest(req);
  // Matches the existing GET /api/warehouses policy (ADMIN + DISPATCHER
  // can already see every loading point) rather than the stricter
  // ADMIN-only POST — editing a loading point's name/address/
  // coordinates is the same class of operational correction Task K.4
  // already decided DISPATCHER should be trusted with for customer
  // sites, and there is no pricing-critical field here to protect.
  if (!hasRole(session, ["ADMIN", "DISPATCHER"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;

  const warehouse = await db.query.warehouses.findFirst({ where: and(eq(warehouses.id, id), eq(warehouses.tenantId, tenantId)) });
  if (!warehouse) {
    return NextResponse.json({ error: "Loading point not found" }, { status: 404 });
  }

  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  const updates: Record<string, unknown> = {};
  for (const key of Object.keys(body)) {
    if (key in data) updates[key] = (data as Record<string, unknown>)[key];
  }
  if (Object.keys(updates).length > 0) {
    await db.update(warehouses).set(updates).where(eq(warehouses.id, id));
  }

  const updated = await db.query.warehouses.findFirst({ where: eq(warehouses.id, id) });
  return NextResponse.json(updated);
}
