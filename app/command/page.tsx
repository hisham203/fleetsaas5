"use client";
/**
 * Smarty1 Command Center — Milestone A
 * Answers: "What is the live state of operations right now?"
 */
import { useEffect, useState, useCallback } from "react";
import AppShell from "@/components/AppShell";
import { PageContainer, PageHeader, MetricCard, StatusBadge, EmptyState, LoadingState } from "@/components/ds";

type DashData = {
  activeTrips: number; plannedTrips: number; pendingOrders: number;
  availableDrivers: number; availableVehicles: number;
  exceptions: number; slaAtRisk: number;
  recentTrips: any[];
};

const EMPTY: DashData = {
  activeTrips: 0, plannedTrips: 0, pendingOrders: 0,
  availableDrivers: 0, availableVehicles: 0,
  exceptions: 0, slaAtRisk: 0, recentTrips: [],
};

function TripRow({ trip }: { trip: any }) {
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-slate-100 last:border-0">
      <StatusBadge status={trip.status ?? "PLANNED"} size="xs" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink truncate">{trip.tripNumber ?? trip.id?.slice(0,8)}</p>
        <p className="text-xs text-steel truncate">{trip.customerName ?? trip.stops?.[0]?.order?.customer?.name ?? "—"}</p>
      </div>
      {trip.driverId && (
        <span className="text-xs text-steel shrink-0">{trip.driver?.user?.name ?? "Assigned"}</span>
      )}
    </div>
  );
}

export default function CommandCenterPage() {
  const [data, setData] = useState<DashData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      // Load from existing API endpoints:
      const [tripRes, orderRes, driverRes, vehicleRes] = await Promise.all([
        fetch("/api/trips"),
        fetch("/api/orders?status=PENDING"),
        fetch("/api/drivers"),
        fetch("/api/vehicles"),
      ]);

      const trips = tripRes.ok ? await tripRes.json() : [];
      const orders = orderRes.ok ? await orderRes.json() : [];
        const drivers = driverRes.ok ? await driverRes.json() : [];
      const vehicles = vehicleRes.ok ? await vehicleRes.json() : [];

      const tripArr = Array.isArray(trips) ? trips : [];
      const orderArr = Array.isArray(orders) ? orders : [];
      const driverArr = Array.isArray(drivers) ? drivers : [];
      const vehicleArr = Array.isArray(vehicles) ? vehicles : [];

      setData({
        activeTrips: tripArr.filter((t: any) => t.status === "DISPATCHED" || t.status === "IN_PROGRESS").length,
        plannedTrips: tripArr.filter((t: any) => t.status === "PLANNED").length,
        pendingOrders: orderArr.filter((o: any) => o.status === "PENDING" || o.status === "VALIDATED").length,
        availableDrivers: driverArr.filter((d: any) => d.status === "AVAILABLE").length,
        availableVehicles: vehicleArr.filter((v: any) => v.status === "AVAILABLE").length,
        exceptions: 0,
        slaAtRisk: 0,
        recentTrips: tripArr.filter((t: any) => t.status === "DISPATCHED" || t.status === "PLANNED").slice(0, 8),
      });
    } catch (e) {
      setError("Failed to load operational data.");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const d = data ?? EMPTY;

  return (
    <AppShell title="Command Center" domainId="command">
      <PageContainer>
        <PageHeader
          title="Command Center"
          subtitle="Live operational status"
          breadcrumbs={[{ label: "Smarty1" }, { label: "Command Center" }]}
          actions={
            <button onClick={load} className="text-xs text-steel hover:text-ink px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-paper transition-colors">
              Refresh
            </button>
          }
        />

        {error && (
          <div className="mb-4 px-4 py-3 bg-dangerLight rounded-lg text-sm text-danger">{error}</div>
        )}

        {/* Live metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
          <MetricCard label="Active Trips" value={d.activeTrips} accent={d.activeTrips > 0 ? "info" : "default"}
            icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125" /></svg>} />
          <MetricCard label="Planned Trips" value={d.plannedTrips} accent="warn"
            trendLabel="Awaiting dispatch" />
          <MetricCard label="Pending Orders" value={d.pendingOrders} accent={d.pendingOrders > 0 ? "warn" : "default"}
            trendLabel="Need planning" />
          <MetricCard label="Available Drivers" value={d.availableDrivers} accent="ok" />
          <MetricCard label="Available Vehicles" value={d.availableVehicles} accent="ok" />
        </div>

        {/* Two column layout */}
        <div className="grid lg:grid-cols-3 gap-6">
          {/* Active / Planned trips */}
          <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 shadow-card">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
              <h2 className="text-sm font-semibold text-ink">Active & Planned Trips</h2>
              <a href="/dispatch" className="text-xs text-aqua hover:underline">Go to Dispatch</a>
            </div>
            <div className="px-5 py-2">
              {!data ? (
                <LoadingState />
              ) : d.recentTrips.length === 0 ? (
                <EmptyState title="No active trips" description="No trips are currently dispatched or planned." />
              ) : (
                d.recentTrips.map((t: any) => <TripRow key={t.id} trip={t} />)
              )}
            </div>
          </div>

          {/* Quick actions */}
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-slate-200 shadow-card p-5">
              <h2 className="text-sm font-semibold text-ink mb-3">Quick Actions</h2>
              <div className="space-y-2">
                {[
                  { label: "Create New Order", href: "/dispatch", accent: "bg-aqua text-white" },
                  { label: "Assignment Workspace", href: "/dispatch/assign", accent: "bg-white border border-slate-200 text-ink" },
                  { label: "Control Tower", href: "/control-tower", accent: "bg-white border border-slate-200 text-ink" },
                  { label: "View All Trips", href: "/admin?tab=trips", accent: "bg-white border border-slate-200 text-ink" },
                ].map(a => (
                  <a key={a.href} href={a.href}
                    className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors hover:opacity-90 ${a.accent}`}>
                    {a.label}
                    <svg className="w-3.5 h-3.5 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                    </svg>
                  </a>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 shadow-card p-5">
              <h2 className="text-sm font-semibold text-ink mb-1">Platform</h2>
              <p className="text-2xs text-steel mb-3">Smarty1 Fleet Operations</p>
              <div className="grid grid-cols-2 gap-2 text-2xs">
                {[
                  ["Drivers", `${d.availableDrivers} available`],
                  ["Vehicles", `${d.availableVehicles} available`],
                  ["Planned", `${d.plannedTrips} trips`],
                  ["Orders", `${d.pendingOrders} pending`],
                ].map(([k, v]) => (
                  <div key={k} className="bg-paper rounded-lg px-2.5 py-2">
                    <div className="text-steel">{k}</div>
                    <div className="font-semibold text-ink">{v}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </PageContainer>
    </AppShell>
  );
}
