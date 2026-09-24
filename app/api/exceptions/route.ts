export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { exceptions } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, and, desc } from "drizzle-orm";
import { SAFE_CUSTOMER_COLUMNS, SAFE_USER_COLUMNS } from "@/lib/contractHelpers";
import { checkPermission, PERMISSIONS } from "@/lib/requirePermission";

// BR-11 / APP-02 Exception Center — every failed or partially-delivered
// stop shows up here until a dispatcher applies a closing action.
export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = getSessionTenantId(session)!;
  const _permDeny1 = await checkPermission(session, tenantId, PERMISSIONS.CONTROL_TOWER_VIEW);
  if (_permDeny1) return _permDeny1;
  const _permDeny2 = await checkPermission(session, tenantId, PERMISSIONS.CONTROL_TOWER_VIEW); if (_permDeny2) return _permDeny2;

  const status = req.nextUrl.searchParams.get("status");
  const conditions = [eq(exceptions.tenantId, tenantId), status ? eq(exceptions.status, status) : undefined].filter(
    Boolean
  ) as any[];

  const rows = await db.query.exceptions.findMany({
    where: and(...conditions),
    with: {
      order: { with: { customer: { columns: SAFE_CUSTOMER_COLUMNS } } },
      tripStop: { with: { trip: { with: { driver: { with: { user: { columns: SAFE_USER_COLUMNS } } }, vehicle: true } } } },
    },
    orderBy: desc(exceptions.createdAt),
  });
  return NextResponse.json(rows);
}
