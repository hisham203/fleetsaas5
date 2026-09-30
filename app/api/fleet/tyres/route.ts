export const dynamic = "force-dynamic";
/**
 * GET /api/fleet/tyres
 *
 * Tenant-scoped fleet-wide tyre records.
 * Single efficient query — no N+1 per vehicle.
 * Vehicle identity embedded for each record.
 *
 * Permission: MAINTENANCE_VIEW (consistent with per-vehicle tyre endpoint)
 * Tenant isolation: via vehicle IDs
 *
 * Query params:
 *   ?status=ACTIVE|RETIRED  filter by tyre status
 *   ?vehicleId=<id>  filter to one vehicle
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { tyreRecords, vehicles } from "@/lib/db/schema";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getSessionFromRequest, getSessionTenantId } from "@/lib/auth";
import { checkPermission, PERMISSIONS } from "@/lib/requirePermission";

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = getSessionTenantId(session)!;
  const deny = await checkPermission(session, tenantId, PERMISSIONS.MAINTENANCE_VIEW);
  if (deny) return deny;

  const url = new URL(req.url);
  const statusFilter = url.searchParams.get("status");
  const vehicleIdFilter = url.searchParams.get("vehicleId");

  const tenantVehicles = await db.query.vehicles.findMany({
    where: eq(vehicles.tenantId, tenantId),
    columns: { id: true, plateNumber: true, vehicleType: true, vehicleCode: true, status: true },
  });
  if (tenantVehicles.length === 0) return NextResponse.json([]);

  const vehicleIds = vehicleIdFilter
    ? tenantVehicles.filter((v) => v.id === vehicleIdFilter).map((v) => v.id)
    : tenantVehicles.map((v) => v.id);

  if (vehicleIds.length === 0) return NextResponse.json([]);

  const conditions = [inArray(tyreRecords.vehicleId, vehicleIds)];
  if (statusFilter) conditions.push(eq(tyreRecords.status, statusFilter.toUpperCase()));

  const rows = await db.query.tyreRecords.findMany({
    where: and(...conditions),
    orderBy: desc(tyreRecords.installedAt),
  });

  const vehicleMap = new Map(tenantVehicles.map((v) => [v.id, v]));
  const result = rows.map((r) => ({
    ...r,
    vehicle: vehicleMap.get(r.vehicleId) ?? null,
  }));

  return NextResponse.json(result);
}
