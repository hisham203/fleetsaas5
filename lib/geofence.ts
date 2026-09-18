/**
 * P2-01 Workstream D: Geofence Awareness
 *
 * Haversine distance between two GPS coordinates (metres).
 * Used to detect vehicle arrival at loading points and customer sites.
 * Does NOT automatically trigger lifecycle changes — generates operational
 * suggestions/events that the driver confirms.
 */
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000; // Earth radius in metres
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export type GeofenceCheckResult =
  | { inside: true; distanceMeters: number }
  | { inside: false; distanceMeters: number };

export function checkGeofence(
  vehicleLat: number, vehicleLng: number,
  targetLat: number, targetLng: number,
  radiusMeters: number
): GeofenceCheckResult {
  const distanceMeters = haversineMeters(vehicleLat, vehicleLng, targetLat, targetLng);
  return { inside: distanceMeters <= radiusMeters, distanceMeters };
}
