"use client";

import { useEffect, useState, useCallback } from "react";
import { useRequireSession } from "@/lib/useSession";
import AdminShell from "@/components/AdminShell";
import KpiCard from "@/components/KpiCard";

// Milestone Q, Gate Q6 — Loading Points. Deliberately NOT a new entity:
// this reuses the existing `warehouses` table/API exactly as-is (the
// same one Tasks L/M already extended and audited), presented here under
// the "Loading Points" terminology this milestone asks for. No schema
// change was made or is needed for this view.
//
// Milestone R, Part 7 — fields already supported today: name, address,
// GPS coordinates (lat/lng — already shown in the table below, not a
// gap). Fields genuinely absent from the schema and deferred as a future
// schema proposal only (confirmed directly, and by Task M's own prior
// audit for the active/inactive question specifically): type, code,
// operating hours, allowed tanker capacities, active/inactive status,
// government royalty settings, and loading capacity/queue rules. None of
// these are invented here as fake UI-only fields.
export default function LoadingPointsPage() {
  const { session, loading: sessionLoading } = useRequireSession(["ADMIN", "DISPATCHER"]);
  const [tenant, setTenant] = useState<any>(null);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [tripCounts, setTripCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    const tRes = await fetch("/api/tenant");
    let tenantId: string | null = null;
    if (tRes.ok) {
      const t = await tRes.json();
      setTenant(t);
      tenantId = t.id;
    }
    const [whRes, tripsRes] = await Promise.all([
      fetch(`/api/warehouses${tenantId ? `?tenantId=${tenantId}` : ""}`),
      fetch(`/api/trips${tenantId ? `?tenantId=${tenantId}` : ""}`),
    ]);
    if (!whRes.ok) {
      const data = await whRes.json().catch(() => ({}));
      setError(typeof data.error === "string" ? data.error : "Failed to load loading points");
      setLoading(false);
      return;
    }
    setError("");
    setWarehouses(await whRes.json());
    if (tripsRes.ok) {
      const trips = await tripsRes.json();
      const counts: Record<string, number> = {};
      for (const t of trips) {
        if (t.status === "PLANNED" || t.status === "DISPATCHED") {
          counts[t.warehouseId] = (counts[t.warehouseId] ?? 0) + 1;
        }
      }
      setTripCounts(counts);
    }
    setLoading(false);
  }, [session]);

  useEffect(() => {
    load();
  }, [load]);

  if (sessionLoading || !session) {
    return <div className="min-h-screen bg-paper flex items-center justify-center text-steel text-sm">Loading…</div>;
  }

  return (
    <AdminShell title="Loading Points" tenantName={tenant?.name}>
      <div className="p-6 space-y-6">
        {/* Q37: only a real, derivable metric is shown here. Government/
            private classification and active/out-of-service counts are
            deliberately not shown as KPI cards — no field distinguishes
            them today, and a fake split would violate this milestone's
            own "no fake data" rule. */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard label="Loading Points" value={warehouses.length} />
        </div>
        <p className="text-steel text-xs">
          Government/private classification and active/inactive status aren&apos;t tracked yet — every loading point listed here is currently available for dispatch and vehicle assignment.
        </p>

        {error && <p className="text-danger text-sm">{error}</p>}

        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          {loading ? (
            <p className="p-6 text-steel text-sm">Loading…</p>
          ) : warehouses.length === 0 ? (
            <p className="p-6 text-steel text-sm text-center">No loading points yet — create one from Fleet &amp; Inventory.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-paper text-steel text-xs uppercase">
                  <tr>
                    <th className="text-left px-4 py-2">Loading Point</th>
                    <th className="text-left px-4 py-2">Address</th>
                    <th className="text-left px-4 py-2">GPS</th>
                    <th className="text-left px-4 py-2">Default</th>
                    <th className="text-left px-4 py-2">Active Trips</th>
                    <th className="text-left px-4 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {warehouses.map((w) => (
                    <tr key={w.id} className="border-t border-slate-100">
                      <td className="px-4 py-2 font-medium">{w.name}</td>
                      <td className="px-4 py-2 text-steel">{w.address}</td>
                      <td className="px-4 py-2 text-steel">{w.lat.toFixed(4)}, {w.lng.toFixed(4)}</td>
                      <td className="px-4 py-2 text-steel">{w.isDefault ? "Yes" : "—"}</td>
                      <td className="px-4 py-2 text-steel">{tripCounts[w.id] ?? 0}</td>
                      <td className="px-4 py-2">
                        <a href="/admin" className="text-aquaDark hover:underline text-xs font-medium">Edit in Fleet &amp; Inventory</a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AdminShell>
  );
}
