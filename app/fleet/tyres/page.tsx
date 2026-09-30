"use client";
/**
 * Fleet Tyre Registry — Milestone C Closure
 *
 * Uses GET /api/fleet/tyres — tenant-scoped, single query, no N+1.
 */
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import AdminShell from "@/components/AdminShell";
import {
  PageContainer, PageHeader, MetricCard, FilterBar,
  EmptyState, LoadingState, StatusBadge, Btn,
} from "@/components/ds";

interface VehicleIdentity {
  id: string; plateNumber: string; vehicleType: string;
}
interface TyreRecord {
  id: string; vehicleId: string; position: string; serialNumber?: string;
  status: string; costSar?: number; installOdometer?: number; installedAt?: string;
  vehicle: VehicleIdentity | null;
}

function fmtDate(dt?: string | null) {
  if (!dt) return "—";
  return new Date(dt).toLocaleDateString("en-SA", { day: "numeric", month: "short", year: "numeric" });
}

export default function TyresPage() {
  const router = useRouter();
  const [records, setRecords] = useState<TyreRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const r = await fetch("/api/fleet/tyres");
    if (!r.ok) {
      setError(r.status === 401 ? "Unauthorized." : "Failed to load tyre records.");
      setLoading(false); return;
    }
    const data = await r.json();
    setRecords(Array.isArray(data) ? data : []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = records.filter((t) => {
    const q = search.toLowerCase();
    const matchSearch = !q ||
      (t.vehicle?.plateNumber ?? "").toLowerCase().includes(q) ||
      t.position.toLowerCase().includes(q) ||
      (t.serialNumber ?? "").toLowerCase().includes(q);
    const matchStatus = statusFilter === "ALL" || t.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const active = records.filter((t) => t.status === "ACTIVE").length;
  const retired = records.filter((t) => t.status === "RETIRED").length;

  return (
    <AdminShell title="Tyres">
      <PageContainer>
        <PageHeader
          title="Tyre Registry"
          subtitle="Fleet-wide tyre records — all vehicles"
          breadcrumbs={[{ label: "Fleet" }, { label: "Tyres" }]}
          actions={<Btn variant="ghost" size="sm" onClick={load}>↺ Refresh</Btn>}
        />

        {error && (
          <div className="mb-4 px-4 py-3 bg-dangerLight rounded-lg text-sm text-danger">{error}</div>
        )}

        <div className="grid grid-cols-3 gap-3 mb-6">
          <MetricCard label="Total Records" value={records.length} />
          <MetricCard label="Active" value={active} accent="ok" />
          <MetricCard label="Retired" value={retired} />
        </div>

        <FilterBar
          search={search}
          onSearch={setSearch}
          filters={
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-aqua/30"
            >
              <option value="ALL">All statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="RETIRED">Retired</option>
            </select>
          }
          onClear={() => { setSearch(""); setStatusFilter("ALL"); }}
        />

        {loading ? (
          <LoadingState label="Loading tyre records…" />
        ) : filtered.length === 0 ? (
          <EmptyState title="No tyre records found" />
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-paper">
                    {["Vehicle", "Position", "Serial", "Status", "Install km", "Cost (SAR)", "Installed"].map((h) => (
                      <th key={h} className="text-left text-xs font-semibold text-steel px-4 py-3 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((t) => (
                    <tr key={t.id} className="hover:bg-paper">
                      <td className="px-4 py-3">
                        {t.vehicle ? (
                          <button
                            onClick={() => router.push(`/fleet/vehicles/${t.vehicleId}`)}
                            className="text-sm font-medium text-aqua hover:underline"
                          >
                            {t.vehicle.plateNumber}
                          </button>
                        ) : (
                          <span className="text-sm text-steel">{t.vehicleId.slice(0, 8)}…</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-ink">{t.position}</td>
                      <td className="px-4 py-3 text-sm text-steel font-mono">{t.serialNumber ?? "—"}</td>
                      <td className="px-4 py-3"><StatusBadge status={t.status} size="xs" /></td>
                      <td className="px-4 py-3 text-sm text-steel tabular-nums">
                        {t.installOdometer?.toLocaleString() ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-sm tabular-nums">{t.costSar?.toLocaleString() ?? "—"}</td>
                      <td className="px-4 py-3 text-xs text-steel">{fmtDate(t.installedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2.5 border-t border-slate-100 text-xs text-steel">
              {filtered.length} records
            </div>
          </div>
        )}
      </PageContainer>
    </AdminShell>
  );
}
