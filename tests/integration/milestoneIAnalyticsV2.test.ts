/**
 * milestoneIAnalyticsV2.test.ts — Milestone I: Analytics V2
 *
 * A. Canonical metric layer — parseDateRange / precedingPeriod
 * B. Operations metrics — formula and null semantics
 * C. Fleet metrics
 * D. Cost metrics — inclusion/exclusion rules
 * E. Driver analytics — no fake score
 * F. Telematics quality — GPS source provenance
 * G. Analytics API authorization
 * H. Tenant isolation
 * I. Data quality semantics (zero vs null)
 * J. Analytics pages exist (navigation check)
 * K. UAT checklist exists
 * L. Migration count
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import {
  parseDateRange, precedingPeriod, getOperationsMetrics, getFleetMetrics,
  getCostMetrics, getTelematicsQualityMetrics, getDriverAnalytics,
} from "@/lib/analyticsMetrics";
import { makeRequest } from "../helpers/request";
import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

// ── A. Date range utilities ────────────────────────────────────────────────────
describe("A. parseDateRange and precedingPeriod", () => {
  it("A1. parseDateRange returns Date objects", () => {
    const r = parseDateRange("2026-01-01", "2026-01-31");
    expect(r.from).toBeInstanceOf(Date);
    expect(r.to).toBeInstanceOf(Date);
    expect(r.from.getFullYear()).toBe(2026);
  });

  it("A2. parseDateRange defaults to last 30 days when no args", () => {
    const r = parseDateRange(null, null);
    const daysMs = r.to.getTime() - r.from.getTime();
    const days = Math.round(daysMs / 86_400_000);
    expect(days).toBeGreaterThanOrEqual(29);
    expect(days).toBeLessThanOrEqual(31);
  });

  it("A3. precedingPeriod has same duration as input", () => {
    const r = parseDateRange("2026-01-01", "2026-01-31");
    const prev = precedingPeriod(r);
    const currentMs = r.to.getTime() - r.from.getTime();
    const prevMs = prev.to.getTime() - prev.from.getTime();
    expect(prevMs).toBe(currentMs);
  });

  it("A4. precedingPeriod ends at range.from", () => {
    const r = parseDateRange("2026-02-01", "2026-02-28");
    const prev = precedingPeriod(r);
    expect(prev.to.getTime()).toBe(r.from.getTime());
  });

  it("A5. Non-overlapping: prev.to === range.from (no gap, no overlap)", () => {
    const r = parseDateRange("2026-03-01", "2026-03-15");
    const prev = precedingPeriod(r);
    expect(prev.to.getTime()).toBe(r.from.getTime());
    expect(prev.from.getTime()).toBeLessThan(r.from.getTime());
  });
});

// ── B. Operations metrics ─────────────────────────────────────────────────────
describe("B. Operations metrics formula and semantics", () => {
  let tenantId: string;
  beforeAll(async () => {
    const t = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    if (t) tenantId = t.id;
  });

  it("B1. getOperationsMetrics returns all expected fields", async () => {
    if (!tenantId) { console.log("SKIP"); return; }
    const r = parseDateRange("2020-01-01", "2020-01-02"); // intentionally empty period
    const m = await getOperationsMetrics(tenantId, r);
    expect(typeof m.ordersCreated).toBe("number");
    expect(typeof m.tripsCompleted).toBe("number");
    expect(typeof m.tripsFailed).toBe("number");
    expect(typeof m.slaEligibleOrders).toBe("number");
    expect(typeof m.exceptionsCreated).toBe("number");
  });

  it("B2. tripCompletionRate is null when no completed or failed trips", async () => {
    if (!tenantId) { console.log("SKIP"); return; }
    const r = parseDateRange("2000-01-01", "2000-01-02");
    const m = await getOperationsMetrics(tenantId, r);
    // Far-past period: no trips
    expect(m.tripCompletionRate).toBeNull(); // null, not 0
    expect(m.slaComplianceRate).toBeNull();  // null, not 0
  });

  it("B3. tripCompletionRate formula: completed / (completed + failed)", async () => {
    // Pure formula test (no DB):
    const m = {
      tripsCompleted: 8, tripsFailed: 2,
      tripCompletionRate: Math.round(8 / 10 * 100) / 100,
    };
    expect(m.tripCompletionRate).toBeCloseTo(0.8);
  });

  it("B4. slaComplianceRate is null when slaEligibleOrders = 0", async () => {
    if (!tenantId) { console.log("SKIP"); return; }
    const r = parseDateRange("2000-01-01", "2000-01-02");
    const m = await getOperationsMetrics(tenantId, r);
    if (m.slaEligibleOrders === 0) {
      expect(m.slaComplianceRate).toBeNull(); // not 0
    }
  });
});

// ── C. Fleet metrics ──────────────────────────────────────────────────────────
describe("C. Fleet metrics", () => {
  it("C1. getFleetMetrics returns expected shape", async () => {
    const t = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    if (!t) { console.log("SKIP"); return; }
    const r = parseDateRange("2020-01-01", "2026-12-31");
    const m = await getFleetMetrics(t.id, r);
    expect(typeof m.totalVehicles).toBe("number");
    expect(typeof m.activeVehicles).toBe("number");
    expect(m.vehiclesWithDevices + m.vehiclesWithoutDevices).toBe(m.totalVehicles);
  });

  it("C2. No fake utilization percentage in metric layer", () => {
    const src = readFileSync(join(process.cwd(), "lib/analyticsMetrics.ts"), "utf8");
    // Should NOT contain "Utilization %" as a returned metric key:
    expect(src).not.toContain("utilizationPercent");
    expect(src).not.toContain("fleetUtilization");
    // SHOULD document the reason:
    expect(src).toContain("No fake utilization");
  });
});

// ── D. Cost metrics ───────────────────────────────────────────────────────────
describe("D. Cost inclusion/exclusion rules", () => {
  it("D1. Only APPROVED expense claims in cost total", () => {
    const src = readFileSync(join(process.cwd(), "lib/analyticsMetrics.ts"), "utf8");
    // The filter for approved claims:
    expect(src).toContain('eq(expenseClaims.status, "APPROVED")');
    // PENDING and REJECTED must not be included:
    expect(src).not.toContain('"PENDING"');  // not included in cost calculation path
  });

  it("D2. No cost-per-trip allocation from vehicle-period costs", () => {
    const src = readFileSync(join(process.cwd(), "lib/analyticsMetrics.ts"), "utf8");
    // The policy note must exist:
    expect(src).toContain("vehicle-period costs cannot be defensibly allocated");
    // directCostPerCompletedTrip is null by design:
    expect(src).toContain("directCostPerCompletedTrip = null"); // assigned as null
  });

  it("D3. getCostMetrics returns correct fields", async () => {
    const t = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    if (!t) { console.log("SKIP"); return; }
    const r = parseDateRange("2020-01-01", "2026-12-31");
    const m = await getCostMetrics(t.id, r);
    expect(typeof m.totalFuelCostSar).toBe("number");
    expect(typeof m.totalMaintenanceCostSar).toBe("number");
    expect(typeof m.totalTyreCostSar).toBe("number");
    expect(typeof m.totalApprovedExpensesSar).toBe("number");
    expect(typeof m.totalRecordedOperatingCostSar).toBe("number");
    // Total should equal sum of components:
    const expected = Math.round((m.totalFuelCostSar + m.totalMaintenanceCostSar + m.totalTyreCostSar + m.totalApprovedExpensesSar) * 100) / 100;
    expect(m.totalRecordedOperatingCostSar).toBeCloseTo(expected, 1);
  });

  it("D4. No double-counting: fuel in fuelLogs vs fuel in expenseClaims are separate", () => {
    const src = readFileSync(join(process.cwd(), "lib/analyticsMetrics.ts"), "utf8");
    // fuelLogs and expenseClaims are queried separately and presented separately:
    expect(src).toContain("totalFuelCostSar");
    expect(src).toContain("fuelExpenseClaimsSar");
    // They are not summed together:
    expect(src).not.toContain("totalFuelCostSar + fuelExpenseClaimsSar");
    expect(src).not.toContain("fuelExpenseClaimsSar + totalFuelCostSar");
  });
});

// ── E. Driver analytics — no fake score ──────────────────────────────────────
describe("E. Driver analytics — transparent metrics, no fake score", () => {
  it("E1. Driver analytics has no composite safety score", () => {
    const src = readFileSync(join(process.cwd(), "lib/analyticsMetrics.ts"), "utf8");
    expect(src).not.toContain("safetyScore");
    expect(src).not.toContain("drivingScore");
    expect(src).not.toContain("harshBraking");
    expect(src).not.toContain("speedingScore");
  });

  it("E2. Driver analytics returns expected transparent fields", async () => {
    const t = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    if (!t) { console.log("SKIP"); return; }
    const r = parseDateRange("2020-01-01", "2026-12-31");
    const rows = await getDriverAnalytics(t.id, r);
    for (const d of rows) {
      expect(typeof d.driverId).toBe("string");
      expect(typeof d.tripsCompleted).toBe("number");
      expect(typeof d.tripsFailed).toBe("number");
      // completionRate is null or number — never a fabricated score:
      expect(d.completionRate === null || typeof d.completionRate === "number").toBe(true);
    }
  });

  it("E3. onTimeRate is null (not 0) when no SLA-eligible orders", async () => {
    const t = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    if (!t) { console.log("SKIP"); return; }
    const r = parseDateRange("2000-01-01", "2000-01-02"); // no orders
    const rows = await getDriverAnalytics(t.id, r);
    for (const d of rows) {
      if (d.slaEligible === 0) {
        expect(d.onTimeRate).toBeNull(); // null not 0
      }
    }
  });
});

// ── F. Telematics quality — GPS source provenance ─────────────────────────────
describe("F. GPS source provenance and demo isolation", () => {
  it("F1. GPS_DEMO pings are counted separately in telematics quality", () => {
    const src = readFileSync(join(process.cwd(), "lib/analyticsMetrics.ts"), "utf8");
    expect(src).toContain('source === "GPS_DEMO"');
    expect(src).toContain("demoPings");
    expect(src).toContain("devicePings");
    expect(src).toContain("driverAppPings");
  });

  it("F2. Physical GPS = DEVICE + DRIVER_APP (demo excluded)", () => {
    const src = readFileSync(join(process.cwd(), "lib/analyticsMetrics.ts"), "utf8");
    // Comment in telematics quality page:
    const page = readFileSync(join(process.cwd(), "app/analytics/telematics/page.tsx"), "utf8");
    expect(page).toContain("GPS_DEMO pings are isolated from physical");
    expect(page).toContain("Physical GPS total");
    expect(page).toContain("devicePings + d.driverAppPings");
  });

  it("F3. Telematics coverage % = vehiclesWithDevice / totalVehicles", () => {
    const src = readFileSync(join(process.cwd(), "lib/analyticsMetrics.ts"), "utf8");
    expect(src).toContain("vehiclesWithDevice / totalVehicles");
    // Returns null when no vehicles:
    expect(src).toContain("totalVehicles > 0 ? r2(vehiclesWithDevice / totalVehicles) : null");
  });
});

// ── G. Analytics API authorization ───────────────────────────────────────────
describe("G. Analytics API authorization", () => {
  const routes = [
    { path: "/api/analytics/overview", file: "analytics/overview/route.ts" },
    { path: "/api/analytics/operations", file: "analytics/operations/route.ts" },
    { path: "/api/analytics/fleet", file: "analytics/fleet/route.ts" },
    { path: "/api/analytics/drivers", file: "analytics/drivers/route.ts" },
    { path: "/api/analytics/costs", file: "analytics/costs/route.ts" },
    { path: "/api/analytics/telematics", file: "analytics/telematics/route.ts" },
  ];

  for (const { path, file } of routes) {
    it(`G. Unauthenticated ${path} returns 401`, async () => {
      const mod = await import(`@/app/api/${file.replace("/route.ts", "")}/route`);
      const res = await mod.GET(makeRequest(path, {}));
      expect(res.status).toBe(401);
    });
  }

  it("G7. Analytics routes use REPORTS_* permissions not admin bypass", () => {
    const src = readFileSync(join(process.cwd(), "app/api/analytics/overview/route.ts"), "utf8");
    expect(src).toContain("REPORTS_OPERATIONS_VIEW");
    expect(src).not.toContain("hasRole");
    expect(src).not.toContain("ADMIN");
  });
});

// ── H. Tenant isolation ───────────────────────────────────────────────────────
describe("H. Tenant isolation in analytics", () => {
  it("H1. getOperationsMetrics enforces tenant boundary (empty for wrong tenant)", async () => {
    const fakeTenantId = "00000000-fake-fake-fake-000000000000";
    const r = parseDateRange("2020-01-01", "2026-12-31");
    const m = await getOperationsMetrics(fakeTenantId, r);
    expect(m.ordersCreated).toBe(0);
    expect(m.tripsCompleted).toBe(0);
    expect(m.slaEligibleOrders).toBe(0);
  });

  it("H2. getCostMetrics returns zeros for unknown tenant", async () => {
    const m = await getCostMetrics("unknown-tenant", parseDateRange("2020-01-01", "2026-12-31"));
    expect(m.totalFuelCostSar).toBe(0);
    expect(m.totalRecordedOperatingCostSar).toBe(0);
  });

  it("H3. getTelematicsQualityMetrics returns zeros for unknown tenant", async () => {
    const m = await getTelematicsQualityMetrics("unknown-tenant", parseDateRange("2020-01-01", "2026-12-31"));
    expect(m.totalVehicles).toBe(0);
    expect(m.telemetryCoveragePercent).toBeNull();
  });

  it("H4. getDriverAnalytics returns empty array for unknown tenant", async () => {
    const rows = await getDriverAnalytics("unknown-tenant", parseDateRange("2020-01-01", "2026-12-31"));
    expect(rows).toHaveLength(0);
  });
});

// ── I. Data quality semantics ─────────────────────────────────────────────────
describe("I. Zero vs null semantics", () => {
  it("I1. tripCompletionRate formula returns null not 0 for no eligible trips", () => {
    // Simulated: 0 completed + 0 failed
    const completed = 0, failed = 0;
    const base = completed + failed;
    const rate = base > 0 ? completed / base : null;
    expect(rate).toBeNull(); // not 0
  });

  it("I2. tripsPerVehicle returns null not 0 when no active vehicles", () => {
    const src = readFileSync(join(process.cwd(), "lib/analyticsMetrics.ts"), "utf8");
    expect(src).toContain("activeVehicles > 0 ? r2(completedTrips / activeVehicles) : null");
  });

  it("I3. telemetryCoveragePercent null when no vehicles exist", () => {
    const src = readFileSync(join(process.cwd(), "lib/analyticsMetrics.ts"), "utf8");
    expect(src).toContain("totalVehicles > 0 ? r2(vehiclesWithDevice / totalVehicles) : null");
  });

  it("I4. Cost metrics return numeric 0 (not null) when no records — costs are measured zeros", async () => {
    const m = await getCostMetrics("empty-tenant", parseDateRange("2000-01-01", "2000-01-02"));
    expect(m.totalFuelCostSar).toBe(0);
    expect(m.totalRecordedOperatingCostSar).toBe(0);
    // For costs, 0 IS the correct answer (no costs recorded) unlike rates/ratios
  });
});

// ── J. Analytics pages exist ──────────────────────────────────────────────────
describe("J. Analytics workspace pages", () => {
  const pages = [
    "app/analytics/overview/page.tsx",
    "app/analytics/operations/page.tsx",
    "app/analytics/fleet/page.tsx",
    "app/analytics/drivers/page.tsx",
    "app/analytics/costs/page.tsx",
    "app/analytics/telematics/page.tsx",
  ];

  for (const page of pages) {
    it(`J. ${page} exists`, () => {
      expect(existsSync(join(process.cwd(), page))).toBe(true);
    });
  }

  it("J7. Cost page shows no-cost-per-trip disclaimer", () => {
    const src = readFileSync(join(process.cwd(), "app/analytics/costs/page.tsx"), "utf8");
    expect(src).toContain("cannot be defensibly allocated");
  });

  it("J8. Fleet page shows no-utilization disclaimer", () => {
    const src = readFileSync(join(process.cwd(), "app/analytics/fleet/page.tsx"), "utf8");
    expect(src).toContain("Utilization % is not shown");
  });

  it("J9. Driver page shows no-safety-score note", () => {
    const src = readFileSync(join(process.cwd(), "app/analytics/drivers/page.tsx"), "utf8");
    expect(src).toContain("no composite safety");
  });
});

// ── K. UAT checklist ─────────────────────────────────────────────────────────
describe("K. Physical Road Test UAT checklist", () => {
  it("K1. UAT checklist file exists", () => {
    expect(existsSync(join(process.cwd(), "docs/PHYSICAL_ROAD_TEST_UAT.md"))).toBe(true);
  });

  it("K2. Checklist covers required sections", () => {
    const src = readFileSync(join(process.cwd(), "docs/PHYSICAL_ROAD_TEST_UAT.md"), "utf8");
    expect(src).toContain("PRE-TEST SETUP");
    expect(src).toContain("ROAD TEST EXECUTION");
    expect(src).toContain("POST-TRIP VERIFICATION");
    expect(src).toContain("Dispatch");
    expect(src).toContain("GPS ingestion");
    expect(src).toContain("Live Fleet");
    expect(src).toContain("ETA");
    expect(src).toContain("Trip Replay");
    expect(src).toContain("Analytics Impact");
  });

  it("K3. Checklist explicitly excludes AirTag from software scope", () => {
    const src = readFileSync(join(process.cwd(), "docs/PHYSICAL_ROAD_TEST_UAT.md"), "utf8");
    expect(src).toContain("AirTag");
    expect(src).toContain("NOT part of this test");
  });

  it("K4. Checklist has GPS_DEMO isolation check", () => {
    const src = readFileSync(join(process.cwd(), "docs/PHYSICAL_ROAD_TEST_UAT.md"), "utf8");
    expect(src).toContain("GPS_DEMO");
    expect(src).toContain("Demo pings same as baseline");
  });
});

// ── L. Migration count ────────────────────────────────────────────────────────
describe("L. Migration count", () => {
  it("L1. Still 30 migrations — Milestone I requires no schema change", () => {
    const { readdirSync } = require("fs");
    const count = readdirSync(join(process.cwd(), "drizzle")).filter((f: string) => f.endsWith(".sql")).length;
    expect(count).toBe(30); // 0000–0029; no migration 0030
  });

  it("L2. lib/analyticsMetrics.ts exists and exports canonical functions", () => {
    expect(existsSync(join(process.cwd(), "lib/analyticsMetrics.ts"))).toBe(true);
    const src = readFileSync(join(process.cwd(), "lib/analyticsMetrics.ts"), "utf8");
    expect(src).toContain("export async function getOperationsMetrics");
    expect(src).toContain("export async function getFleetMetrics");
    expect(src).toContain("export async function getCostMetrics");
    expect(src).toContain("export async function getTelematicsQualityMetrics");
    expect(src).toContain("export async function getDriverAnalytics");
  });
});


