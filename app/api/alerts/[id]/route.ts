export const dynamic = "force-dynamic";
/**
 * PATCH /api/alerts/[id]/acknowledge
 * PATCH /api/alerts/[id]/resolve
 * via ?action=acknowledge or ?action=resolve query param (single endpoint)
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { telemetryEvents } from "@/lib/db/schema";
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
  const deny = await checkPermission(session, tenantId, PERMISSIONS.CONTROL_TOWER_MANAGE_EVENTS);
  if (deny) return deny;

  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? "acknowledge";
  const userId = (session as any)?.user?.id ?? null;
  const now = new Date();

  const event = await db.query.telemetryEvents.findFirst({
    where: and(eq(telemetryEvents.id, id), eq(telemetryEvents.tenantId, tenantId)),
    columns: { id: true, status: true },
  });
  if (!event) return NextResponse.json({ error: "Alert not found" }, { status: 404 });

  if (action === "acknowledge" && event.status === "OPEN") {
    await db.update(telemetryEvents)
      .set({ status: "ACKNOWLEDGED", acknowledgedBy: userId, acknowledgedAt: now } as any)
      .where(eq(telemetryEvents.id, id));
    return NextResponse.json({ ok: true, status: "ACKNOWLEDGED" });
  }

  if (action === "resolve") {
    await db.update(telemetryEvents)
      .set({ status: "RESOLVED", resolvedBy: userId, resolvedAt: now } as any)
      .where(eq(telemetryEvents.id, id));
    return NextResponse.json({ ok: true, status: "RESOLVED" });
  }

  return NextResponse.json({ error: "Invalid action or alert not in correct state" }, { status: 422 });
}
