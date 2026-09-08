"use client";

import { useEffect, useState, useCallback } from "react";
import AdminShell from "@/components/AdminShell";
import { useRequireSession } from "@/lib/useSession";
import { extractErrorMessage } from "@/lib/helpers";
import { CODE_FIELD_ENTITY_MAP } from "@/lib/numberingFormat";

// Milestone AC, Part 4 — Settings foundation.
// Milestone AD, Part 9 — Numbering & Sequences upgraded to read-only.
// Milestone AE, Part 3 — Numbering & Sequences upgraded again to a
// real configuration UI: create/edit series (safe fields only —
// entityType/seriesCode/nextNumber are immutable after creation, per
// this route's own validation), and a live preview using the exact
// same pure formatSequenceNumber() the real allocator uses — the
// preview never calls the allocator itself, so it can never consume a
// real number. Users & Access, Roles & Permissions, and Operational
// Settings remain honestly design-pending.
export default function SettingsPage() {
  const { session, loading } = useRequireSession(["ADMIN"]);
  const [series, setSeries] = useState<any[] | null>(null);
  const [entityTypes, setEntityTypes] = useState<any[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/settings/numbering-series").then((r) => (r.ok ? r.json() : [])).then(setSeries);
  }, []);

  useEffect(() => {
    if (!session) return;
    load();
    fetch("/api/settings/numbering-entity-types").then((r) => (r.ok ? r.json() : [])).then(setEntityTypes);
  }, [session, load]);

  if (loading || !session) {
    return <div className="min-h-screen bg-paper flex items-center justify-center text-steel text-sm">Loading…</div>;
  }

  const otherCards = [
    { title: "Users & Access", description: "Manage who can log in and which tenant(s) they belong to.", status: "Design pending / schema required" },
    { title: "Roles & Permissions", description: "Dispatch Supervisor, Maintenance Team, Workshop Manager, Procurement, Inventory, and other role-based access.", status: "Design pending / schema required" },
    { title: "Operational Settings", description: "Tenant-level configuration for dispatch, maintenance, and procurement workflows.", status: "Design pending / schema required" },
  ];

  return (
    <AdminShell title="Settings">
      <div className="p-6 max-w-4xl mx-auto space-y-4">
        <div>
          <h1 className="text-lg font-semibold">Settings</h1>
          <p className="text-steel text-sm mt-0.5">The central place for platform configuration — numbering, users, roles, permissions, and operational settings.</p>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-sm">Numbering & Sequences</h3>
            <button onClick={() => setShowNew((v) => !v)} className="bg-ink text-white rounded-lg px-3 py-1 text-xs font-medium">{showNew ? "Cancel" : "+ New Series"}</button>
          </div>
          <p className="text-steel text-xs bg-warn/10 rounded-lg px-2 py-1.5">Auto-numbering is live for Suppliers, Item Groups, Categories, Sub-Categories, Items, Workshops, and Maintenance Warehouses. Other entities are listed below as future/audit-only — none are faked.</p>

          {/* Milestone AF, Part 9 — honest coverage table driven by the
              same CODE_FIELD_ENTITY_MAP the APIs use, so this view can't
              drift from what the routes actually do. */}
          <div>
            <p className="text-steel text-xs uppercase tracking-wide mb-1">Numbering coverage</p>
            <table className="w-full text-xs">
              <thead className="text-steel uppercase"><tr><th className="text-left py-1">Entity</th><th className="text-left py-1">Field</th><th className="text-left py-1">Status</th></tr></thead>
              <tbody>
                {CODE_FIELD_ENTITY_MAP.map((m) => (
                  <tr key={m.entityType} className="border-t border-slate-50">
                    <td className="py-1 font-mono">{m.entityType}</td>
                    <td className="py-1 text-steel">{m.field}</td>
                    <td className="py-1">
                      <span className={m.status === "converted" ? "text-ok" : "text-steel"}>
                        {m.status === "converted" ? "Converted" : m.status === "schema-gap" ? "Schema gap (proposed)" : "Audit-only / future"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {showNew && <SeriesForm entityTypes={entityTypes} onCancel={() => setShowNew(false)} onSaved={() => { setShowNew(false); load(); }} />}

          <div>
            <p className="text-steel text-xs uppercase tracking-wide mb-1">Configured series</p>
            {series === null ? (
              <p className="text-steel text-sm">Loading…</p>
            ) : series.length === 0 ? (
              <p className="text-steel text-sm">No numbering series configured yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-steel text-xs uppercase"><tr><th className="text-left py-1">Entity</th><th className="text-left py-1">Prefix</th><th className="text-left py-1">Next</th><th className="text-left py-1">Status</th><th className="text-left py-1">Actions</th></tr></thead>
                <tbody>
                  {series.map((s: any) => (
                    <>
                      <tr key={s.id} className="border-t border-slate-50">
                        <td className="py-1">{s.displayName}</td>
                        <td className="py-1 font-mono text-xs">{s.prefix}</td>
                        <td className="py-1">{s.nextNumber}</td>
                        <td className="py-1 text-steel">{s.status}</td>
                        <td className="py-1"><button onClick={() => setEditingId(editingId === s.id ? null : s.id)} className="text-aquaDark hover:underline text-xs font-medium">{editingId === s.id ? "Close" : "Edit"}</button></td>
                      </tr>
                      {editingId === s.id && (
                        <tr className="bg-paper"><td colSpan={5} className="py-2">
                          <SeriesForm series={s} entityTypes={entityTypes} onCancel={() => setEditingId(null)} onSaved={() => { setEditingId(null); load(); }} />
                        </td></tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div>
            <p className="text-steel text-xs uppercase tracking-wide mb-1">Supported entity types</p>
            <div className="flex flex-wrap gap-1.5">
              {entityTypes.map((et: any) => (
                <span key={et.entityType} className="text-xs bg-paper rounded px-2 py-0.5">{et.label} ({et.recommendedPrefix})</span>
              ))}
            </div>
          </div>

          <div>
            <p className="text-steel text-xs uppercase tracking-wide mb-1">Format examples</p>
            <div className="flex flex-wrap gap-1.5 font-mono text-xs">
              {["C06001", "S06001", "V06001", "VH06001", "D06001", "CN06001", "EX06001", "LP06001", "IG06001", "IC06001", "ISC06001", "I06001", "W06001", "WH06001"].map((ex) => (
                <span key={ex} className="bg-paper rounded px-2 py-0.5">{ex}</span>
              ))}
            </div>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          {otherCards.map((c) => (
            <div key={c.title} className="bg-white rounded-xl border border-slate-200 p-4 space-y-2">
              <h3 className="font-medium text-sm">{c.title}</h3>
              <p className="text-steel text-sm">{c.description}</p>
              <p className="text-warn text-xs bg-warn/10 rounded-lg px-2 py-1 inline-block">{c.status}</p>
            </div>
          ))}
        </div>
      </div>
    </AdminShell>
  );
}

// Milestone AE, Part 3 — a single form for both create (no series
// prop) and edit (series prop provided). entityType/seriesCode/
// nextNumber are locked once a series exists — the edit view shows
// them read-only rather than as editable inputs, matching the PATCH
// route's own validation exactly.
function SeriesForm({ series, entityTypes, onCancel, onSaved }: any) {
  const [entityType, setEntityType] = useState(series?.entityType ?? "");
  const [seriesCode, setSeriesCode] = useState(series?.seriesCode ?? "");
  const [displayName, setDisplayName] = useState(series?.displayName ?? "");
  const [prefix, setPrefix] = useState(series?.prefix ?? "");
  const [seriesSegment, setSeriesSegment] = useState(series?.seriesSegment ?? "");
  const [separator, setSeparator] = useState(series?.separator ?? "");
  const [paddingLength, setPaddingLength] = useState(series?.paddingLength ?? 3);
  const [nextNumber] = useState(series?.nextNumber ?? 1); // immutable after creation
  const [resetPolicy, setResetPolicy] = useState(series?.resetPolicy ?? "NEVER");
  const [status, setStatus] = useState(series?.status ?? "ACTIVE");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Milestone AE, Part 3 — pure client-side preview, matching
  // lib/numbering.ts's own formatSequenceNumber() exactly. This never
  // calls any API and never allocates a real number.
  function previewFormat(): string {
    const parts = [prefix || "?"];
    if (seriesSegment) parts.push(seriesSegment);
    parts.push(String(nextNumber).padStart(Number(paddingLength) || 3, "0"));
    return parts.join(separator || "");
  }

  async function save() {
    setSubmitting(true);
    setError("");
    const body: Record<string, unknown> = { displayName, prefix, seriesSegment: seriesSegment || undefined, separator, paddingLength: Number(paddingLength), resetPolicy, status };
    if (!series) {
      body.entityType = entityType;
      body.seriesCode = seriesCode;
      body.nextNumber = Number(nextNumber);
    }
    const res = series
      ? await fetch(`/api/settings/numbering-series/${series.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      : await fetch("/api/settings/numbering-series", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setSubmitting(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(extractErrorMessage(data));
      return;
    }
    onSaved();
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-3 space-y-2 max-w-md">
      {series ? (
        <p className="text-steel text-xs">Entity: <span className="font-mono">{series.entityType}</span> · Series code: <span className="font-mono">{series.seriesCode}</span> (locked)</p>
      ) : (
        <>
          <select className="w-full border rounded-lg px-2 py-1.5 text-sm" value={entityType} onChange={(e) => setEntityType(e.target.value)}>
            <option value="">Select entity type</option>
            {entityTypes.map((et: any) => <option key={et.entityType} value={et.entityType}>{et.label} (recommended: {et.recommendedPrefix})</option>)}
          </select>
          <input className="w-full border rounded-lg px-2 py-1.5 text-sm" placeholder="Series code (e.g. SUPPLIER_MAIN)" value={seriesCode} onChange={(e) => setSeriesCode(e.target.value)} />
        </>
      )}
      <input className="w-full border rounded-lg px-2 py-1.5 text-sm" placeholder="Display name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      <div className="grid grid-cols-3 gap-2">
        <input className="border rounded-lg px-2 py-1.5 text-sm" placeholder="Prefix (e.g. V)" value={prefix} onChange={(e) => setPrefix(e.target.value)} />
        <input className="border rounded-lg px-2 py-1.5 text-sm" placeholder="Segment (e.g. 06)" value={seriesSegment} onChange={(e) => setSeriesSegment(e.target.value)} />
        <input className="border rounded-lg px-2 py-1.5 text-sm" placeholder="Separator" value={separator} onChange={(e) => setSeparator(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input type="number" min={1} max={10} className="border rounded-lg px-2 py-1.5 text-sm" placeholder="Padding length" value={paddingLength} onChange={(e) => setPaddingLength(Number(e.target.value))} />
        <select className="border rounded-lg px-2 py-1.5 text-sm" value={resetPolicy} onChange={(e) => setResetPolicy(e.target.value)}>
          <option value="NEVER">NEVER</option>
          <option value="YEARLY">YEARLY</option>
          <option value="MONTHLY">MONTHLY</option>
        </select>
      </div>
      <select className="w-full border rounded-lg px-2 py-1.5 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="ACTIVE">ACTIVE</option>
        <option value="INACTIVE">INACTIVE</option>
      </select>
      <p className="text-steel text-xs">Preview (does not consume a number): <span className="font-mono font-medium">{previewFormat()}</span></p>
      {error && <p className="text-danger text-xs">{error}</p>}
      <div className="flex gap-2">
        <button disabled={(!series && (!entityType || !seriesCode)) || !displayName || !prefix || submitting} onClick={save} className="bg-ink text-white rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-40">Save</button>
        <button onClick={onCancel} className="text-steel text-xs">Cancel</button>
      </div>
    </div>
  );
}
