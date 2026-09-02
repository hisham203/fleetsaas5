import { describe, it, expect, beforeAll } from "vitest";
import { makeRequest, loginAs } from "../helpers/request";

// Guards the specific class of bug this file's seed data was rewritten to
// fix: a demo dataset that leaves every order PENDING produces an
// Executive Dashboard of all zeros and nulls, which is useless for an
// investor/customer demo. These assertions would fail again if a future
// change reverted the seed to that state, or introduced an absurd
// cost-per-km from an unrealistic cross-country haul distance.
describe("seed data quality — credible demo dataset (not a regression test for exact values)", () => {
  let waterAdminCookie: string;
  let acmeAdminCookie: string;

  beforeAll(async () => {
    waterAdminCookie = await loginAs("admin@demo-water.co", "password123");
    acmeAdminCookie = await loginAs("admin@acme-fuel-demo.co", "password123");
  });

  it("Demo Water Co.'s Executive Dashboard shows real, non-trivial activity out of the box", async () => {
    const { GET } = await import("@/app/api/executive/dashboard/route");
    const dashboard = await (await GET(makeRequest("/api/executive/dashboard", { cookie: waterAdminCookie }))).json();
    const kpis = dashboard.kpis;

    // The whole point of this dataset: a fresh seed should never show an
    // all-zero dashboard.
    expect(kpis.completedTrips).toBeGreaterThan(20);
    expect(kpis.deliveredOrders).toBeGreaterThan(20);
    expect(kpis.failedOrders).toBeGreaterThan(0); // a realistic operation has some failures, not zero
    expect(kpis.totalRevenueSar).toBeGreaterThan(1000);
    expect(kpis.slaComplianceRate).not.toBeNull();
    expect(kpis.slaComplianceRate).toBeGreaterThan(0.7); // credible, not suspiciously perfect
    expect(kpis.slaComplianceRate).toBeLessThan(1);
    expect(kpis.costPerDeliverySar).not.toBeNull();
    expect(kpis.costPerKmSar).not.toBeNull();
    // A sanity ceiling on cost-per-km: this catches the exact bug found
    // while building this dataset, where routing a delivery from a depot
    // ~860km away inflated the estimated distance and produced an
    // unrealistic near-zero cost-per-km. Real intra-city delivery
    // shouldn't be below a few cents per km.
    expect(kpis.costPerKmSar).toBeGreaterThan(0.5);
    expect(kpis.activeVehicleCount).toBeGreaterThanOrEqual(5);

    expect(dashboard.topDrivers.length).toBeGreaterThan(1);
    expect(dashboard.vehicleRanking.length).toBeGreaterThan(1);
    // Scores/costs shouldn't be identical across every driver/vehicle —
    // that would suggest flat, unvaried filler data rather than a real
    // spread of outcomes.
    const uniqueDriverScores = new Set(dashboard.topDrivers.map((d: any) => d.score));
    expect(uniqueDriverScores.size).toBeGreaterThan(1);
  });

  it("Acme Fuel Delivery Co.'s dashboard shows real activity, distinct from Demo Water Co.'s", async () => {
    const { GET } = await import("@/app/api/executive/dashboard/route");
    const acmeDashboard = await (await GET(makeRequest("/api/executive/dashboard", { cookie: acmeAdminCookie }))).json();
    const waterDashboard = await (await GET(makeRequest("/api/executive/dashboard", { cookie: waterAdminCookie }))).json();

    const acmeKpis = acmeDashboard.kpis;
    expect(acmeKpis.completedTrips).toBeGreaterThan(10);
    expect(acmeKpis.deliveredOrders).toBeGreaterThan(10);
    expect(acmeKpis.totalRevenueSar).toBeGreaterThan(5000);
    expect(acmeKpis.costPerKmSar).toBeGreaterThan(0.5); // same sanity ceiling as above

    // The Company Switcher's whole point: two tenants should look like two
    // different businesses, not the same data twice. Acme (wholesale fuel)
    // should show meaningfully different revenue and volume than Water Co.
    // (retail bottled water) — not just a scaled-down copy.
    expect(acmeKpis.totalRevenueSar).not.toBe(waterDashboard.kpis.totalRevenueSar);
    expect(acmeKpis.totalTrips).not.toBe(waterDashboard.kpis.totalTrips);
    // Acme's average revenue per delivery should be visibly larger
    // (wholesale fuel vs. small retail water bottle orders).
    const acmeAvgRevenue = acmeKpis.totalRevenueSar / acmeKpis.deliveredOrders;
    const waterAvgRevenue = waterDashboard.kpis.totalRevenueSar / waterDashboard.kpis.deliveredOrders;
    expect(acmeAvgRevenue).toBeGreaterThan(waterAvgRevenue * 3);
  });

  it("both tenants have realistic failure rates — neither a perfect 100% nor a broken all-failed dataset", async () => {
    const { GET } = await import("@/app/api/executive/dashboard/route");
    for (const cookie of [waterAdminCookie, acmeAdminCookie]) {
      const dashboard = await (await GET(makeRequest("/api/executive/dashboard", { cookie }))).json();
      const { deliveredOrders, failedOrders } = dashboard.kpis;
      const failureRate = failedOrders / (deliveredOrders + failedOrders);
      expect(failureRate).toBeGreaterThan(0);
      expect(failureRate).toBeLessThan(0.2); // realistic, not a dataset dominated by failures
    }
  });

  // BR-23 was flagged in the Go-Live Product Audit as "built in code, empty
  // in demo" — the Field Ops tab showed "No tasks assigned yet" / "Nothing
  // pending review" on first login despite the feature working correctly.
  // These assertions guard against that regressing silently in the future.
  describe("BR-23 Tasks & Expenses — no longer empty in the demo", () => {
    it("Demo Water Co. has a realistic, varied set of seeded tasks", async () => {
      const { GET } = await import("@/app/api/tasks/route");
      const tasks = await (await GET(makeRequest("/api/tasks", { cookie: waterAdminCookie }))).json();

      expect(tasks.length).toBeGreaterThanOrEqual(8);
      expect(tasks.length).toBeLessThanOrEqual(12);

      const statuses = new Set(tasks.map((t: any) => t.status));
      expect(statuses.size).toBeGreaterThan(1); // not every task stuck in one status

      // Every task must resolve to a real driver — a dangling/broken
      // driver reference would silently render as a blank name in the UI.
      for (const t of tasks) {
        expect(t.driver?.user?.name).toBeTruthy();
      }
    });

    it("Demo Water Co. has a realistic, varied set of seeded expenses", async () => {
      const { GET } = await import("@/app/api/expenses/route");
      const expenses = await (await GET(makeRequest("/api/expenses", { cookie: waterAdminCookie }))).json();

      expect(expenses.length).toBeGreaterThanOrEqual(8);
      expect(expenses.length).toBeLessThanOrEqual(12);

      const statuses = new Set(expenses.map((e: any) => e.status));
      expect(statuses.size).toBeGreaterThan(1);
      // All three real expense statuses should appear at least once —
      // an all-PENDING or all-APPROVED set wouldn't demo the approval
      // workflow at all.
      expect(statuses.has("APPROVED")).toBe(true);
      expect(statuses.has("PENDING")).toBe(true);
      expect(statuses.has("REJECTED")).toBe(true);

      for (const e of expenses) {
        expect(e.driver?.user?.name).toBeTruthy();
        expect(e.vehicle?.plateNumber).toBeTruthy();
        expect(e.amount).toBeGreaterThan(0);
        // A sanity ceiling — this is a demo of realistic operational
        // expenses (fuel, tolls, minor repairs), not five-figure claims.
        expect(e.amount).toBeLessThan(2000);
      }
    });

    it("Acme Fuel Delivery Co. has a realistic, varied set of seeded tasks", async () => {
      const { GET } = await import("@/app/api/tasks/route");
      const tasks = await (await GET(makeRequest("/api/tasks", { cookie: acmeAdminCookie }))).json();

      expect(tasks.length).toBeGreaterThanOrEqual(6);
      expect(tasks.length).toBeLessThanOrEqual(10);
      expect(new Set(tasks.map((t: any) => t.status)).size).toBeGreaterThan(1);
      for (const t of tasks) {
        expect(t.driver?.user?.name).toBeTruthy();
      }
    });

    it("Acme Fuel Delivery Co. has a realistic, varied set of seeded expenses", async () => {
      const { GET } = await import("@/app/api/expenses/route");
      const expenses = await (await GET(makeRequest("/api/expenses", { cookie: acmeAdminCookie }))).json();

      expect(expenses.length).toBeGreaterThanOrEqual(6);
      expect(expenses.length).toBeLessThanOrEqual(10);
      const statuses = new Set(expenses.map((e: any) => e.status));
      expect(statuses.has("APPROVED")).toBe(true);
      expect(statuses.has("PENDING")).toBe(true);
      expect(statuses.has("REJECTED")).toBe(true);
      for (const e of expenses) {
        expect(e.amount).toBeGreaterThan(0);
      }
    });

    it("Acme's expenses are priced at wholesale fuel scale, distinctly larger than Demo Water Co.'s retail scale", async () => {
      const { GET: expensesGet } = await import("@/app/api/expenses/route");
      const waterExpenses = await (await expensesGet(makeRequest("/api/expenses", { cookie: waterAdminCookie }))).json();
      const acmeExpenses = await (await expensesGet(makeRequest("/api/expenses", { cookie: acmeAdminCookie }))).json();

      const avg = (arr: any[]) => arr.reduce((s, e) => s + e.amount, 0) / arr.length;
      expect(avg(acmeExpenses)).toBeGreaterThan(avg(waterExpenses) * 1.5);
    });

    it("a task claiming to be a real 'failed delivery follow-up' is genuinely linked to a real failed trip, not just a plausible-sounding label", async () => {
      const { GET } = await import("@/app/api/tasks/route");
      const tasks = await (await GET(makeRequest("/api/tasks", { cookie: waterAdminCookie }))).json();
      const followUp = tasks.find((t: any) => t.title.startsWith("Failed delivery follow-up"));
      expect(followUp).toBeTruthy();
      expect(followUp.tripId).toBeTruthy();
      expect(followUp.trip?.status).toBe("COMPLETED"); // the trip itself completed; the delivery attempt within it failed
    });
  });
});
