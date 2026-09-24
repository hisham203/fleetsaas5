/**
 * P2-01 Package A — Route Geometry for GPS Demo Mode.
 *
 * Pure functions — no Google Maps dependency, fully unit-testable.
 *
 * Provides:
 *   decodePolyline()      — Google Encoded Polyline → lat/lng array
 *   buildRouteGeometry()  — path → RouteGeometry with cumulative distances
 *   getRoutePosition()    — normalized t (0..1) → {lat, lng} on route
 */

export type LatLng = { lat: number; lng: number };

export type RouteGeometry = {
  path: LatLng[];
  segmentDistances: number[];   // metres per segment
  cumulativeDistances: number[]; // metres from origin to end of each segment
  totalDistanceMeters: number;
};

/** Decode a Google Encoded Polyline string to lat/lng array. */
export function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    let shift = 0; let result = 0; let byte: number;
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);
    shift = 0; result = 0;
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);
    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}

/** Haversine distance in metres between two lat/lng points. */
export function haversineM(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const φ1 = (a.lat * Math.PI) / 180, φ2 = (b.lat * Math.PI) / 180;
  const Δφ = ((b.lat - a.lat) * Math.PI) / 180;
  const Δλ = ((b.lng - a.lng) * Math.PI) / 180;
  const x = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

/** Build a RouteGeometry from a decoded lat/lng path. */
export function buildRouteGeometry(path: LatLng[]): RouteGeometry {
  if (path.length < 2) throw new Error("Route path must have at least 2 points");
  const segmentDistances: number[] = [];
  const cumulativeDistances: number[] = [];
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const d = haversineM(path[i], path[i + 1]);
    segmentDistances.push(d);
    total += d;
    cumulativeDistances.push(total);
  }
  return { path, segmentDistances, cumulativeDistances, totalDistanceMeters: total };
}

/**
 * Return the lat/lng position at normalized progress t (0..1) along the route.
 * t=0 → first point, t=1 → last point.
 * Interpolates within the segment that contains the distance at t.
 */
export function getRoutePosition(geometry: RouteGeometry, t: number): LatLng {
  const { path, cumulativeDistances, totalDistanceMeters } = geometry;
  const clamped = Math.max(0, Math.min(1, t));
  if (clamped <= 0) return path[0];
  if (clamped >= 1) return path[path.length - 1];

  const targetDist = clamped * totalDistanceMeters;
  // Find the segment that contains targetDist:
  let segIdx = cumulativeDistances.findIndex(d => d >= targetDist);
  if (segIdx < 0) segIdx = cumulativeDistances.length - 1;

  const segEnd   = cumulativeDistances[segIdx];
  const segStart = segIdx === 0 ? 0 : cumulativeDistances[segIdx - 1];
  const segLen   = segEnd - segStart;
  const frac     = segLen > 0 ? (targetDist - segStart) / segLen : 0;

  const a = path[segIdx];
  const b = path[segIdx + 1];
  return {
    lat: a.lat + (b.lat - a.lat) * frac,
    lng: a.lng + (b.lng - a.lng) * frac,
  };
}
