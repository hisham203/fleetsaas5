"use client";
import { useState, useEffect, useCallback } from "react";
import AdminShell from "@/components/AdminShell";
import { PageContainer, PageHeader, LoadingState, EmptyState } from "@/components/ds";
import DateRangePicker, { presetRange } from "@/components/DateRangePicker";
import Link from "next/link";
import type { CostMetrics, VehicleAnalyticsRow } from "@/lib/analyticsMetrics";

function sar(v: number) { return v > 0 ? `SAR ${v.toLocaleString("en-SA", { maximumFractionDigits: 0 })}` : "SAR 0" }

export default function CostAnalyticsPage() {
  const [range, setRange] = useState(presetRange("last30"));
  const [data, setData] = useState<{ costs: CostMetrics; vehicleCosts: VehicleAnalyticsRow[] } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/analytics/costs?from=${range.from}&to=${range.to}`).catch(() => null);
    if (res?.ok) { const j = await res.json(); setData({ costs: j.costs, vehicleCosts: j.vehicleCosts }); }
    setLoading(false);
  }, [range.from, range.to]);

  useEffect(() => { load(); }, [load]);

  const c = data?.costs;
  const vs = (data?.vehicleCosts ?? []).filter(v => v.recordedOperatingCostSar > 0).sort((a, b) => b.recordedOperatingCostSar - a.recordedOperatingCostSar);

  return (
    <AdminShell title="Cost Intelligence">
      <PageContainer>
        <PageHeader title="Fleet Cost Intelligence"
          subtitle="Recorded fuel, maintenance, tyre, and approved expense costs. Read-only — no financial posting."
          breadcrumbs={[{ label: "Analytics" }, { label: "Costs" }]} />
        <div className="mb-4"><DateRangePicker value={range} onChange={r => setRange(r)} /></div>
        {loading ? <LoadingState /> : !c ? <EmptyState title="No cost data" description="No recorded costs in this period." /> : (
          <div className="space-y-5">
            {/* Cost summary */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {[
                { label: "Total Recorded Cost", value: sar(c.totalRecordedOperatingCostSar), highlight: true },
                { label: "Fuel Cost",            value: sar(c.totalFuelCostSar) },
                { label: "Maintenance Cost",     value: sar(c.totalMaintenanceCostSar) },
                { label: "Tyre Cost",            value: sar(c.totalTyreCostSar) },
                { label: "Approved Expenses",    value: sar(c.totalApprovedExpensesSar) },
              ].map(k => (
                <div key={k.label} className={`bg-white rounded-xl border ${k.highlight ? "border-aqua/30" : "border-slate-200"} shadow-card p-4`}>
                  <p className="text-xs text-steel mb-1">{k.label}</p>
                  <p className="text-xl font-bold text-ink">{k.value}</p>
                </div>
              ))}
            </div>

            {/* Expense breakdown */}
            {c.totalApprovedExpensesSar > 0 && (
              <div className="bg-white rounded-xl border border-slate-200 shadow-card p-5">
                <h3 className="text-sm font-semibold text-ink mb-3">Approved Expense Claims by Category</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: "Fuel",        value: c.fuelExpenseClaimsSar },
                    { label: "Toll",        value: c.tollExpenseClaimsSar },
                    { label: "Maintenance", value: c.maintenanceExpenseClaimsSar },
                    { label: "Other",       value: c.otherExpenseClaimsSar },
                  ].map(k => (
                    <div key={k.label}>
                      <p className="text-xs text-steel">{k.label}</p>
                      <p className="text-sm font-semibold text-ink">{sar(k.value)}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Vehicle cost table */}
            {vs.length > 0 && (
              <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-100">
                  <h3 className="text-sm font-semibold text-ink">Vehicle Cost Breakdown</h3>
                  <p className="text-2xs text-steel mt-0.5">Recorded costs per vehicle. Cost per trip is not shown — vehicle-period costs cannot be defensibly allocated to individual trips.</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="bg-paper border-b border-slate-100">
                      {["Vehicle","Fuel","Maintenance","Tyres","Expenses","Total Recorded"].map(h =>
                        <th key={h} className="text-start text-xs font-semibold text-steel px-3 py-2">{h}</th>)}
                    </tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {vs.map(v => (
                        <tr key={v.vehicleId} className="hover:bg-paper">
                          <td className="px-3 py-2.5"><Link href={`/fleet/vehicles/${v.vehicleId}`} className="text-aqua hover:underline text-xs font-mono">{v.plateNumber}</Link></td>
                          <td className="px-3 py-2.5 text-xs">{v.fuelCostSar > 0 ? sar(v.fuelCostSar) : "—"}</td>
                          <td className="px-3 py-2.5 text-xs">{v.maintenanceCostSar > 0 ? sar(v.maintenanceCostSar) : "—"}</td>
                          <td className="px-3 py-2.5 text-xs">{v.tyreCostSar > 0 ? sar(v.tyreCostSar) : "—"}</td>
                          <td className="px-3 py-2.5 text-xs">{v.approvedExpensesSar > 0 ? sar(v.approvedExpensesSar) : "—"}</td>
                          <td className="px-3 py-2.5 text-xs font-semibold">{sar(v.recordedOperatingCostSar)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </PageContainer>
    </AdminShell>
  );
}
