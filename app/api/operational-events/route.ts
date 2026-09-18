export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { operationalEvents, trips, vehicles, orders } from "@/lib/db/schema";
import { enforceRbac } from "@/lib/enforceRbac";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, and, desc } from "drizzle-orm";
import { genId } from "@/lib/helpers";
import { z } from "zod";

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN", "DISPATCHER"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;
  const _deny = await enforceRbac(session, tenantId, "control_tower"); if (_deny) return _deny;

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
  if (!hasRole(session, ["ADMIN", "DISPATCHER"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
