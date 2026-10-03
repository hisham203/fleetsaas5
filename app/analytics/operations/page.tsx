"use client";
import { useState, useEffect, useCallback } from "react";
import AdminShell from "@/components/AdminShell";
import { PageContainer, PageHeader, LoadingState, EmptyState } from "@/components/ds";
import DateRangePicker, { presetRange } from "@/components/DateRangePicker";
import type { OperationsMetrics } from "@/lib/analyticsMetrics";

function Row({ label, value, sub, ok }: { label: string; value: string; sub?: string; ok?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-slate-100 last:border-0">
      <span className="text-sm text-ink">{label}</span>
      <div className="text-right">
        <span className={`text-sm font-semibold ${ok === false ? "text-danger" : ok === true ? "text-ok" : "text-ink"}`}>{value}</span>
        {sub && <p className="text-2xs text-steel">{sub}</p>}
      </div>
    </div>
  );
}

function pct(v: number | null) { return v != null ? `${(v * 100).toFixed(1)}%` : "N/A"; }
function delta(cur: number | null, prev: number | null) {
  if (cur == null || prev == null || prev === 0) return "";
  const d = ((cur - prev) / Math.abs(prev) * 100).toFixed(1);
  return Number(d) >= 0 ? `↑${d}%` : `↓${Math.abs(Number(d))}%`;
}

export default function OperationsAnalyticsPage() {
  const [range, setRange] = useState(presetRange("last30"));
  const [data, setData] = useState<{ current: OperationsMetrics; previous: OperationsMetrics | null } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/analytics/operations?from=${range.from}&to=${range.to}`).catch(() => null);
    if (res?.ok) { const j = await res.json(); setData({ current: j.current, previous: j.previous }); }
    setLoading(false);
  }, [range.from, range.to]);

  useEffect(() => { load(); }, [load]);

  const c = data?.current, p = data?.previous;

  return (
    <AdminShell title="Operations & SLA">
      <PageContainer>
        <PageHeader title="Operations & SLA" subtitle="Trips, orders, delivery performance, and service-level compliance."
          breadcrumbs={[{ label: "Analytics" }, { label: "Operations & SLA" }]} />
        <div className="mb-4"><DateRangePicker value={range} onChange={r => setRange(r)} /></div>
        {loading ? <LoadingState /> : !c ? <EmptyState title="No data" description="No operational data in this period." /> : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-white rounded-xl border border-slate-200 shadow-card p-5">
              <h3 className="text-sm font-semibold text-ink mb-3">Orders</h3>
              <Row label="Created" value={String(c.ordersCreated)} sub={p ? `prev: ${p.ordersCreated}  ${delta(c.ordersCreated, p.ordersCreated)}` : undefined} />
              <Row label="Delivered" value={String(c.ordersDelivered)} ok={c.ordersDelivered > 0} />
              <Row label="Failed" value={String(c.ordersFailed)} ok={c.ordersFailed === 0} />
              <Row label="Cancelled" value={String(c.ordersCancelled)} />
            </div>
            <div className="bg-white rounded-xl border border-slate-200 shadow-card p-5">
              <h3 className="text-sm font-semibold text-ink mb-3">Trips</h3>
              <Row label="Planned" value={String(c.tripsPlanned)} />
              <Row label="Dispatched" value={String(c.tripsDispatched)} />
              <Row label="Completed" value={String(c.tripsCompleted)} ok={c.tripsCompleted > 0} />
              <Row label="Failed" value={String(c.tripsFailed)} ok={c.tripsFailed === 0} />
              <Row label="Completion Rate" value={pct(c.tripCompletionRate)} ok={c.tripCompletionRate != null && c.tripCompletionRate >= 0.9} />
              {c.avgTripDurationMinutes != null && <Row label="Avg Trip Duration" value={`${c.avgTripDurationMinutes} min`} />}
            </div>
            <div className="bg-white rounded-xl border border-slate-200 shadow-card p-5">
              <h3 className="text-sm font-semibold text-ink mb-3">SLA Performance</h3>
              {c.slaEligibleOrders === 0 ? (
                <p className="text-sm text-steel">No SLA-eligible orders in this period.</p>
              ) : (
                <>
                  <Row label="Eligible Orders" value={String(c.slaEligibleOrders)} sub="terminal orders with SLA minutes set" />
                  <Row label="Met" value={String(c.slaMet)} ok />
                  <Row label="Missed" value={String(c.slaMissed)} ok={c.slaMissed === 0} />
                  <Row label="Breached" value={String(c.slaBreached)} ok={c.slaBreached === 0} />
                  <Row label="Compliance Rate" value={pct(c.slaComplianceRate)} ok={c.slaComplianceRate != null && c.slaComplianceRate >= 0.9} />
                </>
              )}
            </div>
            <div className="bg-white rounded-xl border border-slate-200 shadow-card p-5">
              <h3 className="text-sm font-semibold text-ink mb-3">Alerts & Exceptions</h3>
              <Row label="Alerts Created" value={String(c.exceptionsCreated)} />
              <Row label="Alerts Resolved" value={String(c.exceptionsResolved)} ok={c.exceptionsResolved === c.exceptionsCreated} />
              {c.exceptionsCreated > 0 && <Row label="Resolution Rate" value={pct(c.exceptionsCreated > 0 ? c.exceptionsResolved / c.exceptionsCreated : null)} />}
            </div>
          </div>
        )}
      </PageContainer>
    </AdminShell>
  );
}
