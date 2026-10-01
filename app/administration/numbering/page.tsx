"use client";
/**
 * Administration — Numbering & Sequences
 * Canonical route: /administration/numbering
 *
 * Reuses all real numbering functionality from the original /admin/settings page.
 * Root cause of the /admin/settings crash was fixed (Fragment key bug).
 * This page uses the enterprise AdminShell and DS components.
 *
 * EXP-001: Apply Recommended is here. Canonical RECOMMENDED_NUMBERING_DEFAULTS
 * used by the API — this page never duplicates the defaults list.
 */
import { useEffect, useState, useCallback } from "react";
import AdminShell from "@/components/AdminShell";
import {
  PageContainer, PageHeader, MetricCard, StatusBadge, EmptyState,
  LoadingState, Btn,
} from "@/components/ds";
import { CODE_FIELD_ENTITY_MAP } from "@/lib/numberingFormat";
import { extractErrorMessage } from "@/lib/helpers";

// ── Types ───────────────────────────────────────────────────────────────────
interface Series {
  id: string; tenantId: string; entityType: string; seriesCode: string;
  displayName: string; prefix: string; seriesSegment?: string;
  separator: string; paddingLength: number; nextNumber: number;
  resetPolicy: string; status: string;
}
interface EntityTypeInfo { entityType: string; recommendedPrefix: string; label: string; }

// ── Apply Recommended ────────────────────────────────────────────────────────
function ApplyRecommendedNumbering({ onApplied }: { onApplied: () => void }) {
  const [preview, setPreview] = useState<{ toCreate: any[]; alreadyConfigured: any[] } | null>(null);
  const [applying, setApplying] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    const r = await fetch("/api/settings/numbering-apply-recommended");
    if (r.ok) setPreview(await r.json());
    else setError("Failed to load preview.");
  }
  async function apply() {
    setApplying(true); setError(null);
    const r = await fetch("/api/settings/numbering-apply-recommended", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: true }),
    });
    setApplying(false);
    if (r.ok) { const d = await r.json(); setDone(d.created); setPreview(null); onApplied(); }
    else setError("Failed to apply recommended series.");
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-card p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-ink">Apply Recommended Smarty1 Numbering</h3>
          <p className="text-xs text-steel mt-0.5">Creates missing standard series. Never overwrites existing configuration.</p>
        </div>
        <Btn variant={preview ? "ghost" : "secondary"} size="sm" onClick={preview ? () => setPreview(null) : load}>
          {preview ? "Cancel" : "Preview"}
        </Btn>
      </div>

      {done !== null && (
        <div className="px-3 py-2 bg-okLight rounded-lg text-xs text-ok font-medium mb-3">
          ✓ Created {done} numbering series successfully.
        </div>
      )}
      {error && <p className="text-xs text-danger mb-2">{error}</p>}

      {preview && (
        <div className="space-y-3">
          {preview.toCreate.length === 0 ? (
            <p className="text-xs text-ok font-medium">✓ All recommended series are already configured.</p>
          ) : (
            <>
              <p className="text-xs text-steel">
                Will create <span className="font-semibold text-ink">{preview.toCreate.length}</span> missing series:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {preview.toCreate.map((s: any) => (
                  <span key={s.entityType} className="text-xs bg-okLight text-ok rounded-lg px-2 py-0.5 font-mono">
                    {s.prefix}{s.seriesSegment}001
                  </span>
                ))}
              </div>
              {preview.alreadyConfigured.length > 0 && (
                <p className="text-xs text-steel">
                  Already configured: {preview.alreadyConfigured.map((s: any) => s.entityType).join(", ")}
                </p>
              )}
              <p className="text-xs text-steel">
                This only creates series that don&apos;t already exist. No existing series are changed.
              </p>
              <Btn variant="primary" onClick={apply} disabled={applying}>
                {applying ? "Applying…" : `Create ${preview.toCreate.length} series`}
              </Btn>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Series Form ──────────────────────────────────────────────────────────────
function SeriesForm({ series, entityTypes, onCancel, onSaved }: {
  series?: Series; entityTypes: EntityTypeInfo[];
  onCancel: () => void; onSaved: () => void;
}) {
  const [entityType, setEntityType] = useState(series?.entityType ?? "");
  const [seriesCode, setSeriesCode] = useState(series?.seriesCode ?? "");
  const [displayName, setDisplayName] = useState(series?.displayName ?? "");
  const [prefix, setPrefix] = useState(series?.prefix ?? "");
  const [seriesSegment, setSeriesSegment] = useState(series?.seriesSegment ?? "");
  const [separator, setSeparator] = useState(series?.separator ?? "");
  const [paddingLength, setPaddingLength] = useState(series?.paddingLength ?? 3);
  const [resetPolicy, setResetPolicy] = useState(series?.resetPolicy ?? "NEVER");
  const [status, setStatus] = useState(series?.status ?? "ACTIVE");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function previewFormat() {
    const parts = [prefix || "?"];
    if (seriesSegment) parts.push(seriesSegment);
    parts.push(String(series?.nextNumber ?? 1).padStart(Number(paddingLength) || 3, "0"));
    return parts.join(separator || "");
  }

  async function save() {
    setSubmitting(true); setError("");
    const body: Record<string, unknown> = {
      displayName, prefix, seriesSegment: seriesSegment || undefined,
      separator, paddingLength: Number(paddingLength), resetPolicy, status,
    };
    if (!series) { body.entityType = entityType; body.seriesCode = seriesCode; body.nextNumber = 1; }
    const res = series
      ? await fetch(`/api/settings/numbering-series/${series.id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
        })
      : await fetch("/api/settings/numbering-series", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
        });
    setSubmitting(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); setError(extractErrorMessage(d)); return; }
    onSaved();
  }

  return (
    <div className="bg-paper rounded-xl border border-slate-200 p-5 space-y-3 max-w-lg">
      <h4 className="text-sm font-semibold text-ink">{series ? "Edit Series" : "New Series"}</h4>
      {series ? (
        <div className="text-xs text-steel bg-white rounded-lg px-3 py-2 border border-slate-100">
          Entity: <span className="font-mono font-medium">{series.entityType}</span> · 
          Code: <span className="font-mono font-medium">{series.seriesCode}</span> · 
          Next#: <span className="font-mono font-medium">{series.nextNumber}</span> (locked)
        </div>
      ) : (
        <div className="space-y-2">
          <select
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-aqua/30"
            value={entityType} onChange={(e) => setEntityType(e.target.value)}
          >
            <option value="">Select entity type…</option>
            {entityTypes.map((et) => (
              <option key={et.entityType} value={et.entityType}>
                {et.label} (recommended prefix: {et.recommendedPrefix})
              </option>
            ))}
          </select>
          <input
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-aqua/30"
            placeholder="Series code (e.g. SUPPLIER_MAIN)"
            value={seriesCode} onChange={(e) => setSeriesCode(e.target.value)}
          />
        </div>
      )}
      <input
        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-aqua/30"
        placeholder="Display name"
        value={displayName} onChange={(e) => setDisplayName(e.target.value)}
      />
      <div className="grid grid-cols-3 gap-2">
        <input className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-aqua/30"
          placeholder="Prefix (e.g. EXP)" value={prefix} onChange={(e) => setPrefix(e.target.value)} />
        <input className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-aqua/30"
          placeholder="Segment (06)" value={seriesSegment} onChange={(e) => setSeriesSegment(e.target.value)} />
        <input className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-aqua/30"
          placeholder="Separator" value={separator} onChange={(e) => setSeparator(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input type="number" min={1} max={10}
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-aqua/30"
          placeholder="Padding length" value={paddingLength} onChange={(e) => setPaddingLength(Number(e.target.value))} />
        <select
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-aqua/30"
          value={resetPolicy} onChange={(e) => setResetPolicy(e.target.value)}
        >
          <option value="NEVER">NEVER — sequential forever</option>
          <option value="YEARLY">YEARLY — reset each year</option>
          <option value="MONTHLY">MONTHLY — reset each month</option>
        </select>
      </div>
      <select
        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-aqua/30"
        value={status} onChange={(e) => setStatus(e.target.value)}
      >
        <option value="ACTIVE">ACTIVE</option>
        <option value="INACTIVE">INACTIVE</option>
      </select>
      <p className="text-xs text-steel">
        Format preview: <span className="font-mono font-medium text-ink">{previewFormat()}</span>
        <span className="text-steel"> (no number consumed)</span>
      </p>
      {error && <p className="text-xs text-danger">{error}</p>}
      <div className="flex gap-2">
        <Btn
          variant="primary" size="sm"
          disabled={(!series && (!entityType || !seriesCode)) || !displayName || !prefix || submitting}
          onClick={save}
        >
          {submitting ? "Saving…" : "Save Series"}
        </Btn>
        <Btn variant="ghost" size="sm" onClick={onCancel}>Cancel</Btn>
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────
export default function NumberingPage() {
  const [series, setSeries] = useState<Series[] | null>(null);
  const [entityTypes, setEntityTypes] = useState<EntityTypeInfo[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [sRes, etRes] = await Promise.allSettled([
      fetch("/api/settings/numbering-series"),
      fetch("/api/settings/numbering-entity-types"),
    ]);
    if (sRes.status === "fulfilled" && sRes.value.ok) setSeries(await sRes.value.json());
    else setSeries([]);
    if (etRes.status === "fulfilled" && etRes.value.ok) setEntityTypes(await etRes.value.json());
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const active = (series ?? []).filter(s => s.status === "ACTIVE").length;
  const inactive = (series ?? []).filter(s => s.status === "INACTIVE").length;

  return (
    <AdminShell title="Numbering & Sequences">
      <PageContainer>
        <PageHeader
          title="Numbering & Sequences"
          subtitle="Auto-numbering configuration — reference series for expenses, contracts, suppliers and other entities"
          breadcrumbs={[{ label: "Administration" }, { label: "Numbering" }]}
          actions={
            <div className="flex gap-2">
              <Btn variant="ghost" size="sm" onClick={() => setShowNew(v => !v)}>
                {showNew ? "Cancel" : "+ New Series"}
              </Btn>
              <Btn variant="ghost" size="sm" onClick={load}>↺</Btn>
            </div>
          }
        />

        <div className="grid grid-cols-3 gap-3 mb-6">
          <MetricCard label="Total Series" value={series?.length ?? 0} />
          <MetricCard label="Active" value={active} accent="ok" />
          <MetricCard label="Inactive" value={inactive} />
        </div>

        {/* Apply Recommended */}
        <div className="mb-6">
          <ApplyRecommendedNumbering onApplied={load} />
        </div>

        {/* New series form */}
        {showNew && (
          <div className="mb-6">
            <SeriesForm
              entityTypes={entityTypes}
              onCancel={() => setShowNew(false)}
              onSaved={() => { setShowNew(false); load(); }}
            />
          </div>
        )}

        {/* Configured series list */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden mb-6">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-ink">Configured Series</h2>
          </div>
          {loading ? <LoadingState label="Loading series…" /> :
            !series || series.length === 0 ? (
              <EmptyState
                title="No numbering series configured"
                description='Click "Apply Recommended" above to bootstrap all standard Smarty1 series.'
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-paper">
                      {["Entity", "Series Code", "Prefix", "Next #", "Status", ""].map(h => (
                        <th key={h} className="text-left text-xs font-semibold text-steel px-4 py-3">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {series.map((s) => (
                      // FIX: use React.Fragment with key= instead of bare <> which cannot take key prop
                      <tr key={s.id} className="hover:bg-paper">
                        <td className="px-4 py-3 text-sm font-medium text-ink">{s.displayName}</td>
                        <td className="px-4 py-3 text-xs font-mono text-steel">{s.seriesCode}</td>
                        <td className="px-4 py-3 text-sm font-mono">{s.prefix}</td>
                        <td className="px-4 py-3 text-sm tabular-nums">{s.nextNumber}</td>
                        <td className="px-4 py-3"><StatusBadge status={s.status} size="xs" /></td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => setEditingId(editingId === s.id ? null : s.id)}
                            className="text-xs text-aqua hover:underline font-medium"
                          >
                            {editingId === s.id ? "Close" : "Edit"}
                          </button>
                        </td>
                      </tr>
                    )).reduce<React.ReactNode[]>((acc, row, i) => {
                      const s = series[i];
                      acc.push(row);
                      if (editingId === s.id) {
                        acc.push(
                          <tr key={`edit-${s.id}`} className="bg-paper">
                            <td colSpan={6} className="px-4 py-4">
                              <SeriesForm
                                series={s}
                                entityTypes={entityTypes}
                                onCancel={() => setEditingId(null)}
                                onSaved={() => { setEditingId(null); load(); }}
                              />
                            </td>
                          </tr>
                        );
                      }
                      return acc;
                    }, [])}
                  </tbody>
                </table>
              </div>
            )
          }
        </div>

        {/* Coverage table */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-ink">Numbering Coverage</h2>
            <p className="text-xs text-steel mt-0.5">Which entity types currently use system-generated reference numbers</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-paper">
                  {["Entity Type", "Field", "Status"].map(h => (
                    <th key={h} className="text-left text-xs font-semibold text-steel px-4 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {CODE_FIELD_ENTITY_MAP.map((m) => (
                  <tr key={m.entityType} className="hover:bg-paper">
                    <td className="px-4 py-2.5 text-sm font-mono text-steel">{m.entityType}</td>
                    <td className="px-4 py-2.5 text-sm text-steel">{m.field}</td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs font-medium ${m.status === "converted" ? "text-ok" : "text-steel"}`}>
                        {m.status === "converted" ? "Active" : m.status === "schema-gap" ? "Schema gap" : "Planned"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </PageContainer>
    </AdminShell>
  );
}
