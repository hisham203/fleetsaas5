"use client";
import { useEffect, useState, useCallback } from "react";
import AdminShell from "@/components/AdminShell";
import StatusBadge from "@/components/StatusBadge";
import { extractErrorMessage } from "@/lib/helpers";
import { useRequireSession } from "@/lib/useSession";
import NextCodePreview from "@/components/NextCodePreview";

// RC1 — Full Procurement workflow: Supplier CRUD + PR create/approve/reject
// + PO create from approved PR + Goods Receipt with inventory posting.
export default function ProcurementPage() {
  const { session, loading } = useRequireSession(["ADMIN", "DISPATCHER"]);
  const [tab, setTab] = useState<"suppliers" | "pr" | "po" | "receipts">("suppliers");
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [prs, setPrs] = useState<any[]>([]);
  const [pos, setPos] = useState<any[]>([]);
  const [grs, setGrs] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);

  const load = useCallback(async () => {
    if (!session) return;
    const [s, p, o, g, it, wh] = await Promise.all([
      fetch("/api/suppliers").then(r => r.json()),
      fetch("/api/purchase-requisitions").then(r => r.json()),
      fetch("/api/purchase-orders").then(r => r.json()),
      fetch("/api/goods-receipts").then(r => r.json()),
      fetch("/api/items").then(r => r.json()),
      fetch("/api/maintenance-warehouses").then(r => r.json()),
    ]);
    setSuppliers(Array.isArray(s) ? s : []);
    setPrs(Array.isArray(p) ? p : []);
    setPos(Array.isArray(o) ? o : []);
    setGrs(Array.isArray(g) ? g : []);
    setItems(Array.isArray(it) ? it : []);
    setWarehouses(Array.isArray(wh) ? wh : []);
  }, [session]);

  useEffect(() => { if (session) load(); }, [session, load]);

  if (loading || !session) return <div className="min-h-screen bg-paper flex items-center justify-center text-steel text-sm">Loading…</div>;

  const tabs = [
    { id: "suppliers" as const, label: "Suppliers" },
    { id: "pr" as const, label: `Purchase Requisitions (${prs.length})` },
    { id: "po" as const, label: `Purchase Orders (${pos.length})` },
    { id: "receipts" as const, label: `Goods Receipts (${grs.length})` },
  ];

  return (
    <AdminShell title="Procurement">
      <div className="p-6 max-w-6xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">Procurement</h1>
        </div>
        <div className="flex gap-1 border-b border-slate-200">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} className={`px-4 py-2 text-sm font-medium ${tab === t.id ? "border-b-2 border-ink text-ink" : "text-steel hover:text-ink"}`}>{t.label}</button>
          ))}
        </div>
        {tab === "suppliers" && <SuppliersTab suppliers={suppliers} onChange={load} />}
        {tab === "pr" && <PRTab prs={prs} items={items} warehouses={warehouses} pos={pos} onChange={load} isAdmin={session.role === "ADMIN"} />}
        {tab === "po" && <POTab pos={pos} suppliers={suppliers} approvedPRs={prs.filter(p => p.status === "APPROVED")} items={items} grs={grs} onChange={load} isAdmin={session.role === "ADMIN"} />}
        {tab === "receipts" && <GRTab grs={grs} pos={pos} warehouses={warehouses} items={items} onChange={load} />}
      </div>
    </AdminShell>
  );
}

// Supplier codes: Code cannot be changed after creation.
// ── Suppliers ───────────────────────────────────────────────────────────────
function SuppliersTab({ suppliers, onChange }: any) {
  const [showNew, setShowNew] = useState(false);
  const [name, setName] = useState(""); const [contactName, setContactName] = useState(""); const [phone, setPhone] = useState(""); const [email, setEmail] = useState(""); const [submitting, setSubmitting] = useState(false); const [error, setError] = useState(""); const [codeReady, setCodeReady] = useState(false);
  async function save() {
    setSubmitting(true); setError("");
    const res = await fetch("/api/suppliers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, contactName, phone, email: email || undefined }) });
    setSubmitting(false);
    if (!res.ok) { setError(extractErrorMessage(await res.json().catch(() => ({})))); return; }
    setShowNew(false); setName(""); setContactName(""); setPhone(""); setEmail(""); onChange();
  }
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-steel text-sm">{suppliers.length} supplier{suppliers.length !== 1 ? "s" : ""}</p>
        <button onClick={() => setShowNew(v => !v)} className="bg-ink text-white rounded-lg px-3 py-1.5 text-sm font-medium">{showNew ? "Cancel" : "+ New Supplier"}</button>
      </div>
      {showNew && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-2 max-w-md">
          <NextCodePreview entityType="SUPPLIER" label="Supplier code" onReady={setCodeReady} />
          <input className="w-full border rounded-lg px-2 py-1.5 text-sm" placeholder="Supplier name" value={name} onChange={e => setName(e.target.value)} />
          <input className="w-full border rounded-lg px-2 py-1.5 text-sm" placeholder="Contact name (optional)" value={contactName} onChange={e => setContactName(e.target.value)} />
          <div className="grid grid-cols-2 gap-2">
            <input className="border rounded-lg px-2 py-1.5 text-sm" placeholder="Phone" value={phone} onChange={e => setPhone(e.target.value)} />
            <input className="border rounded-lg px-2 py-1.5 text-sm" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
          </div>
          {error && <p className="text-danger text-xs">{error}</p>}
          <button disabled={!name || !codeReady || submitting} onClick={save} className="bg-ink text-white rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-40">Create Supplier</button>
        </div>
      )}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-paper text-steel text-xs uppercase"><tr><th className="text-left px-4 py-2">Code</th><th className="text-left px-4 py-2">Name</th><th className="text-left px-4 py-2">Contact</th><th className="text-left px-4 py-2">Status</th></tr></thead>
          <tbody>{suppliers.map((s: any) => <tr key={s.id} className="border-t border-slate-50"><td className="px-4 py-2 font-mono text-xs">{s.supplierCode}</td><td className="px-4 py-2 font-medium">{s.name}</td><td className="px-4 py-2 text-steel text-xs">{s.contactName ?? "—"} {s.phone ? `· ${s.phone}` : ""}</td><td className="px-4 py-2"><StatusBadge status={s.status} /></td></tr>)}</tbody>
        </table>
        {!suppliers.length && <p className="p-6 text-steel text-sm text-center">No suppliers yet.</p>}
      </div>
    </div>
  );
}

// ── Purchase Requisitions ───────────────────────────────────────────────────
function PRTab({ prs, items, warehouses, pos, onChange, isAdmin }: any) {
  const [showNew, setShowNew] = useState(false);
  const [priority, setPriority] = useState("NORMAL");
  const [justification, setJustification] = useState("");
  const [lines, setLines] = useState([{ itemId: "", quantity: 1, unitOfMeasure: "EA", estimatedUnitCost: "" }]);
  const [submitting, setSubmitting] = useState(false); const [error, setError] = useState("");

  const addLine = () => setLines(l => [...l, { itemId: "", quantity: 1, unitOfMeasure: "EA", estimatedUnitCost: "" }]);
  const removeLine = (i: number) => setLines(l => l.filter((_, idx) => idx !== i));
  const updateLine = (i: number, field: string, val: any) => setLines(l => l.map((ln, idx) => idx === i ? { ...ln, [field]: val } : ln));

  async function submit() {
    setSubmitting(true); setError("");
    const payload = { priority, justification, lines: lines.map(l => ({ itemId: l.itemId, quantity: Number(l.quantity), unitOfMeasure: l.unitOfMeasure, estimatedUnitCost: l.estimatedUnitCost ? Number(l.estimatedUnitCost) : undefined })).filter(l => l.itemId) };
    const res = await fetch("/api/purchase-requisitions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    setSubmitting(false);
    if (!res.ok) { setError(extractErrorMessage(await res.json().catch(() => ({})))); return; }
    setShowNew(false); setJustification(""); setLines([{ itemId: "", quantity: 1, unitOfMeasure: "EA", estimatedUnitCost: "" }]); onChange();
  }

  async function doAction(prId: string, action: string, rejectionReason?: string) {
    await fetch(`/api/purchase-requisitions/${prId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, rejectionReason }) });
    onChange();
  }

  const statusColor = (s: string) => ({ DRAFT: "text-steel", SUBMITTED: "text-warn", APPROVED: "text-ok", REJECTED: "text-danger", PO_CREATED: "text-aquaDark" }[s] ?? "text-steel");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-steel text-sm">{prs.length} requisition{prs.length !== 1 ? "s" : ""}</p>
        <button onClick={() => setShowNew(v => !v)} className="bg-ink text-white rounded-lg px-3 py-1.5 text-sm font-medium">{showNew ? "Cancel" : "+ New Requisition"}</button>
      </div>
      {showNew && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3 max-w-2xl">
          <p className="font-medium text-sm">New Purchase Requisition</p>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="text-xs text-steel">Priority</label>
              <select className="w-full border rounded-lg px-2 py-1.5 text-sm mt-1" value={priority} onChange={e => setPriority(e.target.value)}><option>LOW</option><option>NORMAL</option><option>HIGH</option><option>URGENT</option></select></div>
          </div>
          <textarea className="w-full border rounded-lg px-2 py-1.5 text-sm" rows={2} placeholder="Justification / purpose (optional)" value={justification} onChange={e => setJustification(e.target.value)} />
          <div className="space-y-2">
            <p className="text-xs text-steel font-medium uppercase tracking-wide">Line Items</p>
            {lines.map((ln, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-center">
                <div className="col-span-5"><select className="w-full border rounded-lg px-2 py-1 text-xs" value={ln.itemId} onChange={e => updateLine(i, "itemId", e.target.value)}><option value="">Select item…</option>{items.map((it: any) => <option key={it.id} value={it.id}>{it.name}</option>)}</select></div>
                <div className="col-span-2"><input type="number" min={0.01} step={0.01} className="w-full border rounded-lg px-2 py-1 text-xs" placeholder="Qty" value={ln.quantity} onChange={e => updateLine(i, "quantity", e.target.value)} /></div>
                <div className="col-span-2"><input className="w-full border rounded-lg px-2 py-1 text-xs" placeholder="UoM" value={ln.unitOfMeasure} onChange={e => updateLine(i, "unitOfMeasure", e.target.value)} /></div>
                <div className="col-span-2"><input type="number" className="w-full border rounded-lg px-2 py-1 text-xs" placeholder="Est. cost" value={ln.estimatedUnitCost} onChange={e => updateLine(i, "estimatedUnitCost", e.target.value)} /></div>
                <div className="col-span-1 text-center"><button onClick={() => removeLine(i)} className="text-danger text-xs">✕</button></div>
              </div>
            ))}
            <button onClick={addLine} className="text-aquaDark text-xs font-medium">+ Add line</button>
          </div>
          {error && <p className="text-danger text-xs">{error}</p>}
          <button disabled={submitting || !lines.some(l => l.itemId)} onClick={submit} className="bg-ink text-white rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-40">Submit Requisition</button>
        </div>
      )}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-paper text-steel text-xs uppercase"><tr><th className="text-left px-4 py-2">PR #</th><th className="text-left px-4 py-2">Priority</th><th className="text-left px-4 py-2">Lines</th><th className="text-left px-4 py-2">Status</th><th className="text-left px-4 py-2">Actions</th></tr></thead>
          <tbody>
            {prs.map((pr: any) => (
              <tr key={pr.id} className="border-t border-slate-50">
                <td className="px-4 py-2 font-mono text-xs">{pr.prNumber}</td>
                <td className="px-4 py-2 text-xs">{pr.priority}</td>
                <td className="px-4 py-2 text-xs text-steel">{pr.lines?.length ?? 0} item{(pr.lines?.length ?? 0) !== 1 ? "s" : ""}</td>
                <td className={`px-4 py-2 text-xs font-medium ${statusColor(pr.status)}`}>{pr.status}</td>
                <td className="px-4 py-2 text-xs space-x-2">
                  {pr.status === "DRAFT" && <button onClick={() => doAction(pr.id, "submit")} className="text-aquaDark hover:underline font-medium">Submit</button>}
                  {pr.status === "SUBMITTED" && isAdmin && <>
                    <button onClick={() => doAction(pr.id, "approve")} className="text-ok hover:underline font-medium">Approve</button>
                    <RejectButton prId={pr.id} onReject={(reason) => doAction(pr.id, "reject", reason)} />
                  </>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!prs.length && <p className="p-6 text-steel text-sm text-center">No purchase requisitions yet.</p>}
      </div>
    </div>
  );
}

// ── Purchase Orders ─────────────────────────────────────────────────────────
function POTab({ pos, suppliers, approvedPRs, items, grs, onChange, isAdmin }: any) {
  const [showNew, setShowNew] = useState(false);
  const [supplierId, setSupplierId] = useState(""); const [sourcePRId, setSourcePRId] = useState(""); const [notes, setNotes] = useState("");
  const [lines, setLines] = useState([{ itemId: "", orderedQuantity: 1, unitOfMeasure: "EA", unitPrice: 0, taxRate: 15 }]);
  const [submitting, setSubmitting] = useState(false); const [error, setError] = useState("");

  const addLine = () => setLines(l => [...l, { itemId: "", orderedQuantity: 1, unitOfMeasure: "EA", unitPrice: 0, taxRate: 15 }]);
  const removeLine = (i: number) => setLines(l => l.filter((_, idx) => idx !== i));
  const updateLine = (i: number, field: string, val: any) => setLines(l => l.map((ln, idx) => idx === i ? { ...ln, [field]: val } : ln));

  // Pre-fill lines from selected PR
  function selectPR(prId: string) {
    setSourcePRId(prId);
    const pr = approvedPRs.find((p: any) => p.id === prId);
    if (pr?.lines?.length) setLines(pr.lines.map((l: any) => ({ itemId: l.itemId, orderedQuantity: l.quantity, unitOfMeasure: l.unitOfMeasure, unitPrice: l.estimatedUnitCost ?? 0, taxRate: 15 })));
  }

  async function create() {
    setSubmitting(true); setError("");
    const payload = { supplierId, sourcePurchaseRequisitionId: sourcePRId || undefined, notes: notes || undefined, lines: lines.map(l => ({ ...l, orderedQuantity: Number(l.orderedQuantity), unitPrice: Number(l.unitPrice), taxRate: Number(l.taxRate) })).filter(l => l.itemId) };
    const res = await fetch("/api/purchase-orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    setSubmitting(false);
    if (!res.ok) { setError(extractErrorMessage(await res.json().catch(() => ({})))); return; }
    setShowNew(false); setSupplierId(""); setSourcePRId(""); setLines([{ itemId: "", orderedQuantity: 1, unitOfMeasure: "EA", unitPrice: 0, taxRate: 15 }]); onChange();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-steel text-sm">{pos.length} order{pos.length !== 1 ? "s" : ""}</p>
        {isAdmin && <button onClick={() => setShowNew(v => !v)} className="bg-ink text-white rounded-lg px-3 py-1.5 text-sm font-medium">{showNew ? "Cancel" : "+ New Purchase Order"}</button>}
      </div>
      {showNew && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3 max-w-2xl">
          <p className="font-medium text-sm">New Purchase Order</p>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="text-xs text-steel">Supplier</label>
              <select className="w-full border rounded-lg px-2 py-1.5 text-sm mt-1" value={supplierId} onChange={e => setSupplierId(e.target.value)}><option value="">Select supplier…</option>{suppliers.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
            <div><label className="text-xs text-steel">From approved PR (optional)</label>
              <select className="w-full border rounded-lg px-2 py-1.5 text-sm mt-1" value={sourcePRId} onChange={e => selectPR(e.target.value)}><option value="">None</option>{approvedPRs.map((p: any) => <option key={p.id} value={p.id}>{p.prNumber}</option>)}</select></div>
          </div>
          <textarea className="w-full border rounded-lg px-2 py-1.5 text-sm" rows={2} placeholder="Notes (optional)" value={notes} onChange={e => setNotes(e.target.value)} />
          <div className="space-y-2">
            <p className="text-xs text-steel font-medium uppercase tracking-wide">Line Items</p>
            {lines.map((ln, i) => (
              <div key={i} className="grid grid-cols-12 gap-1 items-center text-xs">
                <div className="col-span-4"><select className="w-full border rounded-lg px-2 py-1 text-xs" value={ln.itemId} onChange={e => updateLine(i, "itemId", e.target.value)}><option value="">Item…</option>{items.map((it: any) => <option key={it.id} value={it.id}>{it.name}</option>)}</select></div>
                <div className="col-span-2"><input type="number" className="w-full border rounded-lg px-2 py-1 text-xs" placeholder="Qty" value={ln.orderedQuantity} onChange={e => updateLine(i, "orderedQuantity", e.target.value)} /></div>
                <div className="col-span-1"><input className="w-full border rounded-lg px-2 py-1 text-xs" placeholder="UoM" value={ln.unitOfMeasure} onChange={e => updateLine(i, "unitOfMeasure", e.target.value)} /></div>
                <div className="col-span-2"><input type="number" className="w-full border rounded-lg px-2 py-1 text-xs" placeholder="Price" value={ln.unitPrice} onChange={e => updateLine(i, "unitPrice", e.target.value)} /></div>
                <div className="col-span-2"><input type="number" className="w-full border rounded-lg px-2 py-1 text-xs" placeholder="Tax%" value={ln.taxRate} onChange={e => updateLine(i, "taxRate", e.target.value)} /></div>
                <div className="col-span-1 text-center"><button onClick={() => removeLine(i)} className="text-danger">✕</button></div>
              </div>
            ))}
            <button onClick={addLine} className="text-aquaDark text-xs font-medium">+ Add line</button>
          </div>
          {error && <p className="text-danger text-xs">{error}</p>}
          <button disabled={submitting || !supplierId || !lines.some(l => l.itemId)} onClick={create} className="bg-ink text-white rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-40">Create Purchase Order</button>
        </div>
      )}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-paper text-steel text-xs uppercase"><tr><th className="text-left px-4 py-2">PO #</th><th className="text-left px-4 py-2">Total</th><th className="text-left px-4 py-2">Status</th><th className="text-left px-4 py-2">GRNs</th></tr></thead>
          <tbody>
            {pos.map((po: any) => (
              <tr key={po.id} className="border-t border-slate-50">
                <td className="px-4 py-2 font-mono text-xs">{po.poNumber}</td>
                <td className="px-4 py-2">{po.totalAmount?.toFixed(2)} SAR</td>
                <td className="px-4 py-2"><StatusBadge status={po.status} /></td>
                <td className="px-4 py-2 text-xs text-steel">{grs.filter((g: any) => g.purchaseOrderId === po.id).length} receipt(s)</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!pos.length && <p className="p-6 text-steel text-sm text-center">No purchase orders yet.</p>}
      </div>
    </div>
  );
}

// ── Goods Receipts ──────────────────────────────────────────────────────────
function GRTab({ grs, pos, warehouses, items, onChange }: any) {
  const [showNew, setShowNew] = useState(false);
  const [poId, setPoId] = useState(""); const [warehouseId, setWarehouseId] = useState(""); const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<any[]>([]);
  const [submitting, setSubmitting] = useState(false); const [error, setError] = useState("");

  function selectPO(id: string) {
    setPoId(id);
    const po = pos.find((p: any) => p.id === id);
    if (po?.lines?.length) setLines(po.lines.map((l: any) => ({ purchaseOrderLineId: l.id, itemId: l.itemId, receivedQuantity: l.orderedQuantity, acceptedQuantity: l.orderedQuantity, rejectedQuantity: 0, unitOfMeasure: l.unitOfMeasure, notes: "" })));
    else setLines([]);
  }
  const updateLine = (i: number, field: string, val: any) => setLines(l => l.map((ln, idx) => idx === i ? { ...ln, [field]: val } : ln));

  async function receive() {
    setSubmitting(true); setError("");
    const payload = { purchaseOrderId: poId, warehouseId, notes: notes || undefined, lines: lines.map(l => ({ ...l, receivedQuantity: Number(l.receivedQuantity), acceptedQuantity: Number(l.acceptedQuantity), rejectedQuantity: Number(l.rejectedQuantity) })) };
    const res = await fetch("/api/goods-receipts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    setSubmitting(false);
    if (!res.ok) { setError(extractErrorMessage(await res.json().catch(() => ({})))); return; }
    setShowNew(false); setPoId(""); setWarehouseId(""); setLines([]); onChange();
  }

  const openPOs = pos.filter((p: any) => p.status !== "RECEIVED" && p.status !== "CANCELLED");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-steel text-sm">{grs.length} receipt{grs.length !== 1 ? "s" : ""}</p>
        <button onClick={() => setShowNew(v => !v)} className="bg-ink text-white rounded-lg px-3 py-1.5 text-sm font-medium">{showNew ? "Cancel" : "+ Record Receipt"}</button>
      </div>
      {showNew && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3 max-w-2xl">
          <p className="font-medium text-sm">Goods Receipt</p>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="text-xs text-steel">Purchase Order</label>
              <select className="w-full border rounded-lg px-2 py-1.5 text-sm mt-1" value={poId} onChange={e => selectPO(e.target.value)}><option value="">Select PO…</option>{openPOs.map((p: any) => <option key={p.id} value={p.id}>{p.poNumber}</option>)}</select></div>
            <div><label className="text-xs text-steel">Receiving Warehouse</label>
              <select className="w-full border rounded-lg px-2 py-1.5 text-sm mt-1" value={warehouseId} onChange={e => setWarehouseId(e.target.value)}><option value="">Select warehouse…</option>{warehouses.map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></div>
          </div>
          {lines.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-steel font-medium uppercase tracking-wide">Items to receive</p>
              {lines.map((ln, i) => {
                const item = items.find((it: any) => it.id === ln.itemId);
                return (
                  <div key={i} className="grid grid-cols-12 gap-1 items-center text-xs">
                    <div className="col-span-4"><span className="text-steel">{item?.name ?? ln.itemId}</span></div>
                    <div className="col-span-2"><label className="text-[10px] text-steel">Received</label><input type="number" className="w-full border rounded-lg px-2 py-1 text-xs" value={ln.receivedQuantity} onChange={e => updateLine(i, "receivedQuantity", e.target.value)} /></div>
                    <div className="col-span-2"><label className="text-[10px] text-steel">Accepted</label><input type="number" className="w-full border rounded-lg px-2 py-1 text-xs" value={ln.acceptedQuantity} onChange={e => updateLine(i, "acceptedQuantity", e.target.value)} /></div>
                    <div className="col-span-2"><label className="text-[10px] text-steel">Rejected</label><input type="number" className="w-full border rounded-lg px-2 py-1 text-xs" value={ln.rejectedQuantity} onChange={e => updateLine(i, "rejectedQuantity", e.target.value)} /></div>
                    <div className="col-span-2 text-steel text-[10px]">{ln.unitOfMeasure}</div>
                  </div>
                );
              })}
            </div>
          )}
          <textarea className="w-full border rounded-lg px-2 py-1.5 text-sm" rows={2} placeholder="Notes (optional)" value={notes} onChange={e => setNotes(e.target.value)} />
          {error && <p className="text-danger text-xs">{error}</p>}
          <button disabled={submitting || !poId || !warehouseId || !lines.length} onClick={receive} className="bg-ink text-white rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-40">Post Goods Receipt</button>
          <p className="text-steel text-[11px]">Accepted quantities are posted to inventory on save.</p>
        </div>
      )}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-paper text-steel text-xs uppercase"><tr><th className="text-left px-4 py-2">GRN #</th><th className="text-left px-4 py-2">PO</th><th className="text-left px-4 py-2">Status</th><th className="text-left px-4 py-2">Received</th></tr></thead>
          <tbody>
            {grs.map((g: any) => {
              const po = pos.find((p: any) => p.id === g.purchaseOrderId);
              return <tr key={g.id} className="border-t border-slate-50"><td className="px-4 py-2 font-mono text-xs">{g.receiptNumber}</td><td className="px-4 py-2 text-xs text-steel">{po?.poNumber ?? "—"}</td><td className="px-4 py-2"><StatusBadge status={g.status} /></td><td className="px-4 py-2 text-xs text-steel">{new Date(g.receivedAt).toLocaleDateString()}</td></tr>;
            })}
          </tbody>
        </table>
        {!grs.length && <p className="p-6 text-steel text-sm text-center">No goods receipts yet.</p>}
      </div>
    </div>
  );
}

// Inline rejection reason form — replaces the browser prompt() anti-pattern.
function RejectButton({ prId, onReject }: { prId: string; onReject: (reason: string) => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!open) return <button onClick={() => setOpen(true)} className="text-danger hover:underline font-medium ml-2">Reject</button>;
  return (
    <span className="inline-flex items-center gap-1 ml-2">
      <input className="border rounded px-1.5 py-0.5 text-xs" placeholder="Rejection reason" value={reason} onChange={e => setReason(e.target.value)} autoFocus />
      <button disabled={!reason.trim()} onClick={() => { onReject(reason); setOpen(false); setReason(""); }} className="text-danger text-xs font-medium disabled:opacity-40">Confirm</button>
      <button onClick={() => setOpen(false)} className="text-steel text-xs">Cancel</button>
    </span>
  );
}
