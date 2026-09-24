export const dynamic = "force-dynamic";
/**
 * P2-02: Trip Resource Assignment — Operation Supervisor action.
 * Permission required: trips.assign
 * Validates vehicle + driver eligibility before accepting assignment.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { trips, tripStops } from "@/lib/db/schema";
import { getSessionFromRequest, getSessionTenantId } from "@/lib/auth";
import { checkPermission, PERMISSIONS } from "@/lib/requirePermission";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { getVehicleEligibility, getDriverEligibility } from "@/lib/dispatchEligibility";

const assignSchema = z.object({
  vehicleId: z.string().min(1).optional(),
  driverId:  z.string().min(1).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = getSessionTenantId(session)!;
  const _permDeny = await checkPermission(session, tenantId, PERMISSIONS.TRIPS_ASSIGN);
  if (_permDeny) return _permDeny;
  const userId = (session as any).user?.id;

  const { id } = await params;
  const body = assignSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });

  const trip = await db.query.trips.findFirst({ where: and(eq(trips.id, id), eq(trips.tenantId, tenantId)) });
  if (!trip) return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  if (!["PLANNED"].includes(trip.status)) {
    return NextResponse.json({ error: `Cannot reassign a ${trip.status} trip`, errorCode: "INVALID_STATE" }, { status: 422 });
  }

  const updates: Record<string, any> = {};

  if (body.data.vehicleId) {
    // Server-side re-validation of vehicle eligibility (availability may have changed):
    // Get required capacity from the orders linked to this trip's stops:
    const tripStops = await db.query.tripStops.findMany({ where: (ts, { eq: eq2 }) => eq2(ts.tripId, trip.id), with: { order: { columns: { requiredTankerCapacityLtr: true } } } });
    const requiredCapacity = tripStops[0]?.order?.requiredTankerCapacityLtr ?? 0;
    const vehicleResults = await getVehicleEligibility(tenantId, requiredCapacity);
    const selected = vehicleResults.find(r => r.candidate.id === body.data.vehicleId);
    if (!selected?.eligible) {
      return NextResponse.json({
        error: selected ? `Vehicle not eligible: ${selected.reason}` : "Vehicle not found in tenant",
        errorCode: "VEHICLE_INELIGIBLE",
      }, { status: 422 });
    }
    updates.vehicleId = body.data.vehicleId;
  }

  if (body.data.driverId) {
    const driverResults = await getDriverEligibility(tenantId);
    const selected = driverResults.find(r => r.candidate.id === body.data.driverId);
    if (!selected?.eligible) {
      return NextResponse.json({
        error: selected ? `Driver not eligible: ${selected.reason}` : "Driver not found in tenant",
        errorCode: "DRIVER_INELIGIBLE",
      }, { status: 422 });
    }
    updates.driverId = body.data.driverId;
  }

  if (Object.keys(updates).length === 0) return NextResponse.json({ ok: true, message: "Nothing to update" });

  // P2-02: Serialised assignment using raw SQL transaction with FOR UPDATE lock.
  // This prevents two supervisors from simultaneously assigning the same driver/vehicle.
  // The lock is acquired on the trip row — any concurrent assignment must wait.
  const { sql: drizzleSql } = await import("drizzle-orm");
  const conflictErrorCode = updates.driverId ? "DRIVER_CONFLICT" : "VEHICLE_CONFLICT";
  let conflictError: string | null = null;
  let updatedTrip: any = null;

  await db.transaction(async (tx) => {
    // 1. Lock the trip row (serialises concurrent assignments):
    const lockedResult = await tx.execute(drizzleSql`
      SELECT id, status, driver_id, vehicle_id
      FROM trips
      WHERE id = ${id} AND tenant_id = ${tenantId}
      FOR UPDATE
    `);
    const locked = (lockedResult as any).rows?.[0] ?? (Array.isArray(lockedResult) ? lockedResult[0] : null);
    if (!locked || locked.status !== "PLANNED") {
      conflictError = "Assignment conflict: trip status changed. Refresh and retry.";
      return;
    }

    // 2. Re-validate driver not in use (inside lock):
    if (updates.driverId) {
      const driverCheck = await tx.execute(drizzleSql`
        SELECT id FROM trips
        WHERE driver_id = ${updates.driverId}
          AND status IN ('DISPATCHED','STARTED','ARRIVED_LOADING','LOADING_COMPLETE','ARRIVED_SITE')
          AND tenant_id = ${tenantId}
        LIMIT 1
      `);
      const activeDriver = (driverCheck as any).rows?.[0] ?? (Array.isArray(driverCheck) ? driverCheck[0] : null);
      if (activeDriver) { conflictError = "Driver is now on another active trip"; return; }
    }

    // 3. Re-validate vehicle not in use (inside lock):
    if (updates.vehicleId) {
      const vehicleCheck = await tx.execute(drizzleSql`
        SELECT id FROM trips
        WHERE vehicle_id = ${updates.vehicleId}
          AND status IN ('DISPATCHED','STARTED','ARRIVED_LOADING','LOADING_COMPLETE','ARRIVED_SITE')
          AND tenant_id = ${tenantId}
        LIMIT 1
      `);
      const activeVehicle = (vehicleCheck as any).rows?.[0] ?? (Array.isArray(vehicleCheck) ? vehicleCheck[0] : null);
      if (activeVehicle) { conflictError = "Vehicle is now on another active trip"; return; }
    }

    // 4. Apply update atomically (inside lock, trip still PLANNED):
    await tx.update(trips).set(updates).where(and(eq(trips.id, id), eq(trips.status, "PLANNED")));
    updatedTrip = await tx.query.trips.findFirst({ where: eq(trips.id, id) });
  });

  if (conflictError) {
    return NextResponse.json({ error: conflictError, errorCode: conflictErrorCode }, { status: 409 });
  }
  return NextResponse.json({ ok: true, trip: updatedTrip });
}
