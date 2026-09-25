/**
 * P2-02: Vehicle & Driver Eligibility Engine
 *
 * Centralized eligibility logic for resource assignment AND dispatch.
 * Used by the Assignment Workspace (list candidates), the assign route
 * (server re-validation) and the dispatch route (final re-validation).
 *
 * CRITICAL: Preserves Phase 1 strict tanker-capacity rules.
 * Required capacity must EXACTLY match vehicle capacity — not >=.
 * Example: required 21,000 L → 21,000 L eligible, 18,000 L NOT, 28,000 L NOT.
 *
 * Every candidate is returned (never silently dropped) with:
 *   availability: AVAILABLE  — can be assigned now
 *                 BUSY       — tied up on another active trip
 *                 INELIGIBLE — can never serve this trip in its current state
 *                              (capacity mismatch, maintenance, off duty…)
 *   reason:       the concrete operational reason, always populated.
 */

import { db } from "@/lib/db/client";
import { trips, vehicles, drivers } from "@/lib/db/schema";
import { eq, and, notInArray } from "drizzle-orm";
import { ACTIVE_TRIP_STATUSES, TERMINAL_TRIP_STATUSES } from "@/lib/tripDto";

export type Availability = "AVAILABLE" | "BUSY" | "INELIGIBLE";

export type EligibilityResult<T> = {
  candidate: T;
  eligible: boolean;
  availability: Availability;
  reason: string;
};

export type VehicleCandidate = {
  id: string;
  plateNumber: string;
  vehicleCode: string | null;
  capacityLiters: number | null;
  status: string;
};

export type DriverCandidate = {
  id: string;
  userId: string;
  name: string | null;
  driverCode: string | null;
  status: string;
};

export type EligibilityOptions = {
  /** The trip being assigned/dispatched — its own current assignment is never a conflict. */
  excludeTripId?: string;
};

/** Vehicle statuses from which a vehicle may be assigned. IN_TRIP is only acceptable when the trip holding it is excludeTripId. */
const VEHICLE_ASSIGNABLE_STATUSES = ["AVAILABLE", "IN_TRIP"];
/** Driver statuses from which a driver may be assigned. ACTIVE is accepted as a legacy alias of AVAILABLE. */
const DRIVER_READY_STATUSES = ["AVAILABLE", "ACTIVE"];

type TripRef = { id: string; tripNumber: string; status: string; vehicleId: string | null; driverId: string | null };

async function openTrips(tenantId: string): Promise<TripRef[]> {
  return db.query.trips.findMany({
    where: and(eq(trips.tenantId, tenantId), notInArray(trips.status, [...TERMINAL_TRIP_STATUSES])),
    columns: { id: true, tripNumber: true, status: true, vehicleId: true, driverId: true },
  });
}

/**
 * Returns all vehicles in the tenant with their eligibility for a trip.
 * Eligibility criteria:
 * 1. Same tenant
 * 2. Vehicle status allows assignment (not MAINTENANCE / OUT_OF_SERVICE …)
 * 3. Vehicle capacity EXACTLY matches required capacity (strict Phase 1 rule).
 *    requiredCapacityLiters = null means the order carries no capacity
 *    constraint (legacy non-contract / wildcard orders) — unchanged Phase 1 behaviour.
 * 4. Not assigned to another open (non-terminal) trip
 */
export async function getVehicleEligibility(
  tenantId: string,
  requiredCapacityLiters: number | null,
  opts: EligibilityOptions = {}
): Promise<EligibilityResult<VehicleCandidate>[]> {
  const allVehicles = await db.query.vehicles.findMany({
    where: eq(vehicles.tenantId, tenantId),
    columns: { id: true, plateNumber: true, vehicleCode: true, capacityLiters: true, status: true },
  });
  const allOpen = await openTrips(tenantId);
  const current = allOpen.find((t) => t.id === opts.excludeTripId) ?? null;
  const open = allOpen.filter((t) => t.id !== opts.excludeTripId);

  return allVehicles.map((v): EligibilityResult<VehicleCandidate> => {
    const candidate: VehicleCandidate = { ...v, vehicleCode: v.vehicleCode ?? null };
    // Maintenance / out-of-service eligibility:
    if (!VEHICLE_ASSIGNABLE_STATUSES.includes(v.status)) {
      return { candidate, eligible: false, availability: "INELIGIBLE", reason: `Vehicle status is ${v.status}` };
    }
    // STRICT CAPACITY CHECK — Phase 1 rule preserved:
    if (requiredCapacityLiters != null && v.capacityLiters !== requiredCapacityLiters) {
      return {
        candidate, eligible: false, availability: "INELIGIBLE",
        reason: `Capacity mismatch: tanker ${v.capacityLiters?.toLocaleString() ?? "unknown"} L, required ${requiredCapacityLiters.toLocaleString()} L (exact match required)`,
      };
    }
    const other = open.find((t) => t.vehicleId === v.id);
    if (other) {
      return { candidate, eligible: false, availability: "BUSY", reason: `Assigned to trip ${other.tripNumber} (${other.status})` };
    }
    if (v.status === "IN_TRIP" && current?.vehicleId !== v.id) {
      // IN_TRIP is only legitimate while held by the trip being assigned/dispatched.
      return { candidate, eligible: false, availability: "BUSY", reason: "Vehicle is marked IN_TRIP" };
    }
    return {
      candidate, eligible: true, availability: "AVAILABLE",
      reason: requiredCapacityLiters != null ? "Available · exact capacity match" : "Available · order has no capacity constraint",
    };
  });
}

/**
 * Returns all drivers in the tenant with their eligibility for a trip.
 * Eligibility criteria:
 * 1. Same tenant
 * 2. Driver status is AVAILABLE (ACTIVE accepted as legacy alias). OFF_DUTY etc. are INELIGIBLE.
 * 3. Not currently on another dispatched / in-progress trip (BUSY).
 *    A driver may be pre-assigned to other PLANNED trips — the dispatch
 *    route's locked conflict check prevents two concurrently active trips.
 */
export async function getDriverEligibility(
  tenantId: string,
  opts: EligibilityOptions = {}
): Promise<EligibilityResult<DriverCandidate>[]> {
  const allDrivers = await db.query.drivers.findMany({
    where: eq(drivers.tenantId, tenantId),
    columns: { id: true, userId: true, status: true, driverCode: true },
    with: { user: { columns: { name: true } } },
  });
  const allOpen = await openTrips(tenantId);
  const current = allOpen.find((t) => t.id === opts.excludeTripId) ?? null;
  const open = allOpen.filter((t) => t.id !== opts.excludeTripId);
  const active = open.filter((t) => (ACTIVE_TRIP_STATUSES as readonly string[]).includes(t.status));

  return allDrivers.map((d): EligibilityResult<DriverCandidate> => {
    const candidate: DriverCandidate = { id: d.id, userId: d.userId, name: d.user?.name ?? null, driverCode: d.driverCode ?? null, status: d.status };
    const onActive = active.find((t) => t.driverId === d.id);
    if (onActive) {
      return { candidate, eligible: false, availability: "BUSY", reason: `On active trip ${onActive.tripNumber} (${onActive.status})` };
    }
    if (d.status === "ON_TRIP") {
      // ON_TRIP with no other active trip: only legitimate when the trip being handled holds this driver.
      const holdsThisTrip = current?.driverId === d.id;
      if (!holdsThisTrip) return { candidate, eligible: false, availability: "BUSY", reason: "Driver is marked ON_TRIP" };
      return { candidate, eligible: true, availability: "AVAILABLE", reason: "Available" };
    }
    if (!DRIVER_READY_STATUSES.includes(d.status)) {
      return { candidate, eligible: false, availability: "INELIGIBLE", reason: `Driver status is ${d.status}` };
    }
    const planned = open.filter((t) => t.driverId === d.id && t.status === "PLANNED").length;
    return {
      candidate, eligible: true, availability: "AVAILABLE",
      reason: planned > 0 ? `Available · pre-assigned to ${planned} other planned trip(s)` : "Available",
    };
  });
}

/**
 * Recommend the best vehicle and driver for a trip.
 * Ranking: eligible → fewest open trips → stable order.
 */
export async function recommendAssignment(tenantId: string, requiredCapacityLiters: number | null, opts: EligibilityOptions = {}) {
  const [vehicleResults, driverResults, open] = await Promise.all([
    getVehicleEligibility(tenantId, requiredCapacityLiters, opts),
    getDriverEligibility(tenantId, opts),
    openTrips(tenantId),
  ]);

  const eligibleVehicles = vehicleResults.filter(r => r.eligible);
  const eligibleDrivers  = driverResults.filter(r => r.eligible);

  const vehicleTripCount: Record<string, number> = {};
  const driverTripCount: Record<string, number> = {};
  for (const t of open) {
    if (t.vehicleId) vehicleTripCount[t.vehicleId] = (vehicleTripCount[t.vehicleId] ?? 0) + 1;
    if (t.driverId) driverTripCount[t.driverId] = (driverTripCount[t.driverId] ?? 0) + 1;
  }

  const recommendedVehicle = [...eligibleVehicles].sort((a, b) =>
    (vehicleTripCount[a.candidate.id] ?? 0) - (vehicleTripCount[b.candidate.id] ?? 0)
  )[0] ?? null;

  const recommendedDriver = [...eligibleDrivers].sort((a, b) =>
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

/** Required tanker capacity of a trip, derived from its orders (trip → stops → order). */
export async function getTripCapacityRequirement(tripId: string): Promise<{ required: number | null; mixed: boolean }> {
  const stops = await db.query.tripStops.findMany({
    where: (ts, { eq: eq2 }) => eq2(ts.tripId, tripId),
    with: { order: { columns: { requiredTankerCapacityLtr: true } } },
  });
  const caps = [...new Set(stops.map((s) => s.order?.requiredTankerCapacityLtr).filter((c): c is number => c != null))];
  return { required: caps.length === 1 ? caps[0] : null, mixed: caps.length > 1 };
}
