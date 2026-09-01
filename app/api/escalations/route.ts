export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { escalations } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { checkAndCreateEscalations } from "@/lib/escalations";
import { eq, and, desc } from "drizzle-orm";

// BR-20 Escalation Center. Every call here first runs the automatic
// breach-check (see lib/escalations.ts) before listing, so simply opening
// this panel is what keeps escalations current — the same "compute/check
// on read" pattern the rest of this build's SLA handling already uses.
export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN", "DISPATCHER"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;

  await checkAndCreateEscalations(tenantId);

  const status = req.nextUrl.searchParams.get("status");
  const conditions = [eq(escalations.tenantId, tenantId), status ? eq(escalations.status, status) : undefined].filter(
    Boolean
  ) as any[];

  const rows = await db.query.escalations.findMany({
    where: and(...conditions),
    with: { order: { with: { customer: true } } },
    orderBy: desc(escalations.createdAt),
  });
  return NextResponse.json(rows);
}
