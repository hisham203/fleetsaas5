export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { purchaseRequisitions, purchaseRequisitionLines } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { enforceRbac } from "@/lib/enforceRbac";
import { resolveEntityCode } from "@/lib/businessCodes";
import { genId } from "@/lib/helpers";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";

const lineSchema = z.object({
  itemId: z.string().min(1),
  description: z.string().optional(),
  quantity: z.number().positive(),
  unitOfMeasure: z.string().min(1),
  estimatedUnitCost: z.number().optional(),
});

const createSchema = z.object({
  workshopId: z.string().optional(),
  warehouseId: z.string().optional(),
  vehicleId: z.string().optional(),
  maintenanceRecordId: z.string().optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL"),
  requiredByDate: z.string().optional(),
  justification: z.string().optional(),
  lines: z.array(lineSchema).min(1, "At least one line item is required"),
});

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !hasRole(session, ["ADMIN", "DISPATCHER"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;
  const _deny = await enforceRbac(session, tenantId, "procurement"); if (_deny) return _deny;
  const userId = session!.type === "USER" ? session!.user.id : "";
  const status = req.nextUrl.searchParams.get("status");
  const conditions = [eq(purchaseRequisitions.tenantId, tenantId), status ? eq(purchaseRequisitions.status, status) : undefined].filter(Boolean) as any[];
  const rows = await db.query.purchaseRequisitions.findMany({
    where: and(...conditions),
    with: { lines: true },
    orderBy: [desc(purchaseRequisitions.createdAt)],
  });
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !hasRole(session, ["ADMIN", "DISPATCHER"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;
  const _deny = await enforceRbac(session, tenantId, "procurement"); if (_deny) return _deny;
  const userId = session.type === "USER" ? session.user.id : "";
  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { lines, ...prData } = parsed.data;
  const prId = genId();
  // RC1: PURCHASE_REQUISITION requires a configured numbering series — no timestamp fallback.
  let prNumber: string;
  try {
    const _r = await resolveEntityCode({ tenantId, entityType: "PURCHASE_REQUISITION", entityLabel: "purchase requisition", codeLabel: "purchase requisition number", provided: undefined });
    if (!_r.ok) return NextResponse.json({ error: "CONFIGURE_NUMBERING", message: "No active PURCHASE_REQUISITION numbering series. Go to Settings → Numbering and apply recommended series." }, { status: 422 });
    prNumber = _r.code;
  } catch (err: any) {
    if (err?.message?.includes("No active")) return NextResponse.json({ error: "CONFIGURE_NUMBERING", message: "No active PURCHASE_REQUISITION numbering series. Go to Settings → Numbering and apply recommended series." }, { status: 422 });
    throw err;
  

  await db.transaction(async (tx) => {
    await tx.insert(purchaseRequisitions).values({
      id: prId, tenantId,
      prNumber,
      requestedByUserId: userId,
      status: "DRAFT",
      ...prData,
      requiredByDate: prData.requiredByDate ? new Date(prData.requiredByDate) : undefined,
    });
    for (const line of lines) {
      await tx.insert(purchaseRequisitionLines).values({
        id: genId(), tenantId,
        purchaseRequisitionId: prId,
        ...line,
      });
    }
  });

  const created = await db.query.purchaseRequisitions.findFirst({
    where: eq(purchaseRequisitions.id, prId),
    with: { lines: true },
  });
  return NextResponse.json(created, { status: 201 });
}
}
