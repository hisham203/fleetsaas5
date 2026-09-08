"use client";

import { useEffect, useState, useCallback } from "react";
import AdminShell from "@/components/AdminShell";
import StatusBadge from "@/components/StatusBadge";
import { useRequireSession } from "@/lib/useSession";
import { extractErrorMessage } from "@/lib/helpers";

const ITEM_TYPES = ["SPARE_PART", "TIRE", "LUBRICANT", "CONSUMABLE", "TOOL", "SAFETY", "OTHER"];
const UOMS = ["EA", "PCS", "LITER", "SET", "KG", "METER"];

// Milestone Z.2, Part 3 — Master Items CRUD foundation. Owns item
// hierarchy/definitions only; stock quantity is never edited here (see
// the note at the bottom of the Items tab) — that's Inventory's job.
export default function MasterItemsPage() {
  const { session, loading } = useRequireSession(["ADMIN"]);
  const [tab, setTab] = useState<"groups" | "categories" | "subcategories" | "items">("groups");
  const [groups, setGroups] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [subcategories, setSubcategories] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [dataLoading, setDataLoading] = useState(true);

  const load = useCallback(async () => {
    setDataLoading(true);
    const [g, c, s, i] = await Promise.all([
      fetch("/api/item-groups").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/item-categories").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/item-subcategories").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/items").then((r) => (r.ok ? r.json() : [])),
    ]);
    setGroups(g);
    setCategories(c);
    setSubcategories(s);
    setItems(i);
    setDataLoading(false);
  }, []);

  useEffect(() => {
    if (session) load();
  }, [session, load]);

  if (loading || !session) {
    return <div className="min-h-screen bg-paper flex items-center justify-center text-steel text-sm">Loading…</div>;
  }

  return (
    <AdminShell title="Master Items">
      <div className="p-6 max-w-5xl mx-auto space-y-4">
        <div>
          <h1 className="text-lg font-semibold">Master Items</h1>
          <p className="text-steel text-sm mt-0.5">Item groups, categories, sub-categories, and the item master — definitions only, not stock.</p>
        </div>

        <div className="flex gap-2">
          {(["groups", "categories", "subcategories", "items"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`px-3 py-1.5 rounded-lg text-xs font-medium border capitalize ${tab === t ? "bg-ink text-white border-ink" : "bg-white text-steel border-slate-200"}`}>
              {t}
            </button>
          ))}
        </div>

        {dataLoading ? (
          <p className="text-steel text-sm">Loading…</p>
        ) : (
          <>
            {tab === "groups" && <GroupsTab groups={groups} onChange={load} />}
            {tab === "categories" && <CategoriesTab categories={categories} groups={groups} onChange={load} />}
            {tab === "subcategories" && <SubcategoriesTab subcategories={subcategories} categories={categories} onChange={load} />}
            {tab === "items" && <ItemsTab items={items} categories={categories} subcategories={subcategories} groups={groups} onChange={load} />}
          </>
        )}
      </div>
    </AdminShell>
  );
}

function GroupsTab({ groups, onChange }: any) {
  const [showNew, setShowNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button onClick={() => setShowNew((v) => !v)} className="bg-ink text-white rounded-lg px-3 py-1.5 text-xs font-medium">{showNew ? "Cancel" : "+ New Item Group"}</button>
      </div>
      {showNew && <GroupForm onCancel={() => setShowNew(false)} onSaved={() => { setShowNew(false); onChange(); }} />}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {groups.length === 0 ? (
          <p className="p-6 text-steel text-sm text-center">No item groups yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-paper text-steel text-xs uppercase"><tr><th className="text-left px-4 py-2">Code</th><th className="text-left px-4 py-2">Name</th><th className="text-left px-4 py-2">Status</th><th className="text-left px-4 py-2">Actions</th></tr></thead>
            <tbody>
              {groups.map((g: any) => (
                <>
                  <tr key={g.id} className="border-t border-slate-100">
                    <td className="px-4 py-2 font-mono text-xs">{g.code}</td>
                    <td className="px-4 py-2">{g.name}</td>
                    <td className="px-4 py-2"><StatusBadge status={g.status} /></td>
                    <td className="px-4 py-2"><button onClick={() => setEditingId(editingId === g.id ? null : g.id)} className="text-aquaDark hover:underline text-xs font-medium">{editingId === g.id ? "Close" : "Edit"}</button></td>
                  </tr>
                  {editingId === g.id && <tr className="bg-paper"><td colSpan={4} className="px-4 py-3"><GroupForm group={g} onCancel={() => setEditingId(null)} onSaved={() => { setEditingId(null); onChange(); }} /></td></tr>}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function GroupForm({ group, onCancel, onSaved }: any) {
  const [code, setCode] = useState(group?.code ?? "");
  const [name, setName] = useState(group?.name ?? "");
  const [status, setStatus] = useState(group?.status ?? "ACTIVE");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function save() {
    setSubmitting(true);
    setError("");
    const res = group
      ? await fetch(`/api/item-groups/${group.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, name, status }) })
      : await fetch("/api/item-groups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, name, status }) });
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
      <div><input className="w-full border rounded-lg px-2 py-1.5 text-sm" placeholder="Code (optional)" value={code} onChange={(e) => setCode(e.target.value)} /><p className="text-steel text-xs mt-0.5">Leave blank to auto-generate from Settings numbering series.</p></div>
      <input className="w-full border rounded-lg px-2 py-1.5 text-sm" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
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

function CategoriesTab({ categories, groups, onChange }: any) {
  const [showNew, setShowNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button onClick={() => setShowNew((v) => !v)} className="bg-ink text-white rounded-lg px-3 py-1.5 text-xs font-medium">{showNew ? "Cancel" : "+ New Category"}</button>
      </div>
      {showNew && <CategoryForm groups={groups} onCancel={() => setShowNew(false)} onSaved={() => { setShowNew(false); onChange(); }} />}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {categories.length === 0 ? (
          <p className="p-6 text-steel text-sm text-center">No item categories yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-paper text-steel text-xs uppercase"><tr><th className="text-left px-4 py-2">Code</th><th className="text-left px-4 py-2">Name</th><th className="text-left px-4 py-2">Group</th><th className="text-left px-4 py-2">Status</th><th className="text-left px-4 py-2">Actions</th></tr></thead>
            <tbody>
              {categories.map((c: any) => (
                <>
                  <tr key={c.id} className="border-t border-slate-100">
                    <td className="px-4 py-2 font-mono text-xs">{c.code}</td>
                    <td className="px-4 py-2">{c.name}</td>
                    <td className="px-4 py-2 text-steel">{groups.find((g: any) => g.id === c.itemGroupId)?.name ?? "—"}</td>
                    <td className="px-4 py-2"><StatusBadge status={c.status} /></td>
                    <td className="px-4 py-2"><button onClick={() => setEditingId(editingId === c.id ? null : c.id)} className="text-aquaDark hover:underline text-xs font-medium">{editingId === c.id ? "Close" : "Edit"}</button></td>
                  </tr>
                  {editingId === c.id && <tr className="bg-paper"><td colSpan={5} className="px-4 py-3"><CategoryForm category={c} groups={groups} onCancel={() => setEditingId(null)} onSaved={() => { setEditingId(null); onChange(); }} /></td></tr>}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function CategoryForm({ category, groups, onCancel, onSaved }: any) {
  const [code, setCode] = useState(category?.code ?? "");
  const [name, setName] = useState(category?.name ?? "");
  const [itemGroupId, setItemGroupId] = useState(category?.itemGroupId ?? "");
  const [status, setStatus] = useState(category?.status ?? "ACTIVE");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function save() {
    setSubmitting(true);
    setError("");
    const body = { code: code || undefined, name, status, itemGroupId: itemGroupId || null };
    const res = category
      ? await fetch(`/api/item-categories/${category.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      : await fetch("/api/item-categories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
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
      <div><input className="w-full border rounded-lg px-2 py-1.5 text-sm" placeholder="Code (optional)" value={code} onChange={(e) => setCode(e.target.value)} /><p className="text-steel text-xs mt-0.5">Leave blank to auto-generate from Settings numbering series.</p></div>
      <input className="w-full border rounded-lg px-2 py-1.5 text-sm" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
      <select className="w-full border rounded-lg px-2 py-1.5 text-sm" value={itemGroupId} onChange={(e) => setItemGroupId(e.target.value)}>
        <option value="">No group</option>
        {groups.map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}
      </select>
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

function SubcategoriesTab({ subcategories, categories, onChange }: any) {
  const [showNew, setShowNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button onClick={() => setShowNew((v) => !v)} className="bg-ink text-white rounded-lg px-3 py-1.5 text-xs font-medium">{showNew ? "Cancel" : "+ New Sub-Category"}</button>
      </div>
      {showNew && <SubcategoryForm categories={categories} onCancel={() => setShowNew(false)} onSaved={() => { setShowNew(false); onChange(); }} />}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {subcategories.length === 0 ? (
          <p className="p-6 text-steel text-sm text-center">No item sub-categories yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-paper text-steel text-xs uppercase"><tr><th className="text-left px-4 py-2">Code</th><th className="text-left px-4 py-2">Name</th><th className="text-left px-4 py-2">Category</th><th className="text-left px-4 py-2">Status</th><th className="text-left px-4 py-2">Actions</th></tr></thead>
            <tbody>
              {subcategories.map((s: any) => (
                <>
                  <tr key={s.id} className="border-t border-slate-100">
                    <td className="px-4 py-2 font-mono text-xs">{s.code}</td>
                    <td className="px-4 py-2">{s.name}</td>
                    <td className="px-4 py-2 text-steel">{categories.find((c: any) => c.id === s.categoryId)?.name ?? "—"}</td>
                    <td className="px-4 py-2"><StatusBadge status={s.status} /></td>
                    <td className="px-4 py-2"><button onClick={() => setEditingId(editingId === s.id ? null : s.id)} className="text-aquaDark hover:underline text-xs font-medium">{editingId === s.id ? "Close" : "Edit"}</button></td>
                  </tr>
                  {editingId === s.id && <tr className="bg-paper"><td colSpan={5} className="px-4 py-3"><SubcategoryForm subcategory={s} categories={categories} onCancel={() => setEditingId(null)} onSaved={() => { setEditingId(null); onChange(); }} /></td></tr>}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function SubcategoryForm({ subcategory, categories, onCancel, onSaved }: any) {
  const [code, setCode] = useState(subcategory?.code ?? "");
  const [name, setName] = useState(subcategory?.name ?? "");
  const [categoryId, setCategoryId] = useState(subcategory?.categoryId ?? "");
  const [status, setStatus] = useState(subcategory?.status ?? "ACTIVE");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function save() {
    setSubmitting(true);
    setError("");
    const body = { code: code || undefined, name, status, categoryId };
    const res = subcategory
      ? await fetch(`/api/item-subcategories/${subcategory.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      : await fetch("/api/item-subcategories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
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
      <div><input className="w-full border rounded-lg px-2 py-1.5 text-sm" placeholder="Code (optional)" value={code} onChange={(e) => setCode(e.target.value)} /><p className="text-steel text-xs mt-0.5">Leave blank to auto-generate from Settings numbering series.</p></div>
      <input className="w-full border rounded-lg px-2 py-1.5 text-sm" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
      <select className="w-full border rounded-lg px-2 py-1.5 text-sm" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
        <option value="">Select a category</option>
        {categories.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <select className="w-full border rounded-lg px-2 py-1.5 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="ACTIVE">ACTIVE</option>
        <option value="INACTIVE">INACTIVE</option>
      </select>
      {error && <p className="text-danger text-xs">{error}</p>}
      <div className="flex gap-2">
        <button disabled={!name || !categoryId || submitting} onClick={save} className="bg-ink text-white rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-40">Save</button>
        <button onClick={onCancel} className="text-steel text-xs">Cancel</button>
      </div>
    </div>
  );
}

function ItemsTab({ items, categories, subcategories, groups, onChange }: any) {
  const [showNew, setShowNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <p className="text-steel text-xs bg-warn/10 rounded-lg px-3 py-2">Item Master defines the item. Stock quantity is managed in Inventory, not here.</p>
      <div className="flex justify-end">
        <button onClick={() => setShowNew((v) => !v)} className="bg-ink text-white rounded-lg px-3 py-1.5 text-xs font-medium">{showNew ? "Cancel" : "+ New Item"}</button>
      </div>
      {showNew && <ItemForm categories={categories} subcategories={subcategories} groups={groups} onCancel={() => setShowNew(false)} onSaved={() => { setShowNew(false); onChange(); }} />}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {items.length === 0 ? (
          <p className="p-6 text-steel text-sm text-center">No items yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-paper text-steel text-xs uppercase"><tr><th className="text-left px-4 py-2">Code</th><th className="text-left px-4 py-2">Name</th><th className="text-left px-4 py-2">Type</th><th className="text-left px-4 py-2">UOM</th><th className="text-left px-4 py-2">Status</th><th className="text-left px-4 py-2">Actions</th></tr></thead>
            <tbody>
              {items.map((it: any) => (
                <>
                  <tr key={it.id} className="border-t border-slate-100">
                    <td className="px-4 py-2 font-mono text-xs">{it.itemCode}</td>
                    <td className="px-4 py-2">{it.name}</td>
                    <td className="px-4 py-2 text-steel">{it.itemType}</td>
                    <td className="px-4 py-2 text-steel">{it.unitOfMeasure}</td>
                    <td className="px-4 py-2"><StatusBadge status={it.status} /></td>
                    <td className="px-4 py-2"><button onClick={() => setEditingId(editingId === it.id ? null : it.id)} className="text-aquaDark hover:underline text-xs font-medium">{editingId === it.id ? "Close" : "Edit"}</button></td>
                  </tr>
                  {editingId === it.id && <tr className="bg-paper"><td colSpan={6} className="px-4 py-3"><ItemForm item={it} categories={categories} subcategories={subcategories} groups={groups} onCancel={() => setEditingId(null)} onSaved={() => { setEditingId(null); onChange(); }} /></td></tr>}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function ItemForm({ item, categories, subcategories, groups, onCancel, onSaved }: any) {
  const [itemCode, setItemCode] = useState(item?.itemCode ?? "");
  const [name, setName] = useState(item?.name ?? "");
  const [categoryId, setCategoryId] = useState(item?.categoryId ?? "");
  const [subCategoryId, setSubCategoryId] = useState(item?.subCategoryId ?? "");
  const [itemGroupId, setItemGroupId] = useState(item?.itemGroupId ?? "");
  const [itemType, setItemType] = useState(item?.itemType ?? "SPARE_PART");
  const [unitOfMeasure, setUnitOfMeasure] = useState(item?.unitOfMeasure ?? "EA");
  const [isStocked, setIsStocked] = useState(item?.isStocked ?? true);
  const [isSerialized, setIsSerialized] = useState(item?.isSerialized ?? false);
  const [isTire, setIsTire] = useState(item?.isTire ?? false);
  const [brand, setBrand] = useState(item?.brand ?? "");
  const [status, setStatus] = useState(item?.status ?? "ACTIVE");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const filteredSubcategories = subcategories.filter((s: any) => s.categoryId === categoryId);

  async function save() {
    setSubmitting(true);
    setError("");
    const body = {
      itemCode: itemCode || undefined, name, categoryId, itemType, unitOfMeasure, isStocked, isSerialized, isTire, brand, status,
      subCategoryId: subCategoryId || null,
      itemGroupId: itemGroupId || null,
    };
    const res = item
      ? await fetch(`/api/items/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      : await fetch("/api/items", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setSubmitting(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(extractErrorMessage(data));
      return;
    }
    onSaved();
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-2 max-w-lg">
      <div><input className="w-full border rounded-lg px-2 py-1.5 text-sm" placeholder="Item code (optional)" value={itemCode} onChange={(e) => setItemCode(e.target.value)} /><p className="text-steel text-xs mt-0.5">Leave blank to auto-generate from Settings numbering series.</p></div>
      <input className="w-full border rounded-lg px-2 py-1.5 text-sm" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
      <div className="grid grid-cols-2 gap-2">
        <select className="border rounded-lg px-2 py-1.5 text-sm" value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setSubCategoryId(""); }}>
          <option value="">Select category</option>
          {categories.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className="border rounded-lg px-2 py-1.5 text-sm" value={subCategoryId} onChange={(e) => setSubCategoryId(e.target.value)}>
          <option value="">No sub-category</option>
          {filteredSubcategories.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      <select className="w-full border rounded-lg px-2 py-1.5 text-sm" value={itemGroupId} onChange={(e) => setItemGroupId(e.target.value)}>
        <option value="">No group</option>
        {groups.map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}
      </select>
      <div className="grid grid-cols-2 gap-2">
        <select className="border rounded-lg px-2 py-1.5 text-sm" value={itemType} onChange={(e) => setItemType(e.target.value)}>
          {ITEM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className="border rounded-lg px-2 py-1.5 text-sm" value={unitOfMeasure} onChange={(e) => setUnitOfMeasure(e.target.value)}>
          {UOMS.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
      </div>
      <input className="w-full border rounded-lg px-2 py-1.5 text-sm" placeholder="Brand (optional)" value={brand} onChange={(e) => setBrand(e.target.value)} />
      <div className="flex gap-4 text-xs text-steel">
        <label className="flex items-center gap-1"><input type="checkbox" checked={isStocked} onChange={(e) => setIsStocked(e.target.checked)} /> Stocked</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={isSerialized} onChange={(e) => setIsSerialized(e.target.checked)} /> Serialized</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={isTire} onChange={(e) => setIsTire(e.target.checked)} /> Tire</label>
      </div>
      <select className="w-full border rounded-lg px-2 py-1.5 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="ACTIVE">ACTIVE</option>
        <option value="INACTIVE">INACTIVE</option>
      </select>
      {error && <p className="text-danger text-xs">{error}</p>}
      <div className="flex gap-2">
        <button disabled={!name || !categoryId || submitting} onClick={save} className="bg-ink text-white rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-40">Save</button>
        <button onClick={onCancel} className="text-steel text-xs">Cancel</button>
      </div>
    </div>
  );
}
