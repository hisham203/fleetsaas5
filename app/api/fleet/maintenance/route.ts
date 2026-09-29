export const dynamic = "force-dynamic";
/**
 * GET /api/fleet/maintenance
 *
 * Tenant-scoped fleet-wide maintenance records.
 * Returns all maintenanceRecords for the tenant with embedded vehicle identity.
 *
 * Permission: MAINTENANCE_VIEW (same as per-vehicle endpoint)
 * Tenant isolation: tenantId scoped via vehicles relation
 *
 * Query params:
 *   ?status=OPEN|COMPLETED  (filter by record status)
 *   ?type=PREVENTIVE|CORRECTIVE|EMERGENCY
 *   ?vehicleId=<id>  (filter to one vehicle)
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { maintenanceRecords, vehicles } from "@/lib/db/schema";
import { getSessionFromRequest, getSessionTenantId } from "@/lib/auth";
import { and, desc, eq, inArray } from "drizzle-orm";
import { checkPermission, PERMISSIONS } from "@/lib/requirePermission";

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = getSessionTenantId(session)!;
  const deny = await checkPermission(session, tenantId, PERMISSIONS.MAINTENANCE_VIEW);
  if (deny) return deny;

  const url = new URL(req.url);
  const statusFilter = url.searchParams.get("status");
  const typeFilter = url.searchParams.get("type");
  const vehicleIdFilter = url.searchParams.get("vehicleId");

  // Fetch all tenant vehicles first (for identity mapping and isolation):
  const tenantVehicles = await db.query.vehicles.findMany({
    where: eq(vehicles.tenantId, tenantId),
    columns: { id: true, plateNumber: true, vehicleType: true, vehicleCode: true, status: true },
  });
  if (tenantVehicles.length === 0) return NextResponse.json([]);

  // Scope to tenant via vehicle IDs — this is the tenant-isolation mechanism:
  const vehicleIds = vehicleIdFilter
    ? tenantVehicles.filter((v) => v.id === vehicleIdFilter).map((v) => v.id)
    : tenantVehicles.map((v) => v.id);

  if (vehicleIds.length === 0) return NextResponse.json([]);

  // Build where conditions:
  const conditions = [inArray(maintenanceRecords.vehicleId, vehicleIds)];
  if (statusFilter) conditions.push(eq(maintenanceRecords.status, statusFilter.toUpperCase()));
  if (typeFilter) conditions.push(eq(maintenanceRecords.type, typeFilter.toUpperCase()));

  const rows = await db.query.maintenanceRecords.findMany({
    where: and(...conditions),
    orderBy: desc(maintenanceRecords.openedAt),
  });

  // Build vehicleMap for O(1) lookup:
  const vehicleMap = new Map(tenantVehicles.map((v) => [v.id, v]));

  // Attach vehicle identity to each record:
  const result = rows.map((r) => ({
    ...r,
    vehicle: vehicleMap.get(r.vehicleId) ?? null,
  }));

  return NextResponse.json(result);
}
