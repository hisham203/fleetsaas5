import { db } from "./db/client";
import { orders, trips, invoices, fuelLogs, maintenanceRecords, vehicles } from "./db/schema";
import { eq } from "drizzle-orm";
import { computeSlaStatus } from "./sla";
import { computeDriverScorecards, computeVehicleScorecards } from "./scorecards";

// APP-07: Executive Dashboard — a single aggregated view for leadership
// (CEO/COO/CFO/Operations Director/Fleet Director in the BRD's language;
// this app's closest role is ADMIN, so that's what gates this — see the
// API route). Management doesn't want to see every order, it wants
// decision-grade numbers: trip volume, SLA compliance, cost per delivery,
// cost per km, revenue per vehicle, fleet utilization, fuel/maintenance
// spend, driver ranking, failed deliveries.
//
// One honest simplification: the BRD explicitly asks for "Cost per KM",
// but nothing in this system tracks actual distance driven (no odometer
// delta per trip, no turn-by-turn route logging). Rather than fabricate
// that number, it's computed as a genuine straight-line (haversine)
// distance estimate — warehouse → each stop in sequence → back to
// warehouse — using coordinates this system already has for real. It's
// clearly labeled "estimated" everywhere it's surfaced, not passed off as
// GPS-tracked mileage.

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371; // Earth's radius in km
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type Period = { from?: Date; to?: Date };

function inPeriod(date: Date | string | null | undefined, period: Period): boolean {
  if (!date) return false;
  const d = new Date(date);
  if (period.from && d < period.from) return false;
  if (period.to && d > period.to) return false;
  return true;
}

export type ExecutiveKpis = {
  totalTrips: number;
  completedTrips: number;
  ordersTotal: number;
  deliveredOrders: number;
  failedOrders: number;
  slaComplianceRate: number | null;
  totalRevenueSar: number;
  totalFuelCostSar: number;
  totalFuelLiters: number;
  totalMaintenanceCostSar: number;
  estimatedDistanceKm: number;
  costPerDeliverySar: number | null;
  costPerKmSar: number | null;
  revenuePerVehicleSar: number | null;
  avgTripsPerVehicle: number | null;
  activeVehicleCount: number;
};

const NUMERIC_KPI_KEYS: (keyof ExecutiveKpis)[] = [
  "totalTrips", "completedTrips", "ordersTotal", "deliveredOrders", "failedOrders",
  "slaComplianceRate", "totalRevenueSar", "totalFuelCostSar", "totalFuelLiters",
  "totalMaintenanceCostSar", "estimatedDistanceKm", "costPerDeliverySar", "costPerKmSar",
  "revenuePerVehicleSar", "avgTripsPerVehicle", "activeVehicleCount",
];

async function computeKpisForPeriod(tenantId: string, period: Period): Promise<ExecutiveKpis> {
  const allOrders = await db.query.orders.findMany({ where: eq(orders.tenantId, tenantId) });
  const periodOrders = allOrders.filter((o) => inPeriod(o.createdAt, period));

  const allTrips = await db.query.trips.findMany({
    where: eq(trips.tenantId, tenantId),
    with: { stops: { with: { order: true } }, warehouse: true },
  });
  const periodTrips = allTrips.filter((t) => inPeriod(t.createdAt, period));
  const completedPeriodTrips = periodTrips.filter((t) => t.status === "COMPLETED");

  const allInvoices = await db.query.invoices.findMany({ where: eq(invoices.tenantId, tenantId) });
  const periodInvoices = allInvoices.filter((i) => inPeriod(i.createdAt, period));

  const allFuel = await db.query.fuelLogs.findMany({ where: eq(fuelLogs.tenantId, tenantId) });
  const periodFuel = allFuel.filter((f) => inPeriod(f.filledAt, period));

  const allMaintenance = await db.query.maintenanceRecords.findMany({ where: eq(maintenanceRecords.tenantId, tenantId) });
  const periodMaintenance = allMaintenance.filter((m) => inPeriod(m.openedAt, period));

  const allVehicles = await db.query.vehicles.findMany({ where: eq(vehicles.tenantId, tenantId) });

  const deliveredOrders = periodOrders.filter((o) => o.status === "DELIVERED" || o.status === "PARTIALLY_DELIVERED").length;
  const failedOrders = periodOrders.filter((o) => o.status === "FAILED").length;

  let met = 0;
  let resolved = 0;
  const terminal = ["DELIVERED", "PARTIALLY_DELIVERED", "FAILED", "CANCELLED"];
  for (const o of periodOrders) {
    if (!terminal.includes(o.status)) continue;
    const sla = computeSlaStatus({ createdAt: o.createdAt, slaMinutes: o.slaMinutes, status: o.status, completedAt: o.completedAt });
    if (sla.slaStatus === "MET" || sla.slaStatus === "MISSED") {
      resolved++;
      if (sla.slaStatus === "MET") met++;
    }
  }
  const slaComplianceRate = resolved > 0 ? met / resolved : null;

  const totalRevenueSar = periodInvoices.reduce((s, i) => s + i.total, 0);
  const totalFuelCostSar = periodFuel.reduce((s, f) => s + f.costSar, 0);
  const totalFuelLiters = periodFuel.reduce((s, f) => s + f.litersFilled, 0);
  const totalMaintenanceCostSar = periodMaintenance.reduce((s, m) => s + (m.cost ?? 0), 0);

  let estimatedDistanceKm = 0;
  for (const t of completedPeriodTrips) {
    if (!t.warehouse) continue;
    const coords = t.stops
      .filter((s) => s.order?.lat != null && s.order?.lng != null)
      .sort((a, b) => a.sequence - b.sequence)
      .map((s) => ({ lat: s.order!.lat!, lng: s.order!.lng! }));
    if (coords.length === 0) continue;

    let dist = 0;
    let prev = { lat: t.warehouse.lat, lng: t.warehouse.lng };
    for (const c of coords) {
      dist += haversineKm(prev.lat, prev.lng, c.lat, c.lng);
      prev = c;
    }
    dist += haversineKm(prev.lat, prev.lng, t.warehouse.lat, t.warehouse.lng); // round trip back to depot
    estimatedDistanceKm += dist;
  }

  const totalCosts = totalFuelCostSar + totalMaintenanceCostSar;
  const costPerDeliverySar = deliveredOrders > 0 ? totalCosts / deliveredOrders : null;
  const costPerKmSar = estimatedDistanceKm > 0 ? totalCosts / estimatedDistanceKm : null;
  const revenuePerVehicleSar = allVehicles.length > 0 ? totalRevenueSar / allVehicles.length : null;
  const avgTripsPerVehicle = allVehicles.length > 0 ? completedPeriodTrips.length / allVehicles.length : null;

  return {
    totalTrips: periodTrips.length,
    completedTrips: completedPeriodTrips.length,
    ordersTotal: periodOrders.length,
    deliveredOrders,
    failedOrders,
    slaComplianceRate: slaComplianceRate != null ? round2(slaComplianceRate) : null,
    totalRevenueSar: round2(totalRevenueSar),
    totalFuelCostSar: round2(totalFuelCostSar),
    totalFuelLiters: round2(totalFuelLiters),
    totalMaintenanceCostSar: round2(totalMaintenanceCostSar),
    estimatedDistanceKm: round2(estimatedDistanceKm),
    costPerDeliverySar: costPerDeliverySar != null ? round2(costPerDeliverySar) : null,
    costPerKmSar: costPerKmSar != null ? round2(costPerKmSar) : null,
    revenuePerVehicleSar: revenuePerVehicleSar != null ? round2(revenuePerVehicleSar) : null,
    avgTripsPerVehicle: avgTripsPerVehicle != null ? round2(avgTripsPerVehicle) : null,
    activeVehicleCount: allVehicles.filter((v) => v.status !== "OUT_OF_SERVICE").length,
  };
}

// Pure function — separated from the DB-fetching code above so the
// percent-change math can be unit-tested directly with hand-picked inputs.
export function computeChangePercent(current: ExecutiveKpis, previous: ExecutiveKpis): Record<string, number | null> {
  const changePercent: Record<string, number | null> = {};
  for (const key of NUMERIC_KPI_KEYS) {
    const curVal = current[key];
    const prevVal = previous[key];
    if (typeof curVal === "number" && typeof prevVal === "number" && prevVal !== 0) {
      changePercent[key] = Math.round(((curVal - prevVal) / Math.abs(prevVal)) * 10000) / 100;
    } else {
      changePercent[key] = null;
    }
  }
  return changePercent;
}

export type ExecutiveDashboard = {
  period: { from: string | null; to: string | null };
  kpis: ExecutiveKpis;
  comparison: { previous: ExecutiveKpis; changePercent: Record<string, number | null> } | null;
  topDrivers: Awaited<ReturnType<typeof computeDriverScorecards>>;
  vehicleRanking: Awaited<ReturnType<typeof computeVehicleScorecards>>;
};

// BR-21's "Trend Analysis" / "Comparative Analysis" features: when both
// `from` and `to` are given, this also computes the immediately-preceding
// period of equal length and returns the percent change for every numeric
// KPI — real comparative analysis, not just a single snapshot.
export async function getExecutiveDashboard(tenantId: string, from?: string, to?: string): Promise<ExecutiveDashboard> {
  const period: Period = {
    from: from ? new Date(from) : undefined,
    to: to ? new Date(to) : undefined,
  };
  const current = await computeKpisForPeriod(tenantId, period);

  let comparison: ExecutiveDashboard["comparison"] = null;
  if (period.from && period.to) {
    const durationMs = period.to.getTime() - period.from.getTime();
    const previousPeriod: Period = {
      from: new Date(period.from.getTime() - durationMs),
      to: new Date(period.from.getTime()),
    };
    const previous = await computeKpisForPeriod(tenantId, previousPeriod);
    comparison = { previous, changePercent: computeChangePercent(current, previous) };
  }

  const [topDrivers, vehicleRanking] = await Promise.all([
    computeDriverScorecards(tenantId),
    computeVehicleScorecards(tenantId),
  ]);

  return {
    period: { from: period.from?.toISOString() ?? null, to: period.to?.toISOString() ?? null },
    kpis: current,
    comparison,
    topDrivers: topDrivers.slice(0, 5),
    vehicleRanking: vehicleRanking.slice(0, 5),
  };
}
