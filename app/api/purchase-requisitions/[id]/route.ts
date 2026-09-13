export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { purchaseRequisitions } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { enforceRbac } from "@/lib/enforceRbac";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

const actionSchema = z.object({
  action: z.enum(["submit", "approve", "reject"]),
  rejectionReason: z.string().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN", "DISPATCHER"])) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = getSessionTenantId(session)!;
  const _deny = await enforceRbac(session, tenantId, "procurement"); if (_deny) return _deny;
  const userId = session!.type === "USER" ? session!.user.id : "";
  const pr = await db.query.purchaseRequisitions.findFirst({ where: and(eq(purchaseRequisitions.id, id), eq(purchaseRequisitions.tenantId, tenantId)) });
  if (!pr) return NextResponse.json({ error: "PR not found" }, { status: 404 });
  const body = await req.json();
  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { action, rejectionReason } = parsed.data;
  let updates: Record<string, unknown> = {};
  if (action === "submit") {
    if (pr.status !== "DRAFT") return NextResponse.json({ error: "Only DRAFT PRs can be submitted" }, { status: 422 });
    updates = { status: "SUBMITTED" };
  } else if (action === "approve") {
    if (!session || !hasRole(session, ["ADMIN"])) return NextResponse.json({ error: "Only ADMIN can approve" }, { status: 403 });
    if (pr.status !== "SUBMITTED") return NextResponse.json({ error: "Only SUBMITTED PRs can be approved" }, { status: 422 });
    updates = { status: "APPROVED", approvedByUserId: userId, approvedAt: new Date() };
  } else if (action === "reject") {
    if (!session || !hasRole(session, ["ADMIN"])) return NextResponse.json({ error: "Only ADMIN can reject" }, { status: 403 });
    if (!rejectionReason) return NextResponse.json({ error: "Rejection reason is required" }, { status: 400 });
    updates = { status: "REJECTED", rejectedByUserId: userId, rejectedAt: new Date(), rejectionReason };
  }
  await db.update(purchaseRequisitions).set(updates).where(eq(purchaseRequisitions.id, id));
  const updated = await db.query.purchaseRequisitions.findFirst({ where: eq(purchaseRequisitions.id, id), with: { lines: true } });
  return NextResponse.json(updated);
}
