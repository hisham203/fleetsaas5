"use client";
import { useEffect, useState, useCallback } from "react";
import AdminShell from "@/components/AdminShell";
import { PageContainer, PageHeader, StatusBadge, FilterBar, EmptyState, LoadingState, MetricCard, Btn } from "@/components/ds";

type Vehicle = {
  id: string; plateNumber?: string; plate?: string; type?: string; vehicleType?: string;
  capacityLiters?: number; status: string; tenantId: string; make?: string; model?: string;
};

function VehicleRow({ v, onView }: { v: Vehicle; onView: (v: Vehicle) => void }) {
  const plate = v.plateNumber ?? v.plate ?? "—";
  const cap = v.capacityLiters != null ? `${v.capacityLiters.toLocaleString()} L` : "—";
  return (
    <tr className="hover:bg-paper transition-colors cursor-pointer" onClick={() => onView(v)}>
      <td className="px-4 py-3 text-sm font-medium text-ink">{plate}</td>
      <td className="px-4 py-3 text-sm text-steel">{v.vehicleType ?? v.type ?? "—"}</td>
      <td className="px-4 py-3 text-sm text-ink tabular-nums">{cap}</td>
      <td className="px-4 py-3"><StatusBadge status={v.status} size="sm" /></td>
      <td className="px-4 py-3 text-sm text-steel">{v.make ?? "—"} {v.model ?? ""}</td>
      <td className="px-4 py-3">
        <Btn variant="ghost" size="xs" onClick={() => onView(v)}>View</Btn>
      </td>
    </tr>
  );
}

export default function VehiclesPage() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const r = await fetch("/api/vehicles");
    if (!r.ok) { setError("Failed to load vehicles."); setLoading(false); return; }
    const data = await r.json();
    setVehicles(Array.isArray(data) ? data : []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = vehicles.filter(v => {
    const plate = (v.plateNumber ?? v.plate ?? "").toLowerCase();
    const matchSearch = !search || plate.includes(search.toLowerCase()) || (v.vehicleType ?? v.type ?? "").toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "ALL" || v.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const counts = { total: vehicles.length, available: vehicles.filter(v=>v.status==="AVAILABLE").length, inTrip: vehicles.filter(v=>v.status==="IN_TRIP").length, maintenance: vehicles.filter(v=>v.status==="MAINTENANCE").length };

  return (
    <AdminShell title="Vehicles">
      <PageContainer>
        <PageHeader
          title="Vehicles"
          subtitle="Fleet asset registry"
          breadcrumbs={[{ label: "Fleet" }, { label: "Vehicles" }]}
          actions={<Btn variant="primary" size="sm" onClick={load}>Refresh</Btn>}
        />

        {/* Metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <MetricCard label="Total" value={counts.total} />
          <MetricCard label="Available" value={counts.available} accent="ok" />
          <MetricCard label="On Trip" value={counts.inTrip} accent="info" />
          <MetricCard label="Maintenance" value={counts.maintenance} accent="warn" />
        </div>

        {/* Filters */}
        <FilterBar
          search={search} onSearch={setSearch}
          filters={
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
              className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-aqua/30">
              <option value="ALL">All statuses</option>
              <option value="AVAILABLE">Available</option>
              <option value="IN_TRIP">On Trip</option>
              <option value="MAINTENANCE">Maintenance</option>
              <option value="OUT_OF_SERVICE">Out of Service</option>
            </select>
          }
          onClear={() => { setSearch(""); setStatusFilter("ALL"); }}
        />

        {/* Table */}
        {loading ? <LoadingState /> : error ? (
          <div className="text-sm text-danger bg-dangerLight rounded-xl p-4">{error}</div>
        ) : filtered.length === 0 ? (
          <EmptyState title="No vehicles found" description={search || statusFilter !== "ALL" ? "Try adjusting your filters." : "No vehicles registered yet."} />
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-card">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-paper">
                    {["Plate", "Type", "Capacity", "Status", "Make/Model", ""].map(h => (
                      <th key={h} className="text-start text-xs font-semibold text-steel px-4 py-3">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map(v => (
                    <VehicleRow key={v.id} v={v}
                      onView={(v) => window.location.href = `/fleet/vehicles/${v.id}`} />
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2.5 border-t border-slate-100 text-xs text-steel">
              {filtered.length} of {vehicles.length} vehicles
            </div>
          </div>
        )}
      </PageContainer>
    </AdminShell>
  );
}
