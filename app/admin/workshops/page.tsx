"use client";

import { useEffect, useState, useCallback } from "react";
import AdminShell from "@/components/AdminShell";
import StatusBadge from "@/components/StatusBadge";
import { useRequireSession } from "@/lib/useSession";
import { extractErrorMessage } from "@/lib/helpers";

// Milestone Z.2, Part 4 — Workshops CRUD. Service locations for
// trucks/tankers — a distinct concept from Loading Points (customer
// delivery dispatch, under Operations) and from Maintenance Warehouses
// (physical stock, which may optionally link to a workshop here).
export default function WorkshopsPage() {
  const { session, loading } = useRequireSession(["ADMIN"]);
  const [workshops, setWorkshops] = useState<any[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setDataLoading(true);
    const res = await fetch("/api/workshops");
    setWorkshops(res.ok ? await res.json() : []);
    setDataLoading(false);
  }, []);

  useEffect(() => {
    if (session) load();
  }, [session, load]);

  if (loading || !session) {
    return <div className="min-h-screen bg-paper flex items-center justify-center text-steel text-sm">Loading…</div>;
  }

  return (
    <AdminShell title="Workshops">
      <div className="p-6 max-w-4xl mx-auto space-y-4">
        <div>
          <h1 className="text-lg font-semibold">Workshops</h1>
          <p className="text-steel text-sm mt-0.5">Internal or external service locations where trucks/tankers are maintained.</p>
        </div>

        <div className="flex justify-end">
          <button onClick={() => setShowNew((v) => !v)} className="bg-ink text-white rounded-lg px-3 py-1.5 text-sm font-medium">{showNew ? "Cancel" : "+ New Workshop"}</button>
        </div>
        {showNew && <WorkshopForm onCancel={() => setShowNew(false)} onSaved={() => { setShowNew(false); load(); }} />}

        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          {dataLoading ? (
            <p className="p-6 text-steel text-sm">Loading…</p>
          ) : workshops.length === 0 ? (
            <p className="p-6 text-steel text-sm text-center">No workshops yet — use &quot;+ New Workshop&quot; above to create one.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-paper text-steel text-xs uppercase">
                <tr><th className="text-left px-4 py-2">Code</th><th className="text-left px-4 py-2">Name</th><th className="text-left px-4 py-2">Type</th><th className="text-left px-4 py-2">City</th><th className="text-left px-4 py-2">Status</th><th className="text-left px-4 py-2">Actions</th></tr>
              </thead>
              <tbody>
                {workshops.map((w: any) => (
                  <>
                    <tr key={w.id} className="border-t border-slate-100">
                      <td className="px-4 py-2 font-mono text-xs">{w.workshopCode}</td>
                      <td className="px-4 py-2 font-medium">{w.name}</td>
                      <td className="px-4 py-2 text-steel">{w.workshopType}</td>
                      <td className="px-4 py-2 text-steel">{w.city ?? "—"}</td>
                      <td className="px-4 py-2"><StatusBadge status={w.status} /></td>
                      <td className="px-4 py-2"><button onClick={() => setEditingId(editingId === w.id ? null : w.id)} className="text-aquaDark hover:underline text-xs font-medium">{editingId === w.id ? "Close" : "Edit"}</button></td>
                    </tr>
                    {editingId === w.id && <tr className="bg-paper"><td colSpan={6} className="px-4 py-3"><WorkshopForm workshop={w} onCancel={() => setEditingId(null)} onSaved={() => { setEditingId(null); load(); }} /></td></tr>}
                  </>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </AdminShell>
  );
}

function WorkshopForm({ workshop, onCancel, onSaved }: any) {
  const [workshopCode, setWorkshopCode] = useState(workshop?.workshopCode ?? "");
  const [name, setName] = useState(workshop?.name ?? "");
  const [workshopType, setWorkshopType] = useState(workshop?.workshopType ?? "INTERNAL");
  const [city, setCity] = useState(workshop?.city ?? "");
  const [district, setDistrict] = useState(workshop?.district ?? "");
  const [address, setAddress] = useState(workshop?.address ?? "");
  const [contactPhone, setContactPhone] = useState(workshop?.contactPhone ?? "");
  const [status, setStatus] = useState(workshop?.status ?? "ACTIVE");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function save() {
    setSubmitting(true);
    setError("");
    const body = { workshopCode: workshopCode || undefined, name, workshopType, city, district, address, contactPhone, status };
    const res = workshop
      ? await fetch(`/api/workshops/${workshop.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      : await fetch("/api/workshops", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setSubmitting(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(extractErrorMessage(data));
      return;
    }
    onSaved();
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-2 max-w-md">
      <div><input className="w-full border rounded-lg px-2 py-1.5 text-sm" placeholder="Workshop code (optional)" value={workshopCode} onChange={(e) => setWorkshopCode(e.target.value)} /><p className="text-steel text-xs mt-0.5">Leave blank to auto-generate from Settings numbering series.</p></div>
      <input className="w-full border rounded-lg px-2 py-1.5 text-sm" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
      <select className="w-full border rounded-lg px-2 py-1.5 text-sm" value={workshopType} onChange={(e) => setWorkshopType(e.target.value)}>
        <option value="INTERNAL">INTERNAL</option>
        <option value="EXTERNAL">EXTERNAL</option>
        <option value="MOBILE_SERVICE">MOBILE_SERVICE</option>
      </select>
      <div className="grid grid-cols-2 gap-2">
        <input className="border rounded-lg px-2 py-1.5 text-sm" placeholder="City" value={city} onChange={(e) => setCity(e.target.value)} />
        <input className="border rounded-lg px-2 py-1.5 text-sm" placeholder="District" value={district} onChange={(e) => setDistrict(e.target.value)} />
      </div>
      <input className="w-full border rounded-lg px-2 py-1.5 text-sm" placeholder="Address" value={address} onChange={(e) => setAddress(e.target.value)} />
      <input className="w-full border rounded-lg px-2 py-1.5 text-sm" placeholder="Contact phone" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
      <select className="w-full border rounded-lg px-2 py-1.5 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="ACTIVE">ACTIVE</option>
        <option value="INACTIVE">INACTIVE</option>
      </select>
      {error && <p className="text-danger text-xs">{error}</p>}
      <div className="flex gap-2">
        <button disabled={!name || submitting} onClick={save} className="bg-ink text-white rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-40">Save</button>
        <button onClick={onCancel} className="text-steel text-xs">Cancel</button>
      </div>
    </div>
  );
}
