"use client";
/**
 * Fuel Registry — Milestone C
 * Fleet-wide fuel log aggregated from the first vehicle as proof-of-concept.
 * Links to per-vehicle fuel in Vehicle 360.
 */
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import AdminShell from "@/components/AdminShell";
import { PageContainer, PageHeader, MetricCard, FilterBar, EmptyState, LoadingState, Btn } from "@/components/ds";

type Vehicle = { id: string; plateNumber: string };
type FuelLog = { id: string; vehicleId: string; litersFilled: number; costSar: number; odometerReading?: number; filledAt?: string; tripId?: string };

function fmtDt(dt?: string | null) {
  if (!dt) return "—";
  return new Date(dt).toLocaleString("en-SA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function FuelPage() {
  const router = useRouter();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [logs, setLogs] = useState<(FuelLog & { plateNumber?: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const vRes = await fetch("/api/vehicles");
    if (!vRes.ok) { setLoading(false); return; }
    const vAll: Vehicle[] = await vRes.json();
    setVehicles(Array.isArray(vAll) ? vAll : []);
    // Fetch fuel for all vehicles in parallel (up to 10 to avoid overload):
    const subset = (Array.isArray(vAll) ? vAll : []).slice(0, 10);
    const results = await Promise.allSettled(
      subset.map(v => fetch(`/api/vehicles/${v.id}/fuel`)
        .then(r => r.ok ? r.json().then((logs: FuelLog[]) => (Array.isArray(logs) ? logs : []).map(l => ({ ...l, plateNumber: v.plateNumber }))) : [])
      )
    );
    const all = results.flatMap(r => r.status === "fulfilled" ? r.value : []);
    all.sort((a, b) => new Date(b.filledAt ?? 0).getTime() - new Date(a.filledAt ?? 0).getTime());
    setLogs(all);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = logs.filter(l => !search || (l.plateNumber ?? "").toLowerCase().includes(search.toLowerCase()));
  const totalLiters = filtered.reduce((s, l) => s + l.litersFilled, 0);
  const totalCost = filtered.reduce((s, l) => s + l.costSar, 0);

  return (
    <AdminShell title="Fuel">
      <PageContainer>
        <PageHeader
          title="Fuel Registry"
          subtitle="Fleet-wide fuel consumption log"
          breadcrumbs={[{ label: "Fleet" }, { label: "Fuel" }]}
          actions={
            <div className="flex gap-2">
              <span className="text-xs text-steel self-center">Showing up to 10 vehicles</span>
              <Btn variant="ghost" size="sm" onClick={load}>↺</Btn>
            </div>
          }
        />
        <div className="grid grid-cols-3 gap-3 mb-6">
          <MetricCard label="Records" value={filtered.length} />
          <MetricCard label="Total Filled" value={`${totalLiters.toLocaleString(undefined, { maximumFractionDigits: 0 })} L`} />
          <MetricCard label="Total Cost" value={`SAR ${totalCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} />
        </div>
        <FilterBar search={search} onSearch={setSearch} onClear={() => setSearch("")} />
        {loading ? <LoadingState /> : filtered.length === 0 ? (
          <EmptyState title="No fuel records" description="Fuel records appear when drivers log fill-ups." />
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-paper">
                    {["Date", "Vehicle", "Liters", "Cost (SAR)", "Odometer", "Trip"].map(h => (
                      <th key={h} className="text-left text-xs font-semibold text-steel px-4 py-3">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map(l => (
                    <tr key={l.id} className="hover:bg-paper">
                      <td className="px-4 py-3 text-xs text-steel">{fmtDt(l.filledAt)}</td>
                      <td className="px-4 py-3">
                        <button onClick={() => { const v = vehicles.find(v => v.id === l.vehicleId); v && router.push(`/fleet/vehicles/${v.id}`); }}
                          className="text-sm font-medium text-aqua hover:underline">{l.plateNumber ?? l.vehicleId}</button>
                      </td>
                      <td className="px-4 py-3 text-sm tabular-nums font-medium">{l.litersFilled.toLocaleString()}</td>
                      <td className="px-4 py-3 text-sm tabular-nums">{l.costSar.toLocaleString()}</td>
                      <td className="px-4 py-3 text-sm text-steel tabular-nums">{l.odometerReading?.toLocaleString() ?? "—"}</td>
                      <td className="px-4 py-3">
                        {l.tripId ? <button onClick={() => router.push(`/operations/trips/${l.tripId}`)} className="text-xs text-aqua hover:underline">View →</button> : "—"}
                      </td>
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
