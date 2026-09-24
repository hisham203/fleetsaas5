export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { automationLogs } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, desc } from "drizzle-orm";
import { checkPermission, PERMISSIONS } from "@/lib/requirePermission";

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = getSessionTenantId(session)!;
  const _permDeny1 = await checkPermission(session, tenantId, PERMISSIONS.TRIPS_VIEW);
  if (_permDeny1) return _permDeny1;
  const _permDeny2 = await checkPermission(session, tenantId, PERMISSIONS.TRIPS_VIEW); if (_permDeny2) return _permDeny2;

  const rows = await db.query.automationLogs.findMany({
    where: eq(automationLogs.tenantId, tenantId),
    with: { order: true },
    orderBy: desc(automationLogs.createdAt),
    limit: 200,
  });
  return NextResponse.json(rows);
}
