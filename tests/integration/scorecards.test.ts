import { describe, it, expect, beforeAll } from "vitest";
import { makeRequest, loginAs } from "../helpers/request";

describe("performance scorecards (BR-17)", () => {
  let dispatcherCookie: string;

  beforeAll(async () => {
    dispatcherCookie = await loginAs("dispatch@demo-water.co", "password123");
  });

  it("returns a driver scorecard for every driver, sorted highest score first", async () => {
    const { GET } = await import("@/app/api/scorecards/drivers/route");
    const res = await GET(makeRequest("/api/scorecards/drivers", { cookie: dispatcherCookie }));
    expect(res.status).toBe(200);
    const scorecards = await res.json();

    expect(scorecards.length).toBeGreaterThanOrEqual(2); // Khalid + Fahad from seed data
    for (const card of scorecards) {
      expect(card.score).toBeGreaterThanOrEqual(0);
      expect(card.score).toBeLessThanOrEqual(100);
      expect(typeof card.driverName).toBe("string");
    }
    for (let i = 1; i < scorecards.length; i++) {
      expect(scorecards[i - 1].score).toBeGreaterThanOrEqual(scorecards[i].score);
    }
  });

  it("returns a vehicle scorecard for every vehicle, ranked by cost-per-trip ascending", async () => {
    const { GET } = await import("@/app/api/scorecards/vehicles/route");
    const res = await GET(makeRequest("/api/scorecards/vehicles", { cookie: dispatcherCookie }));
    expect(res.status).toBe(200);
    const scorecards = await res.json();

    expect(scorecards.length).toBeGreaterThanOrEqual(2); // RUH-1024 + RUH-2077 from seed data
    const withCost = scorecards.filter((v: any) => v.avgCostPerTripSar != null);
    for (let i = 1; i < withCost.length; i++) {
      expect(withCost[i - 1].avgCostPerTripSar).toBeLessThanOrEqual(withCost[i].avgCostPerTripSar);
    }
    // Vehicles with zero completed trips sort after any with a real cost-per-trip figure.
    const withoutCostIndices = scorecards
      .map((v: any, i: number) => (v.avgCostPerTripSar == null ? i : -1))
      .filter((i: number) => i >= 0);
    const withCostIndices = scorecards
      .map((v: any, i: number) => (v.avgCostPerTripSar != null ? i : -1))
      .filter((i: number) => i >= 0);
    if (withoutCostIndices.length > 0 && withCostIndices.length > 0) {
      expect(Math.min(...withoutCostIndices)).toBeGreaterThan(Math.max(...withCostIndices));
    }
  });

  it("a driver session cannot access scorecards (ADMIN/DISPATCHER only)", async () => {
    const driverCookie = await loginAs("khalid@demo-water.co", "password123");
    const { GET } = await import("@/app/api/scorecards/drivers/route");
    const res = await GET(makeRequest("/api/scorecards/drivers", { cookie: driverCookie }));
    expect(res.status).toBe(401);
  });
});

describe("configurable scorecard weights (BR-17)", () => {
  let adminCookie: string;
  let dispatcherCookie: string;

  beforeAll(async () => {
    adminCookie = await loginAs("admin@demo-water.co", "password123");
    dispatcherCookie = await loginAs("dispatch@demo-water.co", "password123");
  });

  it("defaults to 50/30/20 with a 20-trip cap when nothing has been saved yet", async () => {
    const { GET } = await import("@/app/api/scorecards/config/route");
    const res = await GET(makeRequest("/api/scorecards/config", { cookie: adminCookie }));
    const config = await res.json();
    expect(config).toMatchObject({ onTimeWeight: 50, deliverySuccessWeight: 30, tripVolumeWeight: 20, tripVolumeCap: 20 });
  });

  it("rejects saving all-zero weights", async () => {
    const { POST } = await import("@/app/api/scorecards/config/route");
    const res = await POST(makeRequest("/api/scorecards/config", {
      method: "POST",
      cookie: adminCookie,
      body: { onTimeWeight: 0, deliverySuccessWeight: 0, tripVolumeWeight: 0, tripVolumeCap: 20 },
    }));
    expect(res.status).toBe(400);
  });

  it("a DISPATCHER can view the config but not change it", async () => {
    const { GET } = await import("@/app/api/scorecards/config/route");
    const viewRes = await GET(makeRequest("/api/scorecards/config", { cookie: dispatcherCookie }));
    expect(viewRes.status).toBe(200);

    const { POST } = await import("@/app/api/scorecards/config/route");
    const saveRes = await POST(makeRequest("/api/scorecards/config", {
      method: "POST",
      cookie: dispatcherCookie,
      body: { onTimeWeight: 100, deliverySuccessWeight: 0, tripVolumeWeight: 0, tripVolumeCap: 20 },
    }));
    expect(saveRes.status).toBe(401);
  });

  it("saving custom weights changes the driver rankings to match", async () => {
    // Weight entirely on on-time rate — rankings should now be driven
    // purely by on-time rate, not the default's blend with delivery
    // success and trip volume.
    const { POST: saveConfig } = await import("@/app/api/scorecards/config/route");
    const saveRes = await saveConfig(makeRequest("/api/scorecards/config", {
      method: "POST",
      cookie: adminCookie,
      body: { onTimeWeight: 100, deliverySuccessWeight: 0, tripVolumeWeight: 0, tripVolumeCap: 20 },
    }));
    expect(saveRes.status).toBe(201);
    const saved = await saveRes.json();
    expect(saved.onTimeWeight).toBe(100);

    const { GET: driversGet } = await import("@/app/api/scorecards/drivers/route");
    const scorecards = await (await driversGet(makeRequest("/api/scorecards/drivers", { cookie: adminCookie }))).json();

    for (const card of scorecards) {
      const expectedScore = Math.round((card.onTimeRate ?? 0.5) * 100);
      expect(card.score).toBe(expectedScore);
    }

    // Restore defaults so other tests in the suite that assume default
    // weighting behavior aren't affected by this test's changes.
    await saveConfig(makeRequest("/api/scorecards/config", {
      method: "POST",
      cookie: adminCookie,
      body: { onTimeWeight: 50, deliverySuccessWeight: 30, tripVolumeWeight: 20, tripVolumeCap: 20 },
    }));
  });
});
