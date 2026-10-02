"use client";
/**
 * Events & Alerts Workspace
 * Route: /telematics/alerts
 * Operational alert center — acknowledge, resolve, filter, deep-link.
 */
import { useState, useEffect, useCallback } from "react";
import AdminShell from "@/components/AdminShell";
import { PageContainer, PageHeader, StatusBadge, EmptyState, LoadingState, Btn, FilterBar } from "@/components/ds";
import Link from "next/link";

interface Alert {
  id: string; eventType: string; severity: string; status: string;
  vehicleId: string | null; deviceId: string | null; tripId: string | null;
  driverId: string | null; source: string; lat: number | null; lng: number | null;
  eventAt: string; acknowledgedBy: string | null; acknowledgedAt: string | null;
  resolvedBy: string | null; resolvedAt: string | null; metadata: any;
}

const SEV_BADGE: Record<string, string> = {
  CRITICAL: "bg-dangerLight text-danger",
  WARNING:  "bg-warnLight text-warn",
  INFO:     "bg-infoLight text-info",
};

function fmtDt(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-SA", { dateStyle: "short", timeStyle: "short" });
}

function entityRoute(a: Alert): string | null {
  if (a.tripId) return `/operations/trips/${a.tripId}`;
  if (a.vehicleId) return `/fleet/vehicles/${a.vehicleId}`;
  if (a.deviceId) return `/telematics/devices`;
  return null;
}

export default function AlertsWorkspacePage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("OPEN");
  const [severityFilter, setSeverityFilter] = useState("ALL");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ limit: "200" });
    if (statusFilter !== "ALL") params.set("status", statusFilter);
    if (severityFilter !== "ALL") params.set("severity", severityFilter);
    const res = await fetch(`/api/alerts?${params}`).catch(() => null);
    if (res?.ok) setAlerts((await res.json()).alerts ?? []);
    setLoading(false);
  }, [statusFilter, severityFilter]);

  useEffect(() => { load(); }, [load]);

  async function act(alertId: string, action: "acknowledge" | "resolve") {
    setActing(true);
    await fetch(`/api/alerts/${alertId}?action=${action}`, { method: "PATCH" }).catch(() => null);
    setActing(false);
    load();
  }

  async function bulkAcknowledge() {
    if (!selected.size) return;
    setActing(true);
    await Promise.all([...selected].map(id => fetch(`/api/alerts/${id}?action=acknowledge`, { method: "PATCH" })));
    setSelected(new Set()); setActing(false); load();
  }

  const filtered = alerts.filter(a =>
    !search ||
    a.eventType.toLowerCase().includes(search.toLowerCase()) ||
    (a.vehicleId ?? "").toLowerCase().includes(search.toLowerCase()) ||
    (a.tripId ?? "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <AdminShell title="Events & Alerts">
      <PageContainer>
        <PageHeader
          title="Events & Alerts"
          subtitle="Operational alert workspace — acknowledge conditions, resolve issues, deep-link to affected entities"
          breadcrumbs={[{ label: "Telematics" }, { label: "Alerts" }]}
          actions={
            <div className="flex gap-2">
              {selected.size > 0 && (
                <Btn variant="secondary" size="sm" disabled={acting} onClick={bulkAcknowledge}>
                  Acknowledge {selected.size}
                </Btn>
              )}
              <Btn variant="ghost" size="sm" onClick={load}>↺</Btn>
            </div>
          }
        />

        {/* Filters */}
        <div className="flex flex-wrap gap-2 mb-3">
          <div className="flex gap-1">
            {["OPEN","ACKNOWLEDGED","RESOLVED","ALL"].map(f => (
              <button key={f} onClick={() => setStatusFilter(f)}
                className={`text-xs px-3 py-1.5 rounded-lg font-medium ${statusFilter === f ? "bg-aqua text-white" : "bg-white border border-slate-200 text-steel hover:text-ink"}`}>
                {f}
              </button>
            ))}
          </div>
          <div className="flex gap-1 ml-2">
            {["ALL","CRITICAL","WARNING","INFO"].map(f => (
              <button key={f} onClick={() => setSeverityFilter(f)}
                className={`text-xs px-3 py-1.5 rounded-lg font-medium ${severityFilter === f ? "bg-aqua text-white" : "bg-white border border-slate-200 text-steel hover:text-ink"}`}>
                {f === "ALL" ? "All Severity" : f}
              </button>
            ))}
          </div>
        </div>
        <FilterBar search={search} onSearch={setSearch} onClear={() => setSearch("")} />

        {loading ? <LoadingState /> : filtered.length === 0 ? (
          <EmptyState
            title={statusFilter === "OPEN" ? "No open alerts" : "No alerts match the filter"}
            description={statusFilter === "OPEN" ? "All clear — no active operational conditions." : "Try a different filter."}
          />
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-paper">
                  <th className="px-3 py-3 w-8">
                    <input type="checkbox"
                      checked={selected.size === filtered.filter(a => a.status === "OPEN").length && filtered.filter(a => a.status === "OPEN").length > 0}
                      onChange={e => setSelected(e.target.checked ? new Set(filtered.filter(a => a.status === "OPEN").map(a => a.id)) : new Set())} />
                  </th>
                  {["Event","Severity","Status","Vehicle/Trip","Time","Actions"].map(h => (
                    <th key={h} className="text-left text-xs font-semibold text-steel px-3 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map(a => {
                  const route = entityRoute(a);
                  return (
                    <tr key={a.id} className="hover:bg-paper">
                      <td className="px-3 py-2.5">
                        {a.status === "OPEN" && (
                          <input type="checkbox" checked={selected.has(a.id)}
                            onChange={ev => setSelected(prev => { const n = new Set(prev); ev.target.checked ? n.add(a.id) : n.delete(a.id); return n; })} />
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-xs font-mono font-medium text-ink">{a.eventType}</td>
                      <td className="px-3 py-2.5">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${SEV_BADGE[a.severity] ?? "bg-paper text-steel"}`}>{a.severity}</span>
                      </td>
                      <td className="px-3 py-2.5"><StatusBadge status={a.status} size="xs" /></td>
                      <td className="px-3 py-2.5 text-xs text-steel font-mono">
                        {a.tripId ? <Link href={`/operations/trips/${a.tripId}`} className="text-aqua hover:underline">{a.tripId.slice(-8)}</Link> :
                         a.vehicleId ? <Link href={`/fleet/vehicles/${a.vehicleId}`} className="text-aqua hover:underline">{a.vehicleId.slice(-8)}</Link> :
                         a.deviceId ? <span>{a.deviceId.slice(-8)}</span> : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-steel">{fmtDt(a.eventAt)}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex gap-1.5">
                          {a.status === "OPEN" && (
                            <button onClick={() => act(a.id, "acknowledge")} disabled={acting}
                              className="text-xs text-aqua hover:underline">Ack</button>
                          )}
                          {a.status !== "RESOLVED" && (
                            <button onClick={() => act(a.id, "resolve")} disabled={acting}
                              className="text-xs text-steel hover:text-ink">Resolve</button>
                          )}
                          {route && <Link href={route} className="text-xs text-aqua hover:underline">View →</Link>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </PageContainer>
    </AdminShell>
  );
}
