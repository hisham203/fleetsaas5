export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { goodsReceipts } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, and } from "drizzle-orm";

// Milestone Z.1 — schema-only foundation. Read-only. No receiving/
// posting workflow exists yet — posting a receipt (which will later
// create an inventory movement and update the balance) is explicitly
// out of scope for this milestone.
export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;
  const status = req.nextUrl.searchParams.get("status");
  const purchaseOrderId = req.nextUrl.searchParams.get("purchaseOrderId");

  const conditions = [
    eq(goodsReceipts.tenantId, tenantId),
    status ? eq(goodsReceipts.status, status) : undefined,
    purchaseOrderId ? eq(goodsReceipts.purchaseOrderId, purchaseOrderId) : undefined,
  ].filter(Boolean) as any[];
  const rows = await db.query.goodsReceipts.findMany({ where: and(...conditions) });
  return NextResponse.json(rows);
}
