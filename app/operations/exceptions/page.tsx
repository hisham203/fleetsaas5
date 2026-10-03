"use client";
/**
 * Exception Center V2 — Milestone B
 * Strengthens the existing exception surface with filters and actionable context.
 */
import { useEffect, useState, useCallback } from "react";
import AdminShell from "@/components/AdminShell";
import {
  PageContainer, PageHeader, StatusBadge, FilterBar,
  EmptyState, LoadingState, Btn, MetricCard,
} from "@/components/ds";

type Exception = {
  id: string; orderId: string; tripStopId: string;
  type: string; reason?: string; status: string;
  escalated: boolean; createdAt: string; resolvedAt?: string;
  resolutionAction?: string; resolutionNotes?: string;
  order?: {
    orderNumber: string; status: string;
    customer?: { name: string };
  };
};

function elapsed(dt: string) {
  const m = Math.round((Date.now() - new Date(dt).getTime()) / 60000);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

const TYPE_LABEL: Record<string, string> = {
  FAILED: "Failed delivery",
  PARTIALLY_DELIVERED: "Partial delivery",
};

export default function ExceptionCenterPage() {
  const [exceptions, setExceptions] = useState<Exception[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("OPEN");
  const [search, setSearch] = useState("");
  const [resolving, setResolving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params = statusFilter !== "ALL" ? `?status=${statusFilter}` : "";
    const r = await fetch(`/api/exceptions${params}`);
    if (r.ok) {
      const data = await r.json();
      setExceptions(Array.isArray(data) ? data : []);
    }
    setLoading(false);
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  async function resolve(exc: Exception) {
    setResolving(exc.id);
    const r = await fetch(`/api/exceptions/${exc.id}/resolve`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolutionAction: "RESCHEDULE", resolutionNotes: "Resolved via Operations Workspace" }),
    });
    setResolving(null);
    if (r.ok) load();
  }

  async function escalate(exc: Exception) {
    setResolving(exc.id + "_esc");
    await fetch(`/api/exceptions/${exc.id}/escalate`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
    });
    setResolving(null);
    load();
  }

  const filtered = exceptions.filter(e => {
    const q = search.toLowerCase();
    return !q || (e.order?.orderNumber ?? "").toLowerCase().includes(q) ||
      (e.order?.customer?.name ?? "").toLowerCase().includes(q) ||
      e.type.toLowerCase().includes(q);
  });

  const open = exceptions.filter(e => e.status === "OPEN").length;
  const escalated = exceptions.filter(e => e.escalated).length;
  const resolved = exceptions.filter(e => e.status === "RESOLVED").length;

  return (
    <AdminShell title="Exception Center">
      <PageContainer>
        <PageHeader
          title="Exception Center"
          subtitle="Operational exceptions requiring action"
          breadcrumbs={[{ label: "Operations" }, { label: "Exceptions" }]}
          actions={<Btn variant="ghost" size="sm" onClick={load}>↺ Refresh</Btn>}
        />

        <div className="grid grid-cols-3 gap-3 mb-6">
          <MetricCard label="Open" value={open} accent={open > 0 ? "danger" : "default"} />
          <MetricCard label="Escalated" value={escalated} accent={escalated > 0 ? "warn" : "default"} />
          <MetricCard label="Resolved" value={resolved} accent="ok" />
        </div>

        <FilterBar
          search={search} onSearch={setSearch}
          filters={
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
              className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-aqua/30">
              <option value="ALL">All statuses</option>
              <option value="OPEN">Open</option>
              <option value="RESOLVED">Resolved</option>
            </select>
          }
          onClear={() => { setSearch(""); setStatusFilter("OPEN"); }}
        />

        {loading ? <LoadingState /> : filtered.length === 0 ? (
          <EmptyState title="No exceptions found"
            description={statusFilter === "OPEN" ? "No open exceptions — operations running cleanly." : "No exceptions match filters."} />
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-paper">
                    {["Order", "Type", "Customer", "Status", "Escalated", "Reason", "Age", "Actions"].map(h => (
                      <th key={h} className="text-start text-xs font-semibold text-steel px-4 py-3 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map(exc => (
                    <tr key={exc.id} className="hover:bg-paper">
                      <td className="px-4 py-3 text-sm font-semibold text-ink">{exc.order?.orderNumber ?? "—"}</td>
                      <td className="px-4 py-3 text-sm text-steel">{TYPE_LABEL[exc.type] ?? exc.type}</td>
                      <td className="px-4 py-3 text-sm text-ink">{exc.order?.customer?.name ?? "—"}</td>
                      <td className="px-4 py-3"><StatusBadge status={exc.status} size="xs" /></td>
                      <td className="px-4 py-3 text-center">
                        {exc.escalated ? <span className="text-2xs text-danger font-semibold">Yes</span> : "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-steel max-w-xs truncate">{exc.reason ?? exc.resolutionAction ?? "—"}</td>
                      <td className="px-4 py-3 text-xs text-steel">{elapsed(exc.createdAt)}</td>
                      <td className="px-4 py-3">
                        {exc.status === "OPEN" && (
                          <div className="flex gap-1">
                            <Btn variant="secondary" size="xs"
                              onClick={() => resolve(exc)}
                              disabled={resolving === exc.id}>
                              {resolving === exc.id ? "…" : "Resolve"}
                            </Btn>
                            {!exc.escalated && (
                              <Btn variant="ghost" size="xs"
                                onClick={() => escalate(exc)}
                                disabled={resolving === exc.id + "_esc"}>
                                {resolving === exc.id + "_esc" ? "…" : "Escalate"}
                              </Btn>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2.5 border-t border-slate-100 text-xs text-steel">
              {filtered.length} exceptions
            </div>
          </div>
        )}
      </PageContainer>
    </AdminShell>
  );
}
