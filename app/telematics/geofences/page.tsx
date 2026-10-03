"use client";
/**
 * Geofence Definitions
 * Route: /telematics/geofences
 */
import { useState, useEffect, useCallback } from "react";
import AdminShell from "@/components/AdminShell";
import { PageContainer, PageHeader, StatusBadge, EmptyState, LoadingState, Btn, FilterBar } from "@/components/ds";

interface Geofence { id: string; name: string; category: string; centerLat: number; centerLng: number; radiusMeters: number; status: string; notes: string | null; createdAt: string }

export default function GeofencesPage() {
  const [geofences, setGeofences] = useState<Geofence[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name: "", category: "CUSTOM", centerLat: "", centerLng: "", radiusMeters: "200", notes: "" });
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/telematics/geofences");
    if (res.ok) setGeofences((await res.json()).geofences ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function create() {
    setFormError(null);
    const lat = parseFloat(form.centerLat), lng = parseFloat(form.centerLng), r = parseInt(form.radiusMeters);
    if (!form.name || isNaN(lat) || isNaN(lng) || isNaN(r)) { setFormError("Name, lat, lng, and radius are required."); return; }
    const res = await fetch("/api/telematics/geofences", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: form.name, category: form.category, centerLat: lat, centerLng: lng, radiusMeters: r, notes: form.notes || undefined }),
    });
    if (!res.ok) { const d = await res.json(); setFormError(d.error ?? "Failed."); return; }
    setShowNew(false); load();
  }

  const filtered = geofences.filter(g => !search || g.name.toLowerCase().includes(search.toLowerCase()));
  const CATEGORIES = ["LOADING_POINT","CUSTOMER_SITE","DEPOT","WAREHOUSE","CUSTOM"];

  return (
    <AdminShell title="Geofences">
      <PageContainer>
        <PageHeader
          title="Geofence Definitions"
          subtitle="Named geographic zones for vehicle monitoring and arrival detection"
          breadcrumbs={[{ label: "Telematics" }, { label: "Geofences" }]}
          actions={<div className="flex gap-2">
            <Btn variant="secondary" size="sm" onClick={() => setShowNew(v => !v)}>{showNew ? "Cancel" : "+ New Geofence"}</Btn>
            <Btn variant="ghost" size="sm" onClick={load}>↺</Btn>
          </div>}
        />

        {showNew && (
          <div className="mb-6 bg-white rounded-xl border border-slate-200 shadow-card p-5 max-w-md">
            <h3 className="text-sm font-semibold text-ink mb-3">New Geofence</h3>
            <div className="space-y-2">
              <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
                placeholder="Name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              <select className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
                value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <div className="grid grid-cols-3 gap-2">
                <input className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
                  placeholder="Latitude" value={form.centerLat} onChange={e => setForm(f => ({ ...f, centerLat: e.target.value }))} />
                <input className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
                  placeholder="Longitude" value={form.centerLng} onChange={e => setForm(f => ({ ...f, centerLng: e.target.value }))} />
                <input type="number" className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
                  placeholder="Radius (m)" value={form.radiusMeters} onChange={e => setForm(f => ({ ...f, radiusMeters: e.target.value }))} />
              </div>
              {formError && <p className="text-xs text-danger">{formError}</p>}
              <div className="flex gap-2"><Btn variant="primary" size="sm" onClick={create}>Create</Btn><Btn variant="ghost" size="sm" onClick={() => setShowNew(false)}>Cancel</Btn></div>
            </div>
          </div>
        )}

        <FilterBar search={search} onSearch={setSearch} onClear={() => setSearch("")} />
        {loading ? <LoadingState /> : filtered.length === 0 ? (
          <EmptyState title="No geofences defined" description="Create named geographic zones for arrival detection and monitoring." />
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
            <div className="overflow-x-auto -mx-1">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-slate-100 bg-paper">
                {["Name","Category","Centre","Radius","Status","Created"].map(h => (
                  <th key={h} className="text-start text-xs font-semibold text-steel px-4 py-3">{h}</th>
                ))}
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map(g => (
                  <tr key={g.id} className="hover:bg-paper">
                    <td className="px-4 py-3 font-medium text-ink">{g.name}</td>
                    <td className="px-4 py-3 text-xs text-steel">{g.category}</td>
                    <td className="px-4 py-3 text-xs font-mono text-steel">{g.centerLat.toFixed(4)}, {g.centerLng.toFixed(4)}</td>
                    <td className="px-4 py-3 text-xs text-steel">{g.radiusMeters}m</td>
                    <td className="px-4 py-3"><StatusBadge status={g.status} size="xs" /></td>
                    <td className="px-4 py-3 text-xs text-steel">{new Date(g.createdAt).toLocaleDateString("en-SA")}</td>
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
