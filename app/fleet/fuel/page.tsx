"use client";
/**
 * Fleet Fuel Registry — Milestone C Closure
 *
 * Uses GET /api/fleet/fuel — tenant-scoped, no vehicle cap.
 * No N+1 per-vehicle fetching.
 */
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import AdminShell from "@/components/AdminShell";
import {
  PageContainer, PageHeader, MetricCard, FilterBar,
  EmptyState, LoadingState, Btn,
} from "@/components/ds";

interface VehicleIdentity {
  id: string; plateNumber: string; vehicleType: string; vehicleCode?: string;
}
interface FuelRecord {
  id: string; vehicleId: string; tripId?: string;
  litersFilled: number; costSar: number; odometerReading?: number;
  filledAt?: string;
  vehicle: VehicleIdentity | null;
}

function fmtDt(dt?: string | null) {
  if (!dt) return "—";
  return new Date(dt).toLocaleString("en-SA", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

export default function FuelPage() {
  const router = useRouter();
  const [records, setRecords] = useState<FuelRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const r = await fetch("/api/fleet/fuel");
    if (!r.ok) {
      setError(r.status === 401 ? "Unauthorized." : "Failed to load fuel records.");
      setLoading(false); return;
    }
    const data = await r.json();
    setRecords(Array.isArray(data) ? data : []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = records.filter((l) => {
    const q = search.toLowerCase();
    return !q || (l.vehicle?.plateNumber ?? "").toLowerCase().includes(q);
  });

  const totalLiters = filtered.reduce((s, l) => s + l.litersFilled, 0);
  const totalCost   = filtered.reduce((s, l) => s + l.costSar, 0);
  const vehicleCount = new Set(filtered.map((l) => l.vehicleId)).size;

  return (
    <AdminShell title="Fuel">
      <PageContainer>
        <PageHeader
          title="Fuel Registry"
          subtitle="Fleet-wide fuel consumption — all vehicles, no limit"
          breadcrumbs={[{ label: "Fleet" }, { label: "Fuel" }]}
          actions={<Btn variant="ghost" size="sm" onClick={load}>↺ Refresh</Btn>}
        />

        {error && (
          <div className="mb-4 px-4 py-3 bg-dangerLight rounded-lg text-sm text-danger">{error}</div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <MetricCard label="Records" value={filtered.length} />
          <MetricCard label="Vehicles" value={vehicleCount} />
          <MetricCard label="Total Filled"
            value={`${totalLiters.toLocaleString(undefined, { maximumFractionDigits: 0 })} L`} />
          <MetricCard label="Total Cost"
            value={`SAR ${totalCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} />
        </div>

        <FilterBar search={search} onSearch={setSearch} onClear={() => setSearch("")} />

        {loading ? (
          <LoadingState label="Loading fuel records…" />
        ) : filtered.length === 0 ? (
          <EmptyState
            title="No fuel records"
            description="Fuel records appear when drivers log fill-ups during trips."
          />
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-paper">
                    {["Date", "Vehicle", "Liters", "Cost (SAR)", "Odometer", "Trip"].map((h) => (
                      <th key={h} className="text-start text-xs font-semibold text-steel px-4 py-3 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((l) => (
                    <tr key={l.id} className="hover:bg-paper">
                      <td className="px-4 py-3 text-xs text-steel whitespace-nowrap">
                        {fmtDt(l.filledAt)}
                      </td>
                      <td className="px-4 py-3">
                        {l.vehicle ? (
                          <button
                            onClick={() => router.push(`/fleet/vehicles/${l.vehicleId}`)}
                            className="text-sm font-medium text-aqua hover:underline text-start"
                          >
                            {l.vehicle.plateNumber}
                          </button>
                        ) : (
                          <span className="text-sm text-steel">{l.vehicleId.slice(0, 8)}…</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm font-medium tabular-nums">
                        {l.litersFilled.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-sm tabular-nums">
                        {l.costSar.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-sm text-steel tabular-nums">
                        {l.odometerReading?.toLocaleString() ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        {l.tripId ? (
                          <button
                            onClick={() => router.push(`/operations/trips/${l.tripId}`)}
                            className="text-xs text-aqua hover:underline"
                          >
                            View →
                          </button>
                        ) : "—"}
                      </td>
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
