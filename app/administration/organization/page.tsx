"use client";
/**
 * Administration — Organization
 * Route: /administration/organization
 *
 * Displays real tenant information from GET /api/tenant.
 * Read-only — the tenant schema has only id, name, sector, createdAt.
 * No PATCH endpoint exists, so this is display-only for now.
 * No fake fields, no redesigned business logic.
 */
import { useState, useEffect } from "react";
import AdminShell from "@/components/AdminShell";
import {
  PageContainer, PageHeader, MetricCard, LoadingState,
} from "@/components/ds";

interface TenantInfo {
  id: string; name: string; sector: string; createdAt: string;
  users?: { id: string; name: string; email: string; role: string }[];
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start py-3 border-b border-slate-100 last:border-0">
      <p className="text-xs font-semibold text-steel uppercase w-40 shrink-0">{label}</p>
      <p className="text-sm text-ink font-mono">{value}</p>
    </div>
  );
}

export default function OrganizationPage() {
  const [tenant, setTenant] = useState<TenantInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/tenant")
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setTenant(d); else setError("Failed to load organization details."); })
      .catch(() => setError("Failed to load organization details."))
      .finally(() => setLoading(false));
  }, []);

  const fmtDate = (d: string) =>
    new Date(d).toLocaleDateString("en-SA", { day: "numeric", month: "long", year: "numeric" });

  return (
    <AdminShell title="Organization">
      <PageContainer>
        <PageHeader
          title="Organization"
          subtitle="Your tenant identity and configuration"
          breadcrumbs={[{ label: "Administration" }, { label: "Organization" }]}
        />

        {loading ? <LoadingState /> : error ? (
          <div className="text-sm text-danger bg-dangerLight rounded-xl p-4">{error}</div>
        ) : tenant ? (
          <div className="space-y-6">
            <div className="grid grid-cols-3 gap-3">
              <MetricCard label="Users" value={tenant.users?.length ?? "—"} />
              <MetricCard label="Admins" value={tenant.users?.filter(u => u.role === "ADMIN").length ?? "—"} accent="warn" />
              <MetricCard label="Drivers" value={tenant.users?.filter(u => u.role === "DRIVER").length ?? "—"} />
            </div>

            <div className="bg-white rounded-xl border border-slate-200 shadow-card">
              <div className="px-5 py-3.5 border-b border-slate-100">
                <h2 className="text-sm font-semibold text-ink">Tenant Details</h2>
                <p className="text-xs text-steel mt-0.5">Read-only. Contact Smarty1 support to change organization name or sector.</p>
              </div>
              <div className="px-5 py-2">
                <InfoRow label="Organization Name" value={tenant.name} />
                <InfoRow label="Sector" value={tenant.sector} />
                <InfoRow label="Tenant ID" value={tenant.id} />
                <InfoRow label="Created" value={fmtDate(tenant.createdAt)} />
              </div>
            </div>
          </div>
        ) : null}
      </PageContainer>
    </AdminShell>
  );
}
