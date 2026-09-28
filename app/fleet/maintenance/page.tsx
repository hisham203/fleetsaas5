"use client";
import { useEffect, useState, useCallback } from "react";
import AdminShell from "@/components/AdminShell";
import { PageContainer, PageHeader, StatusBadge, EmptyState, LoadingState, MetricCard, FilterBar, Btn } from "@/components/ds";

type MaintenanceRecord = { id: string; vehicleId: string; type: string; status: string; description?: string; scheduledAt?: string; completedAt?: string; cost?: number; vehicle?: { plateNumber?: string; plate?: string } };

function fmtDate(d?: string) { if (!d) return "—"; return new Date(d).toLocaleDateString("en-SA", { day:"numeric", month:"short", year:"2-digit" }); }

export default function MaintenancePage() {
  const [records, setRecords] = useState<MaintenanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [selectedVehicle, setSelectedVehicle] = useState("ALL");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const vRes = await fetch("/api/vehicles");
      if (vRes.ok) {
        const vData = await vRes.json();
        const vList = Array.isArray(vData) ? vData : [];
        setVehicles(vList);
        if (vList.length > 0) {
          const mRes = await fetch(`/api/vehicles/${vList[0].id}/maintenance`);
          if (mRes.ok) {
            const mData = await mRes.json();
            const allRecords = Array.isArray(mData) ? mData : [];
            setRecords(allRecords.map((r: any) => ({ ...r, vehicle: vList[0] })));
          }
        }
      }
    } catch (e) { console.error(e); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = records.filter(r => {
    const matchSearch = !search || (r.type ?? "").toLowerCase().includes(search.toLowerCase()) || (r.description ?? "").toLowerCase().includes(search.toLowerCase());
    return matchSearch;
  });

  const counts = { total: records.length, open: records.filter(r=>r.status==="OPEN").length, completed: records.filter(r=>r.status==="COMPLETED").length };

  return (
    <AdminShell title="Maintenance">
      <PageContainer>
        <PageHeader
          title="Maintenance"
          subtitle="Vehicle maintenance records"
          breadcrumbs={[{ label: "Fleet" }, { label: "Maintenance" }]}
          actions={<Btn variant="primary" size="sm" onClick={load}>Refresh</Btn>}
        />
        <div className="mb-4 text-xs text-steel bg-warnLight rounded-lg px-4 py-2">
          Showing maintenance records for the first registered vehicle. Full fleet maintenance view is planned for Milestone C.
        </div>
        <div className="grid grid-cols-3 gap-3 mb-6">
          <MetricCard label="Total Records" value={counts.total} />
          <MetricCard label="Open" value={counts.open} accent="warn" />
          <MetricCard label="Completed" value={counts.completed} accent="ok" />
        </div>
        <FilterBar search={search} onSearch={setSearch} onClear={() => setSearch("")} />
        {loading ? <LoadingState /> : filtered.length === 0 ? (
          <EmptyState title="No maintenance records" description="No maintenance records found for this vehicle." />
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-card">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-paper">
                    {["Type", "Description", "Status", "Scheduled", "Completed", "Cost"].map(h => (
                      <th key={h} className="text-left text-xs font-semibold text-steel px-4 py-3">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map(r => (
                    <tr key={r.id} className="hover:bg-paper">
                      <td className="px-4 py-3 text-sm font-medium text-ink">{r.type}</td>
                      <td className="px-4 py-3 text-sm text-steel max-w-xs truncate">{r.description ?? "—"}</td>
                      <td className="px-4 py-3"><StatusBadge status={r.status} size="sm" /></td>
                      <td className="px-4 py-3 text-sm text-steel">{fmtDate(r.scheduledAt)}</td>
                      <td className="px-4 py-3 text-sm text-steel">{fmtDate(r.completedAt)}</td>
                      <td className="px-4 py-3 text-sm text-ink tabular-nums">{r.cost != null ? `SAR ${r.cost.toLocaleString()}` : "—"}</td>
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
