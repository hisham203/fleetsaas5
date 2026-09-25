export const dynamic = "force-dynamic";
/**
 * P2-02: Trip Resource Assignment — Operation Supervisor action.
 * Permission required: trips.assign
 *
 * Assigns a tanker and/or driver to a PLANNED trip. The trip REMAINS
 * PLANNED — assignment never dispatches (POST /api/trips/[id]/dispatch is a
 * separate, separately-permissioned action) and never changes the driver's
 * or vehicle's status (that happens at dispatch; see dispatch route).
 *
 * Server-side re-validation (never trusts the workspace list):
 *   tenant · trip status · vehicle status/maintenance · STRICT capacity
 *   equality · vehicle/driver conflicts · driver availability
 *
 * Concurrency: one transaction, row locks taken in the deterministic order
 *   trip → driver → vehicle   (SELECT … FOR UPDATE)
 * — the same order the dispatch route uses, so the two can never deadlock.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { trips } from "@/lib/db/schema";
import { getSessionFromRequest, getSessionTenantId } from "@/lib/auth";
import { checkPermission, PERMISSIONS } from "@/lib/requirePermission";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { getVehicleEligibility, getDriverEligibility, getTripCapacityRequirement } from "@/lib/dispatchEligibility";
import { getOperationalTrip, TERMINAL_TRIP_STATUSES } from "@/lib/tripDto";

const assignSchema = z.object({
  vehicleId: z.string().min(1).optional(),
  driverId:  z.string().min(1).optional(),
});

const rowOf = (r: any) => r?.rows?.[0] ?? (Array.isArray(r) ? r[0] : null);

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = getSessionTenantId(session)!;
  const _permDeny = await checkPermission(session, tenantId, PERMISSIONS.TRIPS_ASSIGN);
  if (_permDeny) return _permDeny;

  const { id } = await params;
  const body = assignSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });

  const trip = await db.query.trips.findFirst({ where: and(eq(trips.id, id), eq(trips.tenantId, tenantId)) });
  if (!trip) return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  if (!["PLANNED"].includes(trip.status)) {
    return NextResponse.json({ error: `Cannot reassign a ${trip.status} trip`, errorCode: "INVALID_STATE" }, { status: 422 });
  }

  const updates: { vehicleId?: string; driverId?: string } = {};

  if (body.data.vehicleId) {
    // Required capacity is derived trip → stop → order (never stored on the trip):
    const { required, mixed } = await getTripCapacityRequirement(trip.id);
    if (mixed) {
      return NextResponse.json({ error: "Trip orders require different tanker capacities", errorCode: "TANKER_CAPACITY_MIXED" }, { status: 422 });
    }
    const vehicleResults = await getVehicleEligibility(tenantId, required, { excludeTripId: trip.id });
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
    const driverResults = await getDriverEligibility(tenantId, { excludeTripId: trip.id });
    const selected = driverResults.find(r => r.candidate.id === body.data.driverId);
    if (!selected?.eligible) {
      return NextResponse.json({
        error: selected ? `Driver not eligible: ${selected.reason}` : "Driver not found in tenant",
        errorCode: "DRIVER_INELIGIBLE",
      }, { status: 422 });
    }
    updates.driverId = body.data.driverId;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ ok: true, message: "Nothing to update" });
  }

  const { sql: drizzleSql } = await import("drizzle-orm");
  const terminal = drizzleSql.raw(TERMINAL_TRIP_STATUSES.map(s => `'${s}'`).join(","));
  let conflict: { error: string; errorCode: string } | null = null;

  await db.transaction(async (tx) => {
    // 1. Lock the trip row (serialises concurrent assignment / dispatch of this trip):
    const locked = rowOf(await tx.execute(drizzleSql`
      SELECT id, status FROM trips WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE
    `));
    if (!locked || locked.status !== "PLANNED") {
      conflict = { error: "Assignment conflict: trip status changed. Refresh and retry.", errorCode: "ASSIGNMENT_CONFLICT" };
      return;
    }

    // 2. Lock the DRIVER row, then re-check inside the lock:
    if (updates.driverId) {
      await tx.execute(drizzleSql`SELECT id FROM drivers WHERE id = ${updates.driverId} AND tenant_id = ${tenantId} FOR UPDATE`);
      const activeDriver = rowOf(await tx.execute(drizzleSql`
        SELECT trip_number FROM trips
        WHERE driver_id = ${updates.driverId} AND tenant_id = ${tenantId} AND id != ${id}
          AND status IN ('DISPATCHED','IN_PROGRESS','STARTED','ARRIVED_LOADING','LOADING_COMPLETE','ARRIVED_SITE')
        LIMIT 1
      `));
      if (activeDriver) { conflict = { error: `Driver is now on active trip ${activeDriver.trip_number}`, errorCode: "DRIVER_CONFLICT" }; return; }
    }

    // 3. Lock the VEHICLE row, then re-check inside the lock (a tanker serves one open trip):
    if (updates.vehicleId) {
      await tx.execute(drizzleSql`SELECT id FROM vehicles WHERE id = ${updates.vehicleId} AND tenant_id = ${tenantId} FOR UPDATE`);
      const otherTrip = rowOf(await tx.execute(drizzleSql`
        SELECT trip_number FROM trips
        WHERE vehicle_id = ${updates.vehicleId} AND tenant_id = ${tenantId} AND id != ${id}
          AND status NOT IN (${terminal})
        LIMIT 1
      `));
      if (otherTrip) { conflict = { error: `Tanker is now assigned to trip ${otherTrip.trip_number}`, errorCode: "VEHICLE_CONFLICT" }; return; }
    }

    // 4. Apply atomically — trip stays PLANNED:
    await tx.update(trips).set(updates).where(and(eq(trips.id, id), eq(trips.status, "PLANNED")));
  });

  if (conflict) return NextResponse.json(conflict, { status: 409 });
  const updated = await getOperationalTrip(tenantId, id);
  return NextResponse.json({ ok: true, trip: updated });
}
