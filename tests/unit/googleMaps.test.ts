import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { optimizeRoute } from "@/lib/googleMaps";

describe("optimizeRoute (BR-06)", () => {
  const originalKey = process.env.GOOGLE_MAPS_API_KEY;

  beforeEach(() => {
    delete process.env.GOOGLE_MAPS_API_KEY;
  });

  afterEach(() => {
    if (originalKey) process.env.GOOGLE_MAPS_API_KEY = originalKey;
  });

  it("falls back to input order with no API key configured, without making a network call", async () => {
    const depot = { lat: 24.7136, lng: 46.6753 };
    const stops = [
      { id: "a", lat: 24.72, lng: 46.68 },
      { id: "b", lat: 24.73, lng: 46.69 },
    ];
    const result = await optimizeRoute(depot, stops);
    expect(result.usedGoogleMaps).toBe(false);
    expect(result.orderedStopIds).toEqual(["a", "b"]);
    expect(result.estimatedDurationMinutes).toBeNull();
  });

  it("returns an empty order for zero stops without erroring", async () => {
    const result = await optimizeRoute({ lat: 24.7, lng: 46.6 }, []);
    expect(result.orderedStopIds).toEqual([]);
  });

  it("skips the API call entirely for a single stop (nothing to optimize)", async () => {
    process.env.GOOGLE_MAPS_API_KEY = "fake-key-should-not-be-used";
    const result = await optimizeRoute({ lat: 24.7, lng: 46.6 }, [{ id: "only", lat: 1, lng: 1 }]);
    expect(result.usedGoogleMaps).toBe(false);
    expect(result.orderedStopIds).toEqual(["only"]);
  });
});
