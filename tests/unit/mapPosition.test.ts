import { describe, it, expect } from "vitest";
import { resolveTripMapPosition } from "@/lib/mapPosition";

// This is the exact logic behind the "View on map" button / "No
// coordinates available" warning added to the Live Dispatch Map, and the
// marker-placement fallback in components/LiveMap.tsx — both now share
// this one function so they can never disagree about whether a given
// trip is locatable, or about whether a shown position is a real live
// GPS ping vs. a fallback (Task N.1: `isLive` added for exactly this).
describe("resolveTripMapPosition (Live Dispatch Map marker fallback)", () => {
  it("prefers the live GPS position when both current and fallback coordinates exist, and marks it isLive", () => {
    const result = resolveTripMapPosition(24.71, 46.67, 24.80, 46.60);
    expect(result).toEqual({ lat: 24.71, lng: 46.67, isLive: true });
  });

  it("falls back to the first stop's location when no GPS ping has landed yet, and marks it NOT isLive", () => {
    const result = resolveTripMapPosition(null, null, 24.80, 46.60);
    expect(result).toEqual({ lat: 24.80, lng: 46.60, isLive: false });
  });

  it("falls back correctly when current coordinates are undefined rather than null", () => {
    const result = resolveTripMapPosition(undefined, undefined, 24.80, 46.60);
    expect(result).toEqual({ lat: 24.80, lng: 46.60, isLive: false });
  });

  it("returns null when neither current nor fallback coordinates exist — genuinely no coordinates", () => {
    expect(resolveTripMapPosition(null, null, null, null)).toBeNull();
    expect(resolveTripMapPosition(undefined, undefined, undefined, undefined)).toBeNull();
  });

  it("returns null when only one of lat/lng is available (a malformed partial position), never a half-formed result", () => {
    expect(resolveTripMapPosition(24.71, null, null, null)).toBeNull();
    expect(resolveTripMapPosition(null, 46.67, null, null)).toBeNull();
  });

  it("treats a real 0,0 coordinate as valid rather than falsy (0 is a legitimate latitude/longitude), and correctly marks it live", () => {
    const result = resolveTripMapPosition(0, 0, 24.8, 46.6);
    expect(result).toEqual({ lat: 0, lng: 0, isLive: true });
  });

  it("a malformed partial CURRENT position (only one of lat/lng set) falls back cleanly to the fallback position instead of a half-formed live result", () => {
    const result = resolveTripMapPosition(24.71, null, 24.80, 46.60);
    expect(result).toEqual({ lat: 24.80, lng: 46.60, isLive: false });
  });
});
