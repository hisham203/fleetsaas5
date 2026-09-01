"use client";

import { useEffect, useRef, useState } from "react";

type TrackedTrip = {
  id: string;
  tripNumber: string;
  currentLat: number | null;
  currentLng: number | null;
  vehicle: { plateNumber: string };
  driver: { user: { name: string } };
};

// BR-12 Live Location Tracking. Loads the Google Maps JS SDK from a script
// tag (no npm package needed) using NEXT_PUBLIC_GOOGLE_MAPS_API_KEY. If that
// env var isn't set, this renders a plain placeholder instead of a broken
// map — route creation/dispatch/delivery all work fine without it, this is
// purely a visualization layer on top.
export default function LiveMap({ trips }: { trips: TrackedTrip[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<Record<string, google.maps.Marker>>({});
  const [ready, setReady] = useState(false);
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
      return;
    }
    const script = document.createElement("script");
    script.id = "google-maps-script";
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}`;
    script.async = true;
    script.onload = () => setReady(true);
    document.head.appendChild(script);
  }, [apiKey]);

  useEffect(() => {
    if (!ready || !containerRef.current) return;
    if (!mapRef.current) {
      mapRef.current = new google.maps.Map(containerRef.current, {
        center: { lat: 24.7136, lng: 46.6753 }, // Riyadh
        zoom: 11,
        disableDefaultUI: true,
        zoomControl: true,
      });
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
      if (trip.currentLat == null || trip.currentLng == null) return;
      const position = { lat: trip.currentLat, lng: trip.currentLng };
      const label = `${trip.vehicle.plateNumber} — ${trip.driver.user.name}`;

      if (markersRef.current[trip.id]) {
        markersRef.current[trip.id].setPosition(position);
      } else {
        markersRef.current[trip.id] = new google.maps.Marker({
          position,
          map: mapRef.current!,
          title: `${trip.tripNumber}: ${label}`,
          label: { text: trip.vehicle.plateNumber.slice(-4), color: "#fff", fontSize: "10px" },
        });
      }
    });
  }, [ready, trips]);

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

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div ref={containerRef} className="w-full h-64" />
    </div>
  );
}
