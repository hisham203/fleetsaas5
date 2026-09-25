export const dynamic = "force-dynamic";
/**
 * P2-02: Loading Points for trip planning.
 *
 * Operationally a "Loading Point"; internally backed by the existing
 * `warehouses` table (see lib/db/schema.ts — warehouses IS the loading-point
 * table). Read-only, tenant-scoped, trips.view — so an Operation Coordinator
 * (no inventory.view) can choose where a planned trip loads.
 *
 * Response: LoadingPoint[] = { id, name, code, address, isDefault }[]
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { warehouses } from "@/lib/db/schema";
import { asc, desc, eq } from "drizzle-orm";
import { getSessionFromRequest, getSessionTenantId } from "@/lib/auth";
import { checkPermission, PERMISSIONS } from "@/lib/requirePermission";

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = getSessionTenantId(session);
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const _deny = await checkPermission(session, tenantId, PERMISSIONS.TRIPS_VIEW);
  if (_deny) return _deny;
  const rows = await db.query.warehouses.findMany({
    where: eq(warehouses.tenantId, tenantId),
    columns: { id: true, name: true, loadingPointCode: true, address: true, isDefault: true },
    orderBy: [desc(warehouses.isDefault), asc(warehouses.name)],
  });
  return NextResponse.json(rows.map((w) => ({ id: w.id, name: w.name, code: w.loadingPointCode ?? null, address: w.address, isDefault: w.isDefault })));
}
