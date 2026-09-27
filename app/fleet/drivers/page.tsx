"use client";
import { useEffect, useState, useCallback } from "react";
import AdminShell from "@/components/AdminShell";
import { PageContainer, PageHeader, StatusBadge, FilterBar, EmptyState, LoadingState, MetricCard, Btn } from "@/components/ds";

type Driver = { id: string; name: string; status: string; licenseNumber?: string; tenantId: string; user?: { name?: string; email?: string } };

function DriverRow({ d }: { d: Driver }) {
  const name = d.user?.name ?? d.name ?? "—";
  return (
    <tr className="hover:bg-paper transition-colors">
      <td className="px-4 py-3 text-sm font-medium text-ink">{name}</td>
      <td className="px-4 py-3 text-sm text-steel font-mono text-xs">{d.licenseNumber ?? "—"}</td>
      <td className="px-4 py-3"><StatusBadge status={d.status} size="sm" /></td>
      <td className="px-4 py-3 text-sm text-steel">{d.user?.email ?? "—"}</td>
    </tr>
  );
}

export default function DriversPage() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const r = await fetch("/api/drivers");
    if (!r.ok) { setError("Failed to load drivers."); setLoading(false); return; }
    const data = await r.json();
    setDrivers(Array.isArray(data) ? data : []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = drivers.filter(d => {
    const name = (d.user?.name ?? d.name ?? "").toLowerCase();
    const matchSearch = !search || name.includes(search.toLowerCase()) || (d.licenseNumber ?? "").toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "ALL" || d.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const counts = { total: drivers.length, available: drivers.filter(d=>d.status==="AVAILABLE").length, onTrip: drivers.filter(d=>d.status==="ON_TRIP").length };

  return (
    <AdminShell title="Drivers">
      <PageContainer>
        <PageHeader
          title="Drivers"
          subtitle="Driver registry"
          breadcrumbs={[{ label: "Fleet" }, { label: "Drivers" }]}
          actions={<Btn variant="primary" size="sm" onClick={load}>Refresh</Btn>}
        />
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
          <MetricCard label="Total Drivers" value={counts.total} />
          <MetricCard label="Available" value={counts.available} accent="ok" />
          <MetricCard label="On Trip" value={counts.onTrip} accent="info" />
        </div>
        <FilterBar
          search={search} onSearch={setSearch}
          filters={
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
              className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-aqua/30">
              <option value="ALL">All statuses</option>
              <option value="AVAILABLE">Available</option>
              <option value="ON_TRIP">On Trip</option>
              <option value="OFF_DUTY">Off Duty</option>
            </select>
          }
          onClear={() => { setSearch(""); setStatusFilter("ALL"); }}
        />
        {loading ? <LoadingState /> : error ? (
          <div className="text-sm text-danger bg-dangerLight rounded-xl p-4">{error}</div>
        ) : filtered.length === 0 ? (
          <EmptyState title="No drivers found" description={search || statusFilter !== "ALL" ? "Try adjusting filters." : "No drivers registered yet."} />
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-card">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-paper">
                    {["Driver", "License No.", "Status", "Email"].map(h => (
                      <th key={h} className="text-left text-xs font-semibold text-steel px-4 py-3">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map(d => <DriverRow key={d.id} d={d} />)}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2.5 border-t border-slate-100 text-xs text-steel">
              {filtered.length} of {drivers.length} drivers
            </div>
          </div>
        )}
      </PageContainer>
    </AdminShell>
  );
}
