export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { expenseClaims } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, and } from "drizzle-orm";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;
  const userId = session!.type === "USER" ? session!.user.id : null;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const claim = await db.query.expenseClaims.findFirst({ where: and(eq(expenseClaims.id, id), eq(expenseClaims.tenantId, tenantId)) });
  if (!claim) return NextResponse.json({ error: "Expense claim not found" }, { status: 404 });
  if (claim.status !== "PENDING") {
    return NextResponse.json({ error: "Only a PENDING claim can be approved" }, { status: 422 });
  }

  await db
    .update(expenseClaims)
    .set({ status: "APPROVED", reviewedByUserId: userId, reviewedAt: new Date() })
    .where(eq(expenseClaims.id, claim.id));

  const updated = await db.query.expenseClaims.findFirst({ where: eq(expenseClaims.id, claim.id) });
  return NextResponse.json(updated);
}
