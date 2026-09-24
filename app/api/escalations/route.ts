export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { escalations } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { checkAndCreateEscalations } from "@/lib/escalations";
import { eq, and, desc } from "drizzle-orm";
import { SAFE_CUSTOMER_COLUMNS } from "@/lib/contractHelpers";
import { checkPermission, PERMISSIONS } from "@/lib/requirePermission";

// BR-20 Escalation Center. Every call here first runs the automatic
// breach-check (see lib/escalations.ts) before listing, so simply opening
// this panel is what keeps escalations current — the same "compute/check
// on read" pattern the rest of this build's SLA handling already uses.
export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = getSessionTenantId(session)!;
  const _permDeny1 = await checkPermission(session, tenantId, PERMISSIONS.CONTROL_TOWER_VIEW);
  if (_permDeny1) return _permDeny1;
  const _permDeny2 = await checkPermission(session, tenantId, PERMISSIONS.CONTROL_TOWER_VIEW); if (_permDeny2) return _permDeny2;

  await checkAndCreateEscalations(tenantId);

  const status = req.nextUrl.searchParams.get("status");
  const conditions = [eq(escalations.tenantId, tenantId), status ? eq(escalations.status, status) : undefined].filter(
    Boolean
  ) as any[];

  const rows = await db.query.escalations.findMany({
    where: and(...conditions),
    with: { order: { with: { customer: { columns: SAFE_CUSTOMER_COLUMNS } } } },
    orderBy: desc(escalations.createdAt),
  });
  return NextResponse.json(rows);
}
