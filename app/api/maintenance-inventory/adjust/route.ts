export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { maintenanceInventoryBalances, maintenanceInventoryMovements } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { enforceRbac } from "@/lib/enforceRbac";
import { genId } from "@/lib/helpers";
import { eq, and, sql } from "drizzle-orm";
import { z } from "zod";

// RC1 — Inventory Adjustment: positive = receiving/gain, negative = loss/write-off.
// Issue to maintenance work order uses movementType = "MAINTENANCE_ISSUE".
const schema = z.object({
  warehouseId: z.string().min(1),
  itemId: z.string().min(1),
  quantity: z.number().refine(n => n !== 0, "Quantity cannot be zero"),
  unitOfMeasure: z.string().min(1),
  movementType: z.enum(["ADJUSTMENT", "MAINTENANCE_ISSUE", "TRANSFER_OUT", "TRANSFER_IN", "RETURN"]).default("ADJUSTMENT"),
  notes: z.string().optional(),
  referenceId: z.string().optional(),   // maintenance record ID for MAINTENANCE_ISSUE
  referenceType: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !hasRole(session, ["ADMIN", "DISPATCHER"])) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = getSessionTenantId(session)!;
  const userId = session.type === "USER" ? session.user.id : "";
  const _deny = await enforceRbac(session, tenantId, "inventory"); if (_deny) return _deny;
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { warehouseId, itemId, quantity, unitOfMeasure, movementType, notes, referenceId, referenceType } = parsed.data;
  // Check available qty for negative movements
  if (quantity < 0) {
    const bal = await db.query.maintenanceInventoryBalances.findFirst({
      where: and(eq(maintenanceInventoryBalances.tenantId, tenantId), eq(maintenanceInventoryBalances.warehouseId, warehouseId), eq(maintenanceInventoryBalances.itemId, itemId)),
    });
    const available = Number(bal?.quantityAvailable ?? 0);
    if (available + quantity < 0) return NextResponse.json({ error: `Insufficient stock: ${available} available, ${Math.abs(quantity)} requested` }, { status: 422 });
  }
  await db.transaction(async (tx) => {
    await tx.insert(maintenanceInventoryMovements).values({
      id: genId(), tenantId, warehouseId, itemId, movementType, quantity, unitOfMeasure,
      referenceType: referenceType ?? movementType, referenceId,
      notes, createdByUserId: userId,
    });
    await tx.execute(sql`
      INSERT INTO maintenance_inventory_balances (id, tenant_id, warehouse_id, item_id, quantity_on_hand, quantity_available, last_movement_at, created_at, updated_at)
      VALUES (${genId()}, ${tenantId}, ${warehouseId}, ${itemId}, ${quantity}, ${quantity}, NOW(), NOW(), NOW())
      ON CONFLICT (tenant_id, warehouse_id, item_id)
      DO UPDATE SET
        quantity_on_hand = maintenance_inventory_balances.quantity_on_hand + ${quantity},
        quantity_available = maintenance_inventory_balances.quantity_available + ${quantity},
        last_movement_at = NOW(), updated_at = NOW()
    `);
  });
  const balance = await db.query.maintenanceInventoryBalances.findFirst({
    where: and(eq(maintenanceInventoryBalances.tenantId, tenantId), eq(maintenanceInventoryBalances.warehouseId, warehouseId), eq(maintenanceInventoryBalances.itemId, itemId)),
  });
  return NextResponse.json({ ok: true, balance }, { status: 201 });
}
