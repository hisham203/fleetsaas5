export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { maintenanceWarehouses, goodsReceipts, goodsReceiptLines, purchaseOrders, purchaseOrderLines, maintenanceInventoryBalances, maintenanceInventoryMovements } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { enforceRbac } from "@/lib/enforceRbac";
import { resolveEntityCode } from "@/lib/businessCodes";
import { genId } from "@/lib/helpers";
import { eq, and, desc, sql } from "drizzle-orm";
import { z } from "zod";

const lineSchema = z.object({
  purchaseOrderLineId: z.string().min(1),
  itemId: z.string().min(1),
  receivedQuantity: z.number().min(0),
  acceptedQuantity: z.number().min(0),
  rejectedQuantity: z.number().min(0).default(0),
  unitOfMeasure: z.string().min(1),
  notes: z.string().optional(),
});
const createSchema = z.object({
  purchaseOrderId: z.string().min(1),
  warehouseId: z.string().min(1),
  receivedDate: z.string().optional(),
  notes: z.string().optional(),
  lines: z.array(lineSchema).min(1),
});

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !hasRole(session, ["ADMIN", "DISPATCHER"])) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = getSessionTenantId(session)!;
  const _deny = await enforceRbac(session, tenantId, "procurement"); if (_deny) return _deny;
  const userId = session!.type === "USER" ? session!.user.id : "";
  const poId = req.nextUrl.searchParams.get("purchaseOrderId");
  const conditions = [eq(goodsReceipts.tenantId, tenantId), poId ? eq(goodsReceipts.purchaseOrderId, poId) : undefined].filter(Boolean) as any[];
  const rows = await db.query.goodsReceipts.findMany({
    where: and(...conditions),

    orderBy: [desc(goodsReceipts.createdAt)],
  });
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !hasRole(session, ["ADMIN", "DISPATCHER"])) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = getSessionTenantId(session)!;
  const _deny = await enforceRbac(session, tenantId, "procurement"); if (_deny) return _deny;
  const userId = session!.type === "USER" ? session!.user.id : "";
  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { lines, ...grData } = parsed.data;
  const po = await db.query.purchaseOrders.findFirst({ where: and(eq(purchaseOrders.id, grData.purchaseOrderId), eq(purchaseOrders.tenantId, tenantId)) });
  if (!po) return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
  // Relationship L — GR must post to a Maintenance Warehouse, not an operational loading point:
  const mwh = await db.query.maintenanceWarehouses.findFirst({
    where: and(eq(maintenanceWarehouses.id, grData.warehouseId), eq(maintenanceWarehouses.tenantId, tenantId)),
    columns: { id: true },
  });
  if (!mwh) {
    return NextResponse.json({
      error: "The receiving warehouse must be a Maintenance Warehouse. Operational Loading Points cannot receive procurement stock.",
      errorCode: "INVALID_MAINTENANCE_WAREHOUSE",
    }, { status: 422 });
  }
  const grId = genId();
  // RC1: GOODS_RECEIPT requires a configured numbering series — no timestamp fallback.
  let grnNumber: string;
  try {
    const _r = await resolveEntityCode({ tenantId, entityType: "GOODS_RECEIPT", entityLabel: "goods receipt", codeLabel: "goods receipt number", provided: undefined });
    if (!_r.ok) return NextResponse.json({ error: "CONFIGURE_NUMBERING", message: "No active GOODS_RECEIPT numbering series. Go to Settings → Numbering and apply recommended series." }, { status: 422 });
    grnNumber = _r.code;
  } catch (err: any) {
    if (err?.message?.includes("No active")) return NextResponse.json({ error: "CONFIGURE_NUMBERING", message: "No active GOODS_RECEIPT numbering series. Go to Settings → Numbering and apply recommended series." }, { status: 422 });
    throw err;
  
  await db.transaction(async (tx) => {
    await tx.insert(goodsReceipts).values({
      id: grId, tenantId, receiptNumber: grnNumber,
      purchaseOrderId: grData.purchaseOrderId,
      warehouseId: grData.warehouseId,
      status: "RECEIVED",
      receivedByUserId: userId,
      receivedAt: grData.receivedDate ? new Date(grData.receivedDate) : new Date(),
      notes: grData.notes,
    });
    for (const line of lines) {
      await tx.insert(goodsReceiptLines).values({ id: genId(), tenantId, goodsReceiptId: grId, ...line });
      if (line.acceptedQuantity > 0) {
        // Post inventory movement and update/create balance
        const movId = genId();
        await tx.insert(maintenanceInventoryMovements).values({
          id: movId, tenantId,
          warehouseId: grData.warehouseId,
          itemId: line.itemId,
          movementType: "GOODS_RECEIPT",
          quantity: line.acceptedQuantity,
          unitOfMeasure: line.unitOfMeasure,
          referenceType: "GOODS_RECEIPT",
          referenceId: grId,
          goodsReceiptId: grId,
          purchaseOrderId: grData.purchaseOrderId,
          notes: line.notes,
          createdByUserId: userId,
        });
        // Upsert the balance
        await tx.execute(sql`
          INSERT INTO maintenance_inventory_balances (id, tenant_id, warehouse_id, item_id, quantity_on_hand, quantity_available, last_movement_at, created_at, updated_at)
          VALUES (${genId()}, ${tenantId}, ${grData.warehouseId}, ${line.itemId}, ${line.acceptedQuantity}, ${line.acceptedQuantity}, NOW(), NOW(), NOW())
          ON CONFLICT (tenant_id, warehouse_id, item_id)
          DO UPDATE SET
            quantity_on_hand = maintenance_inventory_balances.quantity_on_hand + ${line.acceptedQuantity},
            quantity_available = maintenance_inventory_balances.quantity_available + ${line.acceptedQuantity},
            last_movement_at = NOW(),
            updated_at = NOW()
        `);
      }
    }
    // Mark PO as received
    await tx.update(purchaseOrders).set({ status: "RECEIVED" }).where(eq(purchaseOrders.id, grData.purchaseOrderId));
  });
  const created = await db.query.goodsReceipts.findFirst({ where: eq(goodsReceipts.id, grId),  });
  return NextResponse.json(created, { status: 201 });
}
}
