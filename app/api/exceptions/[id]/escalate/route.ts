export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { exceptions, users } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

const escalateSchema = z.object({
  escalatedToUserId: z.string().optional(), // omit to escalate generically, without naming a specific person
});

// BR-11: escalating flags an exception for supervisor/admin attention — it
// does NOT close the case. A dispatcher might escalate and still need to
// apply Reschedule/Return/Reassign/Cancel afterward once guidance comes
// back, so this is a separate endpoint from /resolve.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN", "DISPATCHER"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;

  const exception = await db.query.exceptions.findFirst({ where: and(eq(exceptions.id, id), eq(exceptions.tenantId, tenantId)) });
  if (!exception) return NextResponse.json({ error: "Exception not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const parsed = escalateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  if (parsed.data.escalatedToUserId) {
    const target = await db.query.users.findFirst({
      where: and(eq(users.id, parsed.data.escalatedToUserId), eq(users.tenantId, tenantId), eq(users.role, "ADMIN")),
    });
    if (!target) return NextResponse.json({ error: "Escalation target must be an Admin in this tenant" }, { status: 404 });
  }

  await db
    .update(exceptions)
    .set({ escalated: true, escalatedToUserId: parsed.data.escalatedToUserId ?? null, escalatedAt: new Date() })
    .where(eq(exceptions.id, exception.id));

  const updated = await db.query.exceptions.findFirst({ where: eq(exceptions.id, exception.id) });
  return NextResponse.json(updated);
}
