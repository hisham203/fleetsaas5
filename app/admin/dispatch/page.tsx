"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useRequireSession } from "@/lib/useSession";
import AdminShell from "@/components/AdminShell";
import KpiCard from "@/components/KpiCard";
import StatusBadge from "@/components/StatusBadge";

// Milestone Q, Gate Q4 — Dispatch Control Tower. A read-mostly unified
// view across the whole demand lifecycle (new demand through billing),
// built entirely on the existing /api/control-tower aggregation endpoint
// and lib/controlTowerStatus.ts's normalized status functions. This page
// does not duplicate any dispatch business logic — every action link
// below points at the existing, already-protected /dispatch console
// (which owns assignment, loading confirmation, and dispatch itself) or
// /admin/contracts (which owns billing), rather than reimplementing any
// of those transitions here.
const FILTERS = [
  "All",
  "New",
  "Ready for Planning",
  "Waiting Assignment",
  "Assigned/Waiting Loading",
  "Loaded",
  "In Transit",
  "Delivered",
  "Pending Billing",
  "Exceptions",
] as const;

const STATUS_TO_FILTER: Record<string, (typeof FILTERS)[number]> = {
  NEW: "New",
  READY_FOR_PLANNING: "Ready for Planning",
  WAITING_ASSIGNMENT: "Waiting Assignment",
  ASSIGNED_WAITING_LOADING: "Assigned/Waiting Loading",
  LOADED: "Loaded",
  IN_TRANSIT: "In Transit",
  DELIVERED: "Delivered",
  EXCEPTION: "Exceptions",
  CANCELLED: "All",
};

// Milestone S, Part 8: accepts contractId/customerId/tripId/orderId query
// params for cross-navigation context (e.g. from Contract Management's
// "View active trips"). Filters to matching rows when present, with a
// clear "Showing filtered results" indicator and a one-click reset —
// deliberately not a full search/filter engine, just context
// preservation, per this milestone's own scope.
export default function DispatchControlTowerPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-paper flex items-center justify-center text-steel text-sm">Loading…</div>}>
      <DispatchControlTowerPageInner />
    </Suspense>
  );
}

function DispatchControlTowerPageInner() {
  const { session, loading: sessionLoading } = useRequireSession(["ADMIN", "DISPATCHER"]);
  const searchParams = useSearchParams();
  const contextContractId = searchParams.get("contractId");
  const contextCustomerId = searchParams.get("customerId");
  const contextTripId = searchParams.get("tripId");
  const contextOrderId = searchParams.get("orderId");
  const hasContext = !!(contextContractId || contextCustomerId || contextTripId || contextOrderId);
  const [tenant, setTenant] = useState<any>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("All");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    const tRes = await fetch("/api/tenant");
    if (tRes.ok) setTenant(await tRes.json());
    const res = await fetch("/api/control-tower");
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(typeof data.error === "string" ? data.error : "Failed to load Control Tower data");
      setLoading(false);
      return;
    }
    setError("");
    setRows(await res.json());
    setLoading(false);
  }, [session]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, [load]);

  if (sessionLoading || !session) {
    return <div className="min-h-screen bg-paper flex items-center justify-center text-steel text-sm">Loading…</div>;
  }

  // Q37: every KPI below is a real count over the rows this tenant's own
  // data produced this load — none of these numbers are hardcoded or
  // simulated.
  const kpi = {
    newDemand: rows.filter((r) => r.operationalStatus === "NEW" || r.operationalStatus === "READY_FOR_PLANNING").length,
    waitingAssignment: rows.filter((r) => r.operationalStatus === "WAITING_ASSIGNMENT").length,
    waitingLoading: rows.filter((r) => r.operationalStatus === "ASSIGNED_WAITING_LOADING").length,
    inTransit: rows.filter((r) => r.operationalStatus === "IN_TRANSIT" || r.operationalStatus === "LOADED").length,
    deliveredToday: rows.filter((r) => r.operationalStatus === "DELIVERED" && r.createdAt && new Date(r.createdAt).toDateString() === new Date().toDateString()).length,
    pendingBilling: rows.filter((r) => r.billingStatus === "PENDING_BILLING").length,
    exceptions: rows.filter((r) => r.operationalStatus === "EXCEPTION").length,
  };

  const statusFilteredRows = filter === "All" ? rows : rows.filter((r) => STATUS_TO_FILTER[r.operationalStatus] === filter);
  const filteredRows = hasContext
    ? statusFilteredRows.filter(
        (r) =>
          (!contextContractId || r.contract?.id === contextContractId) &&
          (!contextCustomerId || r.customer?.id === contextCustomerId) &&
          (!contextTripId || r.tripId === contextTripId) &&
          (!contextOrderId || r.orderId === contextOrderId)
      )
    : statusFilteredRows;

  return (
    <AdminShell title="Dispatch Control Tower" tenantName={tenant?.name}>
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          <KpiCard label="New Demand" value={kpi.newDemand} />
          <KpiCard label="Waiting Assignment" value={kpi.waitingAssignment} tone={kpi.waitingAssignment > 0 ? "warn" : "default"} />
          <KpiCard label="Waiting Loading" value={kpi.waitingLoading} tone={kpi.waitingLoading > 0 ? "warn" : "default"} />
          <KpiCard label="In Transit" value={kpi.inTransit} />
          <KpiCard label="Delivered Today" value={kpi.deliveredToday} tone="ok" />
          <KpiCard label="Pending Billing" value={kpi.pendingBilling} />
          <KpiCard label="Exceptions" value={kpi.exceptions} tone={kpi.exceptions > 0 ? "danger" : "default"} />
        </div>

        {hasContext && (
          <div className="bg-aqua/10 border border-aqua/30 rounded-lg px-4 py-2 text-sm flex items-center justify-between">
            <span className="text-aquaDark">Showing filtered results for the linked {contextContractId ? "contract" : contextCustomerId ? "customer" : contextTripId ? "trip" : "order"}.</span>
            <a href="/admin/dispatch" className="text-aquaDark hover:underline text-xs font-medium">View all</a>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${filter === f ? "bg-ink text-white border-ink" : "bg-white text-steel border-slate-200 hover:border-ink"}`}
            >
              {f}
            </button>
          ))}
        </div>

        {error && <p className="text-danger text-sm">{error}</p>}

        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          {loading ? (
            <p className="p-6 text-steel text-sm">Loading…</p>
          ) : filteredRows.length === 0 ? (
            contextContractId ? (
              <div className="p-6 text-center text-sm">
                <p className="text-steel">No active operational trips/orders for this contract yet.</p>
                <p className="mt-2">
                  <a href={`/admin/contract-planner?contractId=${contextContractId}`} className="text-aquaDark hover:underline">Back to Planner</a>
                  {" · "}
                  <a href={`/admin/contracts?contractId=${contextContractId}`} className="text-aquaDark hover:underline">View in Contract Management</a>
                </p>
              </div>
            ) : (
              <p className="p-6 text-steel text-sm text-center">No demand matches this filter.</p>
            )
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-paper text-steel text-xs uppercase">
                  <tr>
                    <th className="text-left px-4 py-2">Order</th>
                    <th className="text-left px-4 py-2">Source</th>
                    <th className="text-left px-4 py-2">Customer</th>
                    <th className="text-left px-4 py-2">Site</th>
                    <th className="text-left px-4 py-2">Contract</th>
                    <th className="text-left px-4 py-2">Loading Point</th>
                    <th className="text-left px-4 py-2">Vehicle</th>
                    <th className="text-left px-4 py-2">Driver</th>
                    <th className="text-left px-4 py-2">Operational Status</th>
                    <th className="text-left px-4 py-2">Billing Status</th>
                    <th className="text-left px-4 py-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((r) => (
                    <tr key={r.orderId} className="border-t border-slate-100">
                      <td className="px-4 py-2 font-medium">{r.orderNumber}</td>
                      <td className="px-4 py-2"><StatusBadge status={r.source} /></td>
                      <td className="px-4 py-2">{r.customer?.name ?? "—"}</td>
                      <td className="px-4 py-2 text-steel">{r.site?.label ?? r.deliveryAddress ?? "—"}</td>
                      <td className="px-4 py-2 text-steel">{r.contract?.contractNumber ?? "Not on contract"}</td>
                      <td className="px-4 py-2 text-steel">{r.loadingPoint?.name ?? "Not assigned"}</td>
                      <td className="px-4 py-2 text-steel">{r.vehicle?.plateNumber ?? "Not assigned"}</td>
                      <td className="px-4 py-2 text-steel">{r.driver?.name ?? "Not assigned"}</td>
                      <td className="px-4 py-2"><StatusBadge status={r.operationalStatus} /></td>
                      <td className="px-4 py-2"><StatusBadge status={r.billingStatus} /></td>
                      <td className="px-4 py-2">
                        {r.tripId ? (
                          <a href={`/dispatch?tripId=${r.tripId}`} className="text-aquaDark hover:underline text-xs font-medium">Open in Dispatch</a>
                        ) : (
                          <a href={`/dispatch?orderId=${r.orderId}`} className="text-aquaDark hover:underline text-xs font-medium">Plan / Assign</a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AdminShell>
  );
}
