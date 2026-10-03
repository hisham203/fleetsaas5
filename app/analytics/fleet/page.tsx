"use client";
import { useState, useEffect, useCallback } from "react";
import AdminShell from "@/components/AdminShell";
import { PageContainer, PageHeader, LoadingState, EmptyState, StatusBadge } from "@/components/ds";
import DateRangePicker, { presetRange } from "@/components/DateRangePicker";
import Link from "next/link";
import type { VehicleAnalyticsRow, FleetMetrics } from "@/lib/analyticsMetrics";

function sar(v: number) { return v > 0 ? `SAR ${v.toLocaleString("en-SA", { maximumFractionDigits: 0 })}` : "SAR 0"; }
function pct(v: number | null) { return v != null ? `${(v * 100).toFixed(1)}%` : "—"; }

export default function FleetAnalyticsPage() {
  const [range, setRange] = useState(presetRange("last30"));
  const [data, setData] = useState<{ summary: FleetMetrics; vehicles: VehicleAnalyticsRow[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<"trips" | "cost">("trips");

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/analytics/fleet?from=${range.from}&to=${range.to}`).catch(() => null);
    if (res?.ok) { const j = await res.json(); setData({ summary: j.summary, vehicles: j.vehicles }); }
    setLoading(false);
  }, [range.from, range.to]);

  useEffect(() => { load(); }, [load]);

  const s = data?.summary;
  const rows = (data?.vehicles ?? []).slice().sort((a, b) =>
    sort === "trips" ? b.tripsCompleted - a.tripsCompleted : b.recordedOperatingCostSar - a.recordedOperatingCostSar
  );

  return (
    <AdminShell title="Fleet Performance">
      <PageContainer>
        <PageHeader title="Fleet Performance" subtitle="Vehicle activity, productivity, and recorded operating costs."
          breadcrumbs={[{ label: "Analytics" }, { label: "Fleet" }]} />
        <div className="mb-4"><DateRangePicker value={range} onChange={r => setRange(r)} /></div>
        {loading ? <LoadingState /> : !data ? <EmptyState title="No data" description="" /> : (
          <div className="space-y-5">
            {/* Summary KPI cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {[
                { label: "Total Vehicles",       value: String(s?.totalVehicles ?? 0) },
                { label: "Active Vehicles",       value: String(s?.activeVehicles ?? 0) },
                { label: "With Device",           value: `${s?.vehiclesWithDevices ?? 0} / ${s?.totalVehicles ?? 0}` },
                { label: "Currently On Trip",     value: String(s?.vehiclesOnTrip ?? 0) },
                { label: "Trips / Vehicle (avg)", value: s?.tripsPerVehicle != null ? String(s.tripsPerVehicle) : "N/A" },
              ].map(k => (
                <div key={k.label} className="bg-white rounded-xl border border-slate-200 shadow-card p-4">
                  <p className="text-xs text-steel mb-1">{k.label}</p>
                  <p className="text-xl font-bold text-ink">{k.value}</p>
                </div>
              ))}
            </div>
            <p className="text-2xs text-steel">Utilization % is not shown — no shift schedule or operational-hours calendar exists to provide a defensible denominator. Trips/vehicle and on-trip count are the transparent productivity measures.</p>

            {/* Vehicle table */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
                <h3 className="text-sm font-semibold text-ink">Vehicles</h3>
                <div className="flex gap-2">
                  <button onClick={() => setSort("trips")} className={`text-xs px-3 py-1 rounded-lg ${sort === "trips" ? "bg-aqua text-white" : "text-steel hover:text-ink"}`}>By Trips</button>
                  <button onClick={() => setSort("cost")} className={`text-xs px-3 py-1 rounded-lg ${sort === "cost" ? "bg-aqua text-white" : "text-steel hover:text-ink"}`}>By Cost</button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="bg-paper border-b border-slate-100">
                    {["Plate","Status","Completed","Failed","Rate","Avg Duration","Fuel","Maintenance","Recorded Cost"].map(h =>
                      <th key={h} className="text-left text-xs font-semibold text-steel px-3 py-2">{h}</th>)}
                  </tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map(v => (
                      <tr key={v.vehicleId} className="hover:bg-paper">
                        <td className="px-3 py-2.5"><Link href={`/fleet/vehicles/${v.vehicleId}`} className="text-aqua hover:underline font-mono text-xs">{v.plateNumber}</Link></td>
                        <td className="px-3 py-2.5"><StatusBadge status={v.status} size="xs" /></td>
                        <td className="px-3 py-2.5 text-xs">{v.tripsCompleted}</td>
                        <td className="px-3 py-2.5 text-xs text-danger">{v.tripsFailed || "—"}</td>
                        <td className="px-3 py-2.5 text-xs">{pct(v.completionRate)}</td>
                        <td className="px-3 py-2.5 text-xs">{v.avgTripDurationMinutes != null ? `${v.avgTripDurationMinutes} min` : "—"}</td>
                        <td className="px-3 py-2.5 text-xs">{v.fuelCostSar > 0 ? sar(v.fuelCostSar) : "—"}</td>
                        <td className="px-3 py-2.5 text-xs">{v.maintenanceCostSar > 0 ? sar(v.maintenanceCostSar) : "—"}</td>
                        <td className="px-3 py-2.5 text-xs font-semibold">{v.recordedOperatingCostSar > 0 ? sar(v.recordedOperatingCostSar) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rows.length === 0 && <p className="text-sm text-steel text-center py-8">No vehicles found.</p>}
              </div>
            </div>
          </div>
        )}
      </PageContainer>
    </AdminShell>
  );
}
