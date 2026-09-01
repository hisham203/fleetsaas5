export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { inventoryItems, warehouses } from "@/lib/db/schema";
import { genId } from "@/lib/helpers";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN", "DISPATCHER"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;

  const warehouseId = req.nextUrl.searchParams.get("warehouseId");
  const conditions = [eq(inventoryItems.tenantId, tenantId), warehouseId ? eq(inventoryItems.warehouseId, warehouseId) : undefined].filter(
    Boolean
  ) as any[];

  const rows = await db.query.inventoryItems.findMany({ where: and(...conditions) });
  return NextResponse.json(rows);
}

const adjustSchema = z.object({
  warehouseId: z.string(),
  itemName: z.string().min(1),
  delta: z.number(), // positive to add stock, negative to remove
  unit: z.string().default("bottle"),
});

// Manual stock adjustment (e.g. new stock delivery, stocktake correction).
// Automatic deductions/additions from trip loading and ePOD empties are
// handled inline in the trip-loading and delivery routes.
export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;

  const body = await req.json();
  const parsed = adjustSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { warehouseId, itemName, delta, unit } = parsed.data;

  // The warehouse must belong to this tenant.
  const warehouse = await db.query.warehouses.findFirst({ where: and(eq(warehouses.id, warehouseId), eq(warehouses.tenantId, tenantId)) });
  if (!warehouse) {
    return NextResponse.json({ error: "Warehouse not found" }, { status: 404 });
  }

  const existing = await db.query.inventoryItems.findFirst({
    where: and(eq(inventoryItems.warehouseId, warehouseId), eq(inventoryItems.itemName, itemName)),
  });

  if (existing) {
    const newQty = existing.quantity + delta;
    if (newQty < 0) {
      return NextResponse.json({ error: `Adjustment would make stock negative (current: ${existing.quantity})` }, { status: 422 });
    }
    await db.update(inventoryItems).set({ quantity: newQty, updatedAt: new Date() }).where(eq(inventoryItems.id, existing.id));
    const updated = await db.query.inventoryItems.findFirst({ where: eq(inventoryItems.id, existing.id) });
    return NextResponse.json(updated);
  }

  if (delta < 0) {
    return NextResponse.json({ error: "Cannot create a new item with negative stock" }, { status: 422 });
  }
  const id = genId();
  await db.insert(inventoryItems).values({ id, tenantId, warehouseId, itemName, quantity: delta, unit });
  const created = await db.query.inventoryItems.findFirst({ where: eq(inventoryItems.id, id) });
  return NextResponse.json(created, { status: 201 });
}
