"use client";
/**
 * Fleet Maintenance Workspace — Milestone C Closure
 *
 * Genuine tenant-wide maintenance workspace using GET /api/fleet/maintenance.
 * No single-vehicle bias. All vehicles, all records.
 *
 * Does NOT add maintenance scheduling (no schema support).
 * Does NOT change BR-15 (opening a record → MAINTENANCE status).
 */
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import AdminShell from "@/components/AdminShell";
import {
  PageContainer, PageHeader, StatusBadge, FilterBar,
  EmptyState, LoadingState, MetricCard, Btn,
} from "@/components/ds";

interface VehicleIdentity {
  id: string; plateNumber: string; vehicleType: string;
  vehicleCode?: string; status: string;
}
interface MaintenanceRecord {
  id: string; vehicleId: string; type: string; description: string;
  status: string; odometerReading?: number; cost?: number;
  openedAt?: string; completedAt?: string;
  vehicle: VehicleIdentity | null;
}

const TYPE_LABELS: Record<string, string> = {
  PREVENTIVE: "Preventive",
  CORRECTIVE: "Corrective",
  EMERGENCY: "Emergency",
};

function fmtDate(dt?: string | null) {
  if (!dt) return "—";
  return new Date(dt).toLocaleDateString("en-SA", { day: "numeric", month: "short", year: "numeric" });
}

export default function FleetMaintenanceWorkspacePage() {
  const router = useRouter();
  const [records, setRecords] = useState<MaintenanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [vehicleFilter, setVehicleFilter] = useState("ALL");

  // Derived: unique vehicles for filter dropdown
  const vehicles = Array.from(
    new Map(
      records.filter((r) => r.vehicle).map((r) => [r.vehicleId, r.vehicle!])
    ).values()
  ).sort((a, b) => a.plateNumber.localeCompare(b.plateNumber));

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const r = await fetch("/api/fleet/maintenance");
    if (!r.ok) {
      setError(r.status === 401 ? "Unauthorized." : "Failed to load maintenance records.");
      setLoading(false); return;
    }
    const data = await r.json();
    setRecords(Array.isArray(data) ? data : []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = records.filter((r) => {
    const q = search.toLowerCase();
    const matchSearch = !q ||
      (r.vehicle?.plateNumber ?? "").toLowerCase().includes(q) ||
      r.type.toLowerCase().includes(q) ||
      r.description.toLowerCase().includes(q) ||
      (r.vehicle?.vehicleCode ?? "").toLowerCase().includes(q);
    const matchStatus = statusFilter === "ALL" || r.status === statusFilter;
    const matchType = typeFilter === "ALL" || r.type === typeFilter;
    const matchVehicle = vehicleFilter === "ALL" || r.vehicleId === vehicleFilter;
    return matchSearch && matchStatus && matchType && matchVehicle;
  });

  const open = records.filter((r) => r.status === "OPEN").length;
  const completed = records.filter((r) => r.status === "COMPLETED").length;
  const uniqueVehicles = new Set(records.map((r) => r.vehicleId)).size;
  const totalCost = records
    .filter((r) => r.cost != null)
    .reduce((sum, r) => sum + (r.cost ?? 0), 0);

  return (
    <AdminShell title="Fleet Maintenance">
      <PageContainer>
        <PageHeader
          title="Fleet Maintenance"
          subtitle="Tenant-wide maintenance records — all vehicles"
          breadcrumbs={[{ label: "Fleet" }, { label: "Maintenance" }]}
          actions={<Btn variant="ghost" size="sm" onClick={load}>↺ Refresh</Btn>}
        />

        {error && (
          <div className="mb-4 px-4 py-3 bg-dangerLight rounded-lg text-sm text-danger">{error}</div>
        )}

        {/* KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <MetricCard label="Total Records" value={records.length} />
          <MetricCard label="Open" value={open}
            accent={open > 0 ? "warn" : "default"}
            trendLabel={open > 0 ? "Active work items" : "None open"} />
          <MetricCard label="Completed" value={completed} accent="ok" />
          <MetricCard label="Vehicles Affected" value={uniqueVehicles} />
        </div>

        {/* Filters */}
        <FilterBar
          search={search}
          onSearch={setSearch}
          filters={
            <div className="flex flex-wrap gap-2">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-aqua/30"
              >
                <option value="ALL">All statuses</option>
                <option value="OPEN">Open</option>
                <option value="COMPLETED">Completed</option>
              </select>

              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-aqua/30"
              >
                <option value="ALL">All types</option>
                <option value="PREVENTIVE">Preventive</option>
                <option value="CORRECTIVE">Corrective</option>
                <option value="EMERGENCY">Emergency</option>
              </select>

              {vehicles.length > 1 && (
                <select
                  value={vehicleFilter}
                  onChange={(e) => setVehicleFilter(e.target.value)}
                  className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-aqua/30"
                >
                  <option value="ALL">All vehicles</option>
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>{v.plateNumber}</option>
                  ))}
                </select>
              )}
            </div>
          }
          onClear={() => {
            setSearch("");
            setStatusFilter("ALL");
            setTypeFilter("ALL");
            setVehicleFilter("ALL");
          }}
        />

        {loading ? (
          <LoadingState label="Loading maintenance records…" />
        ) : filtered.length === 0 ? (
          <EmptyState
            title="No maintenance records found"
            description={
              search || statusFilter !== "ALL" || typeFilter !== "ALL" || vehicleFilter !== "ALL"
                ? "Try adjusting your filters."
                : "No maintenance records for this fleet yet."
            }
          />
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-paper">
                    {["Vehicle", "Status", "Type", "Description", "Opened", "Closed", "Odometer", "Cost (SAR)"].map((h) => (
                      <th key={h} className="text-start text-xs font-semibold text-steel px-4 py-3 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((r) => (
                    <tr key={r.id} className="hover:bg-paper transition-colors">
                      {/* Vehicle — links to Vehicle 360 */}
                      <td className="px-4 py-3">
                        {r.vehicle ? (
                          <button
                            onClick={() => router.push(`/fleet/vehicles/${r.vehicleId}`)}
                            className="text-start"
                          >
                            <div className="text-sm font-semibold text-aqua hover:underline">
                              {r.vehicle.plateNumber}
                            </div>
                            <div className="text-xs text-steel">{r.vehicle.vehicleType}</div>
                            {r.vehicle.status === "MAINTENANCE" && (
                              <StatusBadge status="MAINTENANCE" size="xs" />
                            )}
                          </button>
                        ) : (
                          <span className="text-sm text-steel">{r.vehicleId.slice(0, 8)}…</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={r.status} size="sm" />
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-ink">
                        {TYPE_LABELS[r.type] ?? r.type}
                      </td>
                      <td className="px-4 py-3 text-sm text-steel max-w-xs truncate">
                        {r.description}
                      </td>
                      <td className="px-4 py-3 text-xs text-steel whitespace-nowrap">
                        {fmtDate(r.openedAt)}
                      </td>
                      <td className="px-4 py-3 text-xs text-steel whitespace-nowrap">
                        {fmtDate(r.completedAt)}
                      </td>
                      <td className="px-4 py-3 text-sm text-steel tabular-nums">
                        {r.odometerReading?.toLocaleString() ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-sm tabular-nums">
                        {r.cost != null ? r.cost.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2.5 border-t border-slate-100 flex items-center justify-between">
              <span className="text-xs text-steel">{filtered.length} of {records.length} records</span>
              {totalCost > 0 && (
                <span className="text-xs text-steel">
                  Total cost: <span className="font-medium text-ink">SAR {totalCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                </span>
              )}
            </div>
          </div>
        )}
      </PageContainer>
    </AdminShell>
  );
}
