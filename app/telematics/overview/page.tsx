"use client";
/**
 * Telematics Overview
 * Route: /telematics/overview
 * Real KPIs only — no fake data.
 */
import { useState, useEffect } from "react";
import AdminShell from "@/components/AdminShell";
import { PageContainer, PageHeader, MetricCard, LoadingState, Btn } from "@/components/ds";

interface Overview {
  devices: { total: number; assigned: number; unassigned: number; active: number; offline: number; fault: number };
  vehicles: { total: number; withDevice: number; live: number; stale: number; offline: number };
  events: { openTotal: number; critical: number };
  fetchedAt: string;
}

export default function TelematicsOverviewPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    const res = await fetch("/api/telematics/overview").catch(() => null);
    if (!res?.ok) { setError("Failed to load telematics overview."); setLoading(false); return; }
    setData(await res.json());
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  return (
    <AdminShell title="Telematics Overview">
      <PageContainer>
        <PageHeader
          title="Telematics Overview"
          subtitle="Device registry, fleet GPS health, and open telemetry events"
          breadcrumbs={[{ label: "Telematics" }, { label: "Overview" }]}
          actions={<Btn variant="ghost" size="sm" onClick={load}>↺</Btn>}
        />

        {loading ? <LoadingState /> : error ? (
          <div className="text-sm text-danger bg-dangerLight rounded-xl p-4">{error}</div>
        ) : data ? (
          <div className="space-y-6">
            <div>
              <h2 className="text-xs font-semibold text-steel uppercase mb-3">Device Registry</h2>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
                <MetricCard label="Devices" value={data.devices.total} />
                <MetricCard label="Assigned" value={data.devices.assigned} accent="ok" />
                <MetricCard label="Unassigned" value={data.devices.unassigned} />
                <MetricCard label="Active" value={data.devices.active} accent="ok" />
                <MetricCard label="Offline" value={data.devices.offline} accent="warn" />
                <MetricCard label="Fault" value={data.devices.fault} accent="danger" />
              </div>
            </div>

            <div>
              <h2 className="text-xs font-semibold text-steel uppercase mb-3">Fleet GPS Health</h2>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <MetricCard label="Total Vehicles" value={data.vehicles.total} />
                <MetricCard label="With Device" value={data.vehicles.withDevice} />
                <MetricCard label="Live" value={data.vehicles.live} accent="ok" />
                <MetricCard label="Stale" value={data.vehicles.stale} accent="warn" />
                <MetricCard label="Offline" value={data.vehicles.offline} />
              </div>
            </div>

            <div>
              <h2 className="text-xs font-semibold text-steel uppercase mb-3">Open Telemetry Events</h2>
              <div className="grid grid-cols-2 gap-3 max-w-xs">
                <MetricCard label="Open Events" value={data.events.openTotal} accent="warn" />
                <MetricCard label="Critical" value={data.events.critical} accent="danger" />
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 shadow-card p-5">
              <h2 className="text-sm font-semibold text-ink mb-3">Quick Actions</h2>
              <div className="flex flex-wrap gap-2">
                <a href="/control-tower" className="text-xs bg-paper border border-slate-200 rounded-lg px-3 py-2 hover:bg-white text-ink">
                  🗺 Live Tracking →
                </a>
                <a href="/telematics/devices" className="text-xs bg-paper border border-slate-200 rounded-lg px-3 py-2 hover:bg-white text-ink">
                  📡 Device Registry →
                </a>
                <a href="/telematics/geofences" className="text-xs bg-paper border border-slate-200 rounded-lg px-3 py-2 hover:bg-white text-ink">
                  🔵 Geofences →
                </a>
                <a href="/telematics/events" className="text-xs bg-paper border border-slate-200 rounded-lg px-3 py-2 hover:bg-white text-ink">
                  🔔 Events →
                </a>
                <a href="/telematics/replay" className="text-xs bg-paper border border-slate-200 rounded-lg px-3 py-2 hover:bg-white text-ink">
                  ▶ Trip Replay →
                </a>
              </div>
            </div>

            {data.fetchedAt && (
              <p className="text-xs text-steel/60 text-right">
                Last updated: {new Date(data.fetchedAt).toLocaleTimeString("en-SA")}
              </p>
            )}
          </div>
        ) : null}
      </PageContainer>
    </AdminShell>
  );
}
