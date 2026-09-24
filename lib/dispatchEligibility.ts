/**
 * P2-02: Vehicle & Driver Eligibility Engine
 *
 * Centralized eligibility logic for resource assignment.
 * Used by both manual assignment (supervisor selects) and
 * recommendation engine (system suggests).
 *
 * CRITICAL: Preserves Phase 1 strict tanker-capacity rules.
 * Required capacity must EXACTLY match vehicle capacity — not >=.
 * Example: required 21,000 L → 21,000 L eligible, 18,000 L NOT, 28,000 L NOT.
 */

import { db } from "@/lib/db/client";
import { trips, vehicles, drivers } from "@/lib/db/schema";
import { eq, and, not, ne } from "drizzle-orm";

export type EligibilityResult<T> = {
  candidate: T;
  eligible: boolean;
  reason: string;
};

export type VehicleCandidate = {
  id: string;
  plateNumber: string;
  capacityLiters: number | null;
  status: string;
};

export type DriverCandidate = {
  id: string;
  userId: string;
  name: string | null;
  status: string;
};

/**
 * Returns all vehicles in the tenant with their eligibility for a trip.
 * Eligibility criteria:
 * 1. Same tenant
 * 2. Vehicle is AVAILABLE (status)
 * 3. Vehicle capacity EXACTLY matches required capacity (strict Phase 1 rule)
 * 4. Not already assigned to another ACTIVE (non-completed) trip
 */
export async function getVehicleEligibility(
  tenantId: string,
  requiredCapacityLiters: number
): Promise<EligibilityResult<VehicleCandidate>[]> {
  const allVehicles = await db.query.vehicles.findMany({
    where: eq(vehicles.tenantId, tenantId),
    columns: { id: true, plateNumber: true, capacityLiters: true, status: true },
  });

  // Find vehicles assigned to active trips:
  const activeTrips = await db.query.trips.findMany({
    where: and(eq(trips.tenantId, tenantId), not(eq(trips.status, "COMPLETED"))),
    columns: { vehicleId: true },
  });
  const busyVehicleIds = new Set(activeTrips.map(t => t.vehicleId));

  return allVehicles.map(v => {
    if (v.status !== "AVAILABLE") {
      return { candidate: v, eligible: false, reason: `Vehicle status is ${v.status}` };
    }
    // STRICT CAPACITY CHECK — Phase 1 rule preserved:
    if (v.capacityLiters !== requiredCapacityLiters) {
      return { candidate: v, eligible: false,
        reason: `Capacity mismatch: vehicle ${v.capacityLiters?.toLocaleString() ?? "unknown"} L, required ${requiredCapacityLiters.toLocaleString()} L (exact match required)` };
    }
    if (busyVehicleIds.has(v.id)) {
      return { candidate: v, eligible: false, reason: "Already assigned to an active trip" };
    }
    return { candidate: v, eligible: true, reason: "Available and capacity matches" };
  });
}

/**
 * Returns all drivers in the tenant with their eligibility for a trip.
 * Eligibility criteria:
 * 1. Same tenant
 * 2. Driver is ACTIVE
 * 3. Not currently assigned to a DISPATCHED or STARTED trip
 */
export async function getDriverEligibility(
  tenantId: string
): Promise<EligibilityResult<DriverCandidate>[]> {
  const allDrivers = await db.query.drivers.findMany({
    where: eq(drivers.tenantId, tenantId),
    columns: { id: true, userId: true, status: true },
    with: { user: { columns: { name: true } } },
  });

  // Drivers on active (dispatched/started) trips:
  const activeTrips = await db.query.trips.findMany({
    where: and(eq(trips.tenantId, tenantId), not(eq(trips.status, "COMPLETED"))),
    columns: { driverId: true, status: true },
  });

  // Busy = currently dispatched or started (not just planned):
  const busyDriverIds = new Set(
    activeTrips
      .filter(t => ["DISPATCHED","STARTED","ARRIVED_LOADING","LOADING_COMPLETE","ARRIVED_SITE"].includes(t.status))
      .map(t => t.driverId)
  );

  return allDrivers.map(d => {
    if (d.status !== "ACTIVE") {
      return { candidate: { id: d.id, userId: d.userId, name: d.user?.name ?? null, status: d.status },
        eligible: false, reason: `Driver status is ${d.status}` };
    }
    if (busyDriverIds.has(d.id)) {
      return { candidate: { id: d.id, userId: d.userId, name: d.user?.name ?? null, status: d.status },
        eligible: false, reason: "Driver is currently on an active trip" };
    }
    return { candidate: { id: d.id, userId: d.userId, name: d.user?.name ?? null, status: d.status },
      eligible: true, reason: "Available" };
  });
}

/**
 * Recommend the best vehicle and driver for a trip.
 * Ranking: eligible → fewest active planned trips → FIFO (earliest created).
 * Returns top candidate and full eligibility list.
 */
export async function recommendAssignment(tenantId: string, requiredCapacityLiters: number) {
  const [vehicleResults, driverResults] = await Promise.all([
    getVehicleEligibility(tenantId, requiredCapacityLiters),
    getDriverEligibility(tenantId),
  ]);

  const eligibleVehicles = vehicleResults.filter(r => r.eligible);
  const eligibleDrivers  = driverResults.filter(r => r.eligible);

  // Count active planned trips per vehicle/driver for load balancing:
  const tripCounts = await db.query.trips.findMany({
    where: and(eq(trips.tenantId, tenantId), not(eq(trips.status, "COMPLETED"))),
    columns: { vehicleId: true, driverId: true },
  });

  const vehicleTripCount: Record<string, number> = {};
  const driverTripCount: Record<string, number> = {};
  for (const t of tripCounts) {
    vehicleTripCount[t.vehicleId] = (vehicleTripCount[t.vehicleId] ?? 0) + 1;
    driverTripCount[t.driverId]   = (driverTripCount[t.driverId] ?? 0) + 1;
  }

  const recommendedVehicle = eligibleVehicles.sort((a, b) =>
    (vehicleTripCount[a.candidate.id] ?? 0) - (vehicleTripCount[b.candidate.id] ?? 0)
  )[0] ?? null;

  const recommendedDriver = eligibleDrivers.sort((a, b) =>
    (driverTripCount[a.candidate.id] ?? 0) - (driverTripCount[b.candidate.id] ?? 0)
  )[0] ?? null;

  return {
    vehicles: vehicleResults,
    drivers: driverResults,
    recommendedVehicle: recommendedVehicle?.candidate ?? null,
    recommendedDriver: recommendedDriver?.candidate ?? null,
    eligibleVehicleCount: eligibleVehicles.length,
    eligibleDriverCount: eligibleDrivers.length,
  };
}
