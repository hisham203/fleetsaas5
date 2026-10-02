"use client";
/**
 * Telematics Device Registry
 * Milestone E: Enhanced with device health indicators.

 * Route: /telematics/devices
 */
import { useState, useEffect, useCallback } from "react";
import AdminShell from "@/components/AdminShell";
import {
  PageContainer, PageHeader, MetricCard, StatusBadge, FilterBar,
  EmptyState, LoadingState, Btn,
} from "@/components/ds";

interface Provider { id: string; name: string; providerType: string }
interface Device {
  id: string; deviceIdentifier: string; externalId: string | null;
  deviceType: string; status: string; serialNumber: string | null;
  firmwareVersion: string | null; lastCommunication: string | null;
  lastGpsFix: string | null; lastLat: number | null; lastLng: number | null;
  notes: string | null; createdAt: string;
  provider: Provider | null;
  assignedVehicleId: string | null;
}

function fmtAgo(d: string | null) {
  if (!d) return "—";
  const ms = Date.now() - new Date(d).getTime();
  if (ms < 60000) return "just now";
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ago`;
  if (ms < 86400000) return `${Math.floor(ms / 3600000)}h ago`;
  return `${Math.floor(ms / 86400000)}d ago`;
}

export default function DevicesPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [showNew, setShowNew] = useState(false);
  const [newForm, setNewForm] = useState({ providerId: "", deviceIdentifier: "", deviceType: "GPS_TRACKER", serialNumber: "", notes: "" });
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [dRes, pRes] = await Promise.allSettled([
      fetch("/api/telematics/devices"),
      fetch("/api/telematics/providers"),
    ]);
    if (dRes.status === "fulfilled" && dRes.value.ok) setDevices((await dRes.value.json()).devices ?? []);
    if (pRes.status === "fulfilled" && pRes.value.ok) setProviders((await pRes.value.json()).providers ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function createDevice() {
    setFormError(null); setSubmitting(true);
    if (!newForm.providerId || !newForm.deviceIdentifier) { setFormError("Provider and Device ID are required."); setSubmitting(false); return; }
    const res = await fetch("/api/telematics/devices", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newForm),
    });
    setSubmitting(false);
    if (!res.ok) { const d = await res.json(); setFormError(d.error?.fieldErrors?.deviceIdentifier?.[0] ?? d.error ?? "Failed to create device."); return; }
    setShowNew(false); setNewForm({ providerId: "", deviceIdentifier: "", deviceType: "GPS_TRACKER", serialNumber: "", notes: "" });
    load();
  }

  const STATUSES = ["ALL", "ACTIVE", "UNASSIGNED", "OFFLINE", "INACTIVE", "FAULT"];
  const filtered = devices.filter(d => {
    const matchSearch = !search || d.deviceIdentifier.toLowerCase().includes(search.toLowerCase()) ||
      (d.serialNumber ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (d.provider?.name ?? "").toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "ALL" || d.status === statusFilter;
    return matchSearch && matchStatus;
  });

  return (
    <AdminShell title="Device Registry">
      <PageContainer>
        <PageHeader
          title="Device Registry"
          subtitle="Telematics devices — GPS trackers, OBD units, and virtual devices"
          breadcrumbs={[{ label: "Telematics" }, { label: "Devices" }]}
          actions={
            <div className="flex gap-2">
              <Btn variant="secondary" size="sm" onClick={() => setShowNew(v => !v)}>{showNew ? "Cancel" : "+ Register Device"}</Btn>
              <Btn variant="ghost" size="sm" onClick={load}>↺</Btn>
            </div>
          }
        />

        <div className="grid grid-cols-5 gap-3 mb-6">
          {["ALL","ACTIVE","UNASSIGNED","OFFLINE","FAULT"].map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`text-xs font-semibold rounded-lg py-2 text-center ${statusFilter === s ? "bg-aqua text-white" : "bg-white border border-slate-200 text-steel hover:text-ink"}`}>
              {s} ({s === "ALL" ? devices.length : devices.filter(d => d.status === s).length})
            </button>
          ))}
        </div>

        {showNew && (
          <div className="mb-6 bg-white rounded-xl border border-slate-200 shadow-card p-5 max-w-md">
            <h3 className="text-sm font-semibold text-ink mb-3">Register New Device</h3>
            {providers.length === 0 ? (
              <div className="text-xs text-steel bg-warnLight rounded-lg p-3 mb-3">
                No providers configured. <a href="/administration/telematics-providers" className="underline text-aqua">Add a provider first.</a>
              </div>
            ) : null}
            <div className="space-y-2">
              <select className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
                value={newForm.providerId} onChange={e => setNewForm(f => ({ ...f, providerId: e.target.value }))}>
                <option value="">Select provider…</option>
                {providers.map(p => <option key={p.id} value={p.id}>{p.name} ({p.providerType})</option>)}
              </select>
              <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
                placeholder="Device identifier (e.g. DEV-001)" value={newForm.deviceIdentifier}
                onChange={e => setNewForm(f => ({ ...f, deviceIdentifier: e.target.value }))} />
              <select className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
                value={newForm.deviceType} onChange={e => setNewForm(f => ({ ...f, deviceType: e.target.value }))}>
                {["GPS_TRACKER","OBD","MOBILE","VIRTUAL"].map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
                placeholder="Serial number (optional)" value={newForm.serialNumber}
                onChange={e => setNewForm(f => ({ ...f, serialNumber: e.target.value }))} />
              {formError && <p className="text-xs text-danger">{formError}</p>}
              <div className="flex gap-2">
                <Btn variant="primary" size="sm" disabled={submitting || !newForm.providerId || !newForm.deviceIdentifier} onClick={createDevice}>
                  {submitting ? "Registering…" : "Register"}
                </Btn>
                <Btn variant="ghost" size="sm" onClick={() => setShowNew(false)}>Cancel</Btn>
              </div>
            </div>
          </div>
        )}

        <FilterBar search={search} onSearch={setSearch} onClear={() => setSearch("")} />

        {loading ? <LoadingState /> : filtered.length === 0 ? (
          <EmptyState title="No devices" description={devices.length === 0
            ? 'Register a provider in Administration → Telematics Providers, then register devices here.'
            : 'No devices match the current filter.'} />
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-paper">
                  {["Device ID","Type","Provider","Status","Assigned Vehicle","Last Comm","Last GPS"].map(h => (
                    <th key={h} className="text-left text-xs font-semibold text-steel px-4 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map(d => (
                  <tr key={d.id} className="hover:bg-paper">
                    <td className="px-4 py-3 font-mono text-xs text-ink font-medium">{d.deviceIdentifier}</td>
                    <td className="px-4 py-3 text-xs text-steel">{d.deviceType}</td>
                    <td className="px-4 py-3 text-xs text-steel">{d.provider?.name ?? "—"}</td>
                    <td className="px-4 py-3"><StatusBadge status={d.status} size="xs" /></td>
                    <td className="px-4 py-3 text-xs text-steel font-mono">{d.assignedVehicleId ? d.assignedVehicleId.slice(0, 8) + "…" : "—"}</td>
                    <td className="px-4 py-3 text-xs">
                      <span className={
                        d.lastCommunication == null ? "text-steel/50" :
                        (Date.now() - new Date(d.lastCommunication).getTime() < 15*60*1000) ? "text-ok font-medium" :
                        (Date.now() - new Date(d.lastCommunication).getTime() < 60*60*1000) ? "text-warn font-medium" :
                        "text-danger font-medium"
                      }>
                        {d.lastCommunication == null ? "Never" : fmtAgo(d.lastCommunication)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-steel">{fmtAgo(d.lastGpsFix)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PageContainer>
    </AdminShell>
  );
}
