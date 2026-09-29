"use client";
/**
 * Driver 360 — Milestone C
 * Uses GET /api/drivers (list) + trip history from /api/trips?driverId= if available,
 * or from the general trips list filtered client-side.
 * Also uses /api/scorecards/drivers if accessible.
 */
import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import AdminShell from "@/components/AdminShell";
import {
  PageContainer, StatusBadge, EntityHeader, DescriptionList,
  Tabs, EmptyState, LoadingState, Btn, MetricCard,
} from "@/components/ds";

interface Driver {
  id: string; driverCode?: string; status: string;
  licenseNumber: string; licenseExpiry?: string; tenantId: string;
  user?: { name?: string; email?: string };
}
interface Trip {
  id: string; tripNumber: string; status: string; createdAt?: string;
  dispatchedAt?: string; completedAt?: string;
  vehicle?: { plateNumber: string };
}
interface ScoreMetric {
  period: string;
  tripsCompleted: number; tripsFailed: number;
  onTimeDeliveryRate: number; avgDeliveryTime?: number;
}

function fmtDt(dt?: string | null) {
  if (!dt) return "—";
  return new Date(dt).toLocaleDateString("en-SA", { day: "numeric", month: "short", year: "numeric" });
}
function daysUntil(dt?: string | null) {
  if (!dt) return null;
  return Math.ceil((new Date(dt).getTime() - Date.now()) / 86400000);
}

export default function Driver360Page() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [driver, setDriver] = useState<Driver | null>(null);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState("overview");

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const [driversRes, tripsRes] = await Promise.allSettled([
      fetch("/api/drivers"),
      fetch("/api/trips"),
    ]);
    let found: Driver | null = null;
    if (driversRes.status === "fulfilled" && driversRes.value.ok) {
      const all = await driversRes.value.json();
      found = (Array.isArray(all) ? all : []).find((d: Driver) => d.id === id) ?? null;
      if (!found) setError("Driver not found.");
      else setDriver(found);
    }
    if (tripsRes.status === "fulfilled" && tripsRes.value.ok) {
      const all = await tripsRes.value.json();
      const driverTrips = (Array.isArray(all) ? all : []).filter((t: any) => t.driverId === id || t.driver?.id === id);
      setTrips(driverTrips);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <AdminShell title="Driver"><PageContainer><LoadingState label="Loading driver…" /></PageContainer></AdminShell>;
  if (error || !driver) return (
    <AdminShell title="Driver">
      <PageContainer>
        <button onClick={() => router.back()} className="text-sm text-steel hover:text-ink mb-4 block">← Fleet</button>
        <div className="bg-dangerLight rounded-xl p-5 text-danger text-sm">{error ?? "Driver not found."}</div>
      </PageContainer>
    </AdminShell>
  );

  const name = driver.user?.name ?? driver.driverCode ?? "Driver";
  const licDays = daysUntil(driver.licenseExpiry);
  const licBadge = licDays === null ? null : licDays <= 0 ? "EXPIRED" : licDays <= 30 ? "AT_RISK" : "ON_TRACK";
  const completed = trips.filter(t => t.status === "COMPLETED");
  const failed = trips.filter(t => t.status === "FAILED");

  const TABS = [
    { id: "overview", label: "Overview" },
    { id: "trips", label: `Trips (${trips.length})` },
  ];

  return (
    <AdminShell title={name}>
      <PageContainer>
        <button onClick={() => router.back()} className="flex items-center gap-1.5 text-sm text-steel hover:text-ink mb-4">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
          </svg>
          Fleet
        </button>

        <EntityHeader
          title={name}
          subtitle={driver.driverCode ? `Code: ${driver.driverCode}` : undefined}
          status={driver.status}
          meta={[
            { label: "completed trips", value: String(completed.length) },
            { label: "failed trips", value: String(failed.length) },
          ]}
          actions={<Btn variant="ghost" onClick={load}>Refresh</Btn>}
          avatar={
            <svg className="w-6 h-6 text-steel" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0" />
            </svg>
          }
        />

        <Tabs tabs={TABS} active={tab} onChange={setTab} />

        {tab === "overview" && (
          <div className="grid lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-card">
              <h3 className="text-sm font-semibold text-ink mb-4">Driver Details</h3>
              <DescriptionList items={[
                { label: "Name", value: driver.user?.name ?? "—" },
                { label: "Email", value: driver.user?.email ?? "—" },
                { label: "Driver Code", value: driver.driverCode ?? "—" },
                { label: "License Number", value: driver.licenseNumber },
                { label: "License Expiry", value: fmtDt(driver.licenseExpiry) },
              ]} />
              {licBadge && licBadge !== "ON_TRACK" && (
                <div className={`mt-4 flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium ${licBadge === "EXPIRED" ? "bg-dangerLight text-danger" : "bg-warnLight text-warn"}`}>
                  <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                  </svg>
                  License {licBadge === "EXPIRED" ? "EXPIRED" : `expires in ${licDays} days`}
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3 content-start">
              <MetricCard label="Total Trips" value={trips.length} />
              <MetricCard label="Completed" value={completed.length} accent="ok" />
              <MetricCard label="Failed" value={failed.length} accent={failed.length > 0 ? "danger" : "default"} />
              <MetricCard label="Active" value={trips.filter(t => t.status === "DISPATCHED" || t.status === "IN_PROGRESS").length}
                accent="info" />
            </div>
          </div>
        )}

        {tab === "trips" && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
            {trips.length === 0 ? <EmptyState title="No trips yet" /> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-paper">
                      {["Trip", "Status", "Vehicle", "Dispatched", "Completed"].map(h => (
                        <th key={h} className="text-left text-xs font-semibold text-steel px-4 py-3">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {trips.map((t: any) => (
                      <tr key={t.id} className="hover:bg-paper cursor-pointer" onClick={() => router.push(`/operations/trips/${t.id}`)}>
                        <td className="px-4 py-3 text-sm font-semibold text-aqua">{t.tripNumber}</td>
                        <td className="px-4 py-3"><StatusBadge status={t.status} size="xs" /></td>
                        <td className="px-4 py-3 text-sm text-steel">{t.vehicle?.plateNumber ?? "—"}</td>
                        <td className="px-4 py-3 text-xs text-steel">{fmtDt(t.dispatchedAt)}</td>
                        <td className="px-4 py-3 text-xs text-steel">{fmtDt(t.completedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </PageContainer>
    </AdminShell>
  );
}
