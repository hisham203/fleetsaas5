export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { savedReports } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, and } from "drizzle-orm";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN", "DISPATCHER"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;

  const existing = await db.query.savedReports.findFirst({
    where: and(eq(savedReports.id, id), eq(savedReports.tenantId, tenantId)),
  });
  if (!existing) return NextResponse.json({ error: "Report not found" }, { status: 404 });

  await db.delete(savedReports).where(eq(savedReports.id, id));
  return NextResponse.json({ ok: true });
}
