export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { notifications } from "@/lib/db/schema";
import { getSessionFromRequest, getSessionTenantId } from "@/lib/auth";
import { checkPermission, PERMISSIONS } from "@/lib/requirePermission";
import { eq, and } from "drizzle-orm";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = getSessionTenantId(session);
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await db.update(notifications)
    .set({ read: true })
    .where(and(eq(notifications.id, id), eq(notifications.tenantId, tenantId)));

  return NextResponse.json({ ok: true });
}
