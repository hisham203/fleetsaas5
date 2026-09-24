export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { invoices } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, desc } from "drizzle-orm";
import { checkPermission, PERMISSIONS } from "@/lib/requirePermission";

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = getSessionTenantId(session)!;
  const _permDeny1 = await checkPermission(session, tenantId, PERMISSIONS.ROLES_VIEW); if (_permDeny1) return _permDeny1;

  const rows = await db.query.invoices.findMany({
    where: eq(invoices.tenantId, tenantId),
    // Verified safe in the Task S1 audit — only r.customer?.name is ever
    // read below, never the raw object; it never reaches the response
    // (see the .map() a few lines down). SECURITY_EXPOSURE_CHECK_ALLOW
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
