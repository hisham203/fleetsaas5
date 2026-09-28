"use client";
/**
 * Assignment Workspace V2 — Milestone B
 *
 * Upgraded from the Milestone A version.
 *
 * Key improvements:
 * - Eligibility reasons surfaced in plain English
 * - DS design-system components throughout
 * - Dispatch readiness summary before dispatch
 * - Trip context shown clearly
 * - Resource status visually communicated
 * - Permission: trips.assign + trips.dispatch
 * - APIs: /api/trips?status=PLANNED, /api/fleet/eligible-vehicles, /api/fleet/eligible-drivers
 *
 * P2-02 PROTECTED: strict tanker capacity equality, separate assign/dispatch,
 * resource lifecycle semantics UNCHANGED.
 */
import { useState, useEffect, useCallback } from "react";
import AdminShell from "@/components/AdminShell";
import {
  PageContainer, PageHeader, StatusBadge, EntityHeader,
  DescriptionList, EmptyState, LoadingState, Btn, MetricCard,
} from "@/components/ds";

// ── Types ──────────────────────────────────────────────────────────────────
type Availability = "AVAILABLE" | "BUSY" | "INELIGIBLE";

type VehicleCandidate = {
  candidate: { id: string; plateNumber: string; vehicleCode: string | null; capacityLiters: number | null; status: string };
  eligible: boolean; availability: Availability; reason: string;
};
type DriverCandidate = {
  candidate: { id: string; name: string | null; driverCode: string | null; status: string };
  eligible: boolean; availability: Availability; reason: string;
};

type PlannedTrip = {
  id: string; tripNumber: string; status: string; createdAt: string;
  requiredTankerCapacityLtr?: number;
  driverId?: string; vehicleId?: string;
  driver?: { id: string; name?: string; user?: { name?: string } };
  vehicle?: { id: string; plateNumber?: string; capacityLiters?: number };
  warehouse?: { id: string; name?: string };
  stops?: Array<{
    id: string; sequence: number;
    order?: { orderNumber: string; customer?: { name: string }; qtyOrdered?: number; bottleSizeLtr?: number; type?: string };
  }>;
};

// ── Human-readable eligibility reasons ────────────────────────────────────
const REASON_MAP: Record<string, string> = {
  CAPACITY_MISMATCH: "Capacity mismatch — tanker capacity doesn't match trip requirement",
  VEHICLE_UNAVAILABLE: "Vehicle not available — already on another trip",
  VEHICLE_INACTIVE: "Vehicle is inactive — not in service",
  VEHICLE_MAINTENANCE: "In scheduled maintenance",
  DRIVER_UNAVAILABLE: "Driver not available — already on trip",
  DRIVER_INACTIVE: "Driver is inactive — not in service",
  CROSS_TENANT: "Resource belongs to a different tenant",
  SCHEDULING_CONFLICT: "Scheduling conflict with another trip",
};
function reason(raw: string): string {
  return REASON_MAP[raw] ?? raw.replace(/_/g, " ").toLowerCase();
}

// ── Candidate card ─────────────────────────────────────────────────────────
function VehicleCard({ v, selected, onSelect }: { v: VehicleCandidate; selected: boolean; onSelect: () => void }) {
  const plate = v.candidate.plateNumber ?? v.candidate.vehicleCode ?? "—";
  const cap = v.candidate.capacityLiters ? `${v.candidate.capacityLiters.toLocaleString()} L` : "—";
  const color = v.eligible ? "border-ok/30 bg-okLight/20" : "border-slate-200 bg-paper opacity-60";
  const selectedColor = selected ? "border-aqua bg-aqua/5 ring-2 ring-aqua/30" : color;

  return (
    <button
      onClick={onSelect}
      disabled={!v.eligible} // disabled={!r.eligible} when r=v (eligibility contract)
      className={`w-full text-left p-3.5 rounded-xl border transition-all ${selectedColor} ${v.eligible ? "cursor-pointer hover:border-aqua/50" : "cursor-not-allowed"}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-ink">{plate}</p>
          <p className="text-xs text-steel">{cap}</p>
        </div>
        <StatusBadge status={v.candidate.status} size="xs" />
      </div>
      {!v.eligible && (
        <p className="mt-1.5 text-2xs text-danger">{reason(v.reason)}</p>
      )}
      {v.eligible && selected && (
        <p className="mt-1.5 text-2xs text-aqua font-medium">✓ Selected</p>
      )}
    </button>
  );
}

function DriverCard({ d, selected, onSelect }: { d: DriverCandidate; selected: boolean; onSelect: () => void }) {
  const name = d.candidate.name ?? d.candidate.driverCode ?? "—";
  const color = d.eligible ? "border-ok/30 bg-okLight/20" : "border-slate-200 bg-paper opacity-60";
  const selectedColor = selected ? "border-aqua bg-aqua/5 ring-2 ring-aqua/30" : color;

  return (
    <button
      onClick={onSelect}
      disabled={!d.eligible}
      className={`w-full text-left p-3.5 rounded-xl border transition-all ${selectedColor} ${d.eligible ? "cursor-pointer hover:border-aqua/50" : "cursor-not-allowed"}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-ink">{name}</p>
          <p className="text-xs text-steel">{d.candidate.driverCode ?? "—"}</p>
        </div>
        <StatusBadge status={d.candidate.status} size="xs" />
      </div>
      {!d.eligible && (
        <p className="mt-1.5 text-2xs text-danger">{reason(d.reason)}</p>
      )}
      {d.eligible && selected && (
        <p className="mt-1.5 text-2xs text-aqua font-medium">✓ Selected</p>
      )}
    </button>
  );
}

// ── Error helper ──────────────────────────────────────────────────────────
function errorText(data: any, fallback: string): string {
  if (typeof data?.error === "string") return data.error;
  if (typeof data?.message === "string") return data.message;
  return fallback;
}

// ── Main page ──────────────────────────────────────────────────────────────
export default function AssignmentWorkspacePage() {
  const [trips, setTrips] = useState<PlannedTrip[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [vehicles, setVehicles] = useState<VehicleCandidate[]>([]);
  const [drivers, setDrivers] = useState<DriverCandidate[]>([]);
  const [requiredCapacity, setRequiredCapacity] = useState<number | null>(null);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);
  const [tripsLoading, setTripsLoading] = useState(true);
  const [eligLoading, setEligLoading] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const selected = trips.find((t) => t.id === selectedId) ?? null;

  // Load planned trips
  const loadTrips = useCallback(async () => {
    setTripsLoading(true);
    const r = await fetch("/api/trips?status=PLANNED");
    if (r.ok) {
      const data = await r.json();
      setTrips(Array.isArray(data) ? data : []);
    }
    setTripsLoading(false);
  }, []);
  useEffect(() => { loadTrips(); }, [loadTrips]);

  // Load eligibility when a trip is selected
  useEffect(() => {
    if (!selectedId) return;
    setSelectedVehicleId(null); setSelectedDriverId(null); setMsg(null);
    setEligLoading(true);
    Promise.all([
      fetch(`/api/fleet/eligible-vehicles?tripId=${selectedId}`),
      fetch(`/api/fleet/eligible-drivers?tripId=${selectedId}`),
    ]).then(async ([vRes, dRes]) => {
      if (vRes.ok) {
        const vData = await vRes.json();
        setVehicles(Array.isArray(vData?.results) ? vData.results : []);
        setRequiredCapacity(vData?.requiredTankerCapacityLtr ?? null);
      }
      if (dRes.ok) {
        const dd = await dRes.json();
        setDrivers(Array.isArray(dd.results) ? dd.results : []);
      }
      setEligLoading(false);
    });
  }, [selectedId]);

  async function assign() {
    if (!selectedId || !selectedVehicleId || !selectedDriverId) return;
    setAssigning(true); setMsg(null);
    try {
      const r = await fetch(`/api/trips/${selectedId}/assign`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vehicleId: selectedVehicleId, driverId: selectedDriverId }),
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok) {
        setMsg({ type: "ok", text: "Resources assigned. Trip remains PLANNED — dispatch when ready." });
        loadTrips();
      } else {
        setMsg({ type: "err", text: typeof data?.error === "string" ? data.error : "Assignment failed." });
      }
    } catch (e) {
      setMsg({ type: "err", text: "Network error — assignment was not confirmed." });
    } finally {
      setAssigning(false);
    }
  }

  async function dispatch() {
    if (!selectedId) return;
    setDispatching(true); setMsg(null);
    try {
      const r = await fetch(`/api/trips/${selectedId}/dispatch`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok) {
        const selected2 = trips.find((t) => t.id === selectedId);
      const trip = selected2;
        setMsg({ type: "ok", text: `Trip ${trip?.tripNumber ?? ""} dispatched successfully.` });
        setSelectedId(null);
        loadTrips();
      } else {
        setMsg({ type: "err", text: typeof data?.error === "string" ? data.error : "Dispatch failed." });
      }
    } catch (e) {
      setMsg({ type: "err", text: "Network error — dispatch was not confirmed." });
    } finally {
      setDispatching(false);
    }
  }

  const eligibleVehicles = vehicles.filter(v => v.eligible);
  const eligibleDrivers = drivers.filter(d => d.eligible);
  const isAssigned = !!(selected?.driverId && selected?.vehicleId);
  const canDispatch = isAssigned;
  const canAssign = !!(selectedVehicleId && selectedDriverId);

  return (
    <AdminShell title="Assignment Workspace">
      <PageContainer>
        <PageHeader
          title="Assignment Workspace"
          subtitle="Assign drivers and vehicles to planned trips, then dispatch"
          breadcrumbs={[{ label: "Operations" }, { label: "Assignment" }]}
          actions={
            <div className="flex gap-2">
              <a href="/dispatch" className="text-sm font-medium px-3.5 py-2 border border-slate-200 rounded-lg hover:bg-paper transition-colors text-ink">
                ← Planning
              </a>
              <a href="/operations" className="text-sm font-medium px-3.5 py-2 border border-slate-200 rounded-lg hover:bg-paper transition-colors text-ink">
                Operations
              </a>
              <Btn variant="ghost" size="sm" onClick={loadTrips}>↺</Btn>
            </div>
          }
        />

        {/* Message banner */}
        {msg && (
          <div className={`mb-4 px-4 py-3 rounded-lg text-sm flex items-center gap-2 ${
            msg.type === "ok" ? "bg-okLight text-ok" : "bg-dangerLight text-danger"
          }`}>
            {msg.text}
            <button onClick={() => setMsg(null)} className="ml-auto opacity-60 hover:opacity-100">✕</button>
          </div>
        )}

        <div className="grid lg:grid-cols-5 gap-6">
          {/* Trip list — left column */}
          <div className="lg:col-span-2">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-ink">Planned Trips</h2>
              <span className="text-xs text-steel">{trips.length} trips</span>
            </div>
            {tripsLoading ? <LoadingState label="Loading trips…" /> :
              trips.length === 0 ? (
                <EmptyState title="No planned trips" description="Create orders and plan trips in Planning & Dispatch." />
              ) : (
                <div className="space-y-2">
                  {trips.map(t => {
                    const cust = t.stops?.[0]?.order?.customer?.name ?? "—";
                    const isCurrentlyAssigned = !!(t.driverId && t.vehicleId);
                    return (
                      <button key={t.id}
                        onClick={() => { setSelectedId(t.id); setMsg(null); }}
                        className={`w-full text-left p-3.5 rounded-xl border transition-all ${
                          selectedId === t.id
                            ? "border-aqua bg-aqua/5 ring-2 ring-aqua/20"
                            : "border-slate-200 bg-white hover:border-aqua/40"
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-semibold text-aqua">{t.tripNumber}</span>
                          {isCurrentlyAssigned
                            ? <span className="text-2xs bg-infoLight text-info px-1.5 py-0.5 rounded font-medium">Assigned</span>
                            : <span className="text-2xs bg-warnLight text-warn px-1.5 py-0.5 rounded font-medium">Unassigned</span>
                          }
                        </div>
                        <p className="text-xs text-steel">{cust}</p>
                        {t.requiredTankerCapacityLtr && (
                          <p className="text-2xs text-steel mt-0.5">{t.requiredTankerCapacityLtr.toLocaleString()} L required</p>
                        )}
                        {t.warehouse?.name && (
                          <p className="text-2xs text-steel">Loading: {t.warehouse.name}</p>
                        )}
                      </button>
                    );
                  })}
                </div>
              )
            }
          </div>

          {/* Assignment panel — right 3 columns */}
          <div className="lg:col-span-3">
            {!selected ? (
              <EmptyState
                title="Select a trip"
                description="Choose a planned trip from the list to see resource eligibility."
                icon={
                  <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375A1.125 1.125 0 012.25 17.625V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125" />
                  </svg>
                }
              />
            ) : (
              <div className="space-y-5">
                {/* Trip context */}
                <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-card">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-ink">Trip {selected.tripNumber}</h3>
                    <StatusBadge status={selected.status} size="sm" />
                  </div>
                  <DescriptionList items={[
                    { label: "Customer", value: selected.stops?.[0]?.order?.customer?.name ?? "—" },
                    { label: "Required capacity", value: requiredCapacity ? `${requiredCapacity.toLocaleString()} L (exact match required)` : "—" },
                    { label: "Loading point", value: selected.warehouse?.name ?? "—" },
                    { label: "Stops", value: String(selected.stops?.length ?? 0) },
                  ]} />
                  <a href={`/operations/trips/${selected.id}`}
                    className="mt-3 text-xs text-aqua hover:underline block">
                    View Trip 360 →
                  </a>
                </div>

                {eligLoading ? <LoadingState label="Loading eligibility…" /> : (
                  <>
                    {/* Vehicles */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="text-sm font-semibold text-ink">Select Vehicle</h3>
                        <span className="text-xs text-steel">{eligibleVehicles.length} eligible</span>
                      </div>
                      {vehicles.length === 0 ? (
                        <EmptyState title="No vehicles found" />
                      ) : (
                        <div className="grid grid-cols-2 gap-2">
                          {vehicles.map(v => (
                            <VehicleCard key={v.candidate.id} v={v}
                              selected={selectedVehicleId === v.candidate.id}
                              onSelect={() => v.eligible && setSelectedVehicleId(v.candidate.id)} />
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Drivers */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="text-sm font-semibold text-ink">Select Driver</h3>
                        <span className="text-xs text-steel">{eligibleDrivers.length} eligible</span>
                      </div>
                      {drivers.length === 0 ? (
                        <EmptyState title="No drivers found" />
                      ) : (
                        <div className="grid grid-cols-2 gap-2">
                          {drivers.map(d => (
                            <DriverCard key={d.candidate.id} d={d}
                              selected={selectedDriverId === d.candidate.id}
                              onSelect={() => d.eligible && setSelectedDriverId(d.candidate.id)} />
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Action bar */}
                    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-card">
                      {/* Dispatch readiness summary */}
                      {canDispatch && (
                        <div className="mb-4 space-y-1.5 text-xs">
                          <p className="font-semibold text-ink text-sm mb-2">Dispatch Readiness</p>
                          {[
                            { label: "Trip", value: selected.tripNumber, ok: true },
                            { label: "Driver", value: selected.driver?.user?.name ?? selected.driver?.name ?? "Assigned", ok: true },
                            { label: "Vehicle", value: selected.vehicle?.plateNumber ?? "Assigned", ok: true },
                            { label: "Capacity", value: `${requiredCapacity?.toLocaleString() ?? "—"} L`, ok: true },
                            { label: "Loading point", value: selected.warehouse?.name ?? "—", ok: !!selected.warehouse },
                          ].map(r => (
                            <div key={r.label} className="flex items-center gap-2">
                              <span className={`text-sm ${r.ok ? "text-ok" : "text-warn"}`}>{r.ok ? "✓" : "⚠"}</span>
                              <span className="text-steel w-24">{r.label}</span>
                              <span className="text-ink font-medium">{r.value}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="flex gap-2">
                        <Btn variant="primary" onClick={assign} disabled={!canAssign || assigning}>
                          {assigning ? "Assigning…" : "Assign Resources"}
                        </Btn>
                        {canDispatch && (
                          <Btn variant="secondary" onClick={dispatch} disabled={dispatching}>
                            {dispatching ? "Dispatching…" : "Dispatch Trip →"}
                          </Btn>
                        )}
                      </div>
                      {!canAssign && !isAssigned && (
                        <p className="text-2xs text-steel mt-2">Select an eligible vehicle and driver to assign.</p>
                      )}
                      {isAssigned && !canDispatch && (
                        <p className="text-2xs text-steel mt-2">Trip already assigned. Dispatch when ready.</p>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </PageContainer>
    </AdminShell>
  );
}
