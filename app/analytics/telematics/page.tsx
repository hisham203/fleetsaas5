"use client";
import { useState, useEffect, useCallback } from "react";
import AdminShell from "@/components/AdminShell";
import { PageContainer, PageHeader, LoadingState } from "@/components/ds";
import DateRangePicker, { presetRange } from "@/components/DateRangePicker";
import Link from "next/link";
import type { TelematicsQualityMetrics } from "@/lib/analyticsMetrics";

function pct(v: number | null) { return v != null ? `${(v * 100).toFixed(1)}%` : "N/A" }

export default function TelematicsAnalyticsPage() {
  const [range, setRange] = useState(presetRange("last30"));
  const [data, setData] = useState<TelematicsQualityMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/analytics/telematics?from=${range.from}&to=${range.to}`).catch(() => null);
    if (res?.ok) setData(await res.json());
    setLoading(false);
  }, [range.from, range.to]);

  useEffect(() => { load(); }, [load]);
  const d = data;

  return (
    <AdminShell title="Telematics & GPS Quality">
      <PageContainer>
        <PageHeader title="Telematics & GPS Quality"
          subtitle="Device coverage, GPS source provenance, and telemetry reliability. GPS_DEMO pings are never mixed into physical GPS metrics."
          breadcrumbs={[{ label: "Analytics" }, { label: "Telematics" }]} />
        <div className="mb-4"><DateRangePicker value={range} onChange={r => setRange(r)} /></div>
        {loading ? <LoadingState /> : !d ? <p className="text-sm text-steel">No telematics data.</p> : (
          <div className="space-y-5">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {[
                { label: "Total Vehicles",    value: String(d.totalVehicles) },
                { label: "With Device",       value: `${d.vehiclesWithDevice} / ${d.totalVehicles}` },
                { label: "Healthy Devices",   value: String(d.vehiclesWithHealthyDevice) },
                { label: "Offline Devices",   value: String(d.vehiclesWithOfflineDevice), warn: d.vehiclesWithOfflineDevice > 0 },
                { label: "Coverage",          value: pct(d.telemetryCoveragePercent) },
              ].map(k => (
                <div key={k.label} className={`bg-white rounded-xl border ${k.warn ? "border-warn/40" : "border-slate-200"} shadow-card p-4`}>
                  <p className="text-xs text-steel mb-1">{k.label}</p>
                  <p className="text-xl font-bold text-ink">{k.value}</p>
                </div>
              ))}
            </div>

            {/* GPS source distribution — CRITICAL: DEMO never inflates physical metrics */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-card p-5">
              <h3 className="text-sm font-semibold text-ink mb-3">GPS Source Distribution (period)</h3>
              <p className="text-2xs text-steel mb-3">GPS_DEMO pings are isolated from physical device metrics. Physical telematics quality = DEVICE + DRIVER_APP only.</p>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <p className="text-xs text-steel">Hardware Device</p>
                  <p className="text-lg font-bold text-ok">{d.devicePings.toLocaleString()}</p>
                  <p className="text-2xs text-steel">pings (source=DEVICE)</p>
                </div>
                <div>
                  <p className="text-xs text-steel">Driver App</p>
                  <p className="text-lg font-bold text-ink">{d.driverAppPings.toLocaleString()}</p>
                  <p className="text-2xs text-steel">pings (source=DRIVER_APP)</p>
                </div>
                <div>
                  <p className="text-xs text-steel">Demo (excluded from physical)</p>
                  <p className="text-lg font-bold text-steel">{d.demoPings.toLocaleString()}</p>
                  <p className="text-2xs text-steel">pings (source=GPS_DEMO)</p>
                </div>
              </div>
              <p className="text-xs text-ink mt-3">Physical GPS total: <strong>{(d.devicePings + d.driverAppPings).toLocaleString()}</strong> pings</p>
            </div>

            {/* ETA and alerts */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="bg-white rounded-xl border border-slate-200 shadow-card p-5">
                <h3 className="text-sm font-semibold text-ink mb-3">ETA Analytics Eligibility</h3>
                <p className="text-2xl font-bold text-ink">{d.tripsEligibleForEtaAnalytics}</p>
                <p className="text-xs text-steel mt-1">trips with baseline ETA (from dispatch)</p>
                {d.tripsEligibleForEtaAnalytics === 0
                  ? <p className="text-xs text-steel mt-2">No ETA accuracy analysis available yet. Baseline ETA is set at dispatch for trips dispatched after Milestone F+G.</p>
                  : <p className="text-xs text-steel mt-2">ETA accuracy metrics require eligible trips with both baseline + actual arrival. Sample size: {d.tripsEligibleForEtaAnalytics}.</p>}
              </div>
              <div className="bg-white rounded-xl border border-slate-200 shadow-card p-5">
                <h3 className="text-sm font-semibold text-ink mb-3">Open Alerts</h3>
                <p className="text-2xl font-bold text-ink">{d.openAlerts}</p>
                <p className="text-xs text-steel mt-1">including {d.deviceOfflineAlerts} device offline</p>
                {d.openAlerts > 0 && (
                  <Link href="/telematics/alerts" className="text-xs text-aqua hover:underline mt-2 block">View Alerts Workspace →</Link>
                )}
              </div>
            </div>

            <div className="flex gap-2 flex-wrap">
              <Link href="/telematics/devices" className="text-xs bg-white border border-slate-200 rounded-lg px-3 py-2 text-aqua hover:bg-paper">Device Registry →</Link>
              <Link href="/telematics/fleet-intelligence" className="text-xs bg-white border border-slate-200 rounded-lg px-3 py-2 text-aqua hover:bg-paper">Fleet Intelligence →</Link>
            </div>
          </div>
        )}
      </PageContainer>
    </AdminShell>
  );
}
