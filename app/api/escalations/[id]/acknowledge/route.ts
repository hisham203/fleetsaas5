export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { escalations } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, and } from "drizzle-orm";

// BR-20: acknowledging an escalation records who's on it, without closing
// the case — the underlying SLA situation may still need to actually be
// fixed (e.g. by reassigning the trip via BR-11's exception workflow).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN", "DISPATCHER"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;
  const userId = session!.type === "USER" ? session!.user.id : null;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const escalation = await db.query.escalations.findFirst({
    where: and(eq(escalations.id, id), eq(escalations.tenantId, tenantId)),
  });
  if (!escalation) return NextResponse.json({ error: "Escalation not found" }, { status: 404 });
  if (escalation.status !== "OPEN") {
    return NextResponse.json({ error: "Only an OPEN escalation can be acknowledged" }, { status: 422 });
  }

  await db
    .update(escalations)
    .set({ status: "ACKNOWLEDGED", acknowledgedAt: new Date(), acknowledgedByUserId: userId })
    .where(eq(escalations.id, escalation.id));

  const updated = await db.query.escalations.findFirst({ where: eq(escalations.id, escalation.id) });
  return NextResponse.json(updated);
}
