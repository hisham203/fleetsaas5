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
  // Milestone AA, Part 5 — create/edit state. POST /api/warehouses and
  // PATCH /api/warehouses/[id] already existed and already worked
  // (tenant-isolated, validated) — this screen simply never wired them
  // up, sending the user to a useless "Edit in Fleet & Inventory" link
  // to /admin instead. No new API was needed for name/address/lat/lng.
  const [showNew, setShowNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

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
          City, district, status (active/inactive), and contact/notes fields aren&apos;t in the schema yet — every loading point listed here is currently available for dispatch and vehicle assignment. Adding those fields is a proposed future schema change, not implemented here.
        </p>

        {error && <p className="text-danger text-sm">{error}</p>}

        <div className="flex justify-end">
          <button onClick={() => setShowNew((v) => !v)} className="bg-ink text-white rounded-lg px-3 py-1.5 text-sm font-medium">
            {showNew ? "Cancel" : "+ New Loading Point"}
          </button>
        </div>
        {showNew && (
          <LoadingPointForm
            onCancel={() => setShowNew(false)}
            onSaved={() => { setShowNew(false); load(); }}
          />
        )}

        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          {loading ? (
            <p className="p-6 text-steel text-sm">Loading…</p>
          ) : warehouses.length === 0 ? (
            <p className="p-6 text-steel text-sm text-center">No loading points yet — use &quot;+ New Loading Point&quot; above to create one.</p>
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
                    <>
                      <tr key={w.id} className="border-t border-slate-100">
                        <td className="px-4 py-2 font-medium">{w.name}</td>
                        <td className="px-4 py-2 text-steel">{w.address}</td>
                        <td className="px-4 py-2 text-steel">{w.lat.toFixed(4)}, {w.lng.toFixed(4)}</td>
                        <td className="px-4 py-2 text-steel">{w.isDefault ? "Yes" : "—"}</td>
                        <td className="px-4 py-2 text-steel">{tripCounts[w.id] ?? 0}</td>
                        <td className="px-4 py-2">
                          <button onClick={() => setEditingId(editingId === w.id ? null : w.id)} className="text-aquaDark hover:underline text-xs font-medium">
                            {editingId === w.id ? "Close" : "Edit"}
                          </button>
                        </td>
                      </tr>
                      {editingId === w.id && (
                        <tr className="border-t border-slate-100 bg-paper">
                          <td colSpan={6} className="px-4 py-3">
                            <LoadingPointForm
                              warehouse={w}
                              onCancel={() => setEditingId(null)}
                              onSaved={() => { setEditingId(null); load(); }}
                            />
                          </td>
                        </tr>
                      )}
                    </>
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

// Milestone AA, Part 5 — a single shared form for both create (no
// warehouse prop) and edit (warehouse prop provided), each calling the
// exact API route that already existed and already worked. Editing now
// happens entirely inside this screen — no more sending the user to
// /admin's Fleet tab.
function LoadingPointForm({ warehouse, onCancel, onSaved }: { warehouse?: any; onCancel: () => void; onSaved: () => void }) {
  const [name, setName] = useState(warehouse?.name ?? "");
  const [address, setAddress] = useState(warehouse?.address ?? "");
  const [lat, setLat] = useState<string>(warehouse?.lat != null ? String(warehouse.lat) : "");
  const [lng, setLng] = useState<string>(warehouse?.lng != null ? String(warehouse.lng) : "");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function save() {
    setSubmitting(true);
    setError("");
    const body = { name, address, lat: Number(lat), lng: Number(lng) };
    const res = warehouse
      ? await fetch(`/api/warehouses/${warehouse.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      : await fetch("/api/warehouses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setSubmitting(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(typeof data.error === "string" ? data.error : "Failed to save loading point");
      return;
    }
    onSaved();
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-2 max-w-md">
      <div>
        <label className="text-steel text-xs block mb-1">Site name</label>
        <input className="w-full border rounded-lg px-2 py-1.5 text-sm" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Al-Kharj Filling Station" />
      </div>
      <div>
        <label className="text-steel text-xs block mb-1">Address</label>
        <input className="w-full border rounded-lg px-2 py-1.5 text-sm" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street/area, city" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-steel text-xs block mb-1">GPS latitude</label>
          <input type="number" step="any" className="w-full border rounded-lg px-2 py-1.5 text-sm" value={lat} onChange={(e) => setLat(e.target.value)} />
        </div>
        <div>
          <label className="text-steel text-xs block mb-1">GPS longitude</label>
          <input type="number" step="any" className="w-full border rounded-lg px-2 py-1.5 text-sm" value={lng} onChange={(e) => setLng(e.target.value)} />
        </div>
      </div>
      <p className="text-steel text-xs">City, district, status, and contact/notes aren&apos;t supported by the schema yet — not shown here rather than faked.</p>
      {error && <p className="text-danger text-xs">{error}</p>}
      <div className="flex gap-2">
        <button disabled={!name || !address || !lat || !lng || submitting} onClick={save} className="bg-ink text-white rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-40">
          {warehouse ? "Save changes" : "Create loading point"}
        </button>
        <button onClick={onCancel} className="text-steel text-xs">Cancel</button>
      </div>
    </div>
  );
}
