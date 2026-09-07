export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { maintenanceWarehouses } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, and } from "drizzle-orm";

// Milestone Z.1 — schema-only foundation. Read-only. Deliberately a
// separate table/route from the existing GET /api/warehouses (dispatch
// loading points) — never the same data.
export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;
  const workshopId = req.nextUrl.searchParams.get("workshopId");
  const status = req.nextUrl.searchParams.get("status");

  const conditions = [
    eq(maintenanceWarehouses.tenantId, tenantId),
    workshopId ? eq(maintenanceWarehouses.workshopId, workshopId) : undefined,
    status ? eq(maintenanceWarehouses.status, status) : undefined,
  ].filter(Boolean) as any[];
  const rows = await db.query.maintenanceWarehouses.findMany({ where: and(...conditions) });
  return NextResponse.json(rows);
}
