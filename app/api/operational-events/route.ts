export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { operationalEvents, trips, vehicles, orders } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, and, desc } from "drizzle-orm";
import { genId } from "@/lib/helpers";
import { z } from "zod";
import { checkPermission, PERMISSIONS } from "@/lib/requirePermission";

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = getSessionTenantId(session)!;
  const _permDeny1 = await checkPermission(session, tenantId, PERMISSIONS.CONTROL_TOWER_VIEW);
  if (_permDeny1) return _permDeny1;
  const _permDeny2 = await checkPermission(session, tenantId, PERMISSIONS.CONTROL_TOWER_VIEW); if (_permDeny2) return _permDeny2;

  const url = new URL(req.url);
  const unreadOnly = url.searchParams.get("unread") === "true";

  const where = unreadOnly
    ? and(eq(operationalEvents.tenantId, tenantId), eq(operationalEvents.read, false))
    : eq(operationalEvents.tenantId, tenantId);

  const rows = await db.query.operationalEvents.findMany({
    where,
    orderBy: desc(operationalEvents.createdAt),
    limit: 200,
  });

  const unreadCount = rows.filter((r) => !r.read).length;
  return NextResponse.json({ events: rows, unreadCount, fetchedAt: new Date().toISOString() });
}

// Mark events as read:
export async function PATCH(req: NextRequest) {
  const session = await getSessionFromRequest(req);

  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!getSessionTenantId(session)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  {
    const { hasRole: _hr3, getSessionTenantId: _gst3 } = await import("@/lib/auth");
    if (!_hr3(session, ["ADMIN"])) {
      const { checkPermission: _cp3, PERMISSIONS: _P3 } = await import("@/lib/requirePermission");
      const _tenId3 = _gst3(session)!;
      const _d3 = await _cp3(session, _tenId3, _P3.CONTROL_TOWER_MANAGE_EVENTS);
      if (_d3) return _d3;
    }
  }
  const tenantId = getSessionTenantId(session)!;
  const body = await req.json().catch(() => ({}));
  const ids: string[] = body.ids ?? [];

  if (ids.length > 0) {
    const { inArray } = await import("drizzle-orm");
    await db.update(operationalEvents)
      .set({ read: true })
      .where(and(eq(operationalEvents.tenantId, tenantId), inArray(operationalEvents.id, ids)));
  } else {
    // Mark all as read:
    await db.update(operationalEvents).set({ read: true }).where(eq(operationalEvents.tenantId, tenantId));
  }
  return NextResponse.json({ ok: true });
}
