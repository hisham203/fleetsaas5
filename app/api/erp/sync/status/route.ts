export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { invoices } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, desc } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;

  const rows = await db.query.invoices.findMany({
    where: eq(invoices.tenantId, tenantId),
    with: { customer: true },
    orderBy: desc(invoices.createdAt),
  });

  return NextResponse.json(
    rows.map((r) => ({
      id: r.id,
      invoiceNumber: r.invoiceNumber,
      customerName: r.customer?.name ?? null,
      total: r.total,
      status: r.status,
      erpExternalId: r.erpExternalId,
      erpSyncedAt: r.erpSyncedAt,
      erpSyncError: r.erpSyncError,
    }))
  );
}
