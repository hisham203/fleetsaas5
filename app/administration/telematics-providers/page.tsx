"use client";
/**
 * Administration — Telematics Providers
 * Route: /administration/telematics-providers
 *
 * Provider registry only — credentials are NEVER stored here.
 * Credentials are configured via environment variables in Coolify.
 * This page stores: name, provider type, non-secret config, notes.
 */
import { useState, useEffect, useCallback } from "react";
import AdminShell from "@/components/AdminShell";
import { PageContainer, PageHeader, StatusBadge, EmptyState, LoadingState, Btn } from "@/components/ds";

interface Provider { id: string; name: string; providerType: string; status: string; notes: string | null; createdAt: string; }

const PROVIDER_TYPES = ["HARDWARE_DEVICE", "PLATFORM_API", "DRIVER_APP", "DEMO"];
const TYPE_LABELS: Record<string, string> = {
  HARDWARE_DEVICE: "Hardware GPS Device",
  PLATFORM_API: "Fleet Platform API",
  DRIVER_APP: "Smarty1 Driver App",
  DEMO: "GPS Demo / Simulator",
};

export default function TelematicsProvidersPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name: "", providerType: "HARDWARE_DEVICE", notes: "" });
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/telematics/providers");
    if (res.ok) setProviders((await res.json()).providers ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function createProvider() {
    setFormError(null); setSubmitting(true);
    if (!form.name) { setFormError("Name is required."); setSubmitting(false); return; }
    const res = await fetch("/api/telematics/providers", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: form.name, providerType: form.providerType, notes: form.notes || undefined }),
    });
    setSubmitting(false);
    if (!res.ok) { const d = await res.json(); setFormError(d.error ?? "Failed."); return; }
    setShowNew(false); setForm({ name: "", providerType: "HARDWARE_DEVICE", notes: "" }); load();
  }

  return (
    <AdminShell title="Telematics Providers">
      <PageContainer>
        <PageHeader
          title="Telematics Providers"
          subtitle="Register GPS hardware vendors and fleet platform integrations"
          breadcrumbs={[{ label: "Administration" }, { label: "Telematics Providers" }]}
          actions={<div className="flex gap-2">
            <Btn variant="secondary" size="sm" onClick={() => setShowNew(v => !v)}>{showNew ? "Cancel" : "+ Add Provider"}</Btn>
            <Btn variant="ghost" size="sm" onClick={load}>↺</Btn>
          </div>}
        />

        <div className="mb-6 bg-infoLight/20 border border-info/20 rounded-xl p-4 text-xs text-steel">
          <strong>Security note:</strong> Provider credentials (API keys, webhook secrets) are configured as environment variables in Coolify — never stored in this database. This registry contains only metadata: name, type, and non-sensitive configuration.
        </div>

        {showNew && (
          <div className="mb-6 bg-white rounded-xl border border-slate-200 shadow-card p-5 max-w-md">
            <h3 className="text-sm font-semibold text-ink mb-3">Add Provider</h3>
            <div className="space-y-2">
              <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
                placeholder="Provider name (e.g. Teltonika FMB Series, Samsara, Wialon)"
                value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              <select className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
                value={form.providerType} onChange={e => setForm(f => ({ ...f, providerType: e.target.value }))}>
                {PROVIDER_TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
              </select>
              <textarea className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
                rows={2} placeholder="Notes (optional)"
                value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
              {formError && <p className="text-xs text-danger">{formError}</p>}
              <div className="flex gap-2">
                <Btn variant="primary" size="sm" disabled={submitting || !form.name} onClick={createProvider}>
                  {submitting ? "Saving…" : "Add Provider"}
                </Btn>
                <Btn variant="ghost" size="sm" onClick={() => setShowNew(false)}>Cancel</Btn>
              </div>
            </div>
          </div>
        )}

        {loading ? <LoadingState /> : providers.length === 0 ? (
          <EmptyState title="No providers registered" description="Add a telematics provider to begin registering devices." />
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
            <div className="overflow-x-auto -mx-1">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-slate-100 bg-paper">
                {["Name","Type","Status","Notes","Registered"].map(h => (
                  <th key={h} className="text-start text-xs font-semibold text-steel px-4 py-3">{h}</th>
                ))}
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {providers.map(p => (
                  <tr key={p.id} className="hover:bg-paper">
                    <td className="px-4 py-3 font-medium text-ink">{p.name}</td>
                    <td className="px-4 py-3 text-xs text-steel">{TYPE_LABELS[p.providerType] ?? p.providerType}</td>
                    <td className="px-4 py-3"><StatusBadge status={p.status} size="xs" /></td>
                    <td className="px-4 py-3 text-xs text-steel max-w-xs truncate">{p.notes ?? "—"}</td>
                    <td className="px-4 py-3 text-xs text-steel">{new Date(p.createdAt).toLocaleDateString("en-SA")}</td>
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
