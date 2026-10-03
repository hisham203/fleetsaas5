"use client";
/**
 * Telemetry Events & Alerts
 * Route: /telematics/events
 */
import { useState, useEffect, useCallback } from "react";
import AdminShell from "@/components/AdminShell";
import { PageContainer, PageHeader, StatusBadge, EmptyState, LoadingState, Btn, FilterBar } from "@/components/ds";

interface TelemetryEvent {
  id: string; eventType: string; severity: string; status: string;
  vehicleId: string | null; deviceId: string | null; tripId: string | null;
  source: string; lat: number | null; lng: number | null;
  eventAt: string; createdAt: string;
}

const SEVERITY_COLOR: Record<string, string> = {
  INFO: "text-steel", WARNING: "text-warn", CRITICAL: "text-danger",
};

function fmtTime(d: string) {
  return new Date(d).toLocaleString("en-SA", { dateStyle: "short", timeStyle: "short" });
}

export default function TelemetryEventsPage() {
  const [events, setEvents] = useState<TelemetryEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("OPEN");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [acknowledging, setAcknowledging] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter !== "ALL") params.set("status", statusFilter);
    params.set("limit", "200");
    const res = await fetch(`/api/telematics/events?${params}`);
    if (res.ok) setEvents((await res.json()).events ?? []);
    setLoading(false);
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  async function acknowledgeSelected() {
    if (selected.size === 0) return;
    setAcknowledging(true);
    await fetch("/api/telematics/events", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventIds: [...selected] }),
    });
    setSelected(new Set());
    setAcknowledging(false);
    load();
  }

  const filtered = events.filter(e => !search ||
    e.eventType.toLowerCase().includes(search.toLowerCase()) ||
    (e.vehicleId ?? "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <AdminShell title="Telemetry Events">
      <PageContainer>
        <PageHeader
          title="Telemetry Events & Alerts"
          subtitle="GPS state changes, device faults, and telemetry signals"
          breadcrumbs={[{ label: "Telematics" }, { label: "Events" }]}
          actions={
            <div className="flex gap-2">
              {selected.size > 0 && (
                <Btn variant="secondary" size="sm" disabled={acknowledging} onClick={acknowledgeSelected}>
                  {acknowledging ? "Acknowledging…" : `Acknowledge ${selected.size}`}
                </Btn>
              )}
              <Btn variant="ghost" size="sm" onClick={load}>↺</Btn>
            </div>
          }
        />

        <div className="flex gap-2 mb-4">
          {["OPEN","ACKNOWLEDGED","RESOLVED","ALL"].map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-lg ${statusFilter === s ? "bg-aqua text-white" : "bg-white border border-slate-200 text-steel hover:text-ink"}`}>
              {s}
            </button>
          ))}
        </div>

        <FilterBar search={search} onSearch={setSearch} onClear={() => setSearch("")} />

        {loading ? <LoadingState /> : filtered.length === 0 ? (
          <EmptyState title="No telemetry events" description={statusFilter === "OPEN" ? "No open alerts — all clear." : "No events match the current filter."} />
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
            <div className="overflow-x-auto -mx-1">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-paper">
                  <th className="px-4 py-3 w-8"><input type="checkbox"
                    checked={selected.size === filtered.length && filtered.length > 0}
                    onChange={e => setSelected(e.target.checked ? new Set(filtered.map(ev => ev.id)) : new Set())} /></th>
                  {["Event","Severity","Status","Vehicle","Source","Time"].map(h => (
                    <th key={h} className="text-start text-xs font-semibold text-steel px-4 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map(e => (
                  <tr key={e.id} className="hover:bg-paper">
                    <td className="px-4 py-2.5">
                      <input type="checkbox" checked={selected.has(e.id)}
                        onChange={ev => setSelected(prev => { const n = new Set(prev); ev.target.checked ? n.add(e.id) : n.delete(e.id); return n; })} />
                    </td>
                    <td className="px-4 py-2.5 text-xs font-mono font-medium text-ink">{e.eventType}</td>
                    <td className={`px-4 py-2.5 text-xs font-semibold ${SEVERITY_COLOR[e.severity] ?? "text-steel"}`}>{e.severity}</td>
                    <td className="px-4 py-2.5"><StatusBadge status={e.status} size="xs" /></td>
                    <td className="px-4 py-2.5 text-xs text-steel font-mono">{e.vehicleId ? e.vehicleId.slice(0, 8) + "…" : "—"}</td>
                    <td className={`px-4 py-2.5 text-xs font-medium ${e.source === "DEMO" ? "text-warn" : "text-steel"}`}>{e.source}</td>
                    <td className="px-4 py-2.5 text-xs text-steel">{fmtTime(e.eventAt)}</td>
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
