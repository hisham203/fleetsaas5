export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { escalations } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

const resolveSchema = z.object({
  notes: z.string().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN", "DISPATCHER"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;

  const escalation = await db.query.escalations.findFirst({
    where: and(eq(escalations.id, id), eq(escalations.tenantId, tenantId)),
  });
  if (!escalation) return NextResponse.json({ error: "Escalation not found" }, { status: 404 });
  if (escalation.status === "RESOLVED") {
    return NextResponse.json({ error: "This escalation has already been resolved" }, { status: 422 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = resolveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  await db
    .update(escalations)
    .set({ status: "RESOLVED", resolvedAt: new Date(), resolutionNotes: parsed.data.notes })
    .where(eq(escalations.id, escalation.id));

  const updated = await db.query.escalations.findFirst({ where: eq(escalations.id, escalation.id) });
  return NextResponse.json(updated);
}
