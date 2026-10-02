"use client";
/**
 * Live Fleet Intelligence
 * Route: /telematics/live
 * Enhanced fleet list with derived operational state, GPS health, and device health.
 * All vehicles in one view — search, filter, deep links to Vehicle 360 and Trip 360.
 */
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import AdminShell from "@/components/AdminShell";
import { PageContainer, PageHeader, StatusBadge, EmptyState, LoadingState, Btn, FilterBar } from "@/components/ds";

type GpsStatus = "LIVE" | "STALE" | "OFFLINE";
type OperationalState = "MOVING" | "IDLE" | "ON_TRIP" | "AVAILABLE" | "OFFLINE" | "UNKNOWN";
type DeviceHealth = "HEALTHY" | "STALE" | "OFFLINE" | "NEVER_REPORTED" | "UNASSIGNED";

interface VehicleRow {
  vehicleId: string; plateNumber: string; vehicleType: string; vehicleStatus: string;
  gpsStatus: GpsStatus; operationalState: OperationalState; deviceHealth: DeviceHealth;
  lat: number | null; lng: number | null; lastPingAt: string | null; lastPingAge: string;
  tripId: string | null; tripNumber: string | null; tripStatus: string | null;
  driverName: string | null; customerName: string | null;
  hasDevice: boolean; deviceIdentifier: string | null;
}
interface Summary { total: number; live: number; stale: number; offline: number; moving: number; idle: number; onTrip: number; available: number; withDevice: number; withoutDevice: number }

const OP_STATE_BADGE: Record<OperationalState, { cls: string; label: string }> = {
  MOVING:    { cls: "bg-okLight text-ok",     label: "Moving" },
  IDLE:      { cls: "bg-infoLight text-info", label: "Idle" },
  ON_TRIP:   { cls: "bg-infoLight text-info", label: "On Trip" },
  AVAILABLE: { cls: "bg-paper text-steel",    label: "Available" },
  OFFLINE:   { cls: "bg-slate-100 text-slate-400", label: "Offline" },
  UNKNOWN:   { cls: "bg-paper text-steel/50", label: "Unknown" },
};
const GPS_DOT: Record<GpsStatus, string> = {
  LIVE: "text-ok", STALE: "text-warn", OFFLINE: "text-steel/40",
};
const DEV_HEALTH_CLS: Record<DeviceHealth, string> = {
  HEALTHY: "text-ok", STALE: "text-warn", OFFLINE: "text-danger",
  NEVER_REPORTED: "text-steel", UNASSIGNED: "text-steel/40",
};

export default function LiveFleetPage() {
  const [vehicles, setVehicles] = useState<VehicleRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [gpsFilter, setGpsFilter] = useState<"ALL" | GpsStatus>("ALL");
  const [opFilter, setOpFilter] = useState<"ALL" | OperationalState>("ALL");

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/fleet/intelligence").catch(() => null);
    if (res?.ok) {
      const data = await res.json();
      setVehicles(data.vehicles ?? []);
      setSummary(data.summary ?? null);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); const id = setInterval(load, 15_000); return () => clearInterval(id); }, [load]);

  const filtered = vehicles.filter(v => {
    const matchSearch = !search ||
      v.plateNumber.toLowerCase().includes(search.toLowerCase()) ||
      (v.driverName ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (v.tripNumber ?? "").toLowerCase().includes(search.toLowerCase());
    const matchGps = gpsFilter === "ALL" || v.gpsStatus === gpsFilter;
    const matchOp = opFilter === "ALL" || v.operationalState === opFilter;
    return matchSearch && matchGps && matchOp;
  });

  return (
    <AdminShell title="Live Fleet">
      <PageContainer>
        <PageHeader
          title="Live Fleet Intelligence"
          subtitle="Operational state, GPS health, and device status across your fleet"
          breadcrumbs={[{ label: "Telematics" }, { label: "Live Fleet" }]}
          actions={<Btn variant="ghost" size="sm" onClick={load}>↺</Btn>}
        />

        {/* Summary KPIs */}
        {summary && (
          <div className="grid grid-cols-4 sm:grid-cols-8 gap-2 mb-5">
            {[
              { label: "Total",     value: summary.total },
              { label: "Moving",    value: summary.moving,   cls: "text-ok" },
              { label: "Idle",      value: summary.idle,     cls: "text-info" },
              { label: "On Trip",   value: summary.onTrip,   cls: "text-info" },
              { label: "Available", value: summary.available },
              { label: "GPS Live",  value: summary.live,     cls: "text-ok" },
              { label: "GPS Stale", value: summary.stale,    cls: "text-warn" },
              { label: "Offline",   value: summary.offline,  cls: "text-steel/50" },
            ].map(k => (
              <div key={k.label} className="bg-white rounded-xl border border-slate-200 p-3 text-center">
                <p className={`text-lg font-bold ${k.cls ?? "text-ink"}`}>{k.value}</p>
                <p className="text-2xs text-steel uppercase">{k.label}</p>
              </div>
            ))}
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap gap-2 mb-3">
          {(["ALL","LIVE","STALE","OFFLINE"] as const).map(f => (
            <button key={f} onClick={() => setGpsFilter(f)}
              className={`text-xs px-3 py-1.5 rounded-lg font-medium ${gpsFilter === f ? "bg-aqua text-white" : "bg-white border border-slate-200 text-steel hover:text-ink"}`}>
              GPS: {f}
            </button>
          ))}
          <span className="text-steel/30 mx-1">|</span>
          {(["ALL","MOVING","IDLE","ON_TRIP","AVAILABLE","OFFLINE"] as const).map(f => (
            <button key={f} onClick={() => setOpFilter(f)}
              className={`text-xs px-3 py-1.5 rounded-lg font-medium ${opFilter === f ? "bg-aqua text-white" : "bg-white border border-slate-200 text-steel hover:text-ink"}`}>
              {f === "ALL" ? "All States" : f.replace("_", " ")}
            </button>
          ))}
        </div>
        <FilterBar search={search} onSearch={setSearch} onClear={() => setSearch("")} />

        {loading && !vehicles.length ? <LoadingState label="Loading fleet…" /> :
         filtered.length === 0 ? <EmptyState title="No vehicles" description={vehicles.length === 0 ? "No vehicles in fleet." : "No vehicles match the current filters."} /> : (
          <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-paper">
                  {["Vehicle","State","GPS","Driver","Trip","Device","Last Ping","Actions"].map(h => (
                    <th key={h} className="text-left text-xs font-semibold text-steel px-3 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map(v => {
                  const opBadge = OP_STATE_BADGE[v.operationalState];
                  return (
                    <tr key={v.vehicleId} className="hover:bg-paper">
                      <td className="px-3 py-2.5">
                        <a href={`/fleet/vehicles/${v.vehicleId}`} className="font-medium text-ink hover:text-aqua">
                          {v.plateNumber}
                        </a>
                        <p className="text-2xs text-steel">{v.vehicleType}</p>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${opBadge.cls}`}>{opBadge.label}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`text-sm font-bold ${GPS_DOT[v.gpsStatus]}`}>●</span>
                        <span className="text-xs text-steel ml-1">{v.gpsStatus}</span>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-steel">{v.driverName ?? "—"}</td>
                      <td className="px-3 py-2.5">
                        {v.tripId
                          ? <a href={`/operations/trips/${v.tripId}`} className="text-xs text-aqua hover:underline font-mono">{v.tripNumber}</a>
                          : <span className="text-xs text-steel/50">—</span>}
                        {v.tripStatus && <StatusBadge status={v.tripStatus} size="xs" />}
                      </td>
                      <td className="px-3 py-2.5">
                        {v.hasDevice
                          ? <span className={`text-xs font-medium ${DEV_HEALTH_CLS[v.deviceHealth]}`}>{v.deviceHealth}</span>
                          : <span className="text-xs text-steel/40">No device</span>}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-steel">{v.lastPingAge}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex gap-1">
                          <a href={`/fleet/vehicles/${v.vehicleId}`} className="text-xs text-aqua hover:underline">360</a>
                          {v.tripId && <a href={`/operations/trips/${v.tripId}`} className="text-xs text-aqua hover:underline">Trip</a>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-steel/40 text-right mt-2">Auto-refreshes every 15s</p>
      </PageContainer>
    </AdminShell>
  );
}
