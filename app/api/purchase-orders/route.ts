export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { purchaseOrders } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, and } from "drizzle-orm";

// Milestone Z.1 — schema-only foundation. Read-only. No PO creation/
// issuing workflow exists yet.
export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;
  const status = req.nextUrl.searchParams.get("status");
  const supplierId = req.nextUrl.searchParams.get("supplierId");

  const conditions = [
    eq(purchaseOrders.tenantId, tenantId),
    status ? eq(purchaseOrders.status, status) : undefined,
    supplierId ? eq(purchaseOrders.supplierId, supplierId) : undefined,
  ].filter(Boolean) as any[];
  const rows = await db.query.purchaseOrders.findMany({ where: and(...conditions) });
  return NextResponse.json(rows);
}
