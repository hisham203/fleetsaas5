// procurement: PR → PO → GR workflow (same-tenant enforced)
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { purchaseOrders, purchaseOrderLines, purchaseRequisitions } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { resolveEntityCode } from "@/lib/businessCodes";
import { genId } from "@/lib/helpers";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";
import { checkPermission, PERMISSIONS } from "@/lib/requirePermission";

const lineSchema = z.object({
  itemId: z.string().min(1),
  description: z.string().optional(),
  orderedQuantity: z.number().positive(),
  unitOfMeasure: z.string().min(1),
  unitPrice: z.number().min(0).default(0),
  taxRate: z.number().min(0).default(0),
});
const createSchema = z.object({
  supplierId: z.string().min(1),
  sourcePurchaseRequisitionId: z.string().optional(),
  expectedDeliveryDate: z.string().optional(),
  notes: z.string().optional(),
  lines: z.array(lineSchema).min(1),
});

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = getSessionTenantId(session)!;
  const _permDeny1 = await checkPermission(session, tenantId, PERMISSIONS.PO_VIEW);
  if (_permDeny1) return _permDeny1;
  const _permDeny2 = await checkPermission(session, tenantId, PERMISSIONS.PR_VIEW); if (_permDeny2) return _permDeny2;
  const userId = session!.type === "USER" ? session!.user.id : "";
  const status = req.nextUrl.searchParams.get("status");
  const conditions = [eq(purchaseOrders.tenantId, tenantId), status ? eq(purchaseOrders.status, status) : undefined].filter(Boolean) as any[];
  const rows = await db.query.purchaseOrders.findMany({
    where: and(...conditions),
    with: { lines: true },
    orderBy: [desc(purchaseOrders.createdAt)],
  });
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !hasRole(session, ["ADMIN"])) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = getSessionTenantId(session)!;
  const _permDeny2 = await checkPermission(session, tenantId, PERMISSIONS.PR_VIEW); if (_permDeny2) return _permDeny2;
  const userId = session!.type === "USER" ? session!.user.id : "";
  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { lines, ...poData } = parsed.data;
  const poId = genId();
  // RC1: PURCHASE_ORDER requires a configured numbering series — no timestamp fallback.
  let poNumber: string;
  try {
    const _r = await resolveEntityCode({ tenantId, entityType: "PURCHASE_ORDER", entityLabel: "purchase order", codeLabel: "purchase order number", provided: undefined });
    if (!_r.ok) return NextResponse.json({ error: "CONFIGURE_NUMBERING", message: "No active PURCHASE_ORDER numbering series. Go to Settings → Numbering and apply recommended series." }, { status: 422 });
    poNumber = _r.code;
  } catch (err: any) {
    if (err?.message?.includes("No active")) return NextResponse.json({ error: "CONFIGURE_NUMBERING", message: "No active PURCHASE_ORDER numbering series. Go to Settings → Numbering and apply recommended series." }, { status: 422 });
    throw err;
  
  const totalAmount = lines.reduce((sum, l) => sum + l.orderedQuantity * l.unitPrice * (1 + l.taxRate / 100), 0);
  await db.transaction(async (tx) => {
    await tx.insert(purchaseOrders).values({
      id: poId, tenantId, poNumber,
      supplierId: poData.supplierId,
      sourcePurchaseRequisitionId: poData.sourcePurchaseRequisitionId,
      status: "DRAFT", totalAmount,
      expectedDeliveryDate: poData.expectedDeliveryDate ? new Date(poData.expectedDeliveryDate) : undefined,
      notes: poData.notes,
    });
    for (const line of lines) {
      const lineTotal = line.orderedQuantity * line.unitPrice * (1 + line.taxRate / 100);
      await tx.insert(purchaseOrderLines).values({ id: genId(), tenantId, purchaseOrderId: poId, ...line, lineTotal });
    }
    if (poData.sourcePurchaseRequisitionId) {
      await tx.update(purchaseRequisitions).set({ status: "PO_CREATED" }).where(eq(purchaseRequisitions.id, poData.sourcePurchaseRequisitionId));
    }
  });
  const created = await db.query.purchaseOrders.findFirst({ where: eq(purchaseOrders.id, poId), with: { lines: true } });
  return NextResponse.json(created, { status: 201 });
}
}
