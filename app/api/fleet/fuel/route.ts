export const dynamic = "force-dynamic";
/**
 * GET /api/fleet/fuel
 *
 * Tenant-scoped fleet-wide fuel logs.
 * No arbitrary vehicle cap — returns all fuel logs for all tenant vehicles.
 * Vehicle identity embedded for each record.
 *
 * Permission: REPORTS_FLEET_VIEW (consistent with per-vehicle /api/vehicles/[id]/fuel)
 * Tenant isolation: via vehicle IDs (fuelLogs has tenantId but vehicles provides identity)
 *
 * Query params:
 *   ?vehicleId=<id>  filter to one vehicle
 *   ?limit=<n>       max records (default 500, hard cap 2000)
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { fuelLogs, vehicles } from "@/lib/db/schema";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getSessionFromRequest, getSessionTenantId } from "@/lib/auth";
import { checkPermission, PERMISSIONS } from "@/lib/requirePermission";

const DEFAULT_LIMIT = 500;
const HARD_CAP = 2000;

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = getSessionTenantId(session)!;
  const deny = await checkPermission(session, tenantId, PERMISSIONS.REPORTS_FLEET_VIEW);
  if (deny) return deny;

  const url = new URL(req.url);
  const vehicleIdFilter = url.searchParams.get("vehicleId");
  const limitParam = parseInt(url.searchParams.get("limit") ?? "", 10);
  const limit = isNaN(limitParam) ? DEFAULT_LIMIT : Math.min(limitParam, HARD_CAP);

  // All tenant vehicles — for identity mapping and isolation:
  const tenantVehicles = await db.query.vehicles.findMany({
    where: eq(vehicles.tenantId, tenantId),
    columns: { id: true, plateNumber: true, vehicleType: true, vehicleCode: true, status: true },
  });
  if (tenantVehicles.length === 0) return NextResponse.json([]);

  const vehicleIds = vehicleIdFilter
    ? tenantVehicles.filter((v) => v.id === vehicleIdFilter).map((v) => v.id)
    : tenantVehicles.map((v) => v.id);

  if (vehicleIds.length === 0) return NextResponse.json([]);

  const rows = await db.query.fuelLogs.findMany({
    where: inArray(fuelLogs.vehicleId, vehicleIds),
    orderBy: desc(fuelLogs.filledAt),
    limit,
  });

  const vehicleMap = new Map(tenantVehicles.map((v) => [v.id, v]));
  const result = rows.map((r) => ({
    ...r,
    vehicle: vehicleMap.get(r.vehicleId) ?? null,
  }));

  return NextResponse.json(result);
}
