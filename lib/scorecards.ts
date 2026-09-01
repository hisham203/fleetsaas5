import { db } from "./db/client";
import { drivers, trips, vehicles, fuelLogs, maintenanceRecords, scorecardConfigs } from "./db/schema";
import { eq } from "drizzle-orm";
import { computeSlaStatus } from "./sla";

// BR-17: Driver & Vehicle Performance Scorecards.
//
// Driver score is a 0–100 composite with per-tenant configurable weights
// (BR-17 explicitly calls for adjustable weights, so unlike most of this
// codebase, these aren't hardcoded — see scorecardConfigs in the schema and
// getScorecardWeights below):
//   on-time delivery rate (BR-20 SLA MET vs MISSED)
//   delivery success rate (delivered vs failed)
//   trip volume, capped at a configurable number of trips for full marks
// Weights don't need to sum to 100 — computeDriverScore normalizes
// whatever's configured. A driver with no resolved orders yet gets a
// neutral 0.5 for the on-time/delivery components rather than 0, so a
// brand-new driver isn't unfairly tanked.
//
// Vehicles don't get a single composite score — "higher is better" doesn't
// make sense for cost metrics, and forcing an arbitrary weighting would
// hide more than it reveals. Instead they're ranked by cost per completed
// trip (fuel + maintenance), ascending — lower cost per trip is better.

export type ScorecardWeights = {
  onTimeWeight: number;
  deliverySuccessWeight: number;
  tripVolumeWeight: number;
  tripVolumeCap: number;
};

export const DEFAULT_SCORECARD_WEIGHTS: ScorecardWeights = {
  onTimeWeight: 50,
  deliverySuccessWeight: 30,
  tripVolumeWeight: 20,
  tripVolumeCap: 20,
};

export async function getScorecardWeights(tenantId: string): Promise<ScorecardWeights> {
  const config = await db.query.scorecardConfigs.findFirst({ where: eq(scorecardConfigs.tenantId, tenantId) });
  if (!config) return DEFAULT_SCORECARD_WEIGHTS;
  return {
    onTimeWeight: config.onTimeWeight,
    deliverySuccessWeight: config.deliverySuccessWeight,
    tripVolumeWeight: config.tripVolumeWeight,
    tripVolumeCap: config.tripVolumeCap,
  };
}

// Pure function, deliberately separated from the DB-fetching code above so
// it can be unit-tested directly with hand-picked inputs (see
// tests/unit/scorecards.test.ts) without needing a database at all.
// Normalizes to 0–100 regardless of whether the weights sum to 100, so
// "5/3/2" and "50/30/20" produce identical results.
export function computeDriverScore(
  components: { onTimeRate: number | null; deliverySuccessRate: number | null; tripsCompleted: number },
  weights: ScorecardWeights
): number {
  const totalWeight = weights.onTimeWeight + weights.deliverySuccessWeight + weights.tripVolumeWeight;
  if (totalWeight <= 0) return 0;

  const onTimeComponent = (components.onTimeRate ?? 0.5) * weights.onTimeWeight;
  const deliveryComponent = (components.deliverySuccessRate ?? 0.5) * weights.deliverySuccessWeight;
  const cap = Math.max(weights.tripVolumeCap, 1);
  const volumeComponent = Math.min(components.tripsCompleted / cap, 1) * weights.tripVolumeWeight;

  return Math.round(((onTimeComponent + deliveryComponent + volumeComponent) / totalWeight) * 100);
}

export type DriverScorecard = {
  driverId: string;
  driverName: string;
  tripsCompleted: number;
  ordersDelivered: number;
  ordersFailed: number;
  onTimeRate: number | null;
  revenueCollectedSar: number;
  avgTripDurationMinutes: number | null;
  score: number;
};

export async function computeDriverScorecards(tenantId: string): Promise<DriverScorecard[]> {
  const weights = await getScorecardWeights(tenantId);

  const allDrivers = await db.query.drivers.findMany({
    where: eq(drivers.tenantId, tenantId),
    with: { user: true },
  });

  const allTrips = await db.query.trips.findMany({
    where: eq(trips.tenantId, tenantId),
    with: { stops: { with: { order: { with: { invoice: true } } } } },
  });

  const tripsByDriver = new Map<string, typeof allTrips>();
  for (const t of allTrips) {
    const list = tripsByDriver.get(t.driverId) ?? [];
    list.push(t);
    tripsByDriver.set(t.driverId, list);
  }

  const scorecards = allDrivers.map((d) => {
    const driverTrips = tripsByDriver.get(d.id) ?? [];
    const tripsCompleted = driverTrips.filter((t) => t.status === "COMPLETED").length;

    let ordersDelivered = 0;
    let ordersFailed = 0;
    let met = 0;
    let resolved = 0;
    let revenueCollectedSar = 0;

    for (const t of driverTrips) {
      for (const s of t.stops) {
        if (s.status === "DELIVERED" || s.status === "PARTIALLY_DELIVERED") {
          ordersDelivered++;
          if (s.order.invoice) revenueCollectedSar += s.order.invoice.total;
        }
        if (s.status === "FAILED") ordersFailed++;

        const terminal = ["DELIVERED", "PARTIALLY_DELIVERED", "FAILED", "CANCELLED"];
        if (terminal.includes(s.order.status)) {
          const sla = computeSlaStatus({
            createdAt: s.order.createdAt,
            slaMinutes: s.order.slaMinutes,
            status: s.order.status,
            completedAt: s.order.completedAt,
          });
          if (sla.slaStatus === "MET" || sla.slaStatus === "MISSED") {
            resolved++;
            if (sla.slaStatus === "MET") met++;
          }
        }
      }
    }

    const completedWithDuration = driverTrips.filter((t) => t.status === "COMPLETED" && t.startedAt && t.completedAt);
    const avgTripDurationMinutes =
      completedWithDuration.length > 0
        ? completedWithDuration.reduce(
            (sum, t) => sum + (new Date(t.completedAt!).getTime() - new Date(t.startedAt!).getTime()) / 60_000,
            0
          ) / completedWithDuration.length
        : null;

    const onTimeRate = resolved > 0 ? met / resolved : null;
    const totalResolvedDeliveries = ordersDelivered + ordersFailed;
    const deliverySuccessRate = totalResolvedDeliveries > 0 ? ordersDelivered / totalResolvedDeliveries : null;

    const score = computeDriverScore({ onTimeRate, deliverySuccessRate, tripsCompleted }, weights);

    return {
      driverId: d.id,
      driverName: d.user.name,
      tripsCompleted,
      ordersDelivered,
      ordersFailed,
      onTimeRate,
      revenueCollectedSar: Math.round(revenueCollectedSar * 100) / 100,
      avgTripDurationMinutes: avgTripDurationMinutes != null ? Math.round(avgTripDurationMinutes) : null,
      score,
    };
  });

  return scorecards.sort((a, b) => b.score - a.score);
}

export type VehicleScorecard = {
  vehicleId: string;
  plateNumber: string;
  tripsCompleted: number;
  totalFuelCostSar: number;
  totalFuelLiters: number;
  totalMaintenanceCostSar: number;
  maintenanceCount: number;
  avgCostPerTripSar: number | null;
};

export async function computeVehicleScorecards(tenantId: string): Promise<VehicleScorecard[]> {
  const allVehicles = await db.query.vehicles.findMany({ where: eq(vehicles.tenantId, tenantId) });
  const allTrips = await db.query.trips.findMany({ where: eq(trips.tenantId, tenantId) });
  const allFuel = await db.query.fuelLogs.findMany({ where: eq(fuelLogs.tenantId, tenantId) });
  const allMaintenance = await db.query.maintenanceRecords.findMany({ where: eq(maintenanceRecords.tenantId, tenantId) });

  const scorecards = allVehicles.map((v) => {
    const tripsCompleted = allTrips.filter((t) => t.vehicleId === v.id && t.status === "COMPLETED").length;
    const fuelForVehicle = allFuel.filter((f) => f.vehicleId === v.id);
    const maintenanceForVehicle = allMaintenance.filter((m) => m.vehicleId === v.id);

    const totalFuelCostSar = fuelForVehicle.reduce((sum, f) => sum + f.costSar, 0);
    const totalFuelLiters = fuelForVehicle.reduce((sum, f) => sum + f.litersFilled, 0);
    const totalMaintenanceCostSar = maintenanceForVehicle.reduce((sum, m) => sum + (m.cost ?? 0), 0);

    const totalCost = totalFuelCostSar + totalMaintenanceCostSar;
    const avgCostPerTripSar = tripsCompleted > 0 ? Math.round((totalCost / tripsCompleted) * 100) / 100 : null;

    return {
      vehicleId: v.id,
      plateNumber: v.plateNumber,
      tripsCompleted,
      totalFuelCostSar: Math.round(totalFuelCostSar * 100) / 100,
      totalFuelLiters: Math.round(totalFuelLiters * 100) / 100,
      totalMaintenanceCostSar: Math.round(totalMaintenanceCostSar * 100) / 100,
      maintenanceCount: maintenanceForVehicle.length,
      avgCostPerTripSar,
    };
  });

  // Vehicles with no completed trips yet (nothing to rank on cost
  // efficiency) sort to the bottom rather than tying for first at "$0/trip".
  return scorecards.sort((a, b) => {
    if (a.avgCostPerTripSar == null && b.avgCostPerTripSar == null) return 0;
    if (a.avgCostPerTripSar == null) return 1;
    if (b.avgCostPerTripSar == null) return -1;
    return a.avgCostPerTripSar - b.avgCostPerTripSar;
  });
}
