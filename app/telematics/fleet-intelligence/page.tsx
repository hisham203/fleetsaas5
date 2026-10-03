"use client";
/**
 * Fleet Intelligence Dashboard
 * Route: /telematics/fleet-intelligence
 * Answers: "What requires fleet/telematics operations attention right now?"
 */
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import AdminShell from "@/components/AdminShell";
import { PageContainer, PageHeader, MetricCard, StatusBadge, EmptyState, LoadingState, Btn } from "@/components/ds";

interface DashboardData {
  fleet: { total: number; onTrip: number; gps: { live: number; stale: number; offline: number } };
  devices: { total: number; assigned: number; healthy: number; stale: number; offline: number; neverReported: number; unassigned: number };
  activeTrips: { total: number; byStatus: Record<string, number> };
  openEvents: { total: number; critical: number; warning: number; recent: Array<{ id: string; eventType: string; severity: string; vehicleId: string | null; eventAt: string; source: string }> };
  recentGeofenceEvents: Array<{ id: string; eventType: string; vehicleId: string; eventAt: string; geofence?: { name: string; category: string } }>;
  attention: {
    vehiclesOfflineOnTrip: Array<{ vehicleId: string; plateNumber: string; lastPingAt: string | null }>;
    devicesNeedingAttention: Array<{ id: string; identifier: string; health: string }>;
  };
  fetchedAt: string;
}

const SEVERITY_BADGE: Record<string, string> = {
  CRITICAL: "text-danger font-semibold", WARNING: "text-warn font-semibold", INFO: "text-steel",
};
const HEALTH_COLOR: Record<string, string> = {
  HEALTHY: "text-ok", STALE: "text-warn", OFFLINE: "text-danger", NEVER_REPORTED: "text-steel", UNASSIGNED: "text-steel/60",
};

function fmtTime(d: string) {
  return new Date(d).toLocaleTimeString("en-SA", { hour: "2-digit", minute: "2-digit" });
}

export default function FleetIntelligencePage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const res = await fetch("/api/telematics/fleet-dashboard").catch(() => null);
    if (!res?.ok) { setError("Failed to load fleet intelligence."); setLoading(false); return; }
    setData(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => { load(); const id = setInterval(load, 30_000); return () => clearInterval(id); }, [load]);

  return (
    <AdminShell title="Fleet Intelligence">
      <PageContainer>
        <PageHeader
          title="Fleet Intelligence"
          subtitle="What requires fleet and telematics attention right now"
          breadcrumbs={[{ label: "Telematics" }, { label: "Fleet Intelligence" }]}
          actions={<Btn variant="ghost" size="sm" onClick={load}>↺ Refresh</Btn>}
        />

        {loading && !data ? <LoadingState label="Loading fleet intelligence…" /> :
         error ? <div className="text-sm text-danger bg-dangerLight rounded-xl p-4">{error}</div> :
         data ? (
          <div className="space-y-6">

            {/* Attention Required */}
            {(data.attention.vehiclesOfflineOnTrip.length > 0 || data.attention.devicesNeedingAttention.length > 0 || data.openEvents.critical > 0) && (
              <div className="bg-dangerLight/40 border border-danger/30 rounded-xl p-4">
                <h2 className="text-sm font-semibold text-danger mb-3">⚠ Requires Attention</h2>
                <div className="space-y-1.5">
                  {data.openEvents.critical > 0 && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-ink">{data.openEvents.critical} CRITICAL telemetry event{data.openEvents.critical !== 1 ? "s" : ""}</span>
                      <Link href="/telematics/events?status=OPEN" className="text-xs text-aqua hover:underline">View →</Link>
                    </div>
                  )}
                  {data.attention.vehiclesOfflineOnTrip.map(v => (
                    <div key={v.vehicleId} className="flex items-center justify-between text-sm">
                      <span className="text-ink">{v.plateNumber} — GPS offline during active trip</span>
                      <a href={`/fleet/vehicles/${v.vehicleId}`} className="text-xs text-aqua hover:underline">Vehicle →</a>
                    </div>
                  ))}
                  {data.attention.devicesNeedingAttention.map(d => (
                    <div key={d.id} className="flex items-center justify-between text-sm">
                      <span className="text-ink">{d.identifier} — Device {d.health.toLowerCase()}</span>
                      <Link href="/telematics/devices" className="text-xs text-aqua hover:underline">Devices →</Link>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Fleet GPS Health */}
            <div>
              <h2 className="text-xs font-semibold text-steel uppercase mb-3">Fleet GPS Health</h2>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <MetricCard label="Total Vehicles" value={data.fleet.total} />
                <MetricCard label="On Trip" value={data.fleet.onTrip} />
                <MetricCard label="GPS Live" value={data.fleet.gps.live} accent="ok" />
                <MetricCard label="GPS Stale" value={data.fleet.gps.stale} accent="warn" />
                <MetricCard label="GPS Offline" value={data.fleet.gps.offline} accent="danger" />
              </div>
            </div>

            {/* Device Health */}
            <div>
              <h2 className="text-xs font-semibold text-steel uppercase mb-3">Device Health</h2>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
                <MetricCard label="Devices" value={data.devices.total} />
                <MetricCard label="Assigned" value={data.devices.assigned} />
                <MetricCard label="Healthy" value={data.devices.healthy} accent="ok" />
                <MetricCard label="Stale" value={data.devices.stale} accent="warn" />
                <MetricCard label="Offline" value={data.devices.offline} accent="danger" />
                <MetricCard label="Unassigned" value={data.devices.unassigned} />
              </div>
            </div>

            {/* Active Trips + Open Events row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Active Trips */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-card p-5">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-semibold text-ink">Active Trips ({data.activeTrips.total})</h2>
                  <Link href="/operations/trips#list" className="text-xs text-aqua hover:underline">All trips →</Link>
                </div>
                {Object.entries(data.activeTrips.byStatus).length === 0
                  ? <p className="text-xs text-steel">No active trips.</p>
                  : <div className="space-y-1.5">
                      {Object.entries(data.activeTrips.byStatus).map(([status, count]) => (
                        <div key={status} className="flex items-center justify-between">
                          <StatusBadge status={status} size="xs" />
                          <span className="text-sm font-semibold text-ink">{count}</span>
                        </div>
                      ))}
                    </div>
                }
              </div>

              {/* Open Events */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-card p-5">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-semibold text-ink">Open Events ({data.openEvents.total})</h2>
                  <Link href="/telematics/events" className="text-xs text-aqua hover:underline">All events →</Link>
                </div>
                {data.openEvents.recent.length === 0
                  ? <p className="text-xs text-steel">No open events.</p>
                  : <div className="space-y-2">
                      {data.openEvents.recent.map(e => (
                        <div key={e.id} className="flex items-start justify-between gap-2">
                          <div>
                            <span className={`text-xs font-mono ${SEVERITY_BADGE[e.severity] ?? ""}`}>{e.eventType}</span>
                          </div>
                          <span className="text-xs text-steel shrink-0">{fmtTime(e.eventAt)}</span>
                        </div>
                      ))}
                    </div>
                }
              </div>
            </div>

            {/* Recent Geofence Events */}
            {data.recentGeofenceEvents.length > 0 && (
              <div className="bg-white rounded-xl border border-slate-200 shadow-card p-5">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-semibold text-ink">Recent Geofence Events (24h)</h2>
                  <Link href="/telematics/geofences" className="text-xs text-aqua hover:underline">Geofences →</Link>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="border-b border-slate-100">
                      {["Event","Geofence","Vehicle","Time"].map(h => (
                        <th key={h} className="text-start font-semibold text-steel px-2 py-1.5">{h}</th>
                      ))}
                    </tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.recentGeofenceEvents.map(e => (
                        <tr key={e.id} className="hover:bg-paper">
                          <td className="px-2 py-1.5 font-medium">
                            <span className={e.eventType === "ENTER" ? "text-ok" : "text-steel"}>{e.eventType}</span>
                          </td>
                          <td className="px-2 py-1.5 text-ink">{e.geofence?.name ?? "—"}</td>
                          <td className="px-2 py-1.5 font-mono text-steel">{e.vehicleId.slice(-8)}</td>
                          <td className="px-2 py-1.5 text-steel">{fmtTime(e.eventAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="grid grid-cols-4 gap-2">
              <Link href="/control-tower" className="text-xs bg-paper border border-slate-200 rounded-lg px-3 py-2 hover:bg-white text-ink text-center">🗺 Live Map</Link>
              <Link href="/telematics/devices" className="text-xs bg-paper border border-slate-200 rounded-lg px-3 py-2 hover:bg-white text-ink text-center">📡 Devices</Link>
              <Link href="/telematics/events" className="text-xs bg-paper border border-slate-200 rounded-lg px-3 py-2 hover:bg-white text-ink text-center">🔔 Events</Link>
              <Link href="/telematics/geofences" className="text-xs bg-paper border border-slate-200 rounded-lg px-3 py-2 hover:bg-white text-ink text-center">🔵 Geofences</Link>
            </div>

            <p className="text-xs text-steel/50 text-end">
              Auto-refreshes every 30s · Last: {new Date(data.fetchedAt).toLocaleTimeString("en-SA")}
            </p>
          </div>
        ) : null}
      </PageContainer>
    </AdminShell>
  );
}
