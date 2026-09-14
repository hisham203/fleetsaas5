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
    // Users & Access is now implemented via the separate UsersRolesSection below
    { title: "Users & Access", description: "Manage who can log in — real implementation in this section.", status: "Active — see Roles section above" },
    { title: "Roles & Permissions", description: "12 system roles with module-level permissions. Assign roles to users in the section above.", status: "Live — RBAC Phase 1" },
    { title: "Operational Settings", description: "Tenant-level configuration for dispatch, maintenance, and procurement workflows.", status: "Planned — Phase 2" },
  ];

  return (
    <AdminShell title="Settings">
      <div className="p-6 max-w-4xl mx-auto space-y-4">
        <div>
          <h1 className="text-lg font-semibold">Settings</h1>
          <p className="text-steel text-sm mt-0.5">The central place for platform configuration — numbering, users, roles, permissions, and operational settings.</p>
        </div>

        <div className="card card-body space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-ink">Numbering & Sequences</h3>
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


          {/* RC1 — Apply Recommended Numbering feature */}
          <ApplyRecommendedNumbering onApplied={() => load()} />

          {showNew && <SeriesForm entityTypes={entityTypes} onCancel={() => setShowNew(false)} onSaved={() => { setShowNew(false); load(); }} />}

          <div>
            <p className="text-steel text-xs uppercase tracking-wide mb-1">Configured series</p>
            {series === null ? (
              <p className="text-steel text-sm">Loading…</p>
            ) : series.length === 0 ? (
              <p className="text-steel text-sm">No numbering series configured yet.</p>
            ) : (
              <table className="data-table">
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

        <UsersRolesSection />

        <div className="grid sm:grid-cols-2 gap-4">
          {otherCards.map((c) => (
            <div key={c.title} className="card card-body space-y-2">
              <h3 className="text-sm font-semibold text-ink">{c.title}</h3>
              <p className="text-steel text-sm">{c.description}</p>
              <p className="text-warn text-xs bg-warn/10 rounded-lg px-2 py-1 inline-block">{c.status}</p>
            </div>
          ))}
        </div>
      </div>
    </AdminShell>
  );
}


// RC1 — Users & Roles Section.
function UsersRolesSection() {
  const [data, setData] = useState<{ users: any[]; userRoles: any[] } | null>(null);
  const [allRoles, setAllRoles] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch("/api/user-roles").then(r => r.ok ? r.json() : null).then(d => d && setData(d)).catch(() => {});
    fetch("/api/roles").then(r => r.ok ? r.json() : {}).then(d => setAllRoles((d as any).roles ?? [])).catch(() => {});
  }, []);
  async function assign(userId: string, roleId: string) {
    setBusy(true);
    await fetch("/api/user-roles", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId, roleId }) });
    const d = await fetch("/api/user-roles").then(r => r.json());
    setData(d); setBusy(false);
  }
  async function revoke(userId: string, roleId: string) {
    setBusy(true);
    await fetch("/api/user-roles", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId, roleId }) });
    const d = await fetch("/api/user-roles").then(r => r.json());
    setData(d); setBusy(false);
  }
  if (!data) return <div className="card card-body"><p className="text-steel text-sm">Loading users…</p></div>;
  return (
    <div className="card card-body space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink">Users &amp; Roles</h3>
        <span className="text-xs text-ok bg-ok/10 rounded px-2 py-0.5">RC1 Live</span>
      </div>
      <p className="text-steel text-xs">Assign module-level roles to tenant users. The legacy system role (ADMIN/DISPATCHER/DRIVER) still grants full access unless you add explicit role assignments.</p>
      <div className="space-y-2">
        {data.users.map((u: any) => {
          const assigned = data.userRoles.filter((ur: any) => ur.userId === u.id);
          return (
            <div key={u.id} className="border border-slate-100 rounded-lg p-3">
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm font-medium">{u.name} <span className="text-steel text-xs font-normal">{u.email}</span></p>
                <span className="text-xs text-steel bg-paper rounded px-1.5 py-0.5">{u.role}</span>
              </div>
              <div className="flex flex-wrap gap-1 mb-1">
                {assigned.map((ur: any) => (
                  <span key={ur.id} className="inline-flex items-center gap-1 text-xs bg-ink/10 rounded px-2 py-0.5">
                    {ur.role?.label ?? ur.roleId}
                    <button onClick={() => revoke(u.id, ur.roleId)} className="text-danger font-bold leading-none" title="Revoke">×</button>
                  </span>
                ))}
                {!assigned.length && <span className="text-steel text-xs italic">No explicit roles assigned</span>}
              </div>
              <select disabled={busy} onChange={e => { if (e.target.value) { assign(u.id, e.target.value); (e.target as HTMLSelectElement).value = ""; } }} className="text-xs border rounded px-2 py-1 text-steel bg-white">
                <option value="">+ Assign role…</option>
                {allRoles.filter((r: any) => !assigned.find((ur: any) => ur.roleId === r.id)).map((r: any) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
            </div>
          );
        })}
        {!data.users.length && <p className="text-steel text-sm">No users in this tenant.</p>}
      </div>
    </div>
  );
}

// RC1 — Apply Recommended Numbering: previews then creates missing standard series.
function ApplyRecommendedNumbering({ onApplied }: { onApplied: () => void }) {
  const [preview, setPreview] = useState<{ toCreate: any[]; alreadyConfigured: any[] } | null>(null);
  const [applying, setApplying] = useState(false);
  const [done, setDone] = useState<number | null>(null);

  async function load() {
    const r = await fetch("/api/settings/numbering-apply-recommended");
    if (r.ok) setPreview(await r.json());
  }

  async function apply() {
    setApplying(true);
    const r = await fetch("/api/settings/numbering-apply-recommended", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: true }) });
    setApplying(false);
    if (r.ok) { const d = await r.json(); setDone(d.created); setPreview(null); onApplied(); }
  }

  return (
    <div className="border border-slate-100 rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-steel text-xs font-medium">Apply Recommended Smarty1 Numbering</p>
        <button onClick={preview ? () => setPreview(null) : load} className="text-aquaDark text-xs font-medium hover:underline">
          {preview ? "Cancel" : "Preview"}
        </button>
      </div>
      {done !== null && <p className="text-ok text-xs">✓ Created {done} numbering series.</p>}
      {preview && (
        <div className="space-y-2">
          {preview.toCreate.length === 0 ? (
            <p className="text-ok text-xs">All recommended series are already configured.</p>
          ) : (
            <>
              <p className="text-steel text-xs">Will create {preview.toCreate.length} missing series:</p>
              <div className="flex flex-wrap gap-1">{preview.toCreate.map((s: any) => <span key={s.entityType} className="text-xs bg-ok/10 text-ok rounded px-2 py-0.5">{s.prefix}{s.seriesSegment}001</span>)}</div>
              {preview.alreadyConfigured.length > 0 && <p className="text-steel text-[11px]">Already configured: {preview.alreadyConfigured.map((s: any) => s.entityType).join(", ")}</p>}
              <button onClick={apply} disabled={applying} className="bg-ok text-white rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-40">
                {applying ? "Applying…" : `Create ${preview.toCreate.length} series`}
              </button>
              <p className="text-steel text-[11px]">This only creates series that don&apos;t already exist. No existing series are changed.</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Milestone AE, Part 3 — a single form for both create (no series// Milestone AE, Part 3 — a single form for both create (no series
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
