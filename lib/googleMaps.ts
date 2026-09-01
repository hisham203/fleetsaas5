// BR-06: Route Optimization via Google Maps Directions API.
// Models each trip as a round trip from the tenant's depot, visiting every
// stop and returning to the depot, using the Directions API's waypoint
// optimization (`optimize:true`). If GOOGLE_MAPS_API_KEY isn't set, or the
// API call fails for any reason (bad key, quota, network), this falls back
// to the original stop order rather than failing trip creation — route
// optimization is a nice-to-have, not something that should block dispatch.

type LatLng = { lat: number; lng: number };
type Stop = { id: string; lat: number; lng: number };

export async function optimizeRoute(
  depot: LatLng,
  stops: Stop[]
): Promise<{ orderedStopIds: string[]; estimatedDurationMinutes: number | null; usedGoogleMaps: boolean }> {
  const fallback = { orderedStopIds: stops.map((s) => s.id), estimatedDurationMinutes: null, usedGoogleMaps: false };

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey || stops.length === 0) return fallback;

  // A single stop needs no optimization — skip the API call entirely.
  if (stops.length === 1) {
    return { orderedStopIds: [stops[0].id], estimatedDurationMinutes: null, usedGoogleMaps: false };
  }

  try {
    const origin = `${depot.lat},${depot.lng}`;
    const destination = origin; // round trip: depot -> stops -> depot
    const waypoints = "optimize:true|" + stops.map((s) => `${s.lat},${s.lng}`).join("|");

    const url =
      `https://maps.googleapis.com/maps/api/directions/json` +
      `?origin=${encodeURIComponent(origin)}` +
      `&destination=${encodeURIComponent(destination)}` +
      `&waypoints=${encodeURIComponent(waypoints)}` +
      `&key=${apiKey}`;

    const res = await fetch(url);
    if (!res.ok) return fallback;
    const data = await res.json();

    if (data.status !== "OK" || !data.routes?.[0]) return fallback;

    const waypointOrder: number[] = data.routes[0].waypoint_order ?? [];
    if (waypointOrder.length !== stops.length) return fallback;

    const orderedStopIds = waypointOrder.map((i) => stops[i].id);
    const totalSeconds = (data.routes[0].legs ?? []).reduce(
      (sum: number, leg: any) => sum + (leg.duration?.value ?? 0),
      0
    );

    return {
      orderedStopIds,
      estimatedDurationMinutes: totalSeconds > 0 ? Math.round(totalSeconds / 60) : null,
      usedGoogleMaps: true,
    };
  } catch {
    return fallback;
  }
}
