"use client";
/**
 * Fleet Compliance — Milestone C
 * Surfaces license expiry for all vehicles and drivers.
 * Groups by: Expired / Expiring within 30 days / Valid.
 * Links to Vehicle 360 / Driver 360 for action.
 * No fake compliance documents — uses licenseExpiry field from existing schema.
 */
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import AdminShell from "@/components/AdminShell";
import {
  PageContainer, PageHeader, MetricCard, StatusBadge, EmptyState, LoadingState, Btn,
} from "@/components/ds";

type Vehicle = { id: string; plateNumber: string; vehicleType: string; status: string; licenseExpiry?: string };
type Driver  = { id: string; driverCode?: string; licenseExpiry?: string; user?: { name?: string } };

type ComplianceItem = {
  id: string; label: string; type: "VEHICLE" | "DRIVER";
  licenseExpiry?: string; href: string; status: string;
  daysUntil: number | null;
};

function computeDays(dt?: string | null): number | null {
  if (!dt) return null;
  return Math.ceil((new Date(dt).getTime() - Date.now()) / 86400000);
}
function fmtDate(dt?: string | null) {
  if (!dt) return "—";
  return new Date(dt).toLocaleDateString("en-SA", { day: "numeric", month: "short", year: "numeric" });
}

function ComplianceRow({ item, onView }: { item: ComplianceItem; onView: () => void }) {
  const d = item.daysUntil;
  const badge = d === null ? null : d <= 0 ? "EXPIRED" : d <= 7 ? "BREACHED" : d <= 30 ? "AT_RISK" : "ON_TRACK";
  return (
    <tr className="hover:bg-paper cursor-pointer transition-colors" onClick={onView}>
      <td className="px-4 py-3">
        <span className={`text-2xs px-1.5 py-0.5 rounded font-medium ${item.type === "VEHICLE" ? "bg-slate-100 text-steel" : "bg-infoLight text-info"}`}>
          {item.type}
        </span>
      </td>
      <td className="px-4 py-3 text-sm font-medium text-ink">{item.label}</td>
      <td className="px-4 py-3 text-sm text-steel">{fmtDate(item.licenseExpiry)}</td>
      <td className="px-4 py-3">
        {badge ? <StatusBadge status={badge} size="xs" /> : <span className="text-xs text-steel">No date on file</span>}
      </td>
      <td className="px-4 py-3 text-xs text-steel">
        {d === null ? "—" : d <= 0 ? <span className="text-danger font-semibold">Expired</span> : `${d} days`}
      </td>
      <td className="px-4 py-3">
        <span className="text-xs text-aqua">View →</span>
      </td>
    </tr>
  );
}

export default function FleetCompliancePage() {
  const router = useRouter();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers]   = useState<Driver[]>([]);
  const [loading, setLoading]   = useState(true);
  const [filter, setFilter]     = useState<"ALL"|"EXPIRED"|"EXPIRING"|"MISSING">("ALL");

  const load = useCallback(async () => {
    setLoading(true);
    const [vRes, dRes] = await Promise.allSettled([fetch("/api/vehicles"), fetch("/api/drivers")]);
    if (vRes.status === "fulfilled" && vRes.value.ok) setVehicles(await vRes.value.json() ?? []);
    if (dRes.status === "fulfilled" && dRes.value.ok) setDrivers(await dRes.value.json() ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const items: ComplianceItem[] = [
    ...vehicles.map(v => ({
      id: v.id, label: v.plateNumber, type: "VEHICLE" as const,
      licenseExpiry: v.licenseExpiry, href: `/fleet/vehicles/${v.id}`,
      status: v.status, daysUntil: computeDays(v.licenseExpiry),
    })),
    ...drivers.map(d => ({
      id: d.id, label: d.user?.name ?? d.driverCode ?? "Driver", type: "DRIVER" as const,
      licenseExpiry: d.licenseExpiry, href: `/fleet/drivers/${d.id}`,
      status: "—", daysUntil: computeDays(d.licenseExpiry),
    })),
  ].sort((a, b) => (a.daysUntil ?? 9999) - (b.daysUntil ?? 9999));

  const expired  = items.filter(i => i.daysUntil !== null && i.daysUntil <= 0);
  const expiring = items.filter(i => i.daysUntil !== null && i.daysUntil > 0 && i.daysUntil <= 30);
  const missing  = items.filter(i => i.daysUntil === null);
  const valid    = items.filter(i => i.daysUntil !== null && i.daysUntil > 30);

  const filtered =
    filter === "EXPIRED"  ? expired :
    filter === "EXPIRING" ? expiring :
    filter === "MISSING"  ? missing : items;

  return (
    <AdminShell title="Fleet Compliance">
      <PageContainer>
        <PageHeader
          title="Fleet Compliance"
          subtitle="License expiry tracking for all vehicles and drivers"
          breadcrumbs={[{ label: "Fleet" }, { label: "Compliance" }]}
          actions={<Btn variant="ghost" size="sm" onClick={load}>↺ Refresh</Btn>}
        />

        {loading ? <LoadingState /> : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
              <button onClick={() => setFilter(filter === "EXPIRED" ? "ALL" : "EXPIRED")} className="text-start">
                <MetricCard label="Expired" value={expired.length}
                  accent={expired.length > 0 ? "danger" : "default"}
                  trendLabel={filter === "EXPIRED" ? "Showing" : "Click to filter"} />
              </button>
              <button onClick={() => setFilter(filter === "EXPIRING" ? "ALL" : "EXPIRING")} className="text-start">
                <MetricCard label="Expiring ≤30d" value={expiring.length}
                  accent={expiring.length > 0 ? "warn" : "default"}
                  trendLabel={filter === "EXPIRING" ? "Showing" : "Click to filter"} />
              </button>
              <button onClick={() => setFilter(filter === "MISSING" ? "ALL" : "MISSING")} className="text-start">
                <MetricCard label="No Date on File" value={missing.length}
                  accent={missing.length > 0 ? "warn" : "default"}
                  trendLabel={filter === "MISSING" ? "Showing" : "Click to filter"} />
              </button>
              <button onClick={() => setFilter("ALL")} className="text-start">
                <MetricCard label="Valid" value={valid.length} accent="ok" />
              </button>
            </div>

            {filter !== "ALL" && (
              <div className="mb-3 flex items-center gap-2 text-xs text-steel">
                Showing: <span className="font-medium text-ink">{filter}</span>
                <button onClick={() => setFilter("ALL")} className="text-aqua hover:underline">Clear filter</button>
              </div>
            )}

            {filtered.length === 0 ? (
              <EmptyState title="No compliance issues" description="All licenses are valid and dates are on file." />
            ) : (
              <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 bg-paper">
                        {["Type", "Name", "Expiry Date", "Status", "Days Remaining", ""].map(h => (
                          <th key={h} className="text-start text-xs font-semibold text-steel px-4 py-3">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filtered.map(item => (
                        <ComplianceRow key={item.id} item={item} onView={() => router.push(item.href)} />
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="px-4 py-2.5 border-t border-slate-100 text-xs text-steel">
                  {filtered.length} items
                </div>
              </div>
            )}
          </>
        )}
      </PageContainer>
    </AdminShell>
  );
}
