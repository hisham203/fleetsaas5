"use client";

import { useEffect, useState, useCallback } from "react";
import AdminShell from "@/components/AdminShell";
import StatusBadge from "@/components/StatusBadge";
import { useRequireSession } from "@/lib/useSession";
import NextCodePreview from "@/components/NextCodePreview";
import { extractErrorMessage } from "@/lib/helpers";

// Milestone Z.2, Part 7 — Inventory foundation screen. Stock control
// for maintenance items, using the real Z.1 read APIs. No stock
// posting, adjustment, transfer, issue-to-maintenance, or manual
// quantity editing exists here — those are explicitly future
// milestones. Maintenance Warehouse CRUD is included here (Part 5's
// own suggested location), never confused with Loading Points
// (customer delivery dispatch, under Operations).
export default function InventoryPage() {
  const { session, loading } = useRequireSession(["ADMIN"]);
  const [tab, setTab] = useState<"overview" | "warehouses" | "movements" | "lowstock">("overview");
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [balances, setBalances] = useState<any[]>([]);
  const [movements, setMovements] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [showAdjust, setShowAdjust] = useState(false);

  const load = useCallback(async () => {
    setDataLoading(true);
    const [w, b, m, i] = await Promise.all([
      fetch("/api/maintenance-warehouses").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/maintenance-inventory/balances").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/maintenance-inventory/movements").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/items").then((r) => (r.ok ? r.json() : [])),
    ]);
    setWarehouses(w);
    setBalances(b);
    setMovements(m);
    setItems(i);
    setDataLoading(false);
  }, []);

  useEffect(() => {
    if (session) load();
  }, [session, load]);

  if (loading || !session) {
    return <div className="min-h-screen bg-paper flex items-center justify-center text-steel text-sm">Loading…</div>;
  }

  const lowStockItems = items.filter((it: any) => {
    const balance = balances.find((b: any) => b.itemId === it.id);
    return it.reorderPoint != null && balance && balance.quantityAvailable <= it.reorderPoint;
  });

  return (
    <AdminShell title="Inventory">
      <div className="p-6 max-w-5xl mx-auto space-y-4">
        <div>
          <h1 className="text-lg font-semibold">Inventory</h1>
          <p className="text-steel text-sm mt-0.5">Stock control for spare parts, tires, and maintenance consumables.</p>
        </div>
        {/* RC1 — Inventory actions now live */}
        {showAdjust && <AdjustmentForm warehouses={warehouses} items={items} onCancel={() => setShowAdjust(false)} onSaved={load} />}

        <div className="flex gap-2">
          {(["overview", "warehouses", "movements", "lowstock"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${tab === t ? "bg-ink text-white border-ink" : "bg-white text-steel border-slate-200"}`}>
              {t === "overview" ? "Stock Overview" : t === "warehouses" ? "Warehouses" : t === "movements" ? "Stock Movements" : "Low Stock / Reorder Watch"}
            </button>
          ))}
        </div>

        {dataLoading ? (
          <p className="text-steel text-sm">Loading…</p>
        ) : (
          <>
            {tab === "overview" && (
              <div className="card overflow-hidden">
                {balances.length === 0 ? (
                  <p className="p-6 text-steel text-sm text-center">No stock balances yet. Balances are created once receiving is implemented in a future milestone.</p>
                ) : (
                  <table className="data-table">
                    <thead className="bg-paper text-steel text-xs uppercase"><tr><th className="text-left px-4 py-2">Warehouse</th><th className="text-left px-4 py-2">Item</th><th className="text-left px-4 py-2">On Hand</th><th className="text-left px-4 py-2">Available</th></tr></thead>
                    <tbody>
                      {balances.map((b: any) => (
                        <tr key={b.id} className="border-t border-slate-100">
                          <td className="px-4 py-2">{warehouses.find((w: any) => w.id === b.warehouseId)?.name ?? "—"}</td>
                          <td className="px-4 py-2">{items.find((i: any) => i.id === b.itemId)?.name ?? "—"}</td>
                          <td className="px-4 py-2">{b.quantityOnHand}</td>
                          <td className="px-4 py-2">{b.quantityAvailable}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {tab === "warehouses" && <WarehousesTab warehouses={warehouses} onChange={load} />}

            {tab === "movements" && (
              <div className="card overflow-hidden">
                {movements.length === 0 ? (
                  <p className="p-6 text-steel text-sm text-center">No stock movements yet.</p>
                ) : (
                  <table className="data-table">
                    <thead className="bg-paper text-steel text-xs uppercase"><tr><th className="text-left px-4 py-2">Type</th><th className="text-left px-4 py-2">Item</th><th className="text-left px-4 py-2">Qty</th><th className="text-left px-4 py-2">Date</th></tr></thead>
                    <tbody>
                      {movements.map((m: any) => (
                        <tr key={m.id} className="border-t border-slate-100">
                          <td className="px-4 py-2">{m.movementType}</td>
                          <td className="px-4 py-2">{items.find((i: any) => i.id === m.itemId)?.name ?? "—"}</td>
                          <td className="px-4 py-2">{m.quantity}</td>
                          <td className="px-4 py-2 text-steel">{new Date(m.createdAt).toLocaleDateString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {tab === "lowstock" && (
              <div className="card overflow-hidden">
                {lowStockItems.length === 0 ? (
                  <p className="p-6 text-steel text-sm text-center">No low-stock items — this reflects real balances against each item&apos;s own reorder point, not an invented KPI.</p>
                ) : (
                  <table className="data-table">
                    <thead className="bg-paper text-steel text-xs uppercase"><tr><th className="text-left px-4 py-2">Item</th><th className="text-left px-4 py-2">Reorder Point</th></tr></thead>
                    <tbody>
                      {lowStockItems.map((it: any) => (
                        <tr key={it.id} className="border-t border-slate-100"><td className="px-4 py-2">{it.name}</td><td className="px-4 py-2">{it.reorderPoint}</td></tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </>
        )}

        <p className="text-steel text-xs">
          Need to add a new item? <a href="/admin/master-items" className="text-aquaDark hover:underline">Go to Master Items</a>.
        </p>
      </div>
    </AdminShell>
  );
}

function WarehousesTab({ warehouses, onChange }: any) {
  const [showNew, setShowNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [workshops, setWorkshops] = useState<any[]>([]);

  useEffect(() => {
    fetch("/api/workshops").then((r) => (r.ok ? r.json() : [])).then(setWorkshops);
  }, []);

  return (
    <div className="space-y-3">
      <p className="text-steel text-xs">Maintenance warehouses store spare parts/tires. Loading Points are water filling sites — a separate concept under Operations.</p>
      <div className="flex justify-end">
        <button onClick={() => setShowNew((v) => !v)} className="bg-ink text-white rounded-lg px-3 py-1.5 text-xs font-medium">{showNew ? "Cancel" : "+ New Maintenance Warehouse"}</button>
      </div>
      {showNew && <WarehouseForm workshops={workshops} onCancel={() => setShowNew(false)} onSaved={() => { setShowNew(false); onChange(); }} />}
      <div className="card overflow-hidden">
        {warehouses.length === 0 ? (
          <p className="p-6 text-steel text-sm text-center">No maintenance warehouses yet.</p>
        ) : (
          <table className="data-table">
            <thead className="bg-paper text-steel text-xs uppercase"><tr><th className="text-left px-4 py-2">Code</th><th className="text-left px-4 py-2">Name</th><th className="text-left px-4 py-2">Type</th><th className="text-left px-4 py-2">Workshop</th><th className="text-left px-4 py-2">Status</th><th className="text-left px-4 py-2">Actions</th></tr></thead>
            <tbody>
              {warehouses.map((w: any) => (
                <>
                  <tr key={w.id} className="border-t border-slate-100">
                    <td className="px-4 py-2 font-mono text-xs">{w.warehouseCode}</td>
                    <td className="px-4 py-2 font-medium">{w.name}</td>
                    <td className="px-4 py-2 text-steel">{w.warehouseType}</td>
                    <td className="px-4 py-2 text-steel">{workshops.find((wk: any) => wk.id === w.workshopId)?.name ?? "—"}</td>
                    <td className="px-4 py-2"><StatusBadge status={w.status} /></td>
                    <td className="px-4 py-2"><button onClick={() => setEditingId(editingId === w.id ? null : w.id)} className="text-aquaDark hover:underline text-xs font-medium">{editingId === w.id ? "Close" : "Edit"}</button></td>
                  </tr>
                  {editingId === w.id && <tr className="bg-paper"><td colSpan={6} className="px-4 py-3"><WarehouseForm warehouse={w} workshops={workshops} onCancel={() => setEditingId(null)} onSaved={() => { setEditingId(null); onChange(); }} /></td></tr>}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function WarehouseForm({ warehouse, workshops, onCancel, onSaved }: any) {
  const [codeReady, setCodeReady] = useState(false);
  const [name, setName] = useState(warehouse?.name ?? "");
  const [warehouseType, setWarehouseType] = useState(warehouse?.warehouseType ?? "WORKSHOP_STORE");
  const [workshopId, setWorkshopId] = useState(warehouse?.workshopId ?? "");
  const [status, setStatus] = useState(warehouse?.status ?? "ACTIVE");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function save() {
    setSubmitting(true);
    setError("");
    const body = { name, warehouseType, status, workshopId: workshopId || null };
    const res = warehouse
      ? await fetch(`/api/maintenance-warehouses/${warehouse.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      : await fetch("/api/maintenance-warehouses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
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
      {warehouse ? (
        <div className="bg-paper rounded-lg px-3 py-2"><p className="text-steel text-xs">Warehouse code</p><p className="font-mono text-sm">{warehouse.warehouseCode}</p><p className="text-steel text-[11px]">Code cannot be changed after creation.</p></div>
      ) : (
        <NextCodePreview entityType="MAINTENANCE_WAREHOUSE" label="Next warehouse code" onReady={setCodeReady} />
      )}
      <input className="w-full border rounded-lg px-2 py-1.5 text-sm" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
      <select className="w-full border rounded-lg px-2 py-1.5 text-sm" value={warehouseType} onChange={(e) => setWarehouseType(e.target.value)}>
        <option value="WORKSHOP_STORE">WORKSHOP_STORE</option>
        <option value="CENTRAL_SPARES">CENTRAL_SPARES</option>
        <option value="TYRE_STORE">TYRE_STORE</option>
        <option value="MOBILE_VAN">MOBILE_VAN</option>
        <option value="OTHER">OTHER</option>
      </select>
      <select className="w-full border rounded-lg px-2 py-1.5 text-sm" value={workshopId} onChange={(e) => setWorkshopId(e.target.value)}>
        <option value="">No workshop (central warehouse)</option>
        {workshops.map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}
      </select>
      <select className="w-full border rounded-lg px-2 py-1.5 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="ACTIVE">ACTIVE</option>
        <option value="INACTIVE">INACTIVE</option>
      </select>
      {error && <p className="text-danger text-xs">{error}</p>}
      <div className="flex gap-2">
        <button disabled={!name || submitting || (!warehouse && !codeReady)} onClick={save} className="bg-ink text-white rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-40">Save</button>
        <button onClick={onCancel} className="text-steel text-xs">Cancel</button>
      </div>
    </div>
  );
}

// RC1 — Inventory Adjustment / Maintenance Issue form.
function AdjustmentForm({ warehouses, items, onCancel, onSaved }: any) {
  const [warehouseId, setWarehouseId] = useState("");
  const [itemId, setItemId] = useState("");
  const [quantity, setQuantity] = useState<number>(0);
  const [unitOfMeasure, setUOM] = useState("EA");
  const [movementType, setMovementType] = useState("ADJUSTMENT");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function save() {
    setSubmitting(true); setError("");
    const res = await fetch("/api/maintenance-inventory/adjust", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ warehouseId, itemId, quantity: Number(quantity), unitOfMeasure, movementType, notes: notes || undefined }),
    });
    setSubmitting(false);
    if (!res.ok) { const d = await res.json(); setError(d.error ?? "Failed"); return; }
    onSaved();
    onCancel();
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-2 max-w-md">
      <p className="text-sm font-semibold text-ink">Inventory Adjustment / Issue</p>
      <div className="grid grid-cols-2 gap-2">
        <div><label className="text-xs text-steel">Warehouse</label>
          <select className="w-full border rounded-lg px-2 py-1.5 text-sm mt-1" value={warehouseId} onChange={e => setWarehouseId(e.target.value)}>
            <option value="">Select…</option>{warehouses.map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select></div>
        <div><label className="text-xs text-steel">Item</label>
          <select className="w-full border rounded-lg px-2 py-1.5 text-sm mt-1" value={itemId} onChange={e => setItemId(e.target.value)}>
            <option value="">Select…</option>{items.map((it: any) => <option key={it.id} value={it.id}>{it.name}</option>)}
          </select></div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div><label className="text-xs text-steel">Qty (negative = out)</label>
          <input type="number" className="w-full border rounded-lg px-2 py-1.5 text-sm mt-1" value={quantity} onChange={e => setQuantity(Number(e.target.value))} /></div>
        <div><label className="text-xs text-steel">UoM</label>
          <input className="w-full border rounded-lg px-2 py-1.5 text-sm mt-1" value={unitOfMeasure} onChange={e => setUOM(e.target.value)} /></div>
        <div><label className="text-xs text-steel">Type</label>
          <select className="w-full border rounded-lg px-2 py-1.5 text-sm mt-1" value={movementType} onChange={e => setMovementType(e.target.value)}>
            <option value="ADJUSTMENT">Adjustment</option>
            <option value="MAINTENANCE_ISSUE">Issue to Maintenance</option>
            <option value="RETURN">Return</option>
            <option value="TRANSFER_OUT">Transfer Out</option>
            <option value="TRANSFER_IN">Transfer In</option>
          </select></div>
      </div>
      <textarea className="w-full border rounded-lg px-2 py-1.5 text-sm" rows={2} placeholder="Notes (optional)" value={notes} onChange={e => setNotes(e.target.value)} />
      {error && <p className="text-danger text-xs">{error}</p>}
      <div className="flex gap-2">
        <button disabled={!warehouseId || !itemId || quantity === 0 || submitting} onClick={save} className="bg-ink text-white rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-40">Post Movement</button>
        <button onClick={onCancel} className="text-steel text-xs">Cancel</button>
      </div>
    </div>
  );
}
