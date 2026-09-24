"use client";
/**
 * P2-02: Supervisor Assignment Workspace
 * Shows PLANNED trips, eligible/ineligible drivers and vehicles,
 * surfaces recommendation, and allows assign + dispatch.
 * Permission: trips.assign (assign) + trips.dispatch (dispatch)
 */

import { useState, useEffect, useCallback } from "react";

type Trip = {
  id: string; tripNumber?: string; customerId?: string; siteId?: string; requiredTankerCapacityLtr?: number;
  driverId?: string | null; vehicleId?: string | null; status: string; dispatchedAt?: string | null;
  customer?: { name?: string }; site?: { name?: string }; vehicle?: { plate?: string } | null; driver?: { name?: string } | null;
};
type VehicleCandidate = { candidate: { id: string; plate: string; capacityLiters: number | null; status: string }; eligible: boolean; reason: string; recommended?: boolean };
type DriverCandidate = { candidate: { id: string; name: string; userId: string; status: string }; eligible: boolean; reason: string; recommended?: boolean };
type Rec = { driver?: DriverCandidate; vehicle?: VehicleCandidate };

function EligibilityBadge({ eligible, recommended }: { eligible: boolean; recommended?: boolean }) {
  if (recommended) return <span className="text-xs font-bold bg-aqua text-white px-2 py-0.5 rounded-full">⭐ Recommended</span>;
  if (eligible) return <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-medium">Eligible</span>;
  return <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-medium">Ineligible</span>;
}

export default function DispatchWorkspace() {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [selected, setSelected] = useState<Trip | null>(null);
  const [vehicles, setVehicles] = useState<VehicleCandidate[]>([]);
  const [drivers, setDrivers] = useState<DriverCandidate[]>([]);
  const [rec, setRec] = useState<Rec>({});
  const [selectedVehicleId, setSelectedVehicleId] = useState<string>("");
  const [selectedDriverId, setSelectedDriverId] = useState<string>("");
  const [assigning, setAssigning] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loadingCandidates, setLoadingCandidates] = useState(false);

  const loadTrips = useCallback(async () => {
    const res = await fetch("/api/trips?status=PLANNED&limit=50");
    if (res.ok) { const d = await res.json(); setTrips(d.trips ?? d.data ?? []); }
  }, []);

  useEffect(() => { loadTrips(); }, [loadTrips]);

  const selectTrip = async (trip: Trip) => {
    setSelected(trip); setError(null); setSuccess(null);
    setSelectedVehicleId(trip.vehicleId ?? ""); setSelectedDriverId(trip.driverId ?? "");
    setLoadingCandidates(true);
    try {
      const cap = trip.requiredTankerCapacityLtr ?? 0;
      const [vRes, dRes] = await Promise.all([
        fetch(`/api/fleet/eligible-vehicles?capacity=${cap}`),
        fetch("/api/fleet/eligible-drivers"),
      ]);
      const vData = vRes.ok ? await vRes.json() : {};
      const dData = dRes.ok ? await dRes.json() : {};
      const vList: VehicleCandidate[] = vData.candidates ?? vData.vehicles ?? [];
      const dList: DriverCandidate[] = dData.candidates ?? dData.drivers ?? [];
      setVehicles(vList);
      setDrivers(dList);
      // Surface recommendation:
      const recV = vList.find(v => v.recommended) ?? vList.find(v => v.eligible);
      const recD = dList.find(d => d.recommended) ?? dList.find(d => d.eligible);
      setRec({ vehicle: recV, driver: recD });
    } finally { setLoadingCandidates(false); }
  };

  const assign = async () => {
    if (!selected) return;
    setAssigning(true); setError(null); setSuccess(null);
    const body: any = {};
    if (selectedVehicleId) body.vehicleId = selectedVehicleId;
    if (selectedDriverId) body.driverId = selectedDriverId;
    const res = await fetch(`/api/trips/${selected.id}/assign`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? "Assignment failed"); setAssigning(false); return; }
    setSuccess("Resources assigned successfully.");
    await loadTrips();
    // Refresh selected:
    const fresh = await fetch(`/api/trips/${selected.id}`);
    if (fresh.ok) { const d = await fresh.json(); setSelected(d.trip ?? d); }
    setAssigning(false);
  };

  const dispatch = async () => {
    if (!selected) return;
    setDispatching(true); setError(null); setSuccess(null);
    const res = await fetch(`/api/trips/${selected.id}/dispatch`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? "Dispatch failed"); setDispatching(false); return; }
    setSuccess(`Trip ${selected.tripNumber ?? selected.id} dispatched! ✓`);
    await loadTrips(); setSelected(null);
    setDispatching(false);
  };

  const isAssigned = selected && (selected.vehicleId || selectedVehicleId) && (selected.driverId || selectedDriverId);
  const canDispatch = selected?.status === "PLANNED" && !!(selected.vehicleId && selected.driverId);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-5">
        <h1 className="text-lg font-semibold text-ink">Assignment Workspace</h1>
        <p className="text-sm text-steel">Select a planned trip to assign resources and dispatch.</p>
      </div>

      <div className="flex gap-6">
        {/* Trip list */}
        <div className="w-80 flex-shrink-0 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="p-3 border-b border-slate-100 text-xs font-semibold text-steel uppercase">Planned Trips ({trips.length})</div>
          <div className="overflow-y-auto max-h-[700px]">
            {trips.length === 0 ? <div className="p-4 text-sm text-steel">No planned trips.</div> : trips.map(t => (
              <button key={t.id} onClick={() => selectTrip(t)}
                className={`w-full text-left px-4 py-3 border-b border-slate-100 hover:bg-slate-50 ${selected?.id === t.id ? "bg-aqua/5 border-l-2 border-l-aqua" : ""}`}>
                <div className="text-sm font-medium text-ink">#{t.tripNumber ?? t.id.slice(-6)}</div>
                <div className="text-xs text-steel">{t.customer?.name ?? "—"} · {t.site?.name ?? "—"}</div>
                <div className="text-xs text-steel">{t.requiredTankerCapacityLtr ? `${t.requiredTankerCapacityLtr.toLocaleString()} L` : "—"}</div>
                <div className="mt-1 flex gap-1">
                  {t.vehicleId ? <span className="text-xs bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded">Vehicle ✓</span> : <span className="text-xs bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded">No vehicle</span>}
                  {t.driverId ? <span className="text-xs bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded">Driver ✓</span> : <span className="text-xs bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded">No driver</span>}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Assignment panel */}
        {selected ? (
          <div className="flex-1 space-y-4">
            {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{error}</div>}
            {success && <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm rounded-lg p-3">{success}</div>}

            {/* Trip summary */}
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold text-ink">Trip #{selected.tripNumber ?? selected.id.slice(-6)}</div>
                  <div className="text-sm text-steel">{selected.customer?.name ?? "Customer"} → {selected.site?.name ?? "Site"}</div>
                  <div className="text-sm text-steel mt-1">Required capacity: <strong>{selected.requiredTankerCapacityLtr?.toLocaleString() ?? "—"} L</strong> (exact match required)</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-steel">Current assignment</div>
                  <div className="text-sm">{selected.vehicle?.plate ?? "No vehicle"}</div>
                  <div className="text-sm">{selected.driver?.name ?? "No driver"}</div>
                </div>
              </div>
            </div>

            {/* Recommendation banner */}
            {(rec.vehicle || rec.driver) && (
              <div className="bg-aqua/5 border border-aqua/20 rounded-xl p-4">
                <div className="text-sm font-semibold text-aqua mb-2">⭐ Recommendation</div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  {rec.vehicle && <div><div className="font-medium">{rec.vehicle.candidate.plate}</div><div className="text-steel">{rec.vehicle.candidate.capacityLiters?.toLocaleString()} L · {rec.vehicle.reason}</div></div>}
                  {rec.driver && <div><div className="font-medium">{rec.driver.candidate.name}</div><div className="text-steel">{rec.driver.reason}</div></div>}
                </div>
                <button onClick={() => {
                  if (rec.vehicle?.eligible) setSelectedVehicleId(rec.vehicle.candidate.id);
                  if (rec.driver?.eligible) setSelectedDriverId(rec.driver.candidate.id);
                }} className="mt-3 text-sm bg-aqua text-white px-4 py-1.5 rounded-lg font-medium">Accept Recommendation</button>
              </div>
            )}

            {loadingCandidates ? <div className="py-8 text-center text-steel text-sm">Loading eligible candidates…</div> : (
              <div className="grid grid-cols-2 gap-4">
                {/* Vehicles */}
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <div className="p-3 border-b border-slate-100 text-xs font-semibold text-steel uppercase">Tanker / Vehicle Candidates</div>
                  <div className="divide-y divide-slate-100 max-h-[300px] overflow-y-auto">
                    {vehicles.length === 0 ? <div className="p-4 text-sm text-steel">No vehicle data.</div> : vehicles.map(v => {
                      const isRec = rec.vehicle?.candidate.id === v.candidate.id;
                      return (
                        <label key={v.candidate.id} className={`flex items-start gap-3 p-3 ${!v.eligible ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:bg-slate-50"} ${selectedVehicleId === v.candidate.id ? "bg-aqua/5" : ""}`}>
                          <input type="radio" name="vehicle" disabled={!v.eligible} value={v.candidate.id} checked={selectedVehicleId === v.candidate.id} onChange={() => v.eligible && setSelectedVehicleId(v.candidate.id)} className="mt-0.5 accent-aqua" />
                          <div className="flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-medium">{v.candidate.plate}</span>
                              <EligibilityBadge eligible={v.eligible} recommended={isRec} />
                            </div>
                            <div className="text-xs text-steel">{v.candidate.capacityLiters?.toLocaleString() ?? "—"} L · {v.candidate.status}</div>
                            <div className="text-xs text-steel/70 mt-0.5">{v.reason}</div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* Drivers */}
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <div className="p-3 border-b border-slate-100 text-xs font-semibold text-steel uppercase">Driver Candidates</div>
                  <div className="divide-y divide-slate-100 max-h-[300px] overflow-y-auto">
                    {drivers.length === 0 ? <div className="p-4 text-sm text-steel">No driver data.</div> : drivers.map(d => {
                      const isRec = rec.driver?.candidate.id === d.candidate.id;
                      return (
                        <label key={d.candidate.id} className={`flex items-start gap-3 p-3 ${!d.eligible ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:bg-slate-50"} ${selectedDriverId === d.candidate.id ? "bg-aqua/5" : ""}`}>
                          <input type="radio" name="driver" disabled={!d.eligible} value={d.candidate.id} checked={selectedDriverId === d.candidate.id} onChange={() => d.eligible && setSelectedDriverId(d.candidate.id)} className="mt-0.5 accent-aqua" />
                          <div className="flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-medium">{d.candidate.name}</span>
                              <EligibilityBadge eligible={d.eligible} recommended={isRec} />
                            </div>
                            <div className="text-xs text-steel">{d.candidate.status}</div>
                            <div className="text-xs text-steel/70 mt-0.5">{d.reason}</div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Action bar */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center gap-3">
              <button onClick={assign} disabled={assigning || (!selectedVehicleId && !selectedDriverId)}
                className="bg-slate-700 text-white px-5 py-2.5 rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-slate-800">
                {assigning ? "Assigning…" : "Assign Resources"}
              </button>
              <button onClick={dispatch} disabled={dispatching || !canDispatch}
                className="bg-aqua text-white px-5 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-40 hover:bg-aqua/90">
                {dispatching ? "Dispatching…" : "Dispatch Trip →"}
              </button>
              {!canDispatch && <div className="text-xs text-steel">Dispatch requires both driver and vehicle assigned.</div>}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-steel text-sm">Select a planned trip from the list to begin assignment.</div>
        )}
      </div>
    </div>
  );
}
