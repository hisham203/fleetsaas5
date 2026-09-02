// BR-12 Live Dispatch Map: a trip's marker position prefers its live GPS
// ping, falling back to its first stop's location when no ping has landed
// yet (e.g. seconds after dispatch, before the driver app's simulated GPS
// loop has run once) — without this, a just-dispatched trip has null
// current coordinates and its marker silently never appears at all, even
// though it's a genuinely active trip. Shared by components/LiveMap.tsx
// (to place the marker) and app/dispatch/page.tsx (to decide whether to
// show a "View on map" button or a "No coordinates available" warning) so
// both agree on exactly the same definition of "this trip is locatable".
//
// Deliberately its own file with zero imports: lib/helpers.ts pulls in
// Node's `crypto` module (for genId's randomUUID), which is fine for
// server code but bloats the client bundle with a crypto polyfill the
// moment a "use client" component imports anything from that file at
// all — confirmed by the dispatch page's bundle jumping from ~5KB to
// ~135KB when this function briefly lived there instead.
export function resolveTripMapPosition(
  currentLat: number | null | undefined,
  currentLng: number | null | undefined,
  fallbackLat: number | null | undefined,
  fallbackLng: number | null | undefined
): { lat: number; lng: number } | null {
  const lat = currentLat ?? fallbackLat;
  const lng = currentLng ?? fallbackLng;
  if (lat == null || lng == null) return null;
  return { lat, lng };
}
