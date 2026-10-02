"use client";
import { useState, useEffect, useCallback } from "react";
import AdminShell from "@/components/AdminShell";
import { PageContainer, PageHeader, LoadingState, EmptyState } from "@/components/ds";
import DateRangePicker, { presetRange } from "@/components/DateRangePicker";
import Link from "next/link";
import type { DriverAnalyticsRow } from "@/lib/analyticsMetrics";

function pct(v: number | null) { return v != null ? `${(v * 100).toFixed(1)}%` : "N/A" }
function sar(v: number) { return v > 0 ? `SAR ${v.toLocaleString("en-SA", { maximumFractionDigits: 0 })}` : "—" }

export default function DriverAnalyticsPage() {
  const [range, setRange] = useState(presetRange("last30"));
  const [rows, setRows] = useState<DriverAnalyticsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<"trips" | "rate">("trips");

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/analytics/drivers?from=${range.from}&to=${range.to}`).catch(() => null);
    if (res?.ok) { const j = await res.json(); setRows(j.drivers ?? []); }
    setLoading(false);
  }, [range.from, range.to]);

  useEffect(() => { load(); }, [load]);

  const sorted = rows.slice().sort((a, b) =>
    sort === "trips" ? b.tripsCompleted - a.tripsCompleted
      : (b.completionRate ?? 0) - (a.completionRate ?? 0)
  );

  return (
    <AdminShell title="Driver Performance">
      <PageContainer>
        <PageHeader title="Driver Performance"
          subtitle="Transparent factual measures — no composite safety score."
          breadcrumbs={[{ label: "Analytics" }, { label: "Drivers" }]} />
        <div className="mb-4"><DateRangePicker value={range} onChange={r => setRange(r)} /></div>
        <p className="text-2xs text-steel mb-3">Metrics shown: trips assigned/completed/failed, completion rate, SLA on-time rate, average trip duration, approved expenses. No composite safety or driving score is shown without real telematics evidence.</p>
        {loading ? <LoadingState /> : rows.length === 0 ? <EmptyState title="No drivers" description="No driver activity in this period." /> : (
          <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
              <h3 className="text-sm font-semibold text-ink">Drivers ({rows.length})</h3>
              <div className="flex gap-2">
                <button onClick={() => setSort("trips")} className={`text-xs px-3 py-1 rounded-lg ${sort === "trips" ? "bg-aqua text-white" : "text-steel hover:text-ink"}`}>By Trips</button>
                <button onClick={() => setSort("rate")} className={`text-xs px-3 py-1 rounded-lg ${sort === "rate" ? "bg-aqua text-white" : "text-steel hover:text-ink"}`}>By Completion</button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="bg-paper border-b border-slate-100">
                  {["Driver","Assigned","Completed","Failed","Completion","On-Time (SLA)","Avg Duration","Expenses"].map(h =>
                    <th key={h} className="text-left text-xs font-semibold text-steel px-3 py-2">{h}</th>)}
                </tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {sorted.map(d => (
                    <tr key={d.driverId} className="hover:bg-paper">
                      <td className="px-3 py-2.5"><Link href={`/fleet/drivers/${d.driverId}`} className="text-aqua hover:underline text-xs font-medium">{d.driverName}</Link></td>
                      <td className="px-3 py-2.5 text-xs">{d.tripsAssigned}</td>
                      <td className="px-3 py-2.5 text-xs font-semibold">{d.tripsCompleted}</td>
                      <td className="px-3 py-2.5 text-xs text-danger">{d.tripsFailed || "—"}</td>
                      <td className="px-3 py-2.5 text-xs">{pct(d.completionRate)}</td>
                      <td className="px-3 py-2.5 text-xs">
                        {d.slaEligible > 0 ? `${pct(d.onTimeRate)} (${d.slaEligible} orders)` : "N/A"}
                      </td>
                      <td className="px-3 py-2.5 text-xs">{d.avgTripDurationMinutes != null ? `${d.avgTripDurationMinutes} min` : "—"}</td>
                      <td className="px-3 py-2.5 text-xs">{sar(d.approvedExpensesSar)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </PageContainer>
    </AdminShell>
  );
}
