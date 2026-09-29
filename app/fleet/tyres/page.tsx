"use client";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import AdminShell from "@/components/AdminShell";
import { PageContainer, PageHeader, MetricCard, FilterBar, EmptyState, LoadingState, StatusBadge, Btn } from "@/components/ds";

type Vehicle = { id: string; plateNumber: string };
type Tyre = { id: string; vehicleId: string; position: string; serialNumber?: string; status: string; costSar?: number; installOdometer?: number; installedAt?: string; plateNumber?: string };

function fmtDt(dt?: string | null) {
  if (!dt) return "—";
  return new Date(dt).toLocaleDateString("en-SA", { day: "numeric", month: "short", year: "numeric" });
}

export default function TyresPage() {
  const router = useRouter();
  const [tyres, setTyres] = useState<Tyre[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");

  const load = useCallback(async () => {
    setLoading(true);
    const vRes = await fetch("/api/vehicles");
    if (!vRes.ok) { setLoading(false); return; }
    const vAll: Vehicle[] = await vRes.json();
    const subset = (Array.isArray(vAll) ? vAll : []).slice(0, 10);
    const results = await Promise.allSettled(
      subset.map(v => fetch(`/api/vehicles/${v.id}/tyres`)
        .then(r => r.ok ? r.json().then((t: Tyre[]) => (Array.isArray(t) ? t : []).map(tr => ({ ...tr, plateNumber: v.plateNumber }))) : [])
      )
    );
    const all = results.flatMap(r => r.status === "fulfilled" ? r.value : []);
    all.sort((a, b) => new Date(b.installedAt ?? 0).getTime() - new Date(a.installedAt ?? 0).getTime());
    setTyres(all);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = tyres.filter(t => {
    const q = search.toLowerCase();
    const matchSearch = !q || (t.plateNumber ?? "").toLowerCase().includes(q) || (t.position ?? "").toLowerCase().includes(q) || (t.serialNumber ?? "").toLowerCase().includes(q);
    const matchStatus = statusFilter === "ALL" || t.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const active = tyres.filter(t => t.status === "ACTIVE").length;
  const retired = tyres.filter(t => t.status === "RETIRED").length;

  return (
    <AdminShell title="Tyres">
      <PageContainer>
        <PageHeader title="Tyre Registry" subtitle="Fleet-wide tyre records"
          breadcrumbs={[{ label: "Fleet" }, { label: "Tyres" }]}
          actions={<Btn variant="ghost" size="sm" onClick={load}>↺</Btn>} />
        <div className="grid grid-cols-3 gap-3 mb-6">
          <MetricCard label="Total Records" value={tyres.length} />
          <MetricCard label="Active" value={active} accent="ok" />
          <MetricCard label="Retired" value={retired} accent="default" />
        </div>
        <FilterBar search={search} onSearch={setSearch}
          filters={
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
              className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-aqua/30">
              <option value="ALL">All statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="RETIRED">Retired</option>
            </select>
          }
          onClear={() => { setSearch(""); setStatusFilter("ALL"); }} />
        {loading ? <LoadingState /> : filtered.length === 0 ? (
          <EmptyState title="No tyre records" />
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-paper">
                    {["Vehicle", "Position", "Serial", "Status", "Install Km", "Cost (SAR)", "Installed"].map(h => (
                      <th key={h} className="text-left text-xs font-semibold text-steel px-4 py-3">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map(t => (
                    <tr key={t.id} className="hover:bg-paper">
                      <td className="px-4 py-3">
                        <button onClick={() => router.push(`/fleet/vehicles/${t.vehicleId}`)}
                          className="text-sm font-medium text-aqua hover:underline">{t.plateNumber ?? t.vehicleId}</button>
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-ink">{t.position}</td>
                      <td className="px-4 py-3 text-sm text-steel font-mono">{t.serialNumber ?? "—"}</td>
                      <td className="px-4 py-3"><StatusBadge status={t.status} size="xs" /></td>
                      <td className="px-4 py-3 text-sm text-steel tabular-nums">{t.installOdometer?.toLocaleString() ?? "—"}</td>
                      <td className="px-4 py-3 text-sm tabular-nums">{t.costSar?.toLocaleString() ?? "—"}</td>
                      <td className="px-4 py-3 text-xs text-steel">{fmtDt(t.installedAt)}</td>
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
