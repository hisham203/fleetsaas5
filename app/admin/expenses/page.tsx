"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import AdminShell from "@/components/AdminShell";
import KpiCard from "@/components/KpiCard";
import StatusBadge from "@/components/StatusBadge";
import { useRequireSession } from "@/lib/useSession";

// Milestone X, Part 3 — Finance Expense Approval Center. This is a
// discoverability fix, not a new capability: GET /api/expenses and
// POST /api/expenses/[id]/approve|reject already existed, fully working
// (tenant-isolated, ADMIN-only approve/reject, PENDING-only guard,
// required rejection reason) — they were just buried two clicks deep
// under Field Ops > Expenses, a label nobody looking for "expense
// approval" would think to check, since Milestone R's sidebar
// migration. This page is a pure UI addition reusing those same,
// unmodified APIs — the old Field Ops sub-tab is left working exactly
// as it was (no capability removed), this is simply the new,
// discoverable home for the same data.
//
// useSearchParams() requires a Suspense boundary, the same Next.js
// requirement every other admin page with query-param filtering
// already handles the same way.
export default function ExpensesPage() {
  return (
    <Suspense fallback={<AdminShell title="Expenses"><p className="p-6 text-steel">Loading…</p></AdminShell>}>
      <ExpensesPageInner />
    </Suspense>
  );
}

function ExpensesPageInner() {
  const { session, loading: sessionLoading } = useRequireSession(["ADMIN"]);
  const searchParams = useSearchParams();
  // Milestone X, Part 6 — a vehicle's "View in Finance" link deep-links
  // here with ?vehicleId=, filtering to just that vehicle's expenses.
  const vehicleIdFilter = searchParams.get("vehicleId");
  const [tenant, setTenant] = useState<any>(null);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "PENDING" | "APPROVED" | "REJECTED">("PENDING");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    const tRes = await fetch("/api/tenant");
    if (tRes.ok) setTenant(await tRes.json());
    const res = await fetch("/api/expenses");
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(typeof data.error === "string" ? data.error : "Failed to load expenses");
      setLoading(false);
      return;
    }
    setError("");
    setExpenses(await res.json());
    setLoading(false);
  }, [session]);

  useEffect(() => {
    load();
  }, [load]);

  async function approve(id: string) {
    setBusyId(id);
    await fetch(`/api/expenses/${id}/approve`, { method: "POST" });
    setBusyId(null);
    load();
  }

  async function reject(id: string) {
    setBusyId(id);
    await fetch(`/api/expenses/${id}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewNotes: rejectReason }),
    });
    setBusyId(null);
    setRejectingId(null);
    setRejectReason("");
    load();
  }

  if (sessionLoading || !session) {
    return <div className="min-h-screen bg-paper flex items-center justify-center text-steel text-sm">Loading…</div>;
  }

  const pending = expenses.filter((e) => e.status === "PENDING");
  const approved = expenses.filter((e) => e.status === "APPROVED");
  const rejected = expenses.filter((e) => e.status === "REJECTED");
  const totalPendingAmount = pending.reduce((sum, e) => sum + e.amount, 0);
  const totalApprovedAmount = approved.reduce((sum, e) => sum + e.amount, 0);

  const filtered = expenses.filter((e) => {
    if (vehicleIdFilter && e.vehicleId !== vehicleIdFilter) return false;
    if (statusFilter !== "ALL" && e.status !== statusFilter) return false;
    return true;
  });

  return (
    <AdminShell title="Expenses" tenantName={tenant?.name}>
      <div className="p-6 max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-lg font-semibold">Expenses</h1>
          <p className="text-steel text-sm mt-0.5">Review driver, trip, vehicle, and maintenance expense requests.</p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <KpiCard label="Pending" value={pending.length} tone={pending.length > 0 ? "warn" : "default"} />
          <KpiCard label="Approved" value={approved.length} tone="ok" />
          <KpiCard label="Rejected" value={rejected.length} />
          <KpiCard label="Pending amount" value={totalPendingAmount.toLocaleString(undefined, { style: "currency", currency: "SAR" })} tone={totalPendingAmount > 0 ? "warn" : "default"} />
          <KpiCard label="Approved amount" value={totalApprovedAmount.toLocaleString(undefined, { style: "currency", currency: "SAR" })} tone="ok" />
        </div>

        {vehicleIdFilter && (
          <div className="bg-aqua/10 text-aquaDark rounded-lg px-3 py-2 text-sm flex items-center justify-between">
            <span>Filtered to one vehicle&apos;s expenses.</span>
            <a href="/admin/expenses" className="underline text-xs font-medium">Clear filter</a>
          </div>
        )}

        <div className="flex gap-2">
          {(["PENDING", "APPROVED", "REJECTED", "ALL"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border capitalize ${statusFilter === s ? "bg-ink text-white border-ink" : "bg-white text-steel border-slate-200 hover:border-ink"}`}
            >
              {s === "ALL" ? "All" : s.charAt(0) + s.slice(1).toLowerCase()}
            </button>
          ))}
        </div>

        {error && <p className="text-danger text-sm">{error}</p>}

        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          {loading ? (
            <p className="p-6 text-steel text-sm">Loading…</p>
          ) : filtered.length === 0 ? (
            <p className="p-6 text-steel text-sm text-center">No expense requests found for this filter.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-paper text-steel text-xs uppercase">
                  <tr>
                    <th className="text-left px-4 py-2">Submitted</th>
                    <th className="text-left px-4 py-2">Driver</th>
                    <th className="text-left px-4 py-2">Vehicle</th>
                    <th className="text-left px-4 py-2">Trip</th>
                    <th className="text-left px-4 py-2">Category</th>
                    <th className="text-left px-4 py-2">Amount</th>
                    <th className="text-left px-4 py-2">Notes</th>
                    <th className="text-left px-4 py-2">Status</th>
                    <th className="text-left px-4 py-2">Reviewed by</th>
                    <th className="text-left px-4 py-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((e) => (
                    <tr key={e.id} className="border-t border-slate-100 align-top">
                      <td className="px-4 py-2 text-steel">{new Date(e.createdAt).toLocaleDateString()}</td>
                      <td className="px-4 py-2">{e.driver?.user?.name ?? "—"}</td>
                      <td className="px-4 py-2 text-steel">{e.vehicle?.plateNumber ?? "—"}</td>
                      <td className="px-4 py-2 text-steel">
                        {e.trip ? (
                          <a href={`/admin/dispatch?tripId=${e.trip.id}`} className="text-aquaDark hover:underline">{e.trip.tripNumber}</a>
                        ) : (
                          e.reason ?? "General"
                        )}
                      </td>
                      <td className="px-4 py-2 text-steel">{e.category}</td>
                      <td className="px-4 py-2 font-medium">{e.amount.toLocaleString(undefined, { style: "currency", currency: "SAR" })}</td>
                      <td className="px-4 py-2 text-steel max-w-[180px] truncate">{e.description ?? "—"}</td>
                      <td className="px-4 py-2"><StatusBadge status={e.status} /></td>
                      <td className="px-4 py-2 text-steel text-xs">
                        {e.status === "PENDING" ? "—" : e.reviewedByUserId ? "Reviewed" : "—"}
                        {e.status === "REJECTED" && e.reviewNotes && <p className="mt-0.5">{e.reviewNotes}</p>}
                      </td>
                      <td className="px-4 py-2">
                        {e.status === "PENDING" ? (
                          rejectingId === e.id ? (
                            <div className="space-y-1">
                              <input
                                className="border rounded px-2 py-1 text-xs w-40"
                                placeholder="Rejection reason"
                                value={rejectReason}
                                onChange={(ev) => setRejectReason(ev.target.value)}
                              />
                              <div className="flex gap-1">
                                <button disabled={!rejectReason.trim() || busyId === e.id} onClick={() => reject(e.id)} className="bg-danger text-white rounded px-2 py-1 text-xs disabled:opacity-40">
                                  Confirm reject
                                </button>
                                <button onClick={() => { setRejectingId(null); setRejectReason(""); }} className="text-steel text-xs">Cancel</button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex gap-1.5">
                              <button disabled={busyId === e.id} onClick={() => approve(e.id)} className="bg-ok text-white rounded px-2 py-1 text-xs font-medium disabled:opacity-40">
                                Approve
                              </button>
                              <button disabled={busyId === e.id} onClick={() => setRejectingId(e.id)} className="border border-slate-200 rounded px-2 py-1 text-xs font-medium">
                                Reject
                              </button>
                            </div>
                          )
                        ) : (
                          <span className="text-steel text-xs">—</span>
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
