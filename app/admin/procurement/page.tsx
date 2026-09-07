"use client";

import { useEffect, useState, useCallback } from "react";
import AdminShell from "@/components/AdminShell";
import StatusBadge from "@/components/StatusBadge";
import { extractErrorMessage } from "@/lib/helpers";
import { useRequireSession } from "@/lib/useSession";

// Milestone Z.2, Part 8 — Procurement foundation screen. Supplier CRUD
// is fully functional; Purchase Requisitions, Purchase Orders, and
// Goods Receipts are read-only/empty here — no PR approval, no PO
// issuing, no receiving posting exists yet. Creating a supplier never
// creates a PR/PO automatically.
export default function ProcurementPage() {
  const { session, loading } = useRequireSession(["ADMIN"]);
  const [tab, setTab] = useState<"suppliers" | "pr" | "po" | "receipts">("suppliers");
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [prs, setPrs] = useState<any[]>([]);
  const [pos, setPos] = useState<any[]>([]);
  const [receipts, setReceipts] = useState<any[]>([]);
  const [dataLoading, setDataLoading] = useState(true);

  const load = useCallback(async () => {
    setDataLoading(true);
    const [s, p, o, r] = await Promise.all([
      fetch("/api/suppliers").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/purchase-requisitions").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/purchase-orders").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/goods-receipts").then((r) => (r.ok ? r.json() : [])),
    ]);
    setSuppliers(s);
    setPrs(p);
    setPos(o);
    setReceipts(r);
    setDataLoading(false);
  }, []);

  useEffect(() => {
    if (session) load();
  }, [session, load]);

  if (loading || !session) {
    return <div className="min-h-screen bg-paper flex items-center justify-center text-steel text-sm">Loading…</div>;
  }

  return (
    <AdminShell title="Procurement">
      <div className="p-6 max-w-5xl mx-auto space-y-4">
        <div>
          <h1 className="text-lg font-semibold">Procurement</h1>
          <p className="text-steel text-sm mt-0.5">Purchase Requisition, Purchase Order, and Goods Receiving for fleet maintenance stock.</p>
        </div>
        <p className="text-steel text-xs bg-warn/10 rounded-lg px-3 py-2">PR/PO/Receiving workflows will be added in later milestones. Suppliers can be managed today.</p>

        <div className="flex gap-2">
          {(["suppliers", "pr", "po", "receipts"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${tab === t ? "bg-ink text-white border-ink" : "bg-white text-steel border-slate-200"}`}>
              {t === "suppliers" ? "Suppliers" : t === "pr" ? "Purchase Requisitions" : t === "po" ? "Purchase Orders" : "Goods Receipts"}
            </button>
          ))}
        </div>

        {dataLoading ? (
          <p className="text-steel text-sm">Loading…</p>
        ) : (
          <>
            {tab === "suppliers" && <SuppliersTab suppliers={suppliers} onChange={load} />}

            {tab === "pr" && (
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                {prs.length === 0 ? <p className="p-6 text-steel text-sm text-center">No purchase requisitions yet — creation will be added in a later milestone.</p> : (
                  <table className="w-full text-sm"><thead className="bg-paper text-steel text-xs uppercase"><tr><th className="text-left px-4 py-2">PR #</th><th className="text-left px-4 py-2">Status</th></tr></thead>
                    <tbody>{prs.map((p: any) => <tr key={p.id} className="border-t border-slate-100"><td className="px-4 py-2">{p.prNumber}</td><td className="px-4 py-2"><StatusBadge status={p.status} /></td></tr>)}</tbody>
                  </table>
                )}
              </div>
            )}

            {tab === "po" && (
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                {pos.length === 0 ? <p className="p-6 text-steel text-sm text-center">No purchase orders yet — creation will be added in a later milestone.</p> : (
                  <table className="w-full text-sm"><thead className="bg-paper text-steel text-xs uppercase"><tr><th className="text-left px-4 py-2">PO #</th><th className="text-left px-4 py-2">Status</th></tr></thead>
                    <tbody>{pos.map((p: any) => <tr key={p.id} className="border-t border-slate-100"><td className="px-4 py-2">{p.poNumber}</td><td className="px-4 py-2"><StatusBadge status={p.status} /></td></tr>)}</tbody>
                  </table>
                )}
              </div>
            )}

            {tab === "receipts" && (
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                {receipts.length === 0 ? <p className="p-6 text-steel text-sm text-center">No goods receipts yet — posting will be added in a later milestone.</p> : (
                  <table className="w-full text-sm"><thead className="bg-paper text-steel text-xs uppercase"><tr><th className="text-left px-4 py-2">Receipt #</th><th className="text-left px-4 py-2">Status</th></tr></thead>
                    <tbody>{receipts.map((r: any) => <tr key={r.id} className="border-t border-slate-100"><td className="px-4 py-2">{r.receiptNumber}</td><td className="px-4 py-2"><StatusBadge status={r.status} /></td></tr>)}</tbody>
                  </table>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </AdminShell>
  );
}

function SuppliersTab({ suppliers, onChange }: any) {
  const [showNew, setShowNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button onClick={() => setShowNew((v) => !v)} className="bg-ink text-white rounded-lg px-3 py-1.5 text-xs font-medium">{showNew ? "Cancel" : "+ New Supplier"}</button>
      </div>
      {showNew && <SupplierForm onCancel={() => setShowNew(false)} onSaved={() => { setShowNew(false); onChange(); }} />}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {suppliers.length === 0 ? (
          <p className="p-6 text-steel text-sm text-center">No suppliers yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-paper text-steel text-xs uppercase"><tr><th className="text-left px-4 py-2">Code</th><th className="text-left px-4 py-2">Name</th><th className="text-left px-4 py-2">Contact</th><th className="text-left px-4 py-2">Status</th><th className="text-left px-4 py-2">Actions</th></tr></thead>
            <tbody>
              {suppliers.map((s: any) => (
                <>
                  <tr key={s.id} className="border-t border-slate-100">
                    <td className="px-4 py-2 font-mono text-xs">{s.supplierCode}</td>
                    <td className="px-4 py-2 font-medium">{s.name}</td>
                    <td className="px-4 py-2 text-steel">{s.contactName ?? "—"}</td>
                    <td className="px-4 py-2"><StatusBadge status={s.status} /></td>
                    <td className="px-4 py-2"><button onClick={() => setEditingId(editingId === s.id ? null : s.id)} className="text-aquaDark hover:underline text-xs font-medium">{editingId === s.id ? "Close" : "Edit"}</button></td>
                  </tr>
                  {editingId === s.id && <tr className="bg-paper"><td colSpan={5} className="px-4 py-3"><SupplierForm supplier={s} onCancel={() => setEditingId(null)} onSaved={() => { setEditingId(null); onChange(); }} /></td></tr>}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function SupplierForm({ supplier, onCancel, onSaved }: any) {
  const [supplierCode, setSupplierCode] = useState(supplier?.supplierCode ?? "");
  const [name, setName] = useState(supplier?.name ?? "");
  const [contactName, setContactName] = useState(supplier?.contactName ?? "");
  const [phone, setPhone] = useState(supplier?.phone ?? "");
  const [email, setEmail] = useState(supplier?.email ?? "");
  const [status, setStatus] = useState(supplier?.status ?? "ACTIVE");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function save() {
    setSubmitting(true);
    setError("");
    const body = { supplierCode: supplierCode || undefined, name, contactName, phone, email, status };
    const res = supplier
      ? await fetch(`/api/suppliers/${supplier.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      : await fetch("/api/suppliers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
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
      <div>
        <input className="w-full border rounded-lg px-2 py-1.5 text-sm" placeholder="Supplier code (optional)" value={supplierCode} onChange={(e) => setSupplierCode(e.target.value)} />
        {!supplier && <p className="text-steel text-xs mt-0.5">Leave blank to auto-generate from Settings numbering series.</p>}
      </div>
      <input className="w-full border rounded-lg px-2 py-1.5 text-sm" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
      <input className="w-full border rounded-lg px-2 py-1.5 text-sm" placeholder="Contact name" value={contactName} onChange={(e) => setContactName(e.target.value)} />
      <div className="grid grid-cols-2 gap-2">
        <input className="border rounded-lg px-2 py-1.5 text-sm" placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <input className="border rounded-lg px-2 py-1.5 text-sm" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
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
