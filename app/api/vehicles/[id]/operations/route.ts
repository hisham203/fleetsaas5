export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { vehicles, trips, expenseClaims, maintenanceRecords, warehouses, drivers } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { SAFE_USER_COLUMNS, SAFE_CUSTOMER_COLUMNS } from "@/lib/contractHelpers";
import { eq, and, desc } from "drizzle-orm";

// Milestone X, Part 7 — Fleet Operations Hub read API. Aggregates
// everything a vehicle detail view needs from tables that already exist
// (trips, expenseClaims, maintenanceRecords) — no new table, no schema
// change. Same permission gate as the Fleet screen itself
// (ADMIN/DISPATCHER, matching FleetTab's own existing access). Every
// list here is empty-safe: a vehicle with no trips/expenses/maintenance
// yet returns empty arrays, never an error or fake placeholder data.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: vehicleId } = await params;
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN", "DISPATCHER"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;

  const vehicle = await db.query.vehicles.findFirst({ where: and(eq(vehicles.id, vehicleId), eq(vehicles.tenantId, tenantId)) });
  if (!vehicle) return NextResponse.json({ error: "Vehicle not found" }, { status: 404 });

  const homeWarehouse = vehicle.homeWarehouseId
    ? await db.query.warehouses.findFirst({ where: eq(warehouses.id, vehicle.homeWarehouseId) })
    : null;

  const [tripRows, expenseRows, maintenanceRows] = await Promise.all([
    db.query.trips.findMany({
      where: and(eq(trips.tenantId, tenantId), eq(trips.vehicleId, vehicleId)),
      with: {
        driver: { with: { user: { columns: SAFE_USER_COLUMNS } } },
        stops: { with: { order: { with: { customer: { columns: SAFE_CUSTOMER_COLUMNS }, location: true, contract: true } } } },
      },
      orderBy: desc(trips.createdAt),
      limit: 50, // Part 21: safe bound, matching the Control Tower's own "avoid loading entire history" precedent
    }),
    db.query.expenseClaims.findMany({
      where: and(eq(expenseClaims.tenantId, tenantId), eq(expenseClaims.vehicleId, vehicleId)),
      orderBy: desc(expenseClaims.createdAt),
    }),
    db.query.maintenanceRecords.findMany({
      where: and(eq(maintenanceRecords.tenantId, tenantId), eq(maintenanceRecords.vehicleId, vehicleId)),
      orderBy: desc(maintenanceRecords.openedAt),
    }),
  ]);

  const activeTrips = tripRows.filter((t) => t.status !== "COMPLETED");
  const completedTrips = tripRows.filter((t) => t.status === "COMPLETED");
  // A vehicle's own "failed" signal is read from its trips' own stops —
  // no new concept, reusing exactly the same FAILED stop status Dispatch
  // and Control Tower already use.
  const failedTripCount = tripRows.filter((t) => t.stops.some((s: any) => s.status === "FAILED")).length;

  return NextResponse.json({
    vehicle,
    homeWarehouse,
    activeTrips,
    recentTrips: tripRows,
    completedTripCount: completedTrips.length,
    failedTripCount,
    expenses: expenseRows,
    expenseSummary: {
      pendingCount: expenseRows.filter((e) => e.status === "PENDING").length,
      approvedCount: expenseRows.filter((e) => e.status === "APPROVED").length,
      approvedTotal: expenseRows.filter((e) => e.status === "APPROVED").reduce((sum, e) => sum + e.amount, 0),
    },
    maintenanceRecords: maintenanceRows,
  });
}
