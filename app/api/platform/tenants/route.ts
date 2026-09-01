export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { tenants, platformAdminTenantGrants } from "@/lib/db/schema";
import { getSessionFromRequest } from "@/lib/auth";
import { eq, inArray } from "drizzle-orm";

// Company Switcher: returns the list of tenants the CURRENT user may
// switch into — their own home tenant plus any explicit grants. Returns a
// 403 for anyone who isn't a platform admin, not just an empty list — an
// ordinary tenant Admin should never even learn this endpoint exists,
// let alone see their own tenant echoed back as if a "switcher" applied
// to them.
export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || session.type !== "USER") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!session.user.isPlatformAdmin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const grants = await db.query.platformAdminTenantGrants.findMany({
    where: eq(platformAdminTenantGrants.userId, session.user.id),
  });
  const tenantIds = Array.from(new Set([session.user.tenantId, ...grants.map((g) => g.tenantId)]));

  const rows = await db.query.tenants.findMany({ where: inArray(tenants.id, tenantIds) });
  return NextResponse.json(
    rows.map((t) => ({ id: t.id, name: t.name, sector: t.sector, isHome: t.id === session.user.tenantId }))
  );
}
