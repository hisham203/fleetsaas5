import { describe, it, expect } from "vitest";
import { computeDriverScore, DEFAULT_SCORECARD_WEIGHTS } from "@/lib/scorecards";

describe("computeDriverScore (BR-17 configurable weights)", () => {
  it("matches the documented default formula: 50/30/20, cap 20 trips", () => {
    // Perfect driver: 100% on-time, 100% delivery success, 20+ trips.
    const score = computeDriverScore(
      { onTimeRate: 1, deliverySuccessRate: 1, tripsCompleted: 20 },
      DEFAULT_SCORECARD_WEIGHTS
    );
    expect(score).toBe(100);
  });

  it("gives a neutral driver (no resolved orders yet) exactly half credit on those components", () => {
    const score = computeDriverScore(
      { onTimeRate: null, deliverySuccessRate: null, tripsCompleted: 0 },
      DEFAULT_SCORECARD_WEIGHTS
    );
    // 0.5*50 + 0.5*30 + 0*20 = 40
    expect(score).toBe(40);
  });

  it("produces identical results whether weights are given as 50/30/20 or 5/3/2 (normalization)", () => {
    const components = { onTimeRate: 0.8, deliverySuccessRate: 0.6, tripsCompleted: 10 };
    const scoreDefault = computeDriverScore(components, DEFAULT_SCORECARD_WEIGHTS);
    const scoreScaledDown = computeDriverScore(components, {
      onTimeWeight: 5,
      deliverySuccessWeight: 3,
      tripVolumeWeight: 2,
      tripVolumeCap: 20,
    });
    expect(scoreScaledDown).toBe(scoreDefault);
  });

  it("a tenant weighting only on-time rate ranks purely by on-time rate", () => {
    const onlyOnTime = { onTimeWeight: 100, deliverySuccessWeight: 0, tripVolumeWeight: 0, tripVolumeCap: 20 };
    const highOnTime = computeDriverScore({ onTimeRate: 0.9, deliverySuccessRate: 0.1, tripsCompleted: 1 }, onlyOnTime);
    const lowOnTime = computeDriverScore({ onTimeRate: 0.2, deliverySuccessRate: 0.9, tripsCompleted: 50 }, onlyOnTime);
    expect(highOnTime).toBeGreaterThan(lowOnTime);
    expect(highOnTime).toBe(90);
    expect(lowOnTime).toBe(20);
  });

  it("respects a custom trip-volume cap", () => {
    const weights = { onTimeWeight: 0, deliverySuccessWeight: 0, tripVolumeWeight: 100, tripVolumeCap: 5 };
    const atCap = computeDriverScore({ onTimeRate: null, deliverySuccessRate: null, tripsCompleted: 5 }, weights);
    const overCap = computeDriverScore({ onTimeRate: null, deliverySuccessRate: null, tripsCompleted: 50 }, weights);
    const halfCap = computeDriverScore({ onTimeRate: null, deliverySuccessRate: null, tripsCompleted: 2.5 }, weights);
    expect(atCap).toBe(100);
    expect(overCap).toBe(100); // capped, doesn't exceed full marks
    expect(halfCap).toBe(50);
  });

  it("returns 0 rather than throwing when all weights are zero", () => {
    const score = computeDriverScore(
      { onTimeRate: 1, deliverySuccessRate: 1, tripsCompleted: 100 },
      { onTimeWeight: 0, deliverySuccessWeight: 0, tripVolumeWeight: 0, tripVolumeCap: 20 }
    );
    expect(score).toBe(0);
  });
});
