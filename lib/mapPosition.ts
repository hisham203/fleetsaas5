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
// Task N.1 audit finding: this previously returned only {lat, lng}, with
// no way for either caller to tell whether the position came from a real
// GPS ping or the first-stop fallback — meaning a just-dispatched trip
// with no GPS yet was rendered on the map identically to one genuinely
// being tracked live, labeled the same way, with nothing distinguishing
// "this is the vehicle" from "this is where it's headed, not confirmed
// live." Now returns `isLive` alongside the coordinates so both
// LiveMap.tsx (marker labeling) and app/dispatch/page.tsx (the "View on
// map" button's own text) can be honest about which one they're showing.
export function resolveTripMapPosition(
  currentLat: number | null | undefined,
  currentLng: number | null | undefined,
  fallbackLat: number | null | undefined,
  fallbackLng: number | null | undefined
): { lat: number; lng: number; isLive: boolean } | null {
  if (currentLat != null && currentLng != null) {
    return { lat: currentLat, lng: currentLng, isLive: true };
  }
  if (fallbackLat != null && fallbackLng != null) {
    return { lat: fallbackLat, lng: fallbackLng, isLive: false };
  }
  return null;
}
