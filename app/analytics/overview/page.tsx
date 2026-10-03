"use client";
import { useState, useEffect, useCallback } from "react";
import AdminShell from "@/components/AdminShell";
import { PageContainer, PageHeader, LoadingState } from "@/components/ds";
import DateRangePicker, { presetRange, isoDate } from "@/components/DateRangePicker";
import Link from "next/link";

type Ops = { ordersCreated: number; tripsCompleted: number; tripsFailed: number; tripCompletionRate: number | null; slaComplianceRate: number | null; exceptionsCreated: number };
type Fleet = { totalVehicles: number; activeVehicles: number; vehiclesWithDevices: number; vehiclesOnTrip: number; tripsPerVehicle: number | null };
type Costs = { totalRecordedOperatingCostSar: number; totalFuelCostSar: number; totalMaintenanceCostSar: number };
type Telemetry = { telemetryCoveragePercent: number | null; devicePings: number; driverAppPings: number; demoPings: number; openAlerts: number };

interface Data { operations: Ops; operationsPrevious: Ops; fleet: Fleet; costs: Costs; telematics: Telemetry }

function KpiCard({ label, value, sub, href, delta, warn }: { label: string; value: string; sub?: string; href?: string; delta?: number | null; warn?: boolean }) {
  const Wrapper = href ? Link : "div";
  return (
    <Wrapper href={href ?? "#"} className={`bg-white rounded-xl border ${warn ? "border-warn/40" : "border-slate-200"} shadow-card p-4 ${href ? "hover:shadow-lg transition-shadow cursor-pointer" : ""}`}>
      <p className="text-xs text-steel mb-1.5">{label}</p>
      <p className="text-2xl font-bold text-ink leading-none">{value}</p>
      {sub && <p className="text-xs text-steel mt-1">{sub}</p>}
      {delta != null && (
        <p className={`text-xs mt-1.5 font-medium ${delta >= 0 ? "text-ok" : "text-danger"}`}>
          {delta >= 0 ? "↑" : "↓"} {Math.abs(delta).toFixed(1)}% vs prior period
        </p>
      )}
    </Wrapper>
  );
}

function pct(v: number | null) { return v != null ? `${(v * 100).toFixed(1)}%` : "N/A"; }
function sar(v: number) { return v > 0 ? `SAR ${v.toLocaleString("en-SA", { maximumFractionDigits: 0 })}` : "SAR 0"; }
function delta(cur: number | null, prev: number | null) {
  if (cur == null || prev == null || prev === 0) return null;
  return Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10;
}

export default function AnalyticsOverviewPage() {
  const initial = presetRange("last30");
  const [range, setRange] = useState(initial);
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/analytics/overview?from=${range.from}&to=${range.to}`).catch(() => null);
    if (res?.ok) setData(await res.json());
    setLoading(false);
  }, [range.from, range.to]);

  useEffect(() => { load(); }, [load]);

  const o = data?.operations, op = data?.operationsPrevious, f = data?.fleet, c = data?.costs, t = data?.telematics;

  return (
    <AdminShell title="Analytics Overview">
      <PageContainer>
        <PageHeader
          title="Analytics Overview"
          subtitle="Operational performance intelligence — period performance, not real-time"
          breadcrumbs={[{ label: "Analytics" }, { label: "Overview" }]}
        />

        <div className="mb-4">
          <DateRangePicker value={range} onChange={r => setRange(r)} />
        </div>

        {loading ? <LoadingState /> : !data ? (
          <p className="text-sm text-steel">No data available.</p>
        ) : (
          <div className="space-y-6">
            {/* Operations KPIs */}
            <section>
              <h2 className="text-xs font-semibold text-steel uppercase tracking-wide mb-3">Operations</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <KpiCard label="Orders" value={String(o?.ordersCreated ?? 0)} href="/analytics/operations" delta={delta(o?.ordersCreated ?? null, op?.ordersCreated ?? null)} />
                <KpiCard label="Trips Completed" value={String(o?.tripsCompleted ?? 0)} delta={delta(o?.tripsCompleted ?? null, op?.tripsCompleted ?? null)} />
                <KpiCard label="Trips Failed" value={String(o?.tripsFailed ?? 0)} warn={(o?.tripsFailed ?? 0) > 0} />
                <KpiCard label="Completion Rate" value={pct(o?.tripCompletionRate ?? null)} delta={delta(o?.tripCompletionRate ?? null, op?.tripCompletionRate ?? null)} />
                <KpiCard label="SLA Compliance" value={pct(o?.slaComplianceRate ?? null)} warn={(o?.slaComplianceRate ?? 1) < 0.9} />
                <KpiCard label="Open Alerts" value={String(t?.openAlerts ?? 0)} warn={(t?.openAlerts ?? 0) > 0} href="/telematics/alerts" />
              </div>
            </section>

            {/* Fleet KPIs */}
            <section>
              <h2 className="text-xs font-semibold text-steel uppercase tracking-wide mb-3">Fleet</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                <KpiCard label="Active Vehicles" value={String(f?.activeVehicles ?? 0)} href="/analytics/fleet" />
                <KpiCard label="On Trip Now" value={String(f?.vehiclesOnTrip ?? 0)} />
                <KpiCard label="With Device" value={String(f?.vehiclesWithDevices ?? 0)} sub={f ? `of ${f.totalVehicles}` : undefined} />
                <KpiCard label="Trips / Vehicle" value={f?.tripsPerVehicle != null ? String(f.tripsPerVehicle) : "N/A"} sub="completed, period" />
                <KpiCard label="Telemetry Coverage" value={pct(t?.telemetryCoveragePercent ?? null)} warn={(t?.telemetryCoveragePercent ?? 1) < 0.8} href="/analytics/telematics" />
              </div>
            </section>

            {/* Cost KPIs */}
            <section>
              <h2 className="text-xs font-semibold text-steel uppercase tracking-wide mb-3">Recorded Cost</h2>
              <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <KpiCard label="Recorded Operating Cost" value={sar(c?.totalRecordedOperatingCostSar ?? 0)} href="/analytics/costs" />
                <KpiCard label="Fuel Cost" value={sar(c?.totalFuelCostSar ?? 0)} />
                <KpiCard label="Maintenance Cost" value={sar(c?.totalMaintenanceCostSar ?? 0)} />
                <KpiCard label="GPS Source: DEVICE" value={String(t?.devicePings ?? 0)} sub={`App: ${t?.driverAppPings ?? 0} · Demo: ${t?.demoPings ?? 0}`} href="/analytics/telematics" />
              </div>
              <p className="text-2xs text-steel mt-2">Cost per trip not shown — vehicle-period costs cannot be defensibly allocated to individual trips without a documented methodology.</p>
            </section>

            {/* Quick links */}
            <section>
              <div className="flex flex-wrap gap-2">
                {[
                  { href: "/analytics/operations", label: "Operations & SLA →" },
                  { href: "/analytics/fleet",      label: "Fleet Performance →" },
                  { href: "/analytics/drivers",    label: "Driver Performance →" },
                  { href: "/analytics/costs",      label: "Cost Intelligence →" },
                  { href: "/analytics/telematics", label: "Telematics Quality →" },
                ].map(l => (
                  <Link key={l.href} href={l.href}
                    className="text-xs bg-white border border-slate-200 rounded-lg px-3 py-2 text-aqua hover:bg-paper">
                    {l.label}
                  </Link>
                ))}
              </div>
            </section>
          </div>
        )}
      </PageContainer>
    </AdminShell>
  );
}
