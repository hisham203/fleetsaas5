export const dynamic = "force-dynamic";
/**
 * GET  /api/notifications — list notifications for current user
 *   ?unread=true — only unread
 *   ?limit=N     — page size (max 50)
 * PATCH /api/notifications/read-all — mark all as read (same file for simplicity)
 *
 * Notifications are scoped to: user-specific (userId matches) OR tenant-wide (userId IS NULL).
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { notifications } from "@/lib/db/schema";
import { getSessionFromRequest, getSessionTenantId } from "@/lib/auth";
import { checkPermission, PERMISSIONS } from "@/lib/requirePermission";
import { eq, and, or, isNull, desc } from "drizzle-orm";
import { genId } from "@/lib/helpers";

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = getSessionTenantId(session);
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const deny = await checkPermission(session, tenantId, PERMISSIONS.TRIPS_VIEW);
  if (deny) return deny;

  const userId = (session as any)?.user?.id as string | undefined;
  const url = new URL(req.url);
  const unreadOnly = url.searchParams.get("unread") === "true";
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "30"), 50);

  const conditions: any[] = [eq(notifications.tenantId, tenantId)];
  if (unreadOnly) conditions.push(eq(notifications.read, false));

  // Include tenant-wide broadcasts OR user-targeted:
  if (userId) {
    conditions.push(or(isNull(notifications.userId), eq(notifications.userId, userId)));
  } else {
    conditions.push(isNull(notifications.userId));
  }

  const rows = await db.query.notifications.findMany({
    where: and(...conditions as [any, ...any[]]),
    orderBy: desc(notifications.createdAt),
    limit,
  });

  const unreadCount = rows.filter(n => !n.read).length;
  return NextResponse.json({ notifications: rows, unreadCount, fetchedAt: new Date().toISOString() });
}

export async function PATCH(req: NextRequest) {
  // Mark all as read for current user:
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = getSessionTenantId(session);
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = (session as any)?.user?.id as string | undefined;

  const conditions: any[] = [
    eq(notifications.tenantId, tenantId),
    eq(notifications.read, false),
  ];
  if (userId) {
    conditions.push(or(isNull(notifications.userId), eq(notifications.userId, userId)));
  } else {
    conditions.push(isNull(notifications.userId));
  }

  await db.update(notifications)
    .set({ read: true })
    .where(and(...conditions as [any, ...any[]]));

  return NextResponse.json({ ok: true });
}
