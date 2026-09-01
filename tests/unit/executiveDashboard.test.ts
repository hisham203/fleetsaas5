import { describe, it, expect } from "vitest";
import { computeChangePercent, type ExecutiveKpis } from "@/lib/executiveDashboard";

function makeKpis(overrides: Partial<ExecutiveKpis> = {}): ExecutiveKpis {
  return {
    totalTrips: 10,
    completedTrips: 8,
    ordersTotal: 20,
    deliveredOrders: 18,
    failedOrders: 2,
    slaComplianceRate: 0.9,
    totalRevenueSar: 1000,
    totalFuelCostSar: 200,
    totalFuelLiters: 100,
    totalMaintenanceCostSar: 50,
    estimatedDistanceKm: 500,
    costPerDeliverySar: 13.89,
    costPerKmSar: 0.5,
    revenuePerVehicleSar: 500,
    avgTripsPerVehicle: 4,
    activeVehicleCount: 2,
    ...overrides,
  };
}

describe("computeChangePercent (APP-07 comparative analysis)", () => {
  it("computes a positive percent change when the metric improved", () => {
    const current = makeKpis({ totalRevenueSar: 1200 });
    const previous = makeKpis({ totalRevenueSar: 1000 });
    const change = computeChangePercent(current, previous);
    expect(change.totalRevenueSar).toBe(20); // +20%
  });

  it("computes a negative percent change when the metric declined", () => {
    const current = makeKpis({ failedOrders: 1 });
    const previous = makeKpis({ failedOrders: 4 });
    const change = computeChangePercent(current, previous);
    expect(change.failedOrders).toBe(-75); // -75%
  });

  it("returns null rather than dividing by zero when the previous value was 0", () => {
    const current = makeKpis({ totalMaintenanceCostSar: 100 });
    const previous = makeKpis({ totalMaintenanceCostSar: 0 });
    const change = computeChangePercent(current, previous);
    expect(change.totalMaintenanceCostSar).toBeNull();
  });

  it("returns null for a metric that's null in either period (e.g. no deliveries yet)", () => {
    const current = makeKpis({ costPerDeliverySar: null });
    const previous = makeKpis({ costPerDeliverySar: 10 });
    const change = computeChangePercent(current, previous);
    expect(change.costPerDeliverySar).toBeNull();
  });

  it("returns 0 when nothing changed between periods", () => {
    const current = makeKpis();
    const previous = makeKpis();
    const change = computeChangePercent(current, previous);
    expect(change.totalRevenueSar).toBe(0);
    expect(change.slaComplianceRate).toBe(0);
  });
});
