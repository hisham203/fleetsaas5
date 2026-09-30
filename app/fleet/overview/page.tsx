"use client";
/**
 * Fleet Overview — Milestone C
 * Uses real fleet APIs. No fake metrics.
 * KPIs: vehicle availability, driver availability, maintenance, compliance.
 */
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import AdminShell from "@/components/AdminShell";
import { PageContainer, PageHeader, MetricCard, StatusBadge, EmptyState, LoadingState, Btn } from "@/components/ds";

type Vehicle = {
  id: string; plateNumber: string; vehicleType: string; vehicleCode?: string;
  status: string; capacityLiters?: number; licenseExpiry?: string; tenantId: string;
};
type Driver = {
  id: string; driverCode?: string; status: string; licenseExpiry?: string;
  user?: { name?: string; email?: string };
};
type MaintenanceRecord = {
  id: string; vehicleId: string; status: string; type: string;
  description: string; openedAt?: string; closedAt?: string;
};

function daysUntil(dt?: string | null): number | null {
  if (!dt) return null;
  return Math.ceil((new Date(dt).getTime() - Date.now()) / 86400000);
}
function fmtDate(dt?: string | null) {
  if (!dt) return "—";
  return new Date(dt).toLocaleDateString("en-SA", { day: "numeric", month: "short", year: "numeric" });
}

export default function FleetOverviewPage() {
  const router = useRouter();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [vRes, dRes] = await Promise.allSettled([
      fetch("/api/vehicles"),
      fetch("/api/drivers"),
    ]);
    if (vRes.status === "fulfilled" && vRes.value.ok) {
      const d = await vRes.value.json();
      setVehicles(Array.isArray(d) ? d : []);
    }
    if (dRes.status === "fulfilled" && dRes.value.ok) {
      const d = await dRes.value.json();
      setDrivers(Array.isArray(d) ? d : []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Derived counts:
  const vAvail = vehicles.filter(v => v.status === "AVAILABLE");
  const vInTrip = vehicles.filter(v => v.status === "IN_TRIP");
  const vMaint  = vehicles.filter(v => v.status === "MAINTENANCE");
  const vOos    = vehicles.filter(v => v.status === "OUT_OF_SERVICE");
  const dAvail  = drivers.filter(d => d.status === "AVAILABLE");
  const dOnTrip = drivers.filter(d => d.status === "ON_TRIP");

  // Compliance alerts (expiring within 30 days or already expired):
  const SOON = 30;
  const vComplianceIssues = vehicles.filter(v => { const d = daysUntil(v.licenseExpiry); return d !== null && d <= SOON; });
  const dComplianceIssues = drivers.filter(d => { const dd = daysUntil(d.licenseExpiry); return dd !== null && dd <= SOON; });

  return (
    <AdminShell title="Fleet Overview">
      <PageContainer>
        <PageHeader
          title="Fleet Overview"
          subtitle="Live fleet status — vehicles, drivers, availability"
          breadcrumbs={[{ label: "Fleet" }, { label: "Overview" }]}
          actions={
            <div className="flex gap-2">
              <Btn variant="ghost" size="sm" onClick={load}>↺ Refresh</Btn>
            </div>
          }
        />

        {loading ? <LoadingState /> : (
          <>
            {/* Vehicle KPIs */}
            <div className="mb-2">
              <p className="text-xs font-semibold text-steel uppercase tracking-wider mb-2">Vehicles</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                <button onClick={() => router.push("/fleet/vehicles")} className="text-left">
                  <MetricCard label="Total Vehicles" value={vehicles.length} />
                </button>
                <button onClick={() => router.push("/fleet/vehicles?status=AVAILABLE")} className="text-left">
                  <MetricCard label="Available" value={vAvail.length} accent="ok" />
                </button>
                <button onClick={() => router.push("/fleet/vehicles?status=IN_TRIP")} className="text-left">
                  <MetricCard label="In Trip" value={vInTrip.length} accent="info" />
                </button>
                <button onClick={() => router.push("/fleet/vehicles?status=MAINTENANCE")} className="text-left">
                  <MetricCard label="Maintenance" value={vMaint.length} accent={vMaint.length > 0 ? "warn" : "default"} />
                </button>
              </div>
            </div>

            {/* Driver KPIs */}
            <div className="mb-6">
              <p className="text-xs font-semibold text-steel uppercase tracking-wider mb-2">Drivers</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <button onClick={() => router.push("/fleet/drivers")} className="text-left">
                  <MetricCard label="Total Drivers" value={drivers.length} />
                </button>
                <button onClick={() => router.push("/fleet/drivers?status=AVAILABLE")} className="text-left">
                  <MetricCard label="Available" value={dAvail.length} accent="ok" />
                </button>
                <button onClick={() => router.push("/fleet/drivers?status=ON_TRIP")} className="text-left">
                  <MetricCard label="On Trip" value={dOnTrip.length} accent="info" />
                </button>
                <button onClick={() => router.push("/fleet/compliance")} className="text-left">
                  <MetricCard label="Compliance Issues" value={vComplianceIssues.length + dComplianceIssues.length}
                    accent={(vComplianceIssues.length + dComplianceIssues.length) > 0 ? "danger" : "default"} />
                </button>
              </div>
            </div>

            {/* Two-column lower section */}
            <div className="grid lg:grid-cols-2 gap-6">
              {/* Unavailable vehicles */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-card">
                <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
                  <h2 className="text-sm font-semibold text-ink">Unavailable Vehicles</h2>
                  <button onClick={() => router.push("/fleet/vehicles")} className="text-xs text-aqua hover:underline">All vehicles →</button>
                </div>
                {[...vInTrip, ...vMaint, ...vOos].length === 0 ? (
                  <div className="px-5 py-6 text-center text-xs text-ok">All vehicles available</div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {[...vInTrip, ...vMaint, ...vOos].slice(0, 8).map(v => (
                      <div key={v.id}
                        className="px-5 py-3 flex items-center gap-3 hover:bg-paper cursor-pointer transition-colors"
                        onClick={() => router.push(`/fleet/vehicles/${v.id}`)}>
                        <StatusBadge status={v.status} size="xs" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-ink">{v.plateNumber}</p>
                          <p className="text-xs text-steel">{v.vehicleType}{v.capacityLiters ? ` · ${v.capacityLiters.toLocaleString()} L` : ""}</p>
                        </div>
                        <span className="text-xs text-steel">›</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Compliance expiring */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-card">
                <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
                  <h2 className="text-sm font-semibold text-ink">Compliance Expiring (30 days)</h2>
                  <button onClick={() => router.push("/fleet/compliance")} className="text-xs text-aqua hover:underline">All compliance →</button>
                </div>
                {(vComplianceIssues.length + dComplianceIssues.length) === 0 ? (
                  <div className="px-5 py-6 text-center text-xs text-ok">No imminent compliance issues</div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {vComplianceIssues.slice(0, 5).map(v => {
                      const d = daysUntil(v.licenseExpiry);
                      return (
                        <div key={v.id}
                          className="px-5 py-3 flex items-center gap-3 hover:bg-paper cursor-pointer"
                          onClick={() => router.push(`/fleet/vehicles/${v.id}`)}>
                          <div className={`w-2 h-2 rounded-full ${d !== null && d <= 0 ? "bg-danger" : "bg-warn"}`} />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-ink">{v.plateNumber}</p>
                            <p className="text-xs text-steel">License expires {fmtDate(v.licenseExpiry)}</p>
                          </div>
                          <span className={`text-xs font-semibold ${d !== null && d <= 0 ? "text-danger" : "text-warn"}`}>
                            {d !== null && d <= 0 ? "Expired" : `${d}d`}
                          </span>
                        </div>
                      );
                    })}
                    {dComplianceIssues.slice(0, 5).map(d => {
                      const dd = daysUntil(d.licenseExpiry);
                      return (
                        <div key={d.id}
                          className="px-5 py-3 flex items-center gap-3 hover:bg-paper cursor-pointer"
                          onClick={() => router.push(`/fleet/drivers/${d.id}`)}>
                          <div className={`w-2 h-2 rounded-full ${dd !== null && dd <= 0 ? "bg-danger" : "bg-warn"}`} />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-ink">{d.user?.name ?? d.driverCode ?? "Driver"}</p>
                            <p className="text-xs text-steel">License expires {fmtDate(d.licenseExpiry)}</p>
                          </div>
                          <span className={`text-xs font-semibold ${dd !== null && dd <= 0 ? "text-danger" : "text-warn"}`}>
                            {dd !== null && dd <= 0 ? "Expired" : `${dd}d`}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Quick links */}
            <div className="mt-6 bg-white rounded-xl border border-slate-200 shadow-card p-5">
              <h2 className="text-sm font-semibold text-ink mb-3">Fleet Modules</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                {[
                  { label: "Vehicles", href: "/fleet/vehicles" },
                  { label: "Drivers", href: "/fleet/drivers" },
                  { label: "Maintenance", href: "/fleet/maintenance" },
                  { label: "Fuel", href: "/fleet/fuel" },
                  { label: "Tyres", href: "/fleet/tyres" },
                  { label: "Compliance", href: "/fleet/compliance" },
                ].map(l => (
                  <button key={l.href} onClick={() => router.push(l.href)}
                    className="text-center py-2.5 px-3 rounded-lg border border-slate-200 text-sm font-medium text-ink hover:bg-paper hover:border-aqua/30 transition-colors">
                    {l.label}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </PageContainer>
    </AdminShell>
  );
}
