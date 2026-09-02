import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { optimizeRoute } from "@/lib/googleMaps";

describe("optimizeRoute (BR-06)", () => {
  const originalKey = process.env.GOOGLE_MAPS_API_KEY;

  beforeEach(() => {
    delete process.env.GOOGLE_MAPS_API_KEY;
  });

  afterEach(() => {
    if (originalKey) process.env.GOOGLE_MAPS_API_KEY = originalKey;
    vi.restoreAllMocks();
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

  // No existing test exercised the actual success path — every other test
  // here either has no key or hits the single-stop early return, so a real
  // bug in parsing waypoint_order or summing leg durations could ship
  // undetected. This mocks a realistic Directions API response shape
  // (reordered waypoints, multiple legs) to close that gap before rolling
  // out a real API key to staging.
  it("reorders stops per waypoint_order and sums leg durations from a real-shaped API response", async () => {
    process.env.GOOGLE_MAPS_API_KEY = "test-key";
    const depot = { lat: 24.7136, lng: 46.6753 };
    const stops = [
      { id: "a", lat: 24.72, lng: 46.68 },
      { id: "b", lat: 24.73, lng: 46.69 },
      { id: "c", lat: 24.74, lng: 46.70 },
    ];

    // Google's API returns waypoint_order as indices into the ORIGINAL
    // waypoints array, reflecting its optimized visiting order — here it
    // says "visit c, then a, then b" (indices [2, 0, 1]).
    const mockResponse = {
      status: "OK",
      routes: [
        {
          waypoint_order: [2, 0, 1],
          legs: [
            { duration: { value: 300 } }, // depot -> c: 5 min
            { duration: { value: 600 } }, // c -> a: 10 min
            { duration: { value: 480 } }, // a -> b: 8 min
            { duration: { value: 420 } }, // b -> depot: 7 min
          ],
        },
      ],
    };
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    } as Response);

    const result = await optimizeRoute(depot, stops);

    expect(result.usedGoogleMaps).toBe(true);
    expect(result.orderedStopIds).toEqual(["c", "a", "b"]); // reordered per waypoint_order
    expect(result.estimatedDurationMinutes).toBe(30); // (300+600+480+420)/60 = 30
  });

  it("falls back gracefully when the API responds with a non-OK status", async () => {
    process.env.GOOGLE_MAPS_API_KEY = "test-key";
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ status: "REQUEST_DENIED" }),
    } as Response);

    const result = await optimizeRoute({ lat: 24.7, lng: 46.6 }, [
      { id: "a", lat: 24.72, lng: 46.68 },
      { id: "b", lat: 24.73, lng: 46.69 },
    ]);
    expect(result.usedGoogleMaps).toBe(false);
    expect(result.orderedStopIds).toEqual(["a", "b"]); // safe fallback, not a thrown error
  });

  it("falls back gracefully when fetch itself throws (network error)", async () => {
    process.env.GOOGLE_MAPS_API_KEY = "test-key";
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("network unreachable"));

    const result = await optimizeRoute({ lat: 24.7, lng: 46.6 }, [
      { id: "a", lat: 24.72, lng: 46.68 },
      { id: "b", lat: 24.73, lng: 46.69 },
    ]);
    expect(result.usedGoogleMaps).toBe(false);
    expect(result.orderedStopIds).toEqual(["a", "b"]);
  });
});
