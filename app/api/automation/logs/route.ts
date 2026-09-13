export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { automationLogs } from "@/lib/db/schema";
import { enforceRbac } from "@/lib/enforceRbac";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, desc } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN", "DISPATCHER"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;
  const _deny = await enforceRbac(session, tenantId, "control_tower"); if (_deny) return _deny;

  const rows = await db.query.automationLogs.findMany({
    where: eq(automationLogs.tenantId, tenantId),
    with: { order: true },
    orderBy: desc(automationLogs.createdAt),
    limit: 200,
  });
  return NextResponse.json(rows);
}
