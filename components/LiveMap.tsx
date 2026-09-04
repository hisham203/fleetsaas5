"use client";

import { useEffect, useRef, useState } from "react";
import { resolveTripMapPosition } from "@/lib/mapPosition";

const DEFAULT_CENTER = { lat: 24.7136, lng: 46.6753 }; // Riyadh
const DEFAULT_ZOOM = 11;

type TrackedTrip = {
  id: string;
  tripNumber: string;
  currentLat: number | null;
  currentLng: number | null;
  // First stop's location — used as a marker position only when no GPS
  // ping has landed yet (e.g. a trip dispatched seconds ago). Without
  // this fallback, a just-dispatched trip has null currentLat/currentLng
  // and its marker silently never appears, even though it's a real
  // active trip. This never changes WHICH trips are shown — that's still
  // decided entirely by the caller (app/dispatch/page.tsx) — it only
  // affects whether a shown trip's marker can be placed somewhere.
  //
  // Task N.1 audit finding: this fallback position was previously
  // rendered identically to a real GPS ping, with nothing distinguishing
  // "this is the vehicle, live" from "this is where it's headed, no GPS
  // yet" — resolveTripMapPosition (lib/mapPosition.ts) now reports which
  // one it is via `isLive`, and the marker's label/title below reflects
  // it honestly instead of implying a live position that isn't real yet.
  fallbackLat: number | null;
  fallbackLng: number | null;
  // Neutral "destination" wording throughout (not "customer site"),
  // per this task's own multi-stop-future-readiness guidance — this
  // pilot is one trip/one stop today, but nothing here should need to
  // change if that ever isn't true.
  destinationLabel?: string | null;
  loadingPointLabel?: string | null;
  vehicle: { plateNumber: string };
  driver: { user: { name: string } };
};

// BR-12 Live Location Tracking. Loads the Google Maps JS SDK from a script
// tag (no npm package needed) using NEXT_PUBLIC_GOOGLE_MAPS_API_KEY. If that
// env var isn't set, this renders a plain placeholder instead of a broken
// map — route creation/dispatch/delivery all work fine without it, this is
// purely a visualization layer on top.
//
// `focusTripId` + `focusToken`: when the caller wants to focus a trip (e.g.
// a "View on map" button elsewhere on the page), it sets focusTripId AND
// increments focusToken. The focus effect below depends ONLY on
// `focusToken`, deliberately not on `trips` — trips refreshes periodically
// (a normal data poll), and if the effect depended on that array too, it
// would re-pan/re-zoom/re-bounce on every single refresh, which is exactly
// the "sticky, can't zoom out" bug this was built to fix. A poll updating
// marker positions (the separate effect above) never re-triggers a focus;
// only an explicit new focusToken does — so once the user pans or zooms
// away themselves, the map stays put until they click "View on map" again.
// `resetToken`: increments to recenter the map on its default view (e.g. a
// "Reset map" button) without touching any trip data.
export default function LiveMap({
  trips,
  focusTripId,
  focusToken,
  resetToken,
}: {
  trips: TrackedTrip[];
  focusTripId?: string | null;
  focusToken?: number;
  resetToken?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<Record<string, google.maps.Marker>>({});
  const [ready, setReady] = useState(false);
  // Task N.1 audit finding: neither a script load failure (network
  // issue, blocked resource, invalid key causing the request itself to
  // fail) nor an exception thrown while constructing the Map object was
  // previously handled at all — `ready` would simply stay false forever,
  // leaving the container as a blank, unexplained 64px box with no
  // indication anything had gone wrong. Both now set this instead, so
  // there's always a clear message rather than empty white space.
  const [loadFailed, setLoadFailed] = useState(false);
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  useEffect(() => {
    if (!apiKey) return;
    if ((window as any).google?.maps) {
      setReady(true);
      return;
    }
    const existing = document.getElementById("google-maps-script");
    if (existing) {
      existing.addEventListener("load", () => setReady(true));
      existing.addEventListener("error", () => setLoadFailed(true));
      return;
    }
    const script = document.createElement("script");
    script.id = "google-maps-script";
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}`;
    script.async = true;
    script.onload = () => setReady(true);
    script.onerror = () => setLoadFailed(true);
    document.head.appendChild(script);
    // A silent hang (script never fires load or error at all, e.g. a
    // request that never completes) is functionally the same "blank
    // box forever" problem — this catches that case too, without
    // touching anything if loading genuinely succeeds first.
    const timeout = setTimeout(() => {
      if (!(window as any).google?.maps) setLoadFailed(true);
    }, 10000);
    return () => clearTimeout(timeout);
  }, [apiKey]);

  useEffect(() => {
    if (!ready || !containerRef.current) return;
    if (!mapRef.current) {
      try {
        mapRef.current = new google.maps.Map(containerRef.current, {
          center: DEFAULT_CENTER,
          zoom: DEFAULT_ZOOM,
          disableDefaultUI: true,
          zoomControl: true,
        });
      } catch {
        setLoadFailed(true);
        return;
      }
    }

    const activeIds = new Set(trips.map((t) => t.id));

    // Remove markers for trips no longer active.
    Object.keys(markersRef.current).forEach((id) => {
      if (!activeIds.has(id)) {
        markersRef.current[id].setMap(null);
        delete markersRef.current[id];
      }
    });

    trips.forEach((trip) => {
      // Prefer a live GPS ping; fall back to the first stop's location so a
      // trip that was just dispatched (no ping yet) still shows up
      // somewhere sensible rather than not at all.
      const position = resolveTripMapPosition(trip.currentLat, trip.currentLng, trip.fallbackLat, trip.fallbackLng);
      if (!position) return;

      // Task N.1: an honest label either way — "Live" only when this is
      // a genuine GPS ping; otherwise explicit that this is the
      // destination, not a confirmed vehicle position, so a dispatcher
      // never mistakes "just dispatched, no GPS yet" for "vehicle is
      // sitting at the delivery site." Loading point is included as
      // context in the same marker's title (an info-window-style
      // addition), not as a second marker — keeps this a targeted
      // clarity fix rather than doubling the marker count per trip.
      const destinationPart = trip.destinationLabel ? ` → ${trip.destinationLabel}` : "";
      const loadingPointPart = trip.loadingPointLabel ? ` (from ${trip.loadingPointLabel})` : "";
      const title = position.isLive
        ? `${trip.tripNumber}: ${trip.vehicle.plateNumber} — ${trip.driver.user.name} (live)${destinationPart}${loadingPointPart}`
        : `${trip.tripNumber}: ${trip.vehicle.plateNumber} — ${trip.driver.user.name} (no GPS yet — showing destination${trip.destinationLabel ? `: ${trip.destinationLabel}` : ""})${loadingPointPart}`;
      const labelText = position.isLive ? trip.vehicle.plateNumber.slice(-4) : "?";

      if (markersRef.current[trip.id]) {
        markersRef.current[trip.id].setPosition(position);
        markersRef.current[trip.id].setTitle(title);
        markersRef.current[trip.id].setLabel({ text: labelText, color: "#fff", fontSize: "10px" });
      } else {
        markersRef.current[trip.id] = new google.maps.Marker({
          position,
          map: mapRef.current!,
          title,
          label: { text: labelText, color: "#fff", fontSize: "10px" },
        });
      }
    });
  }, [ready, trips]);

  // Focus behavior — fires exactly once per focusToken change (i.e. once
  // per "View on map" click), never as a side effect of trips refreshing.
  // A purely visual camera move + a brief bounce on the existing marker;
  // never adds, removes, or moves data.
  //
  // focusTripId is deliberately not in the dependency array: the button
  // that triggers this always sets focusTripId and bumps focusToken in the
  // same click handler, so by the time this effect runs, focusTripId is
  // already current for this render — the point of keying off focusToken
  // alone is specifically to NOT re-run this effect for any other reason
  // (e.g. focusTripId happening to be read again on an unrelated render).
  useEffect(() => {
    if (!focusToken || !focusTripId || !mapRef.current) return;
    const marker = markersRef.current[focusTripId];
    if (!marker) return;
    const position = marker.getPosition();
    if (!position) return;

    mapRef.current.panTo(position);
    mapRef.current.setZoom(15);
    marker.setAnimation(google.maps.Animation.BOUNCE);
    const stop = setTimeout(() => marker.setAnimation(null), 1400);
    return () => clearTimeout(stop);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see comment above: focusTripId is read fresh but must not itself retrigger this effect
  }, [focusToken]);

  // Reset behavior — fires exactly once per resetToken change (a "Reset
  // map" button), recentering on the default view. Independent of focus
  // and of trips data for the same reason as above.
  useEffect(() => {
    if (!resetToken || !mapRef.current) return;
    mapRef.current.panTo(DEFAULT_CENTER);
    mapRef.current.setZoom(DEFAULT_ZOOM);
  }, [resetToken]);

  if (!apiKey) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center justify-center h-64">
        <p className="text-steel text-sm text-center max-w-xs">
          Set <code className="bg-paper px-1 rounded">NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code> in
          <code className="bg-paper px-1 rounded">.env.local</code> to show live vehicle positions on a map here.
        </p>
      </div>
    );
  }

  if (loadFailed) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center justify-center h-64">
        <p className="text-steel text-sm text-center max-w-xs">
          The live map couldn&apos;t load right now. Dispatching, loading confirmation, and trip
          assignment all still work normally without it — try refreshing the page to bring the map back.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div ref={containerRef} className="w-full h-64" />
    </div>
  );
}
