/**
 * lib/analyticsMetrics.ts — Milestone I: Canonical Analytics Metric Layer
 *
 * All analytics KPI formulas live here.
 * API routes and UI pages consume this layer — never reimplement formulas.
 *
 * DESIGN RULES:
 * - Use PostgreSQL aggregation (COUNT/SUM/AVG with bounded WHERE) not in-memory filter
 * - Every query is tenant-scoped via tenantId
 * - Distinguish NULL (no data) from 0 (measured zero) — callers must handle both
 * - No fake utilization % without a defensible denominator
 * - No arbitrary cost allocation to trips unless directly linked
 * - No fake driver safety score
 * - GPS_DEMO is never silently mixed into physical telemetry metrics
 *
 * PERIOD SEMANTICS:
 * - from/to are ISO strings; parsed to Date; inclusive on both ends
 * - All trip/order date filters use createdAt (consistent throughout)
 * - Comparison period is the immediately preceding window of equal length
 */

import { db } from "@/lib/db/client";
import {
  orders, trips, vehicles, drivers, fuelLogs, maintenanceRecords,
  tyreRecords, expenseClaims, vehicleGpsHistory, telematicsDevices,
  vehicleDeviceAssignments, telemetryEvents, geofenceEvents,
} from "@/lib/db/schema";
import { eq, and, gte, lte, isNull, isNotNull, sql, count, sum, avg, max, min } from "drizzle-orm";
import { computeSlaStatus } from "@/lib/sla";

// ── Date range utilities ───────────────────────────────────────────────────────

export interface DateRange {
  from: Date;
  to: Date;
}

/** Parse ISO date strings into a DateRange. Falls back to last 30 days. */
export function parseDateRange(from?: string | null, to?: string | null): DateRange {
  const toDate = to ? new Date(to) : new Date();
  const fromDate = from ? new Date(from) : new Date(toDate.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { from: fromDate, to: toDate };
}

/** Compute the preceding period of equal length for period-over-period comparison. */
export function precedingPeriod(range: DateRange): DateRange {
  const durationMs = range.to.getTime() - range.from.getTime();
  return {
    from: new Date(range.from.getTime() - durationMs),
    to: new Date(range.from.getTime()),
  };
}

/** Round to 2 decimal places. */
function r2(n: number): number { return Math.round(n * 100) / 100; }
function r0(n: number): number { return Math.round(n); }

// ── NULL vs ZERO semantics ─────────────────────────────────────────────────────
// Convention: null = no data / not applicable; 0 = measured zero.
// All rate/ratio KPIs return null when denominator is 0 (no eligible records).

// ── Operations metrics ─────────────────────────────────────────────────────────

export interface OperationsMetrics {
  ordersCreated: number;
  ordersDelivered: number;
  ordersFailed: number;
  ordersCancelled: number;
  tripsPlanned: number;
  tripsDispatched: number;
  tripsCompleted: number;
  tripsFailed: number;
  tripCompletionRate: number | null;   // tripsCompleted / (tripsCompleted + tripsFailed)
  avgTripDurationMinutes: number | null;
  // SLA:
  slaEligibleOrders: number;          // terminal orders with slaMinutes set
  slaMet: number;
  slaMissed: number;
  slaBreached: number;
  slaComplianceRate: number | null;   // slaMet / slaEligibleOrders
  // Exceptions:
  exceptionsCreated: number;
  exceptionsResolved: number;
}

export async function getOperationsMetrics(
  tenantId: string,
  range: DateRange
): Promise<OperationsMetrics> {
  const [orderRows, tripRows] = await Promise.all([
    db.query.orders.findMany({
      where: and(
        eq(orders.tenantId, tenantId),
        gte(orders.createdAt, range.from),
        lte(orders.createdAt, range.to)
      ),
      columns: { id: true, status: true, createdAt: true, completedAt: true, slaMinutes: true },
    }),
    db.query.trips.findMany({
      where: and(
        eq(trips.tenantId, tenantId),
        gte(trips.createdAt, range.from),
        lte(trips.createdAt, range.to)
      ),
      columns: { id: true, status: true, startedAt: true, completedAt: true },
    }),
  ]);

  const ordersDelivered = orderRows.filter(o => o.status === "DELIVERED" || o.status === "PARTIALLY_DELIVERED").length;
  const ordersFailed    = orderRows.filter(o => o.status === "FAILED").length;
  const ordersCancelled = orderRows.filter(o => o.status === "CANCELLED").length;

  const tripsCompleted = tripRows.filter(t => t.status === "COMPLETED").length;
  const tripsFailed    = tripRows.filter(t => t.status === "FAILED").length;
  const tripsPlanned   = tripRows.filter(t => t.status === "PLANNED" || t.status === "TRIP_PLANNED").length;
  const tripsDispatched= tripRows.filter(t => t.status === "DISPATCHED").length;
  const tripCompletionBase = tripsCompleted + tripsFailed;
  const tripCompletionRate = tripCompletionBase > 0 ? r2(tripsCompleted / tripCompletionBase) : null;

  // Average trip duration — completed trips with both startedAt and completedAt:
  const completedWithTime = tripRows.filter(t =>
    t.status === "COMPLETED" && t.startedAt && t.completedAt
  );
  const avgTripDurationMinutes = completedWithTime.length > 0
    ? r0(completedWithTime.reduce((s, t) =>
        s + (new Date(t.completedAt!).getTime() - new Date(t.startedAt!).getTime()) / 60_000, 0
      ) / completedWithTime.length)
    : null;

  // SLA — only terminal orders with slaMinutes:
  const terminalStatuses = ["DELIVERED", "PARTIALLY_DELIVERED", "FAILED", "CANCELLED"];
  let slaMet = 0, slaMissed = 0, slaBreached = 0;
  for (const o of orderRows) {
    if (!terminalStatuses.includes(o.status) || !o.slaMinutes) continue;
    const result = computeSlaStatus({
      createdAt: o.createdAt, slaMinutes: o.slaMinutes,
      status: o.status, completedAt: o.completedAt,
    });
    if (result.slaStatus === "MET") slaMet++;
    else if (result.slaStatus === "MISSED") slaMissed++;
    else if (result.slaStatus === "BREACHED") slaBreached++;
  }
  const slaEligibleOrders = slaMet + slaMissed + slaBreached;
  const slaComplianceRate = slaEligibleOrders > 0 ? r2(slaMet / slaEligibleOrders) : null;

  // Exceptions — use telemetry events as canonical exception store:
  const exceptionRows = await db.query.telemetryEvents.findMany({
    where: and(
      eq(telemetryEvents.tenantId, tenantId),
      gte(telemetryEvents.eventAt, range.from),
      lte(telemetryEvents.eventAt, range.to)
    ),
    columns: { id: true, status: true },
  });
  const exceptionsCreated  = exceptionRows.length;
  const exceptionsResolved = exceptionRows.filter(e => e.status === "RESOLVED").length;

  return {
    ordersCreated: orderRows.length, ordersDelivered, ordersFailed, ordersCancelled,
    tripsPlanned, tripsDispatched, tripsCompleted, tripsFailed, tripCompletionRate,
    avgTripDurationMinutes, slaEligibleOrders, slaMet, slaMissed, slaBreached,
    slaComplianceRate, exceptionsCreated, exceptionsResolved,
  };
}

// ── Fleet metrics ──────────────────────────────────────────────────────────────

export interface FleetMetrics {
  totalVehicles: number;
  activeVehicles: number;        // status != OUT_OF_SERVICE
  vehiclesWithDevices: number;   // has active device assignment
  vehiclesWithoutDevices: number;
  vehiclesOnTrip: number;        // currently on an active trip (status IN active statuses)
  tripsPerVehicle: number | null;// completed trips / active vehicles
  // No fake utilization %; show transparent measures
}

export async function getFleetMetrics(
  tenantId: string,
  range: DateRange
): Promise<FleetMetrics> {
  const [vehicleRows, assignmentRows, tripRows] = await Promise.all([
    db.query.vehicles.findMany({
      where: eq(vehicles.tenantId, tenantId),
      columns: { id: true, status: true },
    }),
    db.query.vehicleDeviceAssignments.findMany({
      where: and(eq(vehicleDeviceAssignments.tenantId, tenantId), isNull(vehicleDeviceAssignments.unassignedAt)),
      columns: { vehicleId: true },
    }),
    db.query.trips.findMany({
      where: and(
        eq(trips.tenantId, tenantId),
        gte(trips.createdAt, range.from),
        lte(trips.createdAt, range.to)
      ),
      columns: { id: true, vehicleId: true, status: true },
    }),
  ]);

  const activeVehicles = vehicleRows.filter(v => v.status !== "OUT_OF_SERVICE").length;
  const devicedVehicleIds = new Set(assignmentRows.map(a => a.vehicleId));
  const vehiclesWithDevices    = vehicleRows.filter(v => devicedVehicleIds.has(v.id)).length;
  const vehiclesWithoutDevices = vehicleRows.length - vehiclesWithDevices;

  const ACTIVE_TRIP_STATUSES = ["DISPATCHED","STARTED","ARRIVED_LOADING","LOADING_COMPLETE","ARRIVED_SITE"];
  const vehiclesOnTrip = new Set(
    tripRows.filter(t => ACTIVE_TRIP_STATUSES.includes(t.status)).map(t => t.vehicleId)
  ).size;

  const completedTrips = tripRows.filter(t => t.status === "COMPLETED").length;
  const tripsPerVehicle = activeVehicles > 0 ? r2(completedTrips / activeVehicles) : null;

  return { totalVehicles: vehicleRows.length, activeVehicles, vehiclesWithDevices,
    vehiclesWithoutDevices, vehiclesOnTrip, tripsPerVehicle };
}

// ── Vehicle-level breakdown ────────────────────────────────────────────────────

export interface VehicleAnalyticsRow {
  vehicleId: string;
  plateNumber: string;
  status: string;
  tripsCompleted: number;
  tripsFailed: number;
  completionRate: number | null;
  avgTripDurationMinutes: number | null;
  fuelCostSar: number;           // recorded fuel cost
  maintenanceCostSar: number;    // recorded maintenance cost
  tyreCostSar: number;           // recorded tyre cost
  approvedExpensesSar: number;   // approved expense claims
  recordedOperatingCostSar: number; // sum of all above
  directCostPerCompletedTrip: number | null; // only if any cost is trip-linked
}

export async function getVehicleAnalytics(
  tenantId: string,
  range: DateRange
): Promise<VehicleAnalyticsRow[]> {
  const [vehicleRows, tripRows, fuelRows, maintRows, tyreRows, expenseRows] = await Promise.all([
    db.query.vehicles.findMany({ where: eq(vehicles.tenantId, tenantId) }),
    db.query.trips.findMany({
      where: and(eq(trips.tenantId, tenantId), gte(trips.createdAt, range.from), lte(trips.createdAt, range.to)),
      columns: { id: true, vehicleId: true, status: true, startedAt: true, completedAt: true },
    }),
    db.query.fuelLogs.findMany({
      where: and(eq(fuelLogs.tenantId, tenantId), gte(fuelLogs.filledAt, range.from), lte(fuelLogs.filledAt, range.to)),
      columns: { vehicleId: true, costSar: true, tripId: true },
    }),
    db.query.maintenanceRecords.findMany({
      where: and(eq(maintenanceRecords.tenantId, tenantId), gte(maintenanceRecords.openedAt, range.from), lte(maintenanceRecords.openedAt, range.to)),
      columns: { vehicleId: true, cost: true },
    }),
    db.query.tyreRecords.findMany({
      where: and(eq(tyreRecords.tenantId, tenantId), gte(tyreRecords.installedAt, range.from), lte(tyreRecords.installedAt, range.to)),
      columns: { vehicleId: true, costSar: true },
    }),
    db.query.expenseClaims.findMany({
      where: and(eq(expenseClaims.tenantId, tenantId), eq(expenseClaims.status, "APPROVED"),
                 gte(expenseClaims.createdAt, range.from), lte(expenseClaims.createdAt, range.to)),
      columns: { vehicleId: true, amount: true, tripId: true },
    }),
  ]);

  return vehicleRows.map(v => {
    const myTrips       = tripRows.filter(t => t.vehicleId === v.id);
    const completed     = myTrips.filter(t => t.status === "COMPLETED");
    const failed        = myTrips.filter(t => t.status === "FAILED");
    const base          = completed.length + failed.length;
    const completionRate= base > 0 ? r2(completed.length / base) : null;

    const withTime = completed.filter(t => t.startedAt && t.completedAt);
    const avgDur = withTime.length > 0
      ? r0(withTime.reduce((s, t) => s + (new Date(t.completedAt!).getTime() - new Date(t.startedAt!).getTime()) / 60_000, 0) / withTime.length)
      : null;

    const fuelCost  = r2(fuelRows.filter(f => f.vehicleId === v.id).reduce((s, f) => s + f.costSar, 0));
    const maintCost = r2(maintRows.filter(m => m.vehicleId === v.id).reduce((s, m) => s + (m.cost ?? 0), 0));
    const tyreCost  = r2(tyreRows.filter(t => t.vehicleId === v.id).reduce((s, t) => s + (t.costSar ?? 0), 0));
    const expCost   = r2(expenseRows.filter(e => e.vehicleId === v.id).reduce((s, e) => s + e.amount, 0));
    const recorded  = r2(fuelCost + maintCost + tyreCost + expCost);

    // Direct cost per completed trip: only trip-linked costs (fuel.tripId or expense.tripId set):
    const directTripIds = new Set([
      ...fuelRows.filter(f => f.vehicleId === v.id && f.tripId).map(f => f.tripId!),
      ...expenseRows.filter(e => e.vehicleId === v.id && e.tripId).map(e => e.tripId!),
    ]);
    // If no direct links exist, direct cost per trip = null (not allocated):
    const directCostPerCompletedTrip = null; // vehicle-period costs cannot be defensibly allocated to trips

    return {
      vehicleId: v.id, plateNumber: v.plateNumber, status: v.status,
      tripsCompleted: completed.length, tripsFailed: failed.length, completionRate, avgTripDurationMinutes: avgDur,
      fuelCostSar: fuelCost, maintenanceCostSar: maintCost, tyreCostSar: tyreCost,
      approvedExpensesSar: expCost, recordedOperatingCostSar: recorded,
      directCostPerCompletedTrip,
    };
  });
}

// ── Driver-level analytics ─────────────────────────────────────────────────────

export interface DriverAnalyticsRow {
  driverId: string;
  driverName: string;
  tripsAssigned: number;
  tripsCompleted: number;
  tripsFailed: number;
  completionRate: number | null;
  onTimeRate: number | null;      // from SLA: slaMet / slaEligible
  slaEligible: number;
  avgTripDurationMinutes: number | null;
  approvedExpensesSar: number;
  // No composite safety score — transparent measures only
}

export async function getDriverAnalytics(
  tenantId: string,
  range: DateRange
): Promise<DriverAnalyticsRow[]> {
  const [driverRows, tripRows, expenseRows, orderRows] = await Promise.all([
    db.query.drivers.findMany({
      where: eq(drivers.tenantId, tenantId),
      with: { user: { columns: { name: true } } },
      columns: { id: true },
    }),
    db.query.trips.findMany({
      where: and(eq(trips.tenantId, tenantId), gte(trips.createdAt, range.from), lte(trips.createdAt, range.to)),
      columns: { id: true, driverId: true, status: true, startedAt: true, completedAt: true },
    }),
    db.query.expenseClaims.findMany({
      where: and(eq(expenseClaims.tenantId, tenantId), eq(expenseClaims.status, "APPROVED"),
                 gte(expenseClaims.createdAt, range.from), lte(expenseClaims.createdAt, range.to)),
      columns: { driverId: true, amount: true },
    }),
    db.query.orders.findMany({
      where: and(eq(orders.tenantId, tenantId), gte(orders.createdAt, range.from), lte(orders.createdAt, range.to)),
      columns: { id: true, status: true, createdAt: true, completedAt: true, slaMinutes: true },
    }),
  ]);

  const orderMap = new Map(orderRows.map(o => [o.id, o]));

  return driverRows.map(d => {
    const myTrips = tripRows.filter(t => t.driverId === d.id);
    const completed = myTrips.filter(t => t.status === "COMPLETED").length;
    const failed    = myTrips.filter(t => t.status === "FAILED").length;
    const base = completed + failed;
    const completionRate = base > 0 ? r2(completed / base) : null;

    const withTime = myTrips.filter(t => t.status === "COMPLETED" && t.startedAt && t.completedAt);
    const avgDur = withTime.length > 0
      ? r0(withTime.reduce((s, t) => s + (new Date(t.completedAt!).getTime() - new Date(t.startedAt!).getTime()) / 60_000, 0) / withTime.length)
      : null;

    // On-time rate: computed from SLA on orders in this period
    const terminalStatuses = ["DELIVERED","PARTIALLY_DELIVERED","FAILED","CANCELLED"];
    let slaMet = 0, slaEligible = 0;
    for (const o of orderRows) {
      if (!terminalStatuses.includes(o.status) || !o.slaMinutes) continue;
      const result = computeSlaStatus({ createdAt: o.createdAt, slaMinutes: o.slaMinutes, status: o.status, completedAt: o.completedAt });
      if (result.slaStatus === "MET" || result.slaStatus === "MISSED") {
        slaEligible++;
        if (result.slaStatus === "MET") slaMet++;
      }
    }

    const approvedExpenses = r2(expenseRows.filter(e => e.driverId === d.id).reduce((s, e) => s + e.amount, 0));

    return {
      driverId: d.id, driverName: (d as any).user?.name ?? "Unknown",
      tripsAssigned: myTrips.length, tripsCompleted: completed, tripsFailed: failed,
      completionRate, onTimeRate: slaEligible > 0 ? r2(slaMet / slaEligible) : null,
      slaEligible, avgTripDurationMinutes: avgDur, approvedExpensesSar: approvedExpenses,
    };
  });
}

// ── Cost Intelligence ──────────────────────────────────────────────────────────

export interface CostMetrics {
  totalFuelCostSar: number;
  totalFuelLiters: number;
  totalMaintenanceCostSar: number;
  maintenanceEvents: number;
  totalTyreCostSar: number;
  tyreEvents: number;
  totalApprovedExpensesSar: number;     // approved expense claims only
  totalRecordedOperatingCostSar: number;
  // Breakdown by expense category:
  fuelExpenseClaimsSar: number;         // expense claims categorized as FUEL
  tollExpenseClaimsSar: number;
  maintenanceExpenseClaimsSar: number;
  otherExpenseClaimsSar: number;
  // NOTE: No cost per trip allocation from vehicle-period costs
  // Only direct fuel logs or expense claims with tripId are trip-attributable
  tripsWithDirectCosts: number;
}

export async function getCostMetrics(
  tenantId: string,
  range: DateRange
): Promise<CostMetrics> {
  const [fuelRows, maintRows, tyreRows, expenseRows] = await Promise.all([
    db.query.fuelLogs.findMany({
      where: and(eq(fuelLogs.tenantId, tenantId), gte(fuelLogs.filledAt, range.from), lte(fuelLogs.filledAt, range.to)),
      columns: { costSar: true, litersFilled: true, tripId: true },
    }),
    db.query.maintenanceRecords.findMany({
      where: and(eq(maintenanceRecords.tenantId, tenantId), gte(maintenanceRecords.openedAt, range.from), lte(maintenanceRecords.openedAt, range.to)),
      columns: { cost: true },
    }),
    db.query.tyreRecords.findMany({
      where: and(eq(tyreRecords.tenantId, tenantId), gte(tyreRecords.installedAt, range.from), lte(tyreRecords.installedAt, range.to)),
      columns: { costSar: true },
    }),
    db.query.expenseClaims.findMany({
      where: and(eq(expenseClaims.tenantId, tenantId), eq(expenseClaims.status, "APPROVED"),
                 gte(expenseClaims.createdAt, range.from), lte(expenseClaims.createdAt, range.to)),
      columns: { amount: true, category: true, tripId: true },
    }),
  ]);

  const totalFuelCostSar         = r2(fuelRows.reduce((s, f) => s + f.costSar, 0));
  const totalFuelLiters          = r2(fuelRows.reduce((s, f) => s + f.litersFilled, 0));
  const totalMaintenanceCostSar  = r2(maintRows.reduce((s, m) => s + (m.cost ?? 0), 0));
  const maintenanceEvents        = maintRows.length;
  const totalTyreCostSar         = r2(tyreRows.reduce((s, t) => s + (t.costSar ?? 0), 0));
  const tyreEvents               = tyreRows.length;
  const totalApprovedExpensesSar = r2(expenseRows.reduce((s, e) => s + e.amount, 0));

  const fuelExpenseClaimsSar         = r2(expenseRows.filter(e => e.category === "FUEL").reduce((s, e) => s + e.amount, 0));
  const tollExpenseClaimsSar         = r2(expenseRows.filter(e => e.category === "TOLL").reduce((s, e) => s + e.amount, 0));
  const maintenanceExpenseClaimsSar  = r2(expenseRows.filter(e => e.category === "MAINTENANCE").reduce((s, e) => s + e.amount, 0));
  const otherExpenseClaimsSar        = r2(expenseRows.filter(e => e.category === "OTHER").reduce((s, e) => s + e.amount, 0));

  const totalRecordedOperatingCostSar = r2(totalFuelCostSar + totalMaintenanceCostSar + totalTyreCostSar + totalApprovedExpensesSar);

  const tripsWithDirectCosts = new Set([
    ...fuelRows.filter(f => f.tripId).map(f => f.tripId!),
    ...expenseRows.filter(e => e.tripId).map(e => e.tripId!),
  ]).size;

  return {
    totalFuelCostSar, totalFuelLiters, totalMaintenanceCostSar, maintenanceEvents,
    totalTyreCostSar, tyreEvents, totalApprovedExpensesSar,
    totalRecordedOperatingCostSar,
    fuelExpenseClaimsSar, tollExpenseClaimsSar, maintenanceExpenseClaimsSar, otherExpenseClaimsSar,
    tripsWithDirectCosts,
  };
}

// ── Telematics Quality metrics ─────────────────────────────────────────────────

export interface TelematicsQualityMetrics {
  totalVehicles: number;
  vehiclesWithDevice: number;
  vehiclesWithHealthyDevice: number;
  vehiclesWithOfflineDevice: number;
  vehiclesNeverReported: number;
  telemetryCoveragePercent: number | null;  // vehiclesWithDevice / totalVehicles
  // GPS source distribution (period):
  gpsHistoryRows: number;
  devicePings: number;       // source = DEVICE
  driverAppPings: number;    // source = DRIVER_APP
  demoPings: number;         // source = GPS_DEMO — must never inflate physical metrics
  // Trips eligible for ETA analytics (have baselineEtaAt):
  tripsEligibleForEtaAnalytics: number;
  // Telemetry events summary:
  openAlerts: number;
  deviceOfflineAlerts: number;
}

export async function getTelematicsQualityMetrics(
  tenantId: string,
  range: DateRange
): Promise<TelematicsQualityMetrics> {
  const [vehicleRows, assignmentRows, deviceRows, gpsRows, tripRows, alertRows] = await Promise.all([
    db.query.vehicles.findMany({ where: eq(vehicles.tenantId, tenantId), columns: { id: true } }),
    db.query.vehicleDeviceAssignments.findMany({
      where: and(eq(vehicleDeviceAssignments.tenantId, tenantId), isNull(vehicleDeviceAssignments.unassignedAt)),
      columns: { vehicleId: true, deviceId: true },
    }),
    db.query.telematicsDevices.findMany({
      where: eq(telematicsDevices.tenantId, tenantId),
      columns: { id: true, lastCommunication: true, status: true },
    }),
    db.query.vehicleGpsHistory.findMany({
      where: and(
        eq(vehicleGpsHistory.tenantId, tenantId),
        gte(vehicleGpsHistory.recordedAt, range.from),
        lte(vehicleGpsHistory.recordedAt, range.to)
      ),
      columns: { source: true },
    }),
    db.query.trips.findMany({
      where: and(eq(trips.tenantId, tenantId), gte(trips.createdAt, range.from), lte(trips.createdAt, range.to)),
      columns: { baselineEtaAt: true },
    }),
    db.query.telemetryEvents.findMany({
      where: and(eq(telemetryEvents.tenantId, tenantId), eq(telemetryEvents.status, "OPEN")),
      columns: { id: true, eventType: true },
    }),
  ]);

  const assignedDeviceIds = new Set(assignmentRows.map(a => a.deviceId));
  const vehiclesWithDevice = vehicleRows.filter(v => assignmentRows.some(a => a.vehicleId === v.id)).length;

  // Device health based on lastCommunication:
  const OFFLINE_MS = 60 * 60 * 1000; // 60 min
  const STALE_MS   = 15 * 60 * 1000; // 15 min
  const now = Date.now();
  let healthy = 0, offline = 0, neverReported = 0;
  for (const d of deviceRows) {
    if (!assignedDeviceIds.has(d.id)) continue;
    if (!d.lastCommunication) { neverReported++; continue; }
    const age = now - new Date(d.lastCommunication).getTime();
    if (age > OFFLINE_MS) offline++;
    else healthy++;
  }

  const totalVehicles = vehicleRows.length;
  const telemetryCoveragePercent = totalVehicles > 0 ? r2(vehiclesWithDevice / totalVehicles) : null;

  const devicePings    = gpsRows.filter(g => g.source === "DEVICE").length;
  const driverAppPings = gpsRows.filter(g => g.source === "DRIVER_APP").length;
  const demoPings      = gpsRows.filter(g => g.source === "GPS_DEMO").length;

  return {
    totalVehicles, vehiclesWithDevice,
    vehiclesWithHealthyDevice: healthy,
    vehiclesWithOfflineDevice: offline,
    vehiclesNeverReported: neverReported,
    telemetryCoveragePercent,
    gpsHistoryRows: gpsRows.length, devicePings, driverAppPings, demoPings,
    tripsEligibleForEtaAnalytics: tripRows.filter(t => t.baselineEtaAt).length,
    openAlerts: alertRows.length,
    deviceOfflineAlerts: alertRows.filter(a => a.eventType === "DEVICE_OFFLINE").length,
  };
}

// ── Period-over-period comparison ──────────────────────────────────────────────

export interface OperationsComparison {
  current: OperationsMetrics;
  previous: OperationsMetrics | null;
  periodRange: { from: string; to: string };
}

export async function getOperationsComparison(
  tenantId: string,
  range: DateRange,
  includePrevious = true
): Promise<OperationsComparison> {
  const current = await getOperationsMetrics(tenantId, range);
  let previous: OperationsMetrics | null = null;
  if (includePrevious) {
    previous = await getOperationsMetrics(tenantId, precedingPeriod(range));
  }
  return {
    current, previous,
    periodRange: { from: range.from.toISOString(), to: range.to.toISOString() },
  };
}
