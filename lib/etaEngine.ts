/**
 * lib/etaEngine.ts — Milestone F+G: Live ETA Engine
 *
 * Calculates live ETA for active trips using the Google Routes API.
 * Uses the same server-side API pattern as /api/trips/[id]/demo-route.
 *
 * DESIGN RULES:
 * - Never expose GOOGLE_ROUTES_API_KEY to the client.
 * - Prefer unavailable over fabricated ETAs.
 * - Cache results in trips table to avoid excessive API cost.
 * - Re-calculate only when: cache is old (> ETA_CACHE_TTL_SECONDS) OR
 *   vehicle has moved significantly (> ETA_MOVEMENT_THRESHOLD_METERS).
 * - Baseline ETA is set ONCE at dispatch and never overwritten.
 * - Delay is derived: live ETA arrival − baseline ETA arrival.
 */

import { haversineMeters } from "@/lib/geofence";

// ── ETA Thresholds (centralized) ──────────────────────────────────────────────
export const ETA_CACHE_TTL_SECONDS        = 300;    // 5 min — re-calculate if older
export const ETA_MOVEMENT_THRESHOLD_METERS = 500;   // 500 m — re-calculate if vehicle moved this far
export const ETA_DELAY_AT_RISK_MINUTES    = 10;     // 10 min late → AT_RISK
export const ETA_DELAY_DELAYED_MINUTES    = 20;     // 20 min late → DELAYED

export type EtaStatus = "ON_TIME" | "AT_RISK" | "DELAYED";
export type EtaQuality = "LIVE" | "CACHED" | "UNAVAILABLE";

export interface EtaResult {
  available: true;
  quality: "LIVE" | "CACHED";
  tripId: string;
  distanceMeters: number;
  durationSeconds: number;
  estimatedArrivalAt: string;  // ISO 8601
  calculatedAt: string;        // ISO 8601
  baselineEtaAt: string | null;
  delayMinutes: number | null;
  etaStatus: EtaStatus | null; // null when no baseline exists
}

export interface EtaUnavailable {
  available: false;
  reason: "NO_GPS" | "NO_DESTINATION" | "ROUTES_API_UNAVAILABLE" | "ROUTES_API_KEY_MISSING" | "TRIP_NOT_ACTIVE";
  quality: "UNAVAILABLE";
  // Return cached values if available even when fresh calculation fails:
  lastKnownArrivalAt?: string;
  lastCalculatedAt?: string;
}

export type EtaResponse = EtaResult | EtaUnavailable;

/** Derive ETA status from delay versus baseline. */
export function deriveEtaStatus(delayMinutes: number): EtaStatus {
  if (delayMinutes >= ETA_DELAY_DELAYED_MINUTES) return "DELAYED";
  if (delayMinutes >= ETA_DELAY_AT_RISK_MINUTES) return "AT_RISK";
  return "ON_TIME";
}

/** Check whether a cached ETA needs recalculation. */
export function etaNeedsRefresh(params: {
  etaCalculatedAt: Date | null;
  lastPingAt: Date | null;
  currentLat: number | null;
  currentLng: number | null;
  prevLat?: number | null;
  prevLng?: number | null;
}): boolean {
  if (!params.etaCalculatedAt) return true;  // no cache yet

  const ageSecs = (Date.now() - params.etaCalculatedAt.getTime()) / 1000;
  if (ageSecs > ETA_CACHE_TTL_SECONDS) return true;  // cache expired

  // Check movement:
  if (params.currentLat != null && params.currentLng != null &&
      params.prevLat != null && params.prevLng != null) {
    const moved = haversineMeters(
      params.prevLat, params.prevLng, params.currentLat, params.currentLng
    );
    if (moved > ETA_MOVEMENT_THRESHOLD_METERS) return true;
  }

  return false;
}

/** Call Google Routes API for a trip. Server-side only — never called from browser. */
export async function calculateRouteEta(params: {
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
}): Promise<{ distanceMeters: number; durationSeconds: number } | null> {
  const apiKey = process.env.GOOGLE_ROUTES_API_KEY;
  if (!apiKey) {
    console.error(JSON.stringify({
      level: "error", event: "eta.routes_api_key_missing",
      message: "GOOGLE_ROUTES_API_KEY not set — ETA unavailable",
    }));
    return null;
  }

  const body = {
    origin:      { location: { latLng: { latitude: params.originLat,  longitude: params.originLng } } },
    destination: { location: { latLng: { latitude: params.destLat,    longitude: params.destLng  } } },
    travelMode: "DRIVE",
    computeAlternativeRoutes: false,
    routingPreference: "TRAFFIC_AWARE_OPTIMAL",  // use live traffic for ETA accuracy
  };

  const res = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "routes.distanceMeters,routes.duration",  // minimal payload
    },
    body: JSON.stringify(body),
  }).catch(() => null);

  if (!res?.ok) {
    console.error(JSON.stringify({
      level: "error", event: "eta.routes_api_error",
      status: res?.status,
    }));
    return null;
  }

  const data = await res.json().catch(() => null);
  const route = data?.routes?.[0];
  if (!route?.distanceMeters || !route?.duration) return null;

  // Google Routes duration is in "Xs" format (e.g. "1234s"):
  const durationSecs = typeof route.duration === "string"
    ? parseInt(route.duration.replace("s", ""), 10)
    : route.duration;

  return { distanceMeters: route.distanceMeters, durationSeconds: durationSecs };
}
