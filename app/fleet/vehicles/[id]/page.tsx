"use client";
/**
 * Vehicle 360 — Milestone C
 * Uses GET /api/vehicles/[id]/operations (rich aggregated response)
 * + GET /api/vehicles/[id]/fuel
 * + GET /api/vehicles/[id]/tyres
 *
 * Tabs: Overview / Trips / Maintenance / Fuel / Tyres
 * No fake telemetry, costs, or documents.
 */
import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import AdminShell from "@/components/AdminShell";
import {
  PageContainer, StatusBadge, EntityHeader, DescriptionList,
  Tabs, EmptyState, LoadingState, Btn, MetricCard,
} from "@/components/ds";

// ── Types — mirror API shapes exactly ─────────────────────────────────────
interface Vehicle {
  id: string; tenantId: string; plateNumber: string; vehicleType: string;
  vehicleCode?: string; capacityLiters?: number; capacityUnits?: number;
  status: string; homeWarehouseId?: string;
  licenseExpiry?: string; createdAt?: string;
}
interface VehicleOps {
  vehicle: Vehicle;
  homeWarehouse: { id: string; name: string } | null;
  activeTrips: any[];
  recentTrips: any[];
  completedTripCount: number;
  failedTripCount: number;
  expenses: any[];
  expenseSummary: { pendingCount: number; approvedCount: number; approvedTotal: number };
  maintenanceRecords: any[];
}
interface FuelLog {
  id: string; vehicleId: string; tripId?: string; litersFilled: number;
  costSar: number; odometerReading?: number; filledAt?: string;
}
interface TyreRecord {
  id: string; position: string; serialNumber?: string; costSar?: number;
  installOdometer?: number; status: string; installedAt?: string;
}

function fmtDt(dt?: string | null) {
  if (!dt) return "—";
  return new Date(dt).toLocaleDateString("en-SA", { day: "numeric", month: "short", year: "numeric" });
}
function fmtTime(dt?: string | null) {
  if (!dt) return "—";
  return new Date(dt).toLocaleString("en-SA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
function daysUntil(dt?: string | null) {
  if (!dt) return null;
  return Math.ceil((new Date(dt).getTime() - Date.now()) / 86400000);
}

export default function Vehicle360Page() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [ops, setOps] = useState<VehicleOps | null>(null);
  const [fuel, setFuel] = useState<FuelLog[]>([]);
  const [tyres, setTyres] = useState<TyreRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState("overview");
  const [telemetry, setTelemetry] = useState<{ gpsStatus: string; lat: number | null; lng: number | null; lastPingAt: string | null; device: { id: string; deviceIdentifier: string; status: string } | null } | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const [opsRes, fuelRes, tyreRes] = await Promise.allSettled([
      fetch(`/api/vehicles/${id}/operations`),
      fetch(`/api/vehicles/${id}/fuel`),
      fetch(`/api/vehicles/${id}/tyres`),
    ]);
    if (opsRes.status === "fulfilled") {
      if (opsRes.value.ok) setOps(await opsRes.value.json());
      else setError(opsRes.value.status === 404 ? "Vehicle not found." : "Failed to load vehicle.");
    } else { setError("Network error."); }
    if (fuelRes.status === "fulfilled" && fuelRes.value.ok) setFuel(await fuelRes.value.json() ?? []);
    if (tyreRes.status === "fulfilled" && tyreRes.value.ok) setTyres(await tyreRes.value.json() ?? []);
    // Telematics tab: fetch latest GPS position from fleet/positions and device from telematics
    const posRes = await fetch("/api/fleet/positions").catch(() => null);
    if (posRes?.ok) {
      const posData = await posRes.json();
      const vPos = (posData.positions ?? []).find((p: any) => p.vehicleId === id);
      setTelemetry({
        gpsStatus: vPos?.gpsStatus ?? "OFFLINE",
        lat: vPos?.lat ?? null,
        lng: vPos?.lng ?? null,
        lastPingAt: vPos?.lastPingAt ?? null,
        device: null, // device registry from telematicsDevices not yet fetched in vehicle-specific endpoint
      });
    }
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <AdminShell title="Vehicle"><PageContainer><LoadingState label="Loading vehicle…" /></PageContainer></AdminShell>;
  if (error || !ops) return (
    <AdminShell title="Vehicle">
      <PageContainer>
        <button onClick={() => router.back()} className="text-sm text-steel hover:text-ink mb-4 block">← Fleet</button>
        <div className="bg-dangerLight rounded-xl p-5 text-danger text-sm">{error ?? "Vehicle not found."}</div>
      </PageContainer>
    </AdminShell>
  );

  const v = ops.vehicle;
  const licDays = daysUntil(v.licenseExpiry);
  const licBadge = licDays === null ? null : licDays <= 0 ? "EXPIRED" : licDays <= 30 ? "AT_RISK" : "ON_TRACK";
  const activeTyres = tyres.filter(t => t.status === "ACTIVE");
  const totalFuelCost = fuel.reduce((sum, f) => sum + f.costSar, 0);
  const totalFuelLiters = fuel.reduce((sum, f) => sum + f.litersFilled, 0);

  const TABS = [
    { id: "overview",    label: "Overview" },
    { id: "trips",       label: `Trips (${ops.recentTrips.length})` },
    { id: "maintenance", label: `Maintenance (${ops.maintenanceRecords.length})` },
    { id: "fuel",        label: `Fuel (${fuel.length})` },
    { id: "tyres",       label: `Tyres (${tyres.length})` },
    { id: "telematics",  label: "Telematics" },
  ];

  return (
    <AdminShell title={v.plateNumber}>
      <PageContainer>
        <button onClick={() => router.back()} className="flex items-center gap-1.5 text-sm text-steel hover:text-ink mb-4">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
          </svg>
          Fleet
        </button>

        <EntityHeader
          title={v.plateNumber}
          subtitle={`${v.vehicleType}${v.vehicleCode ? ` · ${v.vehicleCode}` : ""}`}
          status={v.status}
          meta={[
            ...(v.capacityLiters ? [{ label: "capacity", value: `${v.capacityLiters.toLocaleString()} L` }] : []),
            { label: "completed trips", value: String(ops.completedTripCount) },
            { label: "home depot", value: ops.homeWarehouse?.name ?? "—" },
          ]}
          actions={<Btn variant="ghost" onClick={load}>Refresh</Btn>}
          avatar={
            <svg className="w-6 h-6 text-steel" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375A1.125 1.125 0 012.25 17.625V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125" />
            </svg>
          }
        />

        <Tabs tabs={TABS} active={tab} onChange={setTab} />

        {/* OVERVIEW */}
        {tab === "overview" && (
          <div className="grid lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-card">
              <h3 className="text-sm font-semibold text-ink mb-4">Vehicle Identity</h3>
              <DescriptionList items={[
                { label: "Plate Number", value: v.plateNumber },
                { label: "Vehicle Type", value: v.vehicleType },
                { label: "Vehicle Code", value: v.vehicleCode ?? "—" },
                { label: "Capacity", value: v.capacityLiters ? `${v.capacityLiters.toLocaleString()} L` : (v.capacityUnits ? `${v.capacityUnits} units` : "—") },
                { label: "Home Depot", value: ops.homeWarehouse?.name ?? "—" },
                { label: "License Expiry", value: fmtDt(v.licenseExpiry) },
                { label: "Registered", value: fmtDt(v.createdAt) },
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
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <MetricCard label="Active Trips" value={ops.activeTrips.length} accent={ops.activeTrips.length > 0 ? "info" : "default"} />
                <MetricCard label="Completed" value={ops.completedTripCount} accent="ok" />
                <MetricCard label="Fuel Cost (total)" value={`SAR ${totalFuelCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} />
                <MetricCard label="Active Tyres" value={activeTyres.length} />
              </div>
              {ops.activeTrips.length > 0 && (
                <div className="bg-infoLight rounded-xl p-4">
                  <p className="text-xs font-semibold text-info mb-2">Currently Active</p>
                  {ops.activeTrips.slice(0, 2).map((t: any) => (
                    <button key={t.id} onClick={() => router.push(`/operations/trips/${t.id}`)}
                      className="w-full text-start flex items-center gap-2 py-1.5">
                      <StatusBadge status={t.status} size="xs" />
                      <span className="text-sm font-medium text-ink">{t.tripNumber}</span>
                      <span className="text-xs text-steel ms-auto">View →</span>
                    </button>
                  ))}
                </div>
              )}
              {/* BR-15 maintenance cause visibility:
                  When vehicle.status === MAINTENANCE and open records exist,
                  surface the cause so operators know what is blocking this vehicle. */}
              {v.status === "MAINTENANCE" && (() => {
                const openRecords = ops.maintenanceRecords.filter((m: any) => m.status === "OPEN");
                if (openRecords.length === 0) return null;
                return (
                  <div className="bg-warnLight rounded-xl p-4 border border-warn/20">
                    <p className="text-xs font-semibold text-warn mb-2 flex items-center gap-1.5">
                      <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                      </svg>
                      Vehicle blocked — open maintenance {openRecords.length > 1 ? `(${openRecords.length} records)` : ""}
                    </p>
                    <div className="space-y-2">
                      {openRecords.slice(0, 3).map((m: any) => (
                        <div key={m.id} className="text-xs">
                          <span className="font-medium text-ink">{m.type}</span>
                          <span className="text-steel"> · {m.description}</span>
                          {m.odometerReading && (
                            <span className="text-steel"> · {m.odometerReading.toLocaleString()} km</span>
                          )}
                          {m.cost != null && (
                            <span className="text-steel"> · SAR {m.cost.toLocaleString()}</span>
                          )}
                          <span className="text-steel"> · Opened {fmtDt(m.openedAt)}</span>
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={() => setTab("maintenance")}
                      className="mt-2 text-xs text-warn font-medium hover:underline"
                    >
                      View Maintenance tab →
                    </button>
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {/* TRIPS */}
        {tab === "trips" && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
            {ops.recentTrips.length === 0 ? <EmptyState title="No trips yet" /> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-paper">
                      {["Trip", "Status", "Customer", "Driver", "Date"].map(h => (
                        <th key={h} className="text-start text-xs font-semibold text-steel px-4 py-3">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {ops.recentTrips.map((t: any) => (
                      <tr key={t.id} className="hover:bg-paper cursor-pointer" onClick={() => router.push(`/operations/trips/${t.id}`)}>
                        <td className="px-4 py-3 text-sm font-semibold text-aqua">{t.tripNumber}</td>
                        <td className="px-4 py-3"><StatusBadge status={t.status} size="xs" /></td>
                        <td className="px-4 py-3 text-sm text-ink">{t.stops?.[0]?.order?.customer?.name ?? "—"}</td>
                        <td className="px-4 py-3 text-sm text-steel">{t.driver?.user?.name ?? "—"}</td>
                        <td className="px-4 py-3 text-xs text-steel">{fmtDt(t.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* MAINTENANCE */}
        {tab === "maintenance" && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
            {ops.maintenanceRecords.length === 0 ? <EmptyState title="No maintenance records" /> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-paper">
                      {["Type", "Description", "Status", "Odometer", "Cost", "Opened"].map(h => (
                        <th key={h} className="text-start text-xs font-semibold text-steel px-4 py-3">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {ops.maintenanceRecords.map((m: any) => (
                      <tr key={m.id} className="hover:bg-paper">
                        <td className="px-4 py-3 text-sm font-medium text-ink">{m.type}</td>
                        <td className="px-4 py-3 text-sm text-steel max-w-xs truncate">{m.description}</td>
                        <td className="px-4 py-3"><StatusBadge status={m.status} size="xs" /></td>
                        <td className="px-4 py-3 text-sm text-steel tabular-nums">{m.odometerReading?.toLocaleString() ?? "—"}</td>
                        <td className="px-4 py-3 text-sm text-ink tabular-nums">{m.cost != null ? `SAR ${m.cost.toLocaleString()}` : "—"}</td>
                        <td className="px-4 py-3 text-xs text-steel">{fmtDt(m.openedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* FUEL */}
        {tab === "fuel" && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
              <MetricCard label="Fuel Records" value={fuel.length} />
              <MetricCard label="Total Filled" value={`${totalFuelLiters.toLocaleString(undefined, { maximumFractionDigits: 0 })} L`} />
              <MetricCard label="Total Cost" value={`SAR ${totalFuelCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} />
            </div>
            <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
              {fuel.length === 0 ? <EmptyState title="No fuel records" /> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 bg-paper">
                        {["Date", "Liters", "Cost (SAR)", "Odometer", "Trip"].map(h => (
                          <th key={h} className="text-start text-xs font-semibold text-steel px-4 py-3">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {fuel.map(f => (
                        <tr key={f.id} className="hover:bg-paper">
                          <td className="px-4 py-3 text-xs text-steel">{fmtTime(f.filledAt)}</td>
                          <td className="px-4 py-3 text-sm font-medium tabular-nums">{f.litersFilled.toLocaleString()}</td>
                          <td className="px-4 py-3 text-sm tabular-nums">{f.costSar.toLocaleString()}</td>
                          <td className="px-4 py-3 text-sm text-steel tabular-nums">{f.odometerReading?.toLocaleString() ?? "—"}</td>
                          <td className="px-4 py-3">
                            {f.tripId ? (
                              <button onClick={() => router.push(`/operations/trips/${f.tripId}`)}
                                className="text-xs text-aqua hover:underline">View trip →</button>
                            ) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

        {/* TYRES */}
        {tab === "tyres" && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
            {tyres.length === 0 ? <EmptyState title="No tyre records" /> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-paper">
                      {["Position", "Serial", "Status", "Install Odometer", "Cost (SAR)", "Installed"].map(h => (
                        <th key={h} className="text-start text-xs font-semibold text-steel px-4 py-3">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {tyres.map(t => (
                      <tr key={t.id} className="hover:bg-paper">
                        <td className="px-4 py-3 text-sm font-medium text-ink">{t.position}</td>
                        <td className="px-4 py-3 text-sm text-steel font-mono">{t.serialNumber ?? "—"}</td>
                        <td className="px-4 py-3"><StatusBadge status={t.status} size="xs" /></td>
                        <td className="px-4 py-3 text-sm text-steel tabular-nums">{t.installOdometer?.toLocaleString() ?? "—"}</td>
                        <td className="px-4 py-3 text-sm tabular-nums">{t.costSar?.toLocaleString() ?? "—"}</td>
                        <td className="px-4 py-3 text-xs text-steel">{fmtDt(t.installedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {tab === "telematics" && (
          <div className="space-y-4">
            {/* GPS Health Card */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-card p-5">
              <h3 className="text-sm font-semibold text-ink mb-3">Live GPS &amp; Operational State</h3>
              {telemetry ? (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-steel mb-1">GPS Status</p>
                    <p className={`text-sm font-semibold ${
                      telemetry.gpsStatus === "LIVE" ? "text-ok" :
                      telemetry.gpsStatus === "STALE" ? "text-warn" : "text-steel/50"
                    }`}>● {telemetry.gpsStatus}</p>
                  </div>
                  {telemetry.lat != null && (
                    <div>
                      <p className="text-xs text-steel mb-1">Last Position</p>
                      <p className="text-xs font-mono text-ink">{telemetry.lat.toFixed(5)}, {telemetry.lng?.toFixed(5)}</p>
                    </div>
                  )}
                  {telemetry.lastPingAt && (
                    <div>
                      <p className="text-xs text-steel mb-1">Last Ping</p>
                      <p className="text-xs text-ink">{new Date(telemetry.lastPingAt).toLocaleString("en-SA")}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-xs text-steel mb-1">Source</p>
                    <p className="text-xs text-ink">Driver App (GPS Demo if enabled)</p>
                  </div>
                  {telemetry.gpsStatus === "OFFLINE" && telemetry.lat == null && (
                    <p className="text-xs text-steel italic col-span-2">
                      No GPS recorded. Vehicle must be on an active dispatched trip for GPS to update.
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-xs text-steel">Loading GPS status…</p>
              )}
            </div>

            {/* Device */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-card p-5">
              <h3 className="text-sm font-semibold text-ink mb-3">Telematics Device</h3>
              <p className="text-xs text-steel">
                Device assignments and health are managed in{" "}
                <a href="/telematics/devices" className="text-aqua underline">Telematics → Device Registry</a>.
              </p>
            </div>

            {/* Quick links */}
            <div className="flex flex-wrap gap-2">
              <a href="/control-tower" className="text-xs bg-paper border border-slate-200 rounded-lg px-3 py-2 hover:bg-white text-ink">🗺 Live Tracking →</a>
              <a href="/telematics/live" className="text-xs bg-paper border border-slate-200 rounded-lg px-3 py-2 hover:bg-white text-ink">📊 Fleet Intelligence →</a>
              <a href="/telematics/events" className="text-xs bg-paper border border-slate-200 rounded-lg px-3 py-2 hover:bg-white text-ink">🔔 Events →</a>
            </div>
          </div>
        )}
      </PageContainer>
    </AdminShell>
  );
}
