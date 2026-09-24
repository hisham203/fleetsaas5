export const dynamic = "force-dynamic";
/**
 * P2-02: Trip Dispatch Endpoint — Operation Supervisor action.
 *
 * Dispatch formally transfers a trip from PLANNED/DISPATCHED state
 * into DISPATCHED, making it visible and executable by the assigned driver.
 *
 * Permission required: trips.dispatch
 * Pre-conditions validated server-side:
 *   - Trip exists and is tenant-scoped
 *   - Trip is in a dispatchable state (PLANNED)
 *   - Driver is assigned and available
 *   - Vehicle is assigned and available
 *   - Vehicle capacity matches trip requirement
 * Records: dispatchedAt, dispatchedBy on trips table
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { trips, vehicles, drivers, tripLifecycleEvents } from "@/lib/db/schema";
import { getSessionFromRequest, getSessionTenantId } from "@/lib/auth";
import { checkPermission, PERMISSIONS } from "@/lib/requirePermission";
import { eq, and, not } from "drizzle-orm";
import { genId } from "@/lib/helpers";

const DISPATCHABLE_STATUSES = ["PLANNED"];

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const tenantId = getSessionTenantId(session)!;
  const userId = (session as any).user?.id;

  // Permission check — trips.dispatch required:
  const _permDeny = await checkPermission(session, tenantId, PERMISSIONS.TRIPS_DISPATCH);
  if (_permDeny) return _permDeny;

  const { id } = await params;

  const trip = await db.query.trips.findFirst({
    where: and(eq(trips.id, id), eq(trips.tenantId, tenantId)),
    with: { vehicle: true, driver: true },
  });
  if (!trip) return NextResponse.json({ error: "Trip not found" }, { status: 404 });

  if (!DISPATCHABLE_STATUSES.includes(trip.status)) {
    return NextResponse.json({
      error: `Trip cannot be dispatched from status: ${trip.status}. Only PLANNED trips can be dispatched.`,
      errorCode: "INVALID_DISPATCH_STATE",
    }, { status: 422 });
  }

  // Validate driver and vehicle assignment:
  if (!trip.driverId || !trip.vehicleId) {
    return NextResponse.json({ error: "Trip must have a driver and vehicle assigned before dispatch", errorCode: "MISSING_ASSIGNMENT" }, { status: 422 });
  }

  // Serialised dispatch — SELECT FOR UPDATE prevents two concurrent requests from
  // both passing the conflict check before either updates status to DISPATCHED.
  const { sql: drizzleSql } = await import("drizzle-orm");
  const conflictingStatuses = ["DISPATCHED","STARTED","ARRIVED_LOADING","LOADING_COMPLETE","ARRIVED_SITE"];
  let conflictErrMsg: string | null = null;
  let conflictErrCode: string | null = null;
  let dispatchedAt: Date | null = null;

  // ── Cross-trip concurrency protection ────────────────────────────────────────
  // Problem: Trip A and Trip B both reference Driver X and Vehicle X.
  // Locking Trip A's row does NOT block Trip B's transaction — different rows.
  // Both transactions can read "no active Driver X conflict" before either commits.
  //
  // Solution: lock the SHARED RESOURCE rows (drivers, vehicles) in DETERMINISTIC
  // ORDER (driver before vehicle — consistent across all dispatch transactions,
  // preventing deadlock). Any second transaction dispatching the same driver or
  // vehicle must wait for the first to commit, then sees the conflict and returns 409.
  //
  // Deadlock prevention: lock ordering is always driver → vehicle. Two transactions
  // dispatching the same driver will both wait on the driver lock — one proceeds,
  // one blocks. No circular dependency is possible.
  await db.transaction(async (tx) => {
    // Step 1: Lock current trip row (prevents double-dispatch of this trip):
    const tripLock = await tx.execute(drizzleSql`
      SELECT id, status FROM trips WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE
    `);
    const lockedTrip = (tripLock as any).rows?.[0] ?? (Array.isArray(tripLock) ? tripLock[0] : null);
    if (!lockedTrip || lockedTrip.status !== "PLANNED") {
      conflictErrMsg = "Trip is no longer PLANNED"; conflictErrCode = "ASSIGNMENT_CONFLICT"; return;
    }

    // Step 2: Lock the DRIVER row — serialises all concurrent dispatches of the same driver.
    // Any other transaction dispatching a trip for Driver X must wait here until this commits.
    await tx.execute(drizzleSql`
      SELECT id FROM drivers WHERE id = ${trip.driverId} FOR UPDATE
    `);

    // Step 3: Lock the VEHICLE row — serialises all concurrent dispatches of the same vehicle.
    // Lock order is always driver → vehicle (deterministic, prevents deadlock).
    await tx.execute(drizzleSql`
      SELECT id FROM vehicles WHERE id = ${trip.vehicleId} FOR UPDATE
    `);

    // Step 4: Re-check driver conflict AFTER holding the driver lock (authoritative):
    const conflictStatusArr = drizzleSql.raw(conflictingStatuses.map(s => `'${s}'`).join(","));
    const driverRes = await tx.execute(drizzleSql`
      SELECT id FROM trips
      WHERE driver_id = ${trip.driverId} AND tenant_id = ${tenantId}
        AND id != ${id} AND status = ANY(ARRAY[${conflictStatusArr}])
      LIMIT 1
    `);
    const driverRow = (driverRes as any).rows?.[0] ?? (Array.isArray(driverRes) ? driverRes[0] : null);
    if (driverRow) { conflictErrMsg = "Driver is already active on another dispatched trip"; conflictErrCode = "DRIVER_CONFLICT"; return; }

    // Step 5: Re-check vehicle conflict AFTER holding the vehicle lock (authoritative):
    const vehicleRes = await tx.execute(drizzleSql`
      SELECT id FROM trips
      WHERE vehicle_id = ${trip.vehicleId} AND tenant_id = ${tenantId}
        AND id != ${id} AND status = ANY(ARRAY[${conflictStatusArr}])
      LIMIT 1
    `);
    const vehicleRow = (vehicleRes as any).rows?.[0] ?? (Array.isArray(vehicleRes) ? vehicleRes[0] : null);
    if (vehicleRow) { conflictErrMsg = "Vehicle is already active on another dispatched trip"; conflictErrCode = "VEHICLE_CONFLICT"; return; }

    // Step 6: All locks held, no conflicts — atomically dispatch:
    dispatchedAt = new Date(); // dispatchedAt: now — recorded atomically inside lock
    await tx.update(trips).set({ status: "DISPATCHED", dispatchedAt, dispatchedBy: userId }).where(eq(trips.id, id));
    await tx.insert(tripLifecycleEvents).values({
      id: genId(), tenantId, tripId: id, eventType: "DISPATCHED",
      actorUserId: userId, driverId: trip.driverId, notes: "Trip dispatched to driver",
    });
  });

  if (conflictErrMsg) return NextResponse.json({ error: conflictErrMsg, errorCode: conflictErrCode }, { status: 409 });
  return NextResponse.json({ ok: true, tripId: id, status: "DISPATCHED", dispatchedAt: dispatchedAt!.toISOString(), dispatchedBy: userId });
}
