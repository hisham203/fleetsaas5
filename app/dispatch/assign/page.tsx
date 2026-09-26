"use client";
/**
 * P2-02: Supervisor Assignment Workspace
 *
 *   PLANNED trip → review eligibility → Assign Tanker + Driver (trip stays PLANNED)
 *               → Dispatch Trip (separate action) → DISPATCHED
 *
 * Permission: trips.assign (assign) + trips.dispatch (dispatch)
 *
 * List row AND detail panel are rendered from the same OperationalTripDto
 * (GET /api/trips?status=PLANNED&view=operational, GET /api/trips/[id]),
 * so they can never disagree. Candidates come from
 * GET /api/fleet/eligible-vehicles?tripId= and /api/fleet/eligible-drivers?tripId=
 * → { results: [{ candidate, eligible, availability, reason }] }.
 */

import { useCallback, useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import AdminShell from "@/components/AdminShell";
import StatusBadge from "@/components/StatusBadge";
import { useRequireSession } from "@/lib/useSession";
import type { OperationalTripDto } from "@/lib/tripDto";

type Availability = "AVAILABLE" | "BUSY" | "INELIGIBLE";
type VehicleCandidate = { candidate: { id: string; plateNumber: string; vehicleCode: string | null; capacityLiters: number | null; status: string }; eligible: boolean; availability: Availability; reason: string };
type DriverCandidate = { candidate: { id: string; name: string | null; driverCode: string | null; status: string }; eligible: boolean; availability: Availability; reason: string };

const litres = (n: number | null | undefined) => (n == null ? "—" : `${n.toLocaleString()} L`);
const ORDER_OF: Record<Availability, number> = { AVAILABLE: 0, BUSY: 1, INELIGIBLE: 2 };

async function readJson(res: Response): Promise<any> {
  try { return await res.json(); } catch { return null; }
}

export default function AssignmentWorkspacePage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-paper flex items-center justify-center text-steel text-sm">Loading…</main>}>
      <DispatchWorkspace />
    </Suspense>
  );
}

function DispatchWorkspace() {
  const { session, loading: sessionLoading } = useRequireSession(["ADMIN", "DISPATCHER"]);
  const searchParams = useSearchParams();
  const deepLinkTripId = searchParams.get("tripId");

  const [trips, setTrips] = useState<OperationalTripDto[]>([]);
  const [listLoaded, setListLoaded] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(deepLinkTripId);
  const [vehicles, setVehicles] = useState<VehicleCandidate[]>([]);
  const [drivers, setDrivers] = useState<DriverCandidate[]>([]);
  const [candidateError, setCandidateError] = useState<string | null>(null);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [selectedVehicleId, setSelectedVehicleId] = useState("");
  const [selectedDriverId, setSelectedDriverId] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Detail is the SAME DTO object as the list row — one source of truth.
  const selected = trips.find((t) => t.id === selectedId) ?? null;

  const loadTrips = useCallback(async () => {
    try {
      const res = await fetch("/api/trips?status=PLANNED&view=operational");
      const data = await readJson(res);
      if (!res.ok || !Array.isArray(data)) { setListError(typeof data?.error === "string" ? data.error : "Planned trips could not be loaded."); return; }
      setTrips(data);
      setListError(null);
    } catch {
      setListError("Network error while loading planned trips.");
    } finally {
      setListLoaded(true);
    }
  }, []);

  useEffect(() => { if (session) loadTrips(); }, [session, loadTrips]);

  const loadCandidates = useCallback(async (trip: OperationalTripDto) => {
    setLoadingCandidates(true); setCandidateError(null);
    try {
      const [vRes, dRes] = await Promise.all([
        fetch(`/api/fleet/eligible-vehicles?tripId=${trip.id}`),
        fetch(`/api/fleet/eligible-drivers?tripId=${trip.id}`),
      ]);
      const vData = await readJson(vRes);
      const dData = await readJson(dRes);
      if (!vRes.ok || !dRes.ok) {
        setCandidateError((typeof vData?.error === "string" && vData.error) || (typeof dData?.error === "string" && dData.error) || "Candidates could not be loaded.");
      }
      setVehicles(((vData?.results ?? []) as VehicleCandidate[]).sort((a, b) => ORDER_OF[a.availability] - ORDER_OF[b.availability]));
      setDrivers(((dData?.results ?? []) as DriverCandidate[]).sort((a, b) => ORDER_OF[a.availability] - ORDER_OF[b.availability]));
    } catch {
      setCandidateError("Network error while loading candidates.");
    } finally {
      setLoadingCandidates(false);
    }
  }, []);

  // (Re)load candidates whenever the selected trip changes identity.
  useEffect(() => {
    if (!selected) return;
    setSelectedVehicleId(selected.vehicle?.id ?? "");
    setSelectedDriverId(selected.driver?.id ?? "");
    loadCandidates(selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, loadCandidates]);

  const replaceTrip = (dto: OperationalTripDto) => setTrips((list) => list.map((t) => (t.id === dto.id ? dto : t)));

  async function assign() {
    if (!selected) return;
    setAssigning(true); setError(null); setSuccess(null);
    const body: { vehicleId?: string; driverId?: string } = {};
    if (selectedVehicleId && selectedVehicleId !== selected.vehicle?.id) body.vehicleId = selectedVehicleId;
    if (selectedDriverId && selectedDriverId !== selected.driver?.id) body.driverId = selectedDriverId;
    try {
      const res = await fetch(`/api/trips/${selected.id}/assign`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await readJson(res);
      if (!res.ok) { setError(typeof data?.error === "string" ? data.error : "Assignment failed"); return; }
      // Refresh from the server — never assume what was persisted.
      const fresh = await fetch(`/api/trips/${selected.id}`);
      const dto = fresh.ok ? await readJson(fresh) : data?.trip;
      if (dto?.id) replaceTrip(dto);
      setSuccess("Resources assigned. The trip remains PLANNED until you dispatch it.");
      await loadCandidates(dto?.id ? dto : selected);
    } catch {
      setError("Network error — assignment was not confirmed.");
    } finally {
      setAssigning(false);
    }
  }

  async function dispatch() {
    if (!selected) return;
    setDispatching(true); setError(null); setSuccess(null);
    try {
      const res = await fetch(`/api/trips/${selected.id}/dispatch`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      const data = await readJson(res);
      if (!res.ok) { setError(typeof data?.error === "string" ? data.error : "Dispatch failed"); return; }
      setSuccess(`Trip ${selected.tripNumber} dispatched to ${selected.driver?.name ?? "the driver"}.`);
      setSelectedId(null);
      await loadTrips();
    } catch {
      setError("Network error — dispatch was not confirmed.");
    } finally {
      setDispatching(false);
    }
  }

  const pendingChange = !!selected && (
    (selectedVehicleId !== "" && selectedVehicleId !== (selected.vehicle?.id ?? "")) ||
    (selectedDriverId !== "" && selectedDriverId !== (selected.driver?.id ?? ""))
  );
  // Dispatch is enabled from PERSISTED server state only — never from an unsaved selection.
  const canDispatch = !!selected && selected.status === "PLANNED" && selected.isAssigned && !pendingChange;
  const eligibleVehicleCount = vehicles.filter((v) => v.eligible).length;
  const eligibleDriverCount = drivers.filter((d) => d.eligible).length;

  if (sessionLoading || !session) {
    return <AdminShell title="Assignment Workspace"><p className="p-6 text-steel text-sm">Loading…</p></AdminShell>;
  }

  return (
    <AdminShell title="Assignment Workspace">
      <div className="p-6 max-w-7xl space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-ink">Assignment Workspace</h1>
            <p className="text-sm text-steel">Assign an exact-capacity tanker and an available driver to each planned trip, then dispatch it.</p>
          </div>
          <a href="/dispatch" className="btn btn-md btn-outline">← Order Intake &amp; Planning</a>
        </div>

        {success && <div className="rounded-lg border border-ok/30 bg-okLight px-4 py-3 text-sm text-ok">{success}</div>}

        <div className="flex flex-col lg:flex-row gap-5">
          {/* Planned trip list */}
          <section className="card lg:w-80 shrink-0 overflow-hidden" aria-label="Planned Trips">
            <div className="card-header">
              <h2 className="text-sm font-semibold text-ink">Planned Trips <span className="text-steel font-normal">({trips.length})</span></h2>
              <button onClick={loadTrips} className="text-2xs text-aquaDark font-medium hover:underline">Refresh</button>
            </div>
            <div className="max-h-[720px] overflow-y-auto divide-y divide-slate-100">
              {listError && <div className="p-4 text-sm text-danger">{listError}</div>}
              {!listLoaded ? <div className="p-4 text-sm text-steel">Loading…</div> : trips.length === 0 ? (
                <div className="p-4 text-sm text-steel">No planned trips. Plan trips from the Order Queue.</div>
              ) : trips.map((t) => (
                <button key={t.id} onClick={() => { setSelectedId(t.id); setError(null); setSuccess(null); }}
                  className={`w-full text-left px-4 py-3 hover:bg-slate-50 ${selectedId === t.id ? "bg-aquaLight/40 border-l-2 border-l-aqua" : ""}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-ink">{t.tripNumber}</span>
                    {t.isAssigned
                      ? <span className="badge bg-okLight text-ok">Ready</span>
                      : <span className="badge bg-warnLight text-warn">Needs assignment</span>}
                  </div>
                  <div className="text-xs text-steel mt-0.5">{t.customer?.name ?? "—"} · {t.site?.label ?? t.deliveryAddress ?? "—"}</div>
                  <div className="text-xs text-steel">Required: {t.requiredTankerCapacityLtr != null ? litres(t.requiredTankerCapacityLtr) : "no size requirement"}</div>
                  <div className="mt-1 grid grid-cols-2 gap-1 text-2xs">
                    <span>Tanker: {t.vehicle ? <b className="text-ink">{t.vehicle.plateNumber}</b> : <span className="text-warn font-medium">Unassigned</span>}</span>
                    <span>Driver: {t.driver ? <b className="text-ink">{t.driver.name ?? t.driver.driverCode}</b> : <span className="text-warn font-medium">Unassigned</span>}</span>
                  </div>
                </button>
              ))}
            </div>
          </section>

          {/* Assignment panel */}
          {selected ? (
            <div className="flex-1 space-y-4 min-w-0">
              {error && <div className="rounded-lg border border-danger/30 bg-dangerLight px-4 py-3 text-sm text-danger">{error}</div>}

              <section className="card card-body" aria-label="Trip detail">
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <h2 className="text-base font-semibold text-ink">Trip {selected.tripNumber}</h2>
                  <StatusBadge status={selected.status} />
                  {selected.order && (
                    <span className={`badge ${selected.order.orderType === "B2B_CONTRACT" ? "bg-infoLight text-info" : "bg-aquaLight text-aquaDark"}`}>
                      {selected.order.orderType === "B2B_CONTRACT" ? "B2B Contract" : "B2C Direct"}
                    </span>
                  )}
                </div>
                <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-3 text-sm">
                  <Detail label="Trip Number" value={selected.tripNumber} />
                  <Detail label="Customer" value={selected.customer?.name ?? "—"} />
                  <Detail label="Site" value={selected.site ? `${selected.site.label}${selected.site.siteCode ? ` · ${selected.site.siteCode}` : ""}` : selected.deliveryAddress ?? "—"} />
                  <Detail label="Order" value={selected.order ? `${selected.order.orderNumber}${selected.order.contract ? ` · ${selected.order.contract.contractNumber}` : ""}` : "—"} />
                  <Detail label="Required Capacity" value={selected.requiredTankerCapacityLtr != null ? `${litres(selected.requiredTankerCapacityLtr)} (exact match)` : "No size requirement"} />
                  <Detail label="Loading Point" value={selected.loadingPoint?.name ?? "—"} />
                  <Detail label="Current Tanker" value={selected.vehicle ? `${selected.vehicle.plateNumber} · ${litres(selected.vehicle.capacityLiters)}` : "Unassigned"} warn={!selected.vehicle} />
                  <Detail label="Current Driver" value={selected.driver ? selected.driver.name ?? selected.driver.driverCode ?? "Driver" : "Unassigned"} warn={!selected.driver} />
                </dl>
              </section>

              {candidateError && <div className="rounded-lg border border-warn/30 bg-warnLight px-4 py-3 text-sm text-warn">{candidateError}</div>}

              {loadingCandidates ? <div className="card card-body text-center text-sm text-steel">Checking tanker and driver eligibility…</div> : (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  <CandidateList
                    title="Tankers"
                    emptyText="No tankers are registered in this fleet."
                    noneEligibleText={`No tanker qualifies: ${vehicles.length} checked. See each tanker's reason below.`}
                    eligibleCount={eligibleVehicleCount}
                    rows={vehicles.map((v) => ({
                      id: v.candidate.id,
                      title: v.candidate.plateNumber,
                      sub: `${litres(v.candidate.capacityLiters)}${v.candidate.vehicleCode ? ` · ${v.candidate.vehicleCode}` : ""} · status ${v.candidate.status}`,
                      availability: v.availability, eligible: v.eligible, reason: v.reason,
                    }))}
                    selectedId={selectedVehicleId}
                    currentId={selected.vehicle?.id ?? null}
                    onSelect={setSelectedVehicleId}
                    name="vehicle"
                  />
                  <CandidateList
                    title="Drivers"
                    emptyText="No drivers are registered for this company."
                    noneEligibleText={`No driver qualifies: ${drivers.length} checked. See each driver's reason below.`}
                    eligibleCount={eligibleDriverCount}
                    rows={drivers.map((d) => ({
                      id: d.candidate.id,
                      title: d.candidate.name ?? d.candidate.driverCode ?? "Driver",
                      sub: `${d.candidate.driverCode ? `${d.candidate.driverCode} · ` : ""}status ${d.candidate.status}`,
                      availability: d.availability, eligible: d.eligible, reason: d.reason,
                    }))}
                    selectedId={selectedDriverId}
                    currentId={selected.driver?.id ?? null}
                    onSelect={setSelectedDriverId}
                    name="driver"
                  />
                </div>
              )}

              <section className="card card-body flex flex-wrap items-center gap-3" aria-label="Actions">
                <button onClick={assign} disabled={assigning || !pendingChange}
                  className="btn btn-lg bg-ink text-white hover:bg-slate-800 disabled:opacity-50">
                  {assigning ? "Assigning…" : "Assign Resources"}
                </button>
                <button onClick={dispatch} disabled={dispatching || !canDispatch} className="btn btn-lg btn-primary disabled:opacity-40">
                  {dispatching ? "Dispatching…" : "Dispatch Trip →"}
                </button>
                <p className="text-xs text-steel">
                  {pendingChange
                    ? "Save the assignment before dispatching."
                    : selected.isAssigned
                      ? "Tanker and driver assigned. Dispatch sends the trip to the driver."
                      : "Dispatch requires both a tanker and a driver to be assigned."}
                </p>
              </section>
            </div>
          ) : (
            <div className="flex-1 card card-body flex items-center justify-center text-sm text-steel min-h-[200px]">
              {deepLinkTripId && listLoaded && !trips.some((t) => t.id === deepLinkTripId)
                ? "That trip is no longer awaiting assignment — it may already be dispatched or completed."
                : "Select a planned trip to review eligibility, assign resources and dispatch."}
            </div>
          )}
        </div>
      </div>
    </AdminShell>
  );
}

function Detail({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <dt className="text-2xs uppercase tracking-wide text-steel">{label}</dt>
      <dd className={warn ? "text-warn font-medium" : "text-ink"}>{value}</dd>
    </div>
  );
}

const AVAILABILITY_STYLE: Record<Availability, string> = {
  AVAILABLE: "bg-okLight text-ok",
  BUSY: "bg-warnLight text-warn",
  INELIGIBLE: "bg-slate-100 text-steel",
};

function CandidateList({ title, rows, selectedId, currentId, onSelect, name, emptyText, noneEligibleText, eligibleCount }: {
  title: string; name: string; emptyText: string; noneEligibleText: string; eligibleCount: number;
  rows: { id: string; title: string; sub: string; availability: Availability; eligible: boolean; reason: string }[];
  selectedId: string; currentId: string | null; onSelect: (id: string) => void;
}) {
  return (
    <section className="card overflow-hidden" aria-label={title}>
      <div className="card-header">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        <span className="text-2xs text-steel">{eligibleCount} of {rows.length} available</span>
      </div>
      {rows.length > 0 && eligibleCount === 0 && (
        <div className="px-4 py-2 text-xs text-warn bg-warnLight border-b border-warn/20">{noneEligibleText}</div>
      )}
      <div className="divide-y divide-slate-100 max-h-[360px] overflow-y-auto">
        {rows.length === 0 ? <div className="p-4 text-sm text-steel">{emptyText}</div> : rows.map((r) => (
          <label key={r.id} className={`flex items-start gap-3 px-4 py-3 ${r.eligible ? "cursor-pointer hover:bg-slate-50" : "opacity-70 cursor-not-allowed"} ${selectedId === r.id ? "bg-aquaLight/40" : ""}`}>
            <input type="radio" name={name} className="mt-1 accent-aqua" disabled={!r.eligible} checked={selectedId === r.id} onChange={() => r.eligible && onSelect(r.id)} />
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-ink">{r.title}</span>
                <span className={`badge ${AVAILABILITY_STYLE[r.availability]}`}>{r.availability}</span>
                {currentId === r.id && <span className="badge bg-infoLight text-info">Assigned</span>}
              </div>
              <div className="text-xs text-steel">{r.sub}</div>
              <div className="text-xs text-steel/80 mt-0.5">{r.reason}</div>
            </div>
          </label>
        ))}
      </div>
    </section>
  );
}
