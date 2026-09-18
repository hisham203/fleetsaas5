"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRequireSession } from "@/lib/useSession";
import AdminShell from "@/components/AdminShell";

// ── Types ──────────────────────────────────────────────────────────────────
type GpsStatus = "LIVE" | "STALE" | "OFFLINE";

type VehiclePosition = {
  vehicleId: string; plateNumber: string; capacityLiters: number | null;
  vehicleStatus: string; lat: number | null; lng: number | null;
  lastPingAt: string | null; gpsStatus: GpsStatus;
  tripId: string | null; tripNumber: string | null; tripStatus: string | null;
  loadingConfirmed: boolean | null; driverId: string | null; driverName: string | null;
  customerId: string | null; customerName: string | null; siteLabel: string | null;
  orderId: string | null; orderNumber: string | null; requiredTankerCapacityLtr: number | null;
  loadingPointLat: number | null; loadingPointLng: number | null;
  loadingPointName: string | null; loadingPointRadius: number;
  customerSiteLat: number | null; customerSiteLng: number | null;
  customerSiteLabel: string | null; customerSiteRadius: number;
};

type OpEvent = {
  id: string; eventType: string; tripId: string | null; vehicleId: string | null;
  message: string; severity: "INFO" | "WARNING" | "CRITICAL";
  read: boolean; createdAt: string;
};

// ── Map helpers ────────────────────────────────────────────────────────────
const DEFAULT_CENTER = { lat: 24.7136, lng: 46.6753 };
const DEFAULT_ZOOM = 11;

const STATUS_COLORS: Record<string, string> = {
  AVAILABLE: "#10b981", ASSIGNED: "#60a5fa", EN_ROUTE_LOADING: "#f59e0b",
  EN_ROUTE_CUSTOMER: "#0ea5e9", COMPLETED: "#94a3b8", EXCEPTION: "#ef4444", OFFLINE: "#cbd5e1",
};

const STATUS_LABEL: Record<string, string> = {
  AVAILABLE: "Available", ASSIGNED: "Assigned",
  EN_ROUTE_LOADING: "En Route → Loading", EN_ROUTE_CUSTOMER: "En Route → Customer",
  COMPLETED: "Completed", EXCEPTION: "Exception", OFFLINE: "Offline",
};

const GPS_BADGE: Record<GpsStatus, { cls: string; label: string }> = {
  LIVE:    { cls: "bg-emerald-100 text-emerald-700", label: "LIVE" },
  STALE:   { cls: "bg-amber-100 text-amber-700",    label: "STALE" },
  OFFLINE: { cls: "bg-slate-100 text-slate-500",    label: "OFFLINE" },
};

const SEV_BADGE: Record<string, string> = {
  INFO: "bg-blue-50 text-blue-700 border-blue-200",
  WARNING: "bg-amber-50 text-amber-800 border-amber-200",
  CRITICAL: "bg-red-50 text-red-700 border-red-200",
};

const EVT_ICON: Record<string, string> = {
  GPS_STALE: "📡", TRIP_LATE: "⏰", GEOFENCE_LOADING_ARRIVAL: "🏭",
  GEOFENCE_CUSTOMER_ARRIVAL: "📍", LOADING_OVERRUN: "⚠️",
  DELIVERY_FAILED: "❌", POD_PENDING: "📋", EXCEPTION_OPEN: "🚨", DRIVER_NOT_STARTED: "🔔",
};

function deriveMapStatus(v: VehiclePosition): string {
  if (!v.tripId) return v.vehicleStatus === "AVAILABLE" ? "AVAILABLE" : "OFFLINE";
  if (v.tripStatus === "COMPLETED") return "COMPLETED";
  if (v.tripStatus === "PLANNED") return "ASSIGNED";
  return !v.loadingConfirmed ? "EN_ROUTE_LOADING" : "EN_ROUTE_CUSTOMER";
}

function elapsed(iso: string | null): string {
  if (!iso) return "—";
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "< 1 min ago";
  return m < 60 ? `${m} min ago` : `${Math.floor(m / 60)}h ${m % 60}m ago`;
}

// ── Control Tower Fleet Map (Google Maps) ─────────────────────────────────
function ControlTowerMap({ positions, selected, onSelect }: {
  positions: VehiclePosition[];
  selected: VehiclePosition | null;
  onSelect: (v: VehiclePosition) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<Map<string, google.maps.Marker>>(new Map());
  const circlesRef = useRef<google.maps.Circle[]>([]);
  const routeRef = useRef<google.maps.Polyline | null>(null);
  const destMarkersRef = useRef<google.maps.Marker[]>([]);
  const [mapReady, setMapReady] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  // Load Google Maps script:
  useEffect(() => {
    if (!apiKey) return;
    if ((window as any).google?.maps) { setMapReady(true); return; }
    const existing = document.getElementById("google-maps-script");
    if (existing) {
      existing.addEventListener("load", () => setMapReady(true));
      existing.addEventListener("error", () => setMapFailed(true));
      return;
    }
    const script = document.createElement("script");
    script.id = "google-maps-script";
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}`;
    script.async = true;
    script.onload = () => setMapReady(true);
    script.onerror = () => setMapFailed(true);
    document.head.appendChild(script);
    const t = setTimeout(() => { if (!(window as any).google?.maps) setMapFailed(true); }, 10000);
    return () => clearTimeout(t);
  }, [apiKey]);

  // Initialize map:
  useEffect(() => {
    if (!mapReady || !containerRef.current || mapRef.current) return;
    try {
      mapRef.current = new google.maps.Map(containerRef.current, {
        center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM,
        disableDefaultUI: true, zoomControl: true,
      });
    } catch { setMapFailed(true); }
  }, [mapReady]);

  // Update vehicle markers (on every poll, without reinitializing the map):
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const activeIds = new Set(positions.map(v => v.vehicleId));

    // Remove stale markers:
    markersRef.current.forEach((marker, id) => {
      if (!activeIds.has(id)) { marker.setMap(null); markersRef.current.delete(id); }
    });

    // Add / update vehicle markers:
    positions.forEach(v => {
      if (!v.lat || !v.lng) return;
      const mapStatus = deriveMapStatus(v);
      const color = STATUS_COLORS[mapStatus] ?? "#94a3b8";
      const gpsLabel = GPS_BADGE[v.gpsStatus].label;
      const isSelected = selected?.vehicleId === v.vehicleId;

      const title = [
        v.plateNumber,
        STATUS_LABEL[mapStatus] ?? mapStatus,
        `GPS: ${gpsLabel}`,
        v.driverName ? `Driver: ${v.driverName}` : "",
        v.customerName ? `Customer: ${v.customerName}` : "",
        v.tripNumber ? `Trip: ${v.tripNumber}` : "",
      ].filter(Boolean).join(" · ");

      if (markersRef.current.has(v.vehicleId)) {
        const m = markersRef.current.get(v.vehicleId)!;
        m.setPosition({ lat: v.lat, lng: v.lng });
        m.setTitle(title);
        m.setIcon({
          path: google.maps.SymbolPath.CIRCLE,
          fillColor: color, fillOpacity: 1,
          strokeColor: isSelected ? "#fff" : "#000",
          strokeWeight: isSelected ? 3 : 1,
          scale: isSelected ? 12 : 9,
        });
      } else {
        const marker = new google.maps.Marker({
          position: { lat: v.lat, lng: v.lng },
          map: mapRef.current!,
          title,
          label: { text: v.plateNumber.slice(-4), color: "#fff", fontSize: "9px", fontWeight: "bold" },
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            fillColor: color, fillOpacity: 1,
            strokeColor: "#000", strokeWeight: 1, scale: 9,
          },
        });
        marker.addListener("click", () => onSelect(v));
        markersRef.current.set(v.vehicleId, marker);
      }
    });
  }, [mapReady, positions, selected, onSelect]);

  // Show loading point, customer site, geofence circles, and route for selected vehicle:
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;

    // Clear previous destination markers and circles:
    destMarkersRef.current.forEach(m => m.setMap(null));
    destMarkersRef.current = [];
    circlesRef.current.forEach(c => c.setMap(null));
    circlesRef.current = [];
    if (routeRef.current) { routeRef.current.setMap(null); routeRef.current = null; }

    if (!selected) return;

    // Loading point marker:
    if (selected.loadingPointLat && selected.loadingPointLng) {
      const lp = new google.maps.Marker({
        position: { lat: selected.loadingPointLat, lng: selected.loadingPointLng },
        map: mapRef.current!, title: selected.loadingPointName ?? "Loading Point",
        label: { text: "L", color: "#fff", fontSize: "11px", fontWeight: "bold" },
        icon: { path: google.maps.SymbolPath.CIRCLE, fillColor: "#f59e0b", fillOpacity: 1, strokeColor: "#fff", strokeWeight: 2, scale: 10 },
        zIndex: 5,
      });
      destMarkersRef.current.push(lp);
      // Geofence circle for loading point:
      circlesRef.current.push(new google.maps.Circle({
        map: mapRef.current!, center: { lat: selected.loadingPointLat, lng: selected.loadingPointLng },
        radius: selected.loadingPointRadius,
        fillColor: "#f59e0b", fillOpacity: 0.12,
        strokeColor: "#f59e0b", strokeOpacity: 0.7, strokeWeight: 1.5,
      }));
    }

    // Customer site marker:
    if (selected.customerSiteLat && selected.customerSiteLng) {
      const cs = new google.maps.Marker({
        position: { lat: selected.customerSiteLat, lng: selected.customerSiteLng },
        map: mapRef.current!, title: selected.customerSiteLabel ?? "Customer Site",
        label: { text: "C", color: "#fff", fontSize: "11px", fontWeight: "bold" },
        icon: { path: google.maps.SymbolPath.CIRCLE, fillColor: "#8b5cf6", fillOpacity: 1, strokeColor: "#fff", strokeWeight: 2, scale: 10 },
        zIndex: 5,
      });
      destMarkersRef.current.push(cs);
      // Geofence circle for customer site:
      circlesRef.current.push(new google.maps.Circle({
        map: mapRef.current!, center: { lat: selected.customerSiteLat, lng: selected.customerSiteLng },
        radius: selected.customerSiteRadius,
        fillColor: "#8b5cf6", fillOpacity: 0.12,
        strokeColor: "#8b5cf6", strokeOpacity: 0.7, strokeWeight: 1.5,
      }));
    }

    // GPS route history polyline:
    if (selected.tripId) {
      fetch(`/api/trips/${selected.tripId}/gps-history`)
        .then(r => r.ok ? r.json() : { history: [] })
        .then(d => {
          const pts = (d.history ?? []).slice(-200); // bounded: last 200 points max
          if (pts.length < 2 || !mapRef.current) return;
          const path = pts.map((p: any) => ({ lat: p.lat, lng: p.lng }));
          routeRef.current = new google.maps.Polyline({
            path, map: mapRef.current,
            strokeColor: "#0ea5e9", strokeOpacity: 0.7, strokeWeight: 3,
            zIndex: 2,
          });
        })
        .catch(() => {});
    }

    // Pan map to show the selected vehicle:
    if (selected.lat && selected.lng) {
      mapRef.current.panTo({ lat: selected.lat, lng: selected.lng });
      mapRef.current.setZoom(14);
    }
  }, [mapReady, selected]);

  if (!apiKey) {
    return (
      <div className="flex-1 flex items-center justify-center bg-slate-50 rounded-xl border border-slate-200">
        <div className="text-center p-6">
          <p className="text-2xl mb-2">🗺</p>
          <p className="text-sm text-steel mb-1">Set <code className="bg-paper px-1 rounded">NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code></p>
          <p className="text-xs text-steel">Vehicle positions shown in the list panel →</p>
        </div>
      </div>
    );
  }

  if (mapFailed) {
    return (
      <div className="flex-1 flex items-center justify-center bg-slate-50 rounded-xl border border-slate-200">
        <p className="text-sm text-steel text-center p-4">Map unavailable — check API key or network. All operational data remains available in the list panel.</p>
      </div>
    );
  }

  return <div ref={containerRef} className="flex-1 min-h-[400px] rounded-xl border border-slate-200 overflow-hidden" />;
}

// ── Main Component ─────────────────────────────────────────────────────────
export default function ControlTowerPage() {
  useRequireSession(["ADMIN", "DISPATCHER"]);

  const [positions, setPositions] = useState<VehiclePosition[]>([]);
  // GPS Demo Mode state:
  const [demoEnabled] = useState(() => process.env.NEXT_PUBLIC_GPS_DEMO_ENABLED === "true");
  const [demoTripId, setDemoTripId] = useState("");
  const [demoStatus, setDemoStatus] = useState<"idle" | "running" | "paused" | "completed">("idle");
  const [demoRoute, setDemoRoute] = useState<{ loadingPoint: any; customerSite: any } | null>(null);
  const [demoProgress, setDemoProgress] = useState(0); // 0.0–1.0 displayed in UI

  // Three-clock architecture (Defect 1 fix):
  //   A. visualTimerRef  — 300ms: smooth UI interpolation between route positions
  //   B. routeTimerRef   — 1000ms: route progress clock (1/90 per tick at 1× speed)
  //   C. serverTimerRef  — 6000ms: server GPS persistence (stays within 4s rate limit)
  const visualTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const routeTimerRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const serverTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const routeTRef      = useRef<number>(0); // actual route position, ref to avoid stale closures
  const visualTRef     = useRef<number>(0); // displayed position for smooth animation
  // 1× speed = 90 seconds total → 90 ticks at 1000ms, each advancing by 1/90 ≈ 0.0111
  const DEMO_DURATION_1X_SEC = 90;
  const SERVER_PERSIST_MS    = 6000; // one persisted GPS point every 6 seconds
  const VISUAL_INTERVAL_MS   = 300;  // smooth animation update
  const [events, setEvents] = useState<OpEvent[]>([]);
  const [unread, setUnread] = useState(0);
  const [selected, setSelected] = useState<VehiclePosition | null>(null);
  const [activeTab, setActiveTab] = useState<"map" | "events" | "history" | "demo">("map");
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchPositions = useCallback(async () => {
    try {
      const res = await fetch("/api/fleet/positions");
      if (!res.ok) return;
      const data = await res.json();
      setPositions(data.positions ?? []);
      setFetchedAt(data.fetchedAt);
      setLoading(false);
    } catch {}
  }, []);

  const fetchEvents = useCallback(async () => {
    try {
      const res = await fetch("/api/operational-events?unread=true");
      if (!res.ok) return;
      const data = await res.json();
      setEvents(data.events ?? []);
      setUnread(data.unreadCount ?? 0);
    } catch {}
  }, []);

  const markAllRead = async () => {
    await fetch("/api/operational-events", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
    fetchEvents();
  };

  useEffect(() => {
    fetchPositions(); fetchEvents();
    pollRef.current = setInterval(() => { fetchPositions(); fetchEvents(); }, 15_000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchPositions, fetchEvents]);

  // Clean up all three demo timers on unmount:
  useEffect(() => {
    return () => {
      if (visualTimerRef.current) { clearInterval(visualTimerRef.current); visualTimerRef.current = null; }
      if (routeTimerRef.current)  { clearInterval(routeTimerRef.current);  routeTimerRef.current  = null; }
      if (serverTimerRef.current) { clearInterval(serverTimerRef.current); serverTimerRef.current = null; }
    };
  }, []);

  // Sync selected vehicle with latest positions (update lat/lng on each poll):
  useEffect(() => {
    if (!selected) return;
    const updated = positions.find(p => p.vehicleId === selected.vehicleId);
    if (updated) setSelected(updated);
  }, [positions]);

  // Demo helpers — three-clock architecture:
  function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }

  function clearAllDemoTimers() {
    if (visualTimerRef.current) { clearInterval(visualTimerRef.current); visualTimerRef.current = null; }
    if (routeTimerRef.current)  { clearInterval(routeTimerRef.current);  routeTimerRef.current  = null; }
    if (serverTimerRef.current) { clearInterval(serverTimerRef.current); serverTimerRef.current = null; }
  }

  async function startDemo(speedMultiplier = 1) {
    if (!demoTripId || demoStatus === "running") return;
    // Prevent duplicate loops — clear any lingering timers first:
    clearAllDemoTimers();

    // ── Step 1: Fetch route coordinates ─────────────────────────────────────────
    const res = await fetch(`/api/trips/${demoTripId}/demo-gps`).catch(() => null);
    if (!res?.ok) { alert("Demo GPS not available for this trip — ensure GPS_DEMO_ENABLED=true and ADMIN role"); return; }
    const data = await res.json();
    if (!data.loadingPoint?.lat || !data.customerSite?.lat) {
      alert("Trip missing loading point or customer site coordinates — cannot start demo"); return;
    }
    const route = { loadingPoint: data.loadingPoint, customerSite: data.customerSite };

    // ── Step 2: Persist exact Loading Point as initial GPS position ──────────────
    // This is done BEFORE starting any movement clocks so that:
    //   (a) the vehicle starts visibly AT the Loading Point
    //   (b) processGpsGeofence() can fire GEOFENCE_LOADING_ARRIVAL on this ping
    // If this fails, we do NOT start the demo — no false DEMO GPS LIVE state.
    const initRes = await fetch(`/api/trips/${demoTripId}/demo-gps`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat: route.loadingPoint.lat, lng: route.loadingPoint.lng, speed: 0, accuracy: 5 }),
    }).catch(() => null);
    if (!initRes?.ok) {
      alert("Demo initialization failed — could not persist initial Loading Point GPS. Check server logs.");
      return; // DO NOT start timers or show DEMO GPS LIVE
    }

    // ── Step 3: Initialize state — timers start only after successful init ───────
    setDemoRoute(route);
    routeTRef.current  = 0;
    visualTRef.current = 0;
    setDemoProgress(0);
    setDemoStatus("running");

    // ── Clock A: Visual animation (300ms) ──────────────────────────────────────
    // Interpolates visualT toward routeT for smooth marker movement.
    // Does NOT advance the route — purely cosmetic. No server calls.
    visualTimerRef.current = setInterval(() => {
      const target = routeTRef.current;
      visualTRef.current += (target - visualTRef.current) * 0.15;
      setDemoProgress(visualTRef.current);
    }, VISUAL_INTERVAL_MS);

    // ── Clock B: Route progress (1000ms) ───────────────────────────────────────
    // Advances routeT by (speedMultiplier / DEMO_DURATION_1X_SEC) per second.
    // At 1×: 90 ticks. At 2×: 45 ticks. At 5×: 18 ticks. At 10×: 9 ticks.
    const tickSize = speedMultiplier / DEMO_DURATION_1X_SEC;
    routeTimerRef.current = setInterval(() => {
      const next = Math.min(routeTRef.current + tickSize, 1.0);
      routeTRef.current = next;
      if (next >= 1.0) {
        // Route complete:
        // 1. Stop Clock C first — prevents a concurrent intermediate ping from
        //    firing after clearAllDemoTimers but before the final fetch completes.
        if (serverTimerRef.current) { clearInterval(serverTimerRef.current); serverTimerRef.current = null; }
        // 2. Stop visual and route clocks:
        if (visualTimerRef.current) { clearInterval(visualTimerRef.current); visualTimerRef.current = null; }
        if (routeTimerRef.current)  { clearInterval(routeTimerRef.current);  routeTimerRef.current  = null; }
        visualTRef.current = 1.0;
        setDemoProgress(1.0);
        setDemoStatus("completed");
        // 3. Persist final exact Customer Site coordinate through the normal pipeline.
        //    Clock C is already stopped, so no rate-limit window conflict.
        //    speed=0 signals vehicle has arrived and stopped.
        fetch(`/api/trips/${demoTripId}/demo-gps`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lat: route.customerSite.lat, lng: route.customerSite.lng, speed: 0, accuracy: 5 }),
        }).catch(() => {});
      }
    }, 1000);

    // ── Clock C: Server GPS persistence (6000ms) ───────────────────────────────
    // Intermediate pings between Loading Point and Customer Site.
    // Starts at t=0 (first tick at 6s = ~6.7% of route).
    // Stops at t >= 0.95 to leave a clean window before Clock B sends the
    // final Customer Site ping, preventing any near-final duplicate.
    // At 1×: (90s × 0.95) / 6s ≈ 14 intermediate pings + 1 initial + 1 final = ~16 total.
    serverTimerRef.current = setInterval(() => {
      const t = routeTRef.current;
      if (t >= 0.95) return; // stop intermediate pings near completion — Clock B sends the final
      const lat = lerp(route.loadingPoint.lat, route.customerSite.lat, t);
      const lng = lerp(route.loadingPoint.lng, route.customerSite.lng, t);
      fetch(`/api/trips/${demoTripId}/demo-gps`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat, lng, speed: 8.3, accuracy: 5 }),
      }).catch(() => {});
    }, SERVER_PERSIST_MS);
  }

  function pauseDemo() {
    if (demoStatus !== "running") return;
    // Stop all three clocks — retain routeT and visualT progress:
    clearAllDemoTimers();
    setDemoStatus("paused");
  }

  function resumeDemo() {
    if (!demoRoute || demoStatus !== "paused") return;
    // Prevent duplicates — clocks should already be stopped, but guard anyway:
    clearAllDemoTimers();
    setDemoStatus("running");
    const route = demoRoute;

    // Restart Clock A (visual):
    visualTimerRef.current = setInterval(() => {
      const target = routeTRef.current;
      visualTRef.current += (target - visualTRef.current) * 0.15;
      setDemoProgress(visualTRef.current);
    }, VISUAL_INTERVAL_MS);

    // Restart Clock B (route progress) — continues from routeTRef.current:
    const tickSize = 1 / DEMO_DURATION_1X_SEC;
    routeTimerRef.current = setInterval(() => {
      const next = Math.min(routeTRef.current + tickSize, 1.0);
      routeTRef.current = next;
      if (next >= 1.0) {
        if (serverTimerRef.current) { clearInterval(serverTimerRef.current); serverTimerRef.current = null; }
        if (visualTimerRef.current) { clearInterval(visualTimerRef.current); visualTimerRef.current = null; }
        if (routeTimerRef.current)  { clearInterval(routeTimerRef.current);  routeTimerRef.current  = null; }
        visualTRef.current = 1.0;
        setDemoProgress(1.0);
        setDemoStatus("completed");
        fetch(`/api/trips/${demoTripId}/demo-gps`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lat: route.customerSite.lat, lng: route.customerSite.lng, speed: 0, accuracy: 5 }),
        }).catch(() => {});
      }
    }, 1000);

    // Restart Clock C (persistence) — same 0.95 stop threshold as startDemo:
    serverTimerRef.current = setInterval(() => {
      const t = routeTRef.current;
      if (t >= 0.95) return;
      const lat = lerp(route.loadingPoint.lat, route.customerSite.lat, t);
      const lng = lerp(route.loadingPoint.lng, route.customerSite.lng, t);
      fetch(`/api/trips/${demoTripId}/demo-gps`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat, lng, speed: 8.3, accuracy: 5 }),
      }).catch(() => {});
    }, SERVER_PERSIST_MS);
  }

  function stopDemo() {
    clearAllDemoTimers();
    routeTRef.current  = 0;
    visualTRef.current = 0;
    setDemoStatus("idle");
    setDemoRoute(null);
    setDemoProgress(0);
  }

  // Demo GPS badge: show DEMO badge for vehicle whose trip is being simulated:
  const demoVehicle = demoStatus !== "idle"
    ? positions.find(v => v.tripId === demoTripId)
    : null;

  const kpi = positions.reduce((acc, v) => {
    if (v.tripId && v.tripStatus !== "COMPLETED") acc.activeTrips++;
    if (!v.tripId && v.vehicleStatus === "AVAILABLE") acc.available++;
    if (v.tripStatus === "STARTED") acc.inTransit++;
    if (v.gpsStatus === "LIVE") acc.gpsLive++;
    if (v.gpsStatus === "STALE") acc.gpsStale++;
    if (v.gpsStatus === "OFFLINE") acc.gpsOffline++;
    return acc;
  }, { activeTrips: 0, available: 0, inTransit: 0, gpsLive: 0, gpsStale: 0, gpsOffline: 0 });

  return (
    <AdminShell title="Control Tower">
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-lg font-semibold text-ink">🗼 Control Tower</span>
            <span className="text-2xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">LIVE · 15s</span>
          </div>
          <div className="flex items-center gap-3">
          <span className="text-xs text-steel">{fetchedAt ? `Updated: ${new Date(fetchedAt).toLocaleTimeString()}` : "Loading…"}</span>
          {/* GPS Demo Mode badge */}
          {demoStatus !== "idle" && (
            <span className={`text-2xs px-2 py-0.5 rounded-full font-semibold ${
              demoStatus === "running"   ? "bg-amber-100 text-amber-700 border border-amber-300" :
              demoStatus === "completed" ? "bg-emerald-100 text-emerald-700 border border-emerald-300" :
              "bg-slate-100 text-slate-500"
            }`}>
              🎮 {demoStatus === "running" ? "DEMO GPS LIVE" : demoStatus === "completed" ? "DEMO COMPLETE ✓" : "DEMO PAUSED"}
            </span>
          )}
        </div>
        </div>

        {/* KPI Strip */}
        <div className="bg-slate-50 border-b border-slate-200 px-6 py-2 flex gap-5 overflow-x-auto flex-shrink-0">
          {[
            { l: "Active Trips", v: kpi.activeTrips, c: "text-aqua" },
            { l: "Available", v: kpi.available, c: "text-emerald-600" },
            { l: "In Transit", v: kpi.inTransit, c: "text-amber-600" },
            { l: "GPS Live", v: kpi.gpsLive, c: "text-emerald-600" },
            { l: "GPS Stale", v: kpi.gpsStale, c: "text-amber-500" },
            { l: "GPS Offline", v: kpi.gpsOffline, c: "text-slate-400" },
          ].map(({ l, v, c }) => (
            <div key={l} className="flex flex-col items-center min-w-[72px]">
              <span className={`text-xl font-bold ${c}`}>{v}</span>
              <span className="text-2xs text-steel">{l}</span>
            </div>
          ))}
        </div>

        {/* Tab Bar */}
        <div className="bg-white border-b border-slate-200 px-6 flex gap-0 flex-shrink-0">
          {(demoEnabled ? (["map", "events", "history", "demo"] as const) : (["map", "events", "history"] as const)).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === tab ? "border-aqua text-aqua" : "border-transparent text-steel hover:text-ink"}`}>
              {tab === "map" && "🗺 Fleet Map"}
              {tab === "events" && `🔔 Operations${unread > 0 ? ` (${unread})` : ""}`}
              {tab === "history" && "📋 Trip History"}
          {demoEnabled && tab === "demo" && "🎮 GPS Demo"}
            </button>
          ))}
        </div>

        {/* Fleet Map Tab */}
        {activeTab === "map" && (
          <div className="flex flex-1 overflow-hidden min-h-0">
            {/* Vehicle list */}
            <div className="w-72 border-r border-slate-200 overflow-y-auto bg-white flex-shrink-0">
              {loading && <p className="p-4 text-sm text-steel">Loading fleet…</p>}
              {positions.map(v => {
                const ms = deriveMapStatus(v);
                const gpsBadge = GPS_BADGE[v.gpsStatus];
                const isSelected = selected?.vehicleId === v.vehicleId;
                return (
                  <button key={v.vehicleId} onClick={() => setSelected(isSelected ? null : v)}
                    className={`w-full text-left px-4 py-3 border-b border-slate-100 hover:bg-slate-50 transition-colors ${isSelected ? "bg-aqua/5 border-l-2 border-l-aqua" : ""}`}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: STATUS_COLORS[ms] ?? "#cbd5e1" }} />
                        <span className="text-sm font-medium text-ink">{v.plateNumber}</span>
                      </div>
                      <span className={`text-2xs px-1.5 py-0.5 rounded font-medium ${gpsBadge.cls}`}>{gpsBadge.label}</span>
                    </div>
                    <p className="text-2xs text-steel mt-1 ml-4">{STATUS_LABEL[ms] ?? ms}</p>
                    {v.capacityLiters && <p className="text-2xs text-steel ml-4">{v.capacityLiters.toLocaleString()} L</p>}
                    {v.driverName && <p className="text-2xs text-ink ml-4 truncate">👤 {v.driverName}</p>}
                    {v.customerName && <p className="text-2xs text-aqua ml-4 truncate">🏢 {v.customerName}</p>}
                    {v.lastPingAt && <p className="text-2xs text-steel ml-4">📡 {elapsed(v.lastPingAt)}</p>}
                  </button>
                );
              })}
            </div>

            {/* Map + detail */}
            <div className="flex-1 flex flex-col overflow-hidden min-h-0">
              {/* Operational detail panel (when vehicle selected) */}
              {selected && (
                <div className="bg-white border-b border-slate-200 px-4 py-3 flex items-start gap-6 overflow-x-auto flex-shrink-0">
                  <Detail label="Vehicle" value={selected.plateNumber} />
                  <Detail label="Capacity" value={selected.capacityLiters ? `${selected.capacityLiters.toLocaleString()} L` : "—"} />
                  {selected.requiredTankerCapacityLtr && <Detail label="Required" value={`${selected.requiredTankerCapacityLtr.toLocaleString()} L`} highlight />}
                  <Detail label="Status" value={STATUS_LABEL[deriveMapStatus(selected)] ?? "—"} />
                  <Detail label="GPS" value={GPS_BADGE[selected.gpsStatus].label} />
                  {selected.driverName && <Detail label="Driver" value={selected.driverName} />}
                  {selected.customerName && <Detail label="Customer" value={selected.customerName} />}
                  {selected.tripNumber && <Detail label="Trip" value={selected.tripNumber} />}
                  <Detail label="Loading" value={selected.loadingConfirmed ? "Confirmed ✓" : "Pending"} />
                  {selected.lastPingAt && <Detail label="Last Ping" value={elapsed(selected.lastPingAt)} />}
                  {demoVehicle?.vehicleId === selected.vehicleId && (
                    <div className="flex flex-col gap-0.5 min-w-fit">
                      <span className="text-2xs text-steel">GPS Source</span>
                      <span className="text-xs font-semibold text-amber-600">🎮 DEMO GPS</span>
                    </div>
                  )}
                </div>
              )}

              {/* THE MAP — real Google Maps with vehicle pins, geofence circles, route polyline */}
              <div className="flex-1 flex p-3 min-h-0">
                <ControlTowerMap positions={positions} selected={selected} onSelect={setSelected} />
              </div>
            </div>
          </div>
        )}

        {/* Operations Events Tab */}
        {activeTab === "events" && (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-ink">Operational Events</h2>
              {unread > 0 && <button onClick={markAllRead} className="text-xs text-aqua hover:underline">Mark all read</button>}
            </div>
            {events.length === 0 ? (
              <div className="text-center py-12"><p className="text-3xl mb-2">✅</p><p className="text-sm text-steel">No unread events</p></div>
            ) : (
              <div className="space-y-2">
                {events.map(ev => (
                  <div key={ev.id} className={`border rounded-lg p-3 ${SEV_BADGE[ev.severity]}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2">
                        <span>{EVT_ICON[ev.eventType] ?? "🔔"}</span>
                        <p className="text-xs font-medium">{ev.message}</p>
                      </div>
                      {!ev.read && <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0 mt-1" />}
                    </div>
                    <p className="text-2xs mt-1 opacity-70">{elapsed(ev.createdAt)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* GPS Demo Panel */}
        {activeTab === "demo" && demoEnabled && (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-md">
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4">
                <p className="text-xs font-semibold text-amber-800 mb-1">🎮 GPS DEMO MODE</p>
                <p className="text-2xs text-amber-700">Controlled simulation using the same GPS pipeline as real devices. Coordinates are progressive from Loading Point → Customer Site. Geofence detection and GPS history work normally. Lifecycle, billing, and contracts are NOT affected.</p>
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-2xs text-blue-800">
                <p className="font-medium mb-1">ℹ️ Geofence demo notes</p>
                <p>Loading arrival fires automatically when demo starts (vehicle begins at Loading Point).</p>
                <p className="mt-1">Customer arrival requires <strong>loading to be confirmed</strong> in the driver lifecycle panel first — demo does not auto-advance lifecycle stages.</p>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
                <div>
                  <label className="text-xs font-medium text-steel block mb-1">Trip ID</label>
                  <input
                    type="text" placeholder="Enter trip ID…"
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                    value={demoTripId}
                    onChange={e => setDemoTripId(e.target.value)}
                    disabled={demoStatus !== "idle"}
                  />
                </div>
                {demoRoute && (
                  <div className="space-y-1 text-2xs text-steel">
                    <p>📍 From: {demoRoute.loadingPoint.name} ({demoRoute.loadingPoint.lat?.toFixed(4)}, {demoRoute.loadingPoint.lng?.toFixed(4)})</p>
                    <p>🏢 To: {demoRoute.customerSite.label} ({demoRoute.customerSite.lat?.toFixed(4)}, {demoRoute.customerSite.lng?.toFixed(4)})</p>
                    <p>Progress: {Math.round(demoProgress * 100)}%</p>
                  </div>
                )}
                <div className="flex gap-2 pt-1">
                  {demoStatus === "idle" && (
                    <div className="flex gap-1.5 flex-wrap">
                      {([1, 2, 5, 10] as const).map(spd => (
                        <button key={spd} onClick={() => startDemo(spd)} disabled={!demoTripId}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500 text-white disabled:opacity-40 hover:bg-emerald-600">
                          ▶ {spd}× {spd === 1 ? "(~90s)" : spd === 2 ? "(~45s)" : spd === 5 ? "(~18s)" : "(~9s)"}
                        </button>
                      ))}
                    </div>
                  )}
                  {demoStatus === "running" && (
                    <button onClick={pauseDemo}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-500 text-white hover:bg-amber-600">
                      ⏸ Pause
                    </button>
                  )}
                  {demoStatus === "paused" && (
                    <button onClick={resumeDemo}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-500 text-white hover:bg-blue-600">
                      ▶ Resume
                    </button>
                  )}
                  {demoStatus !== "idle" && (
                    <button onClick={stopDemo}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500 text-white hover:bg-red-600">
                      ⏹ Stop
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Trip History Tab */}
        {activeTab === "history" && (
          <div className="flex-1 overflow-y-auto p-6">
            <h2 className="text-sm font-semibold text-ink mb-4">Trip GPS History</h2>
            <div className="space-y-3">
              {positions.filter(v => v.tripId).map(v => <TripHistoryCard key={v.tripId} vehicle={v} />)}
              {positions.filter(v => v.tripId).length === 0 && <p className="text-sm text-steel text-center py-12">No active trips</p>}
            </div>
          </div>
        )}
      </div>
    </AdminShell>
  );
}

function Detail({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-fit">
      <span className="text-2xs text-steel">{label}</span>
      <span className={`text-xs font-medium ${highlight ? "text-aqua" : "text-ink"}`}>{value}</span>
    </div>
  );
}

function TripHistoryCard({ vehicle: v }: { vehicle: VehiclePosition }) {
  const [history, setHistory] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open || !v.tripId) return;
    fetch(`/api/trips/${v.tripId}/gps-history`)
      .then(r => r.ok ? r.json() : { history: [] })
      .then(d => setHistory((d.history ?? []).slice(-200))) // bounded: max 200 points
      .catch(() => {});
  }, [open, v.tripId]);
  return (
    <div className="bg-white rounded-lg border border-slate-200">
      <button onClick={() => setOpen(!open)} className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-50">
        <div>
          <span className="text-sm font-medium text-ink">{v.tripNumber ?? v.tripId}</span>
          <span className="text-xs text-steel ml-3">{v.plateNumber} · {v.driverName}</span>
        </div>
        <span className="text-steel text-xs">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="border-t border-slate-100 px-4 py-3">
          <p className="text-xs text-steel mb-2">GPS Track — {history.length} points (last 200 shown)</p>
          {history.length === 0 ? <p className="text-xs text-steel">No GPS history yet</p> : (
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {history.slice(-15).map((pt: any, i) => (
                <div key={i} className="flex items-center gap-3 text-2xs text-steel font-mono">
                  <span>{new Date(pt.recordedAt).toLocaleTimeString()}</span>
                  <span>{pt.lat?.toFixed(5)}, {pt.lng?.toFixed(5)}</span>
                  {pt.speed != null && <span>{(pt.speed * 3.6).toFixed(1)} km/h</span>}
                  {pt.accuracy != null && <span>±{Math.round(pt.accuracy)}m</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
