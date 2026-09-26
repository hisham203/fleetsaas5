"use client";
/**
 * Dispatch (Live) — P2-02 Coordinator workspace.
 *
 *   New Order  →  Order Type → Customer → Site → Contract → Tanker Capacity → Create Order
 *   Order Queue →  Plan Trip → Loading Point → POST /api/trips { orderIds, warehouseId }
 *   Planned Trips  → handed to the Supervisor's Assignment Workspace (/dispatch/assign)
 *   Active Trips   → read-only operational visibility (the driver executes them)
 *
 * The coordinator never assigns resources or dispatches here: a planned trip
 * is created PLANNED with NO driver and NO tanker. Assignment and dispatch
 * are separate supervisor actions.
 *
 * Data contracts (all plain arrays unless noted):
 *   GET /api/orders?status=…                         Order[]
 *   GET /api/trips?status=…&view=operational          OperationalTripDto[] (lib/tripDto.ts)
 *   GET /api/loading-points                           LoadingPoint[]
 *   GET /api/customers                                Customer[]
 *   GET /api/customers/[id]/locations                 Site[]
 *   GET /api/contracts/eligible?customerId&locationId EligibleContract[]
 *   GET /api/orders/tanker-capacities                 { capacities: [...] }
 */

import { useCallback, useEffect, useMemo, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import AdminShell from "@/components/AdminShell";
import StatusBadge from "@/components/StatusBadge";
import LiveMap from "@/components/LiveMap";
import { resolveTripMapPosition } from "@/lib/mapPosition";
import { useRequireSession } from "@/lib/useSession";
import type { OperationalTripDto } from "@/lib/tripDto";

// ── Types (mirror the API responses listed above) ───────────────────────────
type QueueOrder = {
  id: string; orderNumber: string; status: string;
  customerId: string; locationId: string | null; contractId: string | null;
  requiredTankerCapacityLtr: number | null; requestedTime: string | null; deliveryAddress: string;
  customer?: { id: string; name: string; type: string; customerCode?: string | null } | null;
  location?: { id: string; label: string; siteCode?: string | null } | null;
  contract?: { id: string; contractNumber: string; type: string } | null;
};
type Customer = { id: string; name: string; type: string; customerCode?: string | null; address?: string };
type Site = { id: string; label: string; address: string; siteCode?: string | null };
type EligibleContract = {
  id: string; contractNumber: string; type: string;
  totalTripsPurchased: number | null; tripsUsed: number | null;
  eligibleTankerCapacities: number[];
};
type LoadingPoint = { id: string; name: string; code: string | null; address: string; isDefault: boolean };
type FleetCapacity = { capacityLiters: number; tankers: number; available: number };
type OrderKind = "B2B_CONTRACT" | "B2C_DIRECT";

const ACTIVE_STATUSES = "DISPATCHED,IN_PROGRESS,STARTED,ARRIVED_LOADING,LOADING_COMPLETE,ARRIVED_SITE";

const litres = (n: number | null | undefined) => (n == null ? "—" : `${n.toLocaleString()} L`);
const when = (s: string | null | undefined) => (s ? new Date(s).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—");
const contractLabel = (type: string) => (type === "ONE_TIME_TRIP_COUNT" ? "Trip-count" : type === "MONTHLY_ACCUMULATED" ? "Monthly" : type.replace(/_/g, " "));

async function readJson(res: Response): Promise<any> {
  try { return await res.json(); } catch { return null; }
}
function errorText(data: any, fallback: string): string {
  if (typeof data?.error === "string") return data.error;
  if (data?.error?.fieldErrors) return Object.values(data.error.fieldErrors).flat().join(" ") || fallback;
  return fallback;
}

// ────────────────────────────────────────────────────────────────────────────
export default function DispatchPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-paper flex items-center justify-center text-steel text-sm">Loading…</main>}>
      <DispatchPageInner />
    </Suspense>
  );
}

function DispatchPageInner() {
  const { session, loading: sessionLoading } = useRequireSession(["ADMIN", "DISPATCHER"]);
  const searchParams = useSearchParams();
  // Deep links from the Dispatch Control Tower: /dispatch?tripId=… or /dispatch?orderId=…
  const deepLinkTripId = searchParams.get("tripId");
  const deepLinkOrderId = searchParams.get("orderId");

  const [queue, setQueue] = useState<QueueOrder[]>([]);
  const [plannedTrips, setPlannedTrips] = useState<OperationalTripDto[]>([]);
  const [activeTrips, setActiveTrips] = useState<OperationalTripDto[]>([]);
  const [loadingPoints, setLoadingPoints] = useState<LoadingPoint[]>([]);
  const [exceptions, setExceptions] = useState<any[]>([]);
  const [escalations, setEscalations] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ tone: "ok" | "danger"; text: string; tripId?: string } | null>(null);
  const [showNewOrder, setShowNewOrder] = useState(false);
  // Queue selection: the order whose Plan Trip panel is open.
  const [selected, setSelected] = useState<string[]>([]);
  const [focusTripId, setFocusTripId] = useState<string | null>(null);
  const [focusToken, setFocusToken] = useState(0);
  const [resetToken, setResetToken] = useState(0);
  const [detailTripId, setDetailTripId] = useState<string | null>(null);
  // Trips opened by deep link that are not in the actionable lists (e.g. completed) — read-only.
  const [extraTrips, setExtraTrips] = useState<OperationalTripDto[]>([]);
  const [deepLinkNotice, setDeepLinkNotice] = useState<string | null>(null);
  const [deepLinkResolved, setDeepLinkResolved] = useState(false);

  const load = useCallback(async () => {
    try {
      const [pending, validated, planned, active, lps, ex, esc] = await Promise.all([
        fetch("/api/orders?status=PENDING"),
        fetch("/api/orders?status=VALIDATED"),
        fetch("/api/trips?status=PLANNED&view=operational"),
        fetch(`/api/trips?status=${ACTIVE_STATUSES}&view=operational`),
        fetch("/api/loading-points"),
        fetch("/api/exceptions?status=OPEN"),
        fetch("/api/escalations?status=OPEN"),
      ]);
      const asArray = async (r: Response) => {
        if (!r.ok) return [];
        const d = await readJson(r);
        return Array.isArray(d) ? d : [];
      };
      const orders: QueueOrder[] = [...(await asArray(pending)), ...(await asArray(validated))];
      // Only dispatch/planning-eligible orders belong in the queue:
      setQueue(orders.filter((o) => o.status === "PENDING" || o.status === "VALIDATED").sort((a, b) => (a.requestedTime ?? "").localeCompare(b.requestedTime ?? "")));
      setPlannedTrips(await asArray(planned));
      setActiveTrips(await asArray(active));
      setLoadingPoints(await asArray(lps));
      setExceptions(await asArray(ex));
      setEscalations(await asArray(esc));
      setLoadError(!pending.ok || !planned.ok ? "Some dispatch data could not be loaded. Check your permissions or refresh." : null);
    } catch {
      setLoadError("Network error while loading dispatch data.");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!session) return;
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [session, load]);

  const allTrips = useMemo(() => [...plannedTrips, ...activeTrips, ...extraTrips], [plannedTrips, activeTrips, extraTrips]);

  // Milestone S/T deep-link resolution, P2-02 semantics. Runs once, after the
  // first load. Trip existence is checked FIRST (the Control Tower's ground
  // truth), then the order's own status.
  useEffect(() => {
    if (deepLinkResolved) return;
    if (!deepLinkTripId && !deepLinkOrderId) { setDeepLinkResolved(true); return; }
    if (!loaded) return; // wait for first load
    setDeepLinkResolved(true);
    (async () => {
      const openTrip = async (tripId: string): Promise<OperationalTripDto | null> => {
        const known = allTrips.find((t) => t.id === tripId);
        if (known) return known;
        const r = await fetch(`/api/trips/${tripId}`);
        if (!r.ok) return null;
        const dto: OperationalTripDto | null = await readJson(r);
        if (dto?.id) setExtraTrips((x) => [...x, dto]);
        return dto?.id ? dto : null;
      };
      const describe = (orderNumber: string, t: OperationalTripDto) =>
        t.status === "PLANNED" && !t.isAssigned ? `Order ${orderNumber} is planned on trip ${t.tripNumber} and awaiting tanker and driver assignment.`
        : t.status === "PLANNED" ? `Order ${orderNumber} is assigned and waiting for dispatch on trip ${t.tripNumber}.`
        : t.status === "COMPLETED" ? `Order ${orderNumber} is already completed. Showing readonly trip details.`
        : `Order ${orderNumber} is active on trip ${t.tripNumber} and shown under Active Trips.`;

      if (deepLinkTripId) {
        const match = await openTrip(deepLinkTripId);
        if (match) {
          setFocusTripId(match.id);
          setFocusToken((x) => x + 1);
          setDetailTripId(match.id);
          if (match.status === "COMPLETED") setDeepLinkNotice(`Trip ${match.tripNumber} is already completed. Showing readonly trip details.`);
        } else {
          setDeepLinkNotice(`Trip ${deepLinkTripId} was not found — it may have been completed or is no longer active.`);
        }
      } else if (deepLinkOrderId) {
        const r = await fetch("/api/orders");
        const every: any[] = r.ok ? ((await readJson(r)) ?? []) : [];
        const match = every.find((o) => o.id === deepLinkOrderId);
        if (!match) { setDeepLinkNotice(`Order ${deepLinkOrderId} was not found.`); return; }
        // Trip existence FIRST (Control Tower ground truth), then order status.
        const linkedTripId = match.tripStop?.trip?.id;
        const linkedTrip = linkedTripId ? await openTrip(linkedTripId) : null;
        if (linkedTrip) {
          setFocusTripId(linkedTrip.id);
          setFocusToken((x) => x + 1);
          setDetailTripId(linkedTrip.id);
          setDeepLinkNotice(describe(match.orderNumber, linkedTrip));
        } else if (match.status === "PENDING" || match.status === "VALIDATED") {
          // Genuinely new demand — open Plan Trip for it in the Order Queue.
          setSelected([match.id]);
        } else if (match.status === "DELIVERED" || match.status === "PARTIALLY_DELIVERED") {
          setDeepLinkNotice(`Order ${match.orderNumber} is already completed. No trip record is linked for it (this can happen for deliveries recorded without full dispatch tracking).`);
        } else {
          setDeepLinkNotice(`Order ${match.orderNumber} is marked as ${match.status.toLowerCase()}, but its trip record could not be found — this may require admin review.`);
        }
      }
    })();
  }, [deepLinkResolved, deepLinkTripId, deepLinkOrderId, loaded, allTrips]);

  const unassigned = plannedTrips.filter((t) => !t.isAssigned).length;
  const detailTrip = allTrips.find((t) => t.id === detailTripId) ?? null;

  if (sessionLoading || !session) {
    return <AdminShell title="Dispatch (Live)"><p className="p-6 text-steel text-sm">Loading…</p></AdminShell>;
  }

  return (
    <AdminShell title="Dispatch (Live)">
      <div className="p-6 space-y-5 max-w-7xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-ink">Order Intake &amp; Trip Planning</h1>
            <p className="text-sm text-steel">Create bulk-water orders and plan unassigned trips. Tanker and driver assignment happens in the Assignment Workspace.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowNewOrder((s) => !s)} className="btn btn-md btn-primary">
              {showNewOrder ? "Close new order" : "+ New Order"}
            </button>
            <a href="/dispatch/assign" className="btn btn-md btn-outline">Assignment Workspace →</a>
          </div>
        </div>

        {deepLinkNotice && (
          <div className="rounded-lg border border-warn/30 bg-warnLight px-4 py-3 text-sm text-warn flex items-center justify-between gap-3">
            <span>{deepLinkNotice}</span>
            <button onClick={() => setDeepLinkNotice(null)} className="text-xs opacity-70 hover:opacity-100">Dismiss</button>
          </div>
        )}
        {flash && (
          <div className={`rounded-lg border px-4 py-3 text-sm flex items-center justify-between gap-3 ${flash.tone === "ok" ? "bg-okLight border-ok/30 text-ok" : "bg-dangerLight border-danger/30 text-danger"}`}>
            <span>
              {flash.text}
              {flash.tripId && <> · <a className="underline font-medium" href={`/dispatch/assign?tripId=${flash.tripId}`}>Open in Assignment Workspace</a></>}
            </span>
            <button onClick={() => setFlash(null)} className="text-xs opacity-70 hover:opacity-100">Dismiss</button>
          </div>
        )}
        {loadError && <div className="rounded-lg border border-warn/30 bg-warnLight px-4 py-3 text-sm text-warn">{loadError}</div>}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Kpi label="Orders awaiting planning" value={queue.length} />
          <Kpi label="Planned trips" value={plannedTrips.length} sub={`${unassigned} awaiting assignment · ${plannedTrips.length - unassigned} ready to dispatch`} />
          <Kpi label="Active trips" value={activeTrips.length} sub="Dispatched and in progress" />
        </div>

        {escalations.length > 0 && <EscalationsPanel escalations={escalations} onChange={load} />}
        {exceptions.length > 0 && <ExceptionCenter exceptions={exceptions} onChange={load} />}

        {showNewOrder && (
          <NewOrderPanel
            onCancel={() => setShowNewOrder(false)}
            onCreated={(order) => {
              setShowNewOrder(false);
              setFlash({ tone: "ok", text: `Order ${order.orderNumber} created and added to the Order Queue.` });
              load();
            }}
          />
        )}

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          {/* ORDER QUEUE — eligible orders requiring planning */}
          <section className="card" aria-label="Order Queue">
            <div className="card-header">
              <h2 className="text-sm font-semibold text-ink">Order Queue <span className="text-steel font-normal">({queue.length})</span></h2>
              <span className="text-2xs text-steel">Orders awaiting trip planning</span>
            </div>
            <div className="divide-y divide-slate-100 max-h-[560px] overflow-y-auto">
              {!loaded ? <Empty text="Loading orders…" /> : queue.length === 0 ? <Empty text="No orders awaiting planning." /> : queue.map((o) => (
                <div key={o.id} className={`p-4 ${selected.includes(o.id) ? "bg-aquaLight/40" : ""}`}>
                  <OrderSummary order={o} />
                  {selected.includes(o.id) ? (
                    <PlanTripForm
                      order={o}
                      loadingPoints={loadingPoints}
                      onCancel={() => setSelected([])}
                      onPlanned={(trip) => {
                        setSelected([]);
                        setFlash({ tone: "ok", text: `Trip ${trip.tripNumber} planned for order ${o.orderNumber} — awaiting tanker and driver assignment.`, tripId: trip.id });
                        load();
                      }}
                    />
                  ) : (
                    <div className="mt-3">
                      <button onClick={() => setSelected([o.id])} className="btn btn-sm btn-primary">Plan Trip</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* PLANNED TRIPS — handed to the supervisor */}
          <section className="card" aria-label="Planned Trips">
            <div className="card-header">
              <h2 className="text-sm font-semibold text-ink">Planned Trips <span className="text-steel font-normal">({plannedTrips.length})</span></h2>
              <a href="/dispatch/assign" className="text-2xs text-aquaDark font-medium hover:underline">Assign &amp; dispatch →</a>
            </div>
            <div className="divide-y divide-slate-100 max-h-[560px] overflow-y-auto">
              {!loaded ? <Empty text="Loading trips…" /> : plannedTrips.length === 0 ? <Empty text="No planned trips." /> : plannedTrips.map((t) => (
                <TripRow key={t.id} trip={t} highlight={t.id === focusTripId} onOpen={() => setDetailTripId(t.id)}>
                  <a href={`/dispatch/assign?tripId=${t.id}`} className="btn btn-sm btn-outline">
                    {t.isAssigned ? "Review & dispatch" : "Assign resources"}
                  </a>
                </TripRow>
              ))}
            </div>
          </section>
        </div>

        {/* ACTIVE TRIPS — read-only; the assigned driver executes them */}
        <section className="card" aria-label="Active Trips">
          <div className="card-header">
            <h2 className="text-sm font-semibold text-ink">Active Trips <span className="text-steel font-normal">({activeTrips.length})</span></h2>
            <button onClick={() => setResetToken((x) => x + 1)} className="text-2xs text-steel hover:text-ink font-medium">Reset map</button>
          </div>
          {/* Live map sits in its own block — the queue, planner and trip lists render outside the map's tree. */}
          {activeTrips.length > 0 && (
            <div className="p-4 border-b border-slate-100">
              <LiveMap
                trips={activeTrips.filter((t) => t.vehicle && t.driver).map((t) => ({
                  id: t.id,
                  tripNumber: t.tripNumber,
                  currentLat: t.currentLat,
                  currentLng: t.currentLng,
                  fallbackLat: t.order?.lat ?? null,
                  fallbackLng: t.order?.lng ?? null,
                  destinationLabel: t.site?.label ?? t.customer?.name ?? t.deliveryAddress,
                  loadingPointLabel: t.loadingPoint?.name ?? null,
                  vehicle: { plateNumber: t.vehicle!.plateNumber },
                  driver: { user: { name: t.driver!.name ?? "Driver" } },
                }))}
                focusTripId={focusTripId}
                focusToken={focusToken}
                resetToken={resetToken}
              />
            </div>
          )}
          <div className="divide-y divide-slate-100">
            {!loaded ? <Empty text="Loading trips…" /> : activeTrips.length === 0 ? <Empty text="No trips currently dispatched." /> : activeTrips.map((t) => {
              const position = resolveTripMapPosition(t.currentLat, t.currentLng, t.order?.lat, t.order?.lng);
              return (
                <TripRow key={t.id} trip={t} highlight={t.id === focusTripId} onOpen={() => setDetailTripId(t.id)}>
                  <span className="text-2xs text-steel">Dispatched {when(t.dispatchedAt)}</span>
                  {position ? (
                    <button onClick={() => { setFocusTripId(t.id); setFocusToken((x) => x + 1); }} className="btn btn-sm btn-outline">
                      {position.isLive ? "View on map" : "View destination on map (no GPS yet)"}
                    </button>
                  ) : (
                    <span className="text-2xs text-warn">Live vehicle location unavailable — destination coordinates unavailable too.</span>
                  )}
                </TripRow>
              );
            })}
          </div>
        </section>
      </div>

      {detailTrip && <TripDetailDrawer trip={detailTrip} onClose={() => setDetailTripId(null)} />}
    </AdminShell>
  );
}

// ── Presentational helpers ─────────────────────────────────────────────────
function Kpi({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="kpi-card">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return <div className="p-6 text-sm text-steel text-center">{text}</div>;
}
function OrderTypeBadge({ kind }: { kind: OrderKind }) {
  return kind === "B2B_CONTRACT"
    ? <span className="badge bg-infoLight text-info">B2B Contract</span>
    : <span className="badge bg-aquaLight text-aquaDark">B2C Direct</span>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-2xs uppercase tracking-wide text-steel">{label}</div>
      <div className="text-sm text-ink">{children}</div>
    </div>
  );
}

function OrderSummary({ order: o }: { order: QueueOrder }) {
  const kind: OrderKind = o.contractId ? "B2B_CONTRACT" : "B2C_DIRECT";
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-ink">{o.orderNumber}</span>
        <OrderTypeBadge kind={kind} />
        <StatusBadge status={o.status} />
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        <Field label="Customer">{o.customer?.name ?? "—"}</Field>
        <Field label="Site">{o.location ? `${o.location.label}${o.location.siteCode ? ` · ${o.location.siteCode}` : ""}` : o.deliveryAddress}</Field>
        <Field label="Contract">{o.contract ? `${o.contract.contractNumber} · ${contractLabel(o.contract.type)}` : "Direct order (no contract)"}</Field>
        <Field label="Required tanker">{o.requiredTankerCapacityLtr != null ? litres(o.requiredTankerCapacityLtr) : "No size requirement"}</Field>
        <Field label="Requested delivery">{when(o.requestedTime)}</Field>
      </div>
    </div>
  );
}

function TripRow({ trip: t, highlight, onOpen, children }: { trip: OperationalTripDto; highlight?: boolean; onOpen?: () => void; children?: React.ReactNode }) {
  return (
    <div className={`p-4 space-y-2 ${highlight ? "bg-aquaLight/40" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={onOpen} className="text-sm font-semibold text-ink hover:text-aquaDark hover:underline" title="Trip details">{t.tripNumber}</button>
        <StatusBadge status={t.status} />
        {t.order && <OrderTypeBadge kind={t.order.orderType} />}
        {t.status === "PLANNED" && (
          t.isAssigned
            ? <span className="badge bg-okLight text-ok">Ready to dispatch</span>
            : <span className="badge bg-warnLight text-warn">Awaiting assignment</span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        <Field label="Customer">{t.customer?.name ?? "—"}</Field>
        <Field label="Site">{t.site ? t.site.label : t.deliveryAddress ?? "—"}</Field>
        <Field label="Required capacity">{t.requiredTankerCapacityLtr != null ? litres(t.requiredTankerCapacityLtr) : "No size requirement"}</Field>
        <Field label="Loading point">{t.loadingPoint?.name ?? "—"}</Field>
        <Field label="Tanker">{t.vehicle ? `${t.vehicle.plateNumber} · ${litres(t.vehicle.capacityLiters)}` : <span className="text-warn">Unassigned</span>}</Field>
        <Field label="Driver">{t.driver ? t.driver.name ?? t.driver.driverCode ?? "Driver" : <span className="text-warn">Unassigned</span>}</Field>
      </div>
      {children && <div className="pt-1 flex items-center gap-2">{children}</div>}
    </div>
  );
}

// ── Plan Trip ──────────────────────────────────────────────────────────────
// The browser Plan Trip contract: POST /api/trips { orderIds: [order.id], warehouseId }
// — NO driverId, NO vehicleId. The trip is created PLANNED and unassigned.
function PlanTripForm({ order, loadingPoints, onCancel, onPlanned }: {
  order: QueueOrder; loadingPoints: LoadingPoint[]; onCancel: () => void; onPlanned: (trip: { id: string; tripNumber: string }) => void;
}) {
  const [warehouseId, setWarehouseId] = useState<string>(() => loadingPoints.find((l) => l.isDefault)?.id ?? loadingPoints[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!warehouseId && loadingPoints.length > 0) setWarehouseId(loadingPoints.find((l) => l.isDefault)?.id ?? loadingPoints[0].id);
  }, [loadingPoints, warehouseId]);

  async function planTrip() {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds: [order.id], warehouseId }),
      });
      const data = await readJson(res);
      if (!res.ok || !data?.id) { setError(errorText(data, "Failed to plan trip")); return; }
      onPlanned({ id: data.id, tripNumber: data.tripNumber });
    } catch {
      setError("Network error — the trip was not planned.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-aqua/30 bg-aquaLight/30 p-3 space-y-3">
      <div className="text-xs font-semibold text-ink">Plan trip for {order.orderNumber}</div>
      {loadingPoints.length === 0 ? (
        <p className="text-xs text-danger">No loading points are configured for this company. Add one under Loading Points before planning trips.</p>
      ) : (
        <label className="block">
          <span className="form-label">Loading Point <span className="text-danger">*</span></span>
          <select className="form-select" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
            {loadingPoints.map((lp) => (
              <option key={lp.id} value={lp.id}>{lp.name}{lp.code ? ` · ${lp.code}` : ""}{lp.isDefault ? " (default)" : ""}</option>
            ))}
          </select>
        </label>
      )}
      <p className="text-2xs text-steel">The trip is created as PLANNED without a tanker or driver. A supervisor assigns resources and dispatches it separately.</p>
      {error && <p className="text-xs text-danger">{error}</p>}
      <div className="flex gap-2">
        <button disabled={busy || !warehouseId} onClick={planTrip} className="btn btn-sm btn-primary disabled:opacity-50">
          {busy ? "Planning…" : "Create Planned Trip"}
        </button>
        <button disabled={busy} onClick={onCancel} className="btn btn-sm btn-ghost">Cancel</button>
      </div>
    </div>
  );
}

// ── New Order ──────────────────────────────────────────────────────────────
// Compatibility mapping to the order API (documented in
// SMARTY1-P2-02-REAL-GOLDEN-PATH.md): one bulk-water order = one tanker
// load → qtyOrdered 1. The legacy per-unit fields keep their API defaults
// and are never shown to the operator.
function NewOrderPanel({ onCancel, onCreated }: { onCancel: () => void; onCreated: (order: { id: string; orderNumber: string }) => void }) {
  const [kind, setKind] = useState<OrderKind | "">("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customersError, setCustomersError] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState("");
  const [sites, setSites] = useState<Site[]>([]);
  const [sitesLoading, setSitesLoading] = useState(false);
  const [siteId, setSiteId] = useState("");
  const [contracts, setContracts] = useState<EligibleContract[]>([]);
  const [contractsLoading, setContractsLoading] = useState(false);
  const [contractId, setContractId] = useState("");
  const [capacity, setCapacity] = useState<number | "">("");
  const [fleetCapacities, setFleetCapacities] = useState<FleetCapacity[]>([]);
  const [paymentMethod, setPaymentMethod] = useState("CASH");
  const [requestedTime, setRequestedTime] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/customers").then(async (r) => {
      if (!r.ok) { setCustomersError("Customers could not be loaded."); return; }
      setCustomers((await readJson(r)) ?? []);
    }).catch(() => setCustomersError("Customers could not be loaded."));
    fetch("/api/orders/tanker-capacities").then(async (r) => {
      if (r.ok) setFleetCapacities(((await readJson(r)) ?? {}).capacities ?? []);
    }).catch(() => {});
  }, []);

  const customerOptions = useMemo(
    () => customers.filter((c) => (kind === "B2B_CONTRACT" ? c.type === "B2B" : c.type !== "B2B")).sort((a, b) => a.name.localeCompare(b.name)),
    [customers, kind]
  );
  const customer = customers.find((c) => c.id === customerId) ?? null;
  const contract = contracts.find((c) => c.id === contractId) ?? null;
  const contractCaps = contract?.eligibleTankerCapacities ?? [];

  function chooseKind(k: OrderKind) {
    setKind(k); setCustomerId(""); setSites([]); setSiteId(""); setContracts([]); setContractId(""); setCapacity(""); setError(null);
    setPaymentMethod(k === "B2B_CONTRACT" ? "ACCOUNT_CREDIT" : "CASH");
  }

  async function chooseCustomer(id: string) {
    setCustomerId(id); setSites([]); setSiteId(""); setContracts([]); setContractId(""); setCapacity(""); setError(null);
    if (!id) return;
    setSitesLoading(true);
    try {
      const r = await fetch(`/api/customers/${id}/locations`);
      setSites(r.ok ? ((await readJson(r)) ?? []) : []);
    } finally {
      setSitesLoading(false);
    }
  }

  async function chooseSite(id: string) {
    setSiteId(id); setContracts([]); setContractId(""); setCapacity(""); setError(null);
    if (!id || kind !== "B2B_CONTRACT") return;
    setContractsLoading(true);
    try {
      const params = new URLSearchParams({ customerId, locationId: id });
      const r = await fetch(`/api/contracts/eligible?${params}`);
      const list: EligibleContract[] = r.ok ? ((await readJson(r)) ?? []) : [];
      setContracts(list);
      if (list.length === 1) chooseContract(list[0].id, list);
    } finally {
      setContractsLoading(false);
    }
  }

  function chooseContract(id: string, list: EligibleContract[] = contracts) {
    setContractId(id);
    const caps = list.find((c) => c.id === id)?.eligibleTankerCapacities ?? [];
    setCapacity(caps.length === 1 ? caps[0] : "");
  }

  // Validity of each progressive step:
  const b2bReady = kind === "B2B_CONTRACT" && !!customerId && !!siteId && !!contractId && (contractCaps.length <= 1 || capacity !== "");
  const b2cReady = kind === "B2C_DIRECT" && !!customerId && capacity !== "";
  const ready = (b2bReady || b2cReady) && !busy;

  async function createOrder() {
    setBusy(true); setError(null);
    const body: Record<string, unknown> = { customerId, qtyOrdered: 1, paymentMethod };
    if (siteId) body.locationId = siteId;
    if (requestedTime) body.requestedTime = new Date(requestedTime).toISOString();
    if (kind === "B2B_CONTRACT") {
      body.contractId = contractId;
      // Single-capacity contracts are derived server-side; multi-capacity needs the explicit choice.
      if (contractCaps.length > 1 && capacity !== "") body.selectedTankerCapacityLtr = capacity;
    } else if (capacity !== "") {
      body.selectedTankerCapacityLtr = capacity;
    }
    try {
      const res = await fetch("/api/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await readJson(res);
      if (!res.ok || !data?.id) { setError(errorText(data, "Failed to create order")); return; }
      onCreated({ id: data.id, orderNumber: data.orderNumber });
    } catch {
      setError("Network error — the order was not created.");
    } finally {
      setBusy(false);
    }
  }

  const step = (n: number, title: string, children: React.ReactNode, done = false) => (
    <div className="flex gap-3">
      <div className={`mt-0.5 h-6 w-6 shrink-0 rounded-full text-2xs font-semibold flex items-center justify-center ${done ? "bg-aqua text-white" : "bg-slate-100 text-steel"}`}>{n}</div>
      <div className="flex-1 space-y-1.5">
        <div className="text-xs font-semibold text-ink">{title}</div>
        {children}
      </div>
    </div>
  );

  return (
    <section className="card" aria-label="New Order">
      <div className="card-header">
        <h2 className="text-sm font-semibold text-ink">New Bulk-Water Order</h2>
        <button onClick={onCancel} className="btn btn-sm btn-ghost">Cancel</button>
      </div>
      <div className="card-body grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-5">
          {step(1, "Order type", (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {([
                ["B2B_CONTRACT", "B2B Contract Order", "Company customer · delivered to a site under an active contract"],
                ["B2C_DIRECT", "B2C Direct Order", "Individual customer · no contract, standard direct-order billing"],
              ] as const).map(([k, title, desc]) => (
                <button key={k} type="button" onClick={() => chooseKind(k)}
                  className={`text-left rounded-lg border p-3 transition ${kind === k ? "border-aqua bg-aquaLight/40" : "border-slate-200 hover:border-slate-300"}`}>
                  <div className="text-sm font-semibold text-ink">{title}</div>
                  <div className="text-2xs text-steel mt-0.5">{desc}</div>
                </button>
              ))}
            </div>
          ), !!kind)}

          {kind && step(2, "Customer", (
            <>
              {customersError && <p className="text-xs text-danger">{customersError}</p>}
              <select className="form-select" value={customerId} onChange={(e) => chooseCustomer(e.target.value)}>
                <option value="">Select {kind === "B2B_CONTRACT" ? "company" : "customer"}…</option>
                {customerOptions.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}{c.customerCode ? ` · ${c.customerCode}` : ""}</option>
                ))}
              </select>
              {customerOptions.length === 0 && customers.length > 0 && (
                <p className="text-2xs text-steel">No {kind === "B2B_CONTRACT" ? "B2B" : "B2C"} customers on file.</p>
              )}
            </>
          ), !!customerId)}

          {kind && customerId && step(3, kind === "B2B_CONTRACT" ? "Delivery site" : "Delivery location", (
            sitesLoading ? <p className="text-xs text-steel">Loading sites…</p> : (
              <>
                <select className="form-select" value={siteId} onChange={(e) => chooseSite(e.target.value)}>
                  <option value="">{kind === "B2B_CONTRACT" ? "Select site…" : `Customer address${customer?.address ? ` — ${customer.address}` : ""}`}</option>
                  {sites.map((s) => <option key={s.id} value={s.id}>{s.label}{s.siteCode ? ` · ${s.siteCode}` : ""}</option>)}
                </select>
                {kind === "B2B_CONTRACT" && sites.length === 0 && (
                  <p className="text-xs text-danger">This company has no delivery sites. Add a site under Customers &amp; Sites before ordering.</p>
                )}
              </>
            )
          ), kind === "B2B_CONTRACT" ? !!siteId : true)}

          {kind === "B2B_CONTRACT" && siteId && step(4, "Contract", (
            contractsLoading ? <p className="text-xs text-steel">Checking eligible contracts…</p> : contracts.length === 0 ? (
              <div className="rounded-lg border border-danger/30 bg-dangerLight px-3 py-2 text-xs text-danger">
                No eligible active contract covers this company and site. A B2B order requires an active contract — activate or extend a contract under Contracts, then return here.
              </div>
            ) : (
              <select className="form-select" value={contractId} onChange={(e) => chooseContract(e.target.value)}>
                {contracts.length > 1 && <option value="">Select contract…</option>}
                {contracts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.contractNumber} · {contractLabel(c.type)}{c.type === "ONE_TIME_TRIP_COUNT" ? ` · ${c.tripsUsed ?? 0}/${c.totalTripsPurchased ?? "∞"} trips used` : ""}
                  </option>
                ))}
              </select>
            )
          ), !!contractId)}

          {((kind === "B2B_CONTRACT" && contractId) || (kind === "B2C_DIRECT" && customerId)) && step(kind === "B2B_CONTRACT" ? 5 : 4, "Required tanker capacity", (
            kind === "B2B_CONTRACT" ? (
              contractCaps.length === 0 ? (
                <p className="text-xs text-steel">This contract prices every tanker size the same — no specific capacity is required.</p>
              ) : contractCaps.length === 1 ? (
                <div className="inline-flex items-center gap-2 rounded-lg bg-aquaLight px-3 py-1.5 text-xs font-medium text-aquaDark">
                  Required tanker: {litres(contractCaps[0])} <span className="font-normal">(set by contract)</span>
                </div>
              ) : (
                <>
                  <select className="form-select" value={capacity} onChange={(e) => setCapacity(e.target.value ? Number(e.target.value) : "")}>
                    <option value="">Select tanker size…</option>
                    {contractCaps.map((c) => <option key={c} value={c}>{litres(c)}</option>)}
                  </select>
                  <p className="text-2xs text-steel">Only sizes priced by this contract are offered. Assignment requires an exact-size tanker.</p>
                </>
              )
            ) : fleetCapacities.length === 0 ? (
              <p className="text-xs text-danger">No tankers with a registered capacity exist in this fleet.</p>
            ) : (
              <>
                <select className="form-select" value={capacity} onChange={(e) => setCapacity(e.target.value ? Number(e.target.value) : "")}>
                  <option value="">Select tanker size…</option>
                  {fleetCapacities.map((c) => (
                    <option key={c.capacityLiters} value={c.capacityLiters}>{litres(c.capacityLiters)} · {c.tankers} tanker(s), {c.available} available now</option>
                  ))}
                </select>
                <p className="text-2xs text-steel">Assignment requires a tanker of exactly this size.</p>
              </>
            )
          ), kind === "B2B_CONTRACT" ? contractCaps.length <= 1 || capacity !== "" : capacity !== "")}

          {(b2bReady || b2cReady) && step(kind === "B2B_CONTRACT" ? 6 : 5, "Delivery & billing", (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="form-label">Requested delivery (optional)</span>
                <input type="datetime-local" className="form-input" value={requestedTime} onChange={(e) => setRequestedTime(e.target.value)} />
              </label>
              {kind === "B2C_DIRECT" ? (
                <label className="block">
                  <span className="form-label">Payment method</span>
                  <select className="form-select" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                    <option value="CASH">Cash on delivery</option>
                    <option value="CARD">Card</option>
                    <option value="ONLINE">Online</option>
                  </select>
                </label>
              ) : (
                <div>
                  <span className="form-label">Billing</span>
                  <p className="text-sm text-ink">Billed on account under the selected contract.</p>
                </div>
              )}
            </div>
          ), true)}
        </div>

        {/* Summary */}
        <aside className="rounded-lg border border-slate-200 bg-paper p-4 space-y-3 h-fit">
          <div className="text-2xs uppercase tracking-wide text-steel font-semibold">Order summary</div>
          <Field label="Order type">{kind === "B2B_CONTRACT" ? "B2B Contract Order" : kind === "B2C_DIRECT" ? "B2C Direct Order" : "—"}</Field>
          <Field label="Customer">{customer?.name ?? "—"}</Field>
          <Field label="Site">{sites.find((s) => s.id === siteId)?.label ?? (kind === "B2C_DIRECT" && customerId ? "Customer address" : "—")}</Field>
          {kind === "B2B_CONTRACT" && <Field label="Contract">{contract ? `${contract.contractNumber} · ${contractLabel(contract.type)}` : "—"}</Field>}
          <Field label="Required tanker">
            {capacity !== "" ? litres(capacity) : kind === "B2B_CONTRACT" && contract && contractCaps.length === 0 ? "Any size" : "—"}
          </Field>
          <Field label="Quantity">1 tanker load</Field>
          {error && <p className="text-xs text-danger">{error}</p>}
          <button disabled={!ready} onClick={createOrder} className="btn btn-md btn-primary w-full disabled:opacity-50">
            {busy ? "Creating…" : "Create Order"}
          </button>
        </aside>
      </div>
    </section>
  );
}

// ── Trip detail drawer (Milestone S/W, P2-02 DTO) ──────────────────────────
// Operational trip facts come from the OperationalTripDto; billing status
// and source come from the Control Tower row for the same trip (GET
// /api/control-tower), fetched when the drawer opens — nothing duplicated.
function TripDetailDrawer({ trip, onClose }: { trip: OperationalTripDto; onClose: () => void }) {
  const [ctRow, setCtRow] = useState<any>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/control-tower").then(async (r) => {
      if (!r.ok || cancelled) return;
      const rows = await readJson(r);
      if (!cancelled && Array.isArray(rows)) setCtRow(rows.find((x: any) => x.tripId === trip.id) ?? null);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [trip.id]);
  const order = trip.order;
  const firstStop = trip.stops[0] ?? null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-ink/30" onClick={onClose} />
      <aside className="relative w-full max-w-sm bg-white h-full overflow-auto shadow-xl p-5 space-y-4" aria-label="Trip detail">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-ink">{trip.tripNumber}</h3>
          <button onClick={onClose} className="btn btn-sm btn-ghost">✕</button>
        </div>
        <div className="space-y-2 text-sm">
          <DetailRow label="Trip status" value={<StatusBadge status={trip.status} />} />
          {ctRow && <DetailRow label="Operational status" value={<StatusBadge status={ctRow.operationalStatus} />} />}
          {ctRow && <DetailRow label="Billing status" value={<StatusBadge status={ctRow.billingStatus} />} />}
          <DetailRow label="Order" value={order ? `${order.orderNumber} · ${order.orderType === "B2B_CONTRACT" ? "B2B Contract" : "B2C Direct"}` : "Not available"} />
          <DetailRow label="Customer" value={trip.customer?.name ?? "Not available"} />
          <DetailRow label="Site" value={trip.site?.label ?? trip.deliveryAddress ?? "Not available"} />
          <DetailRow label="Contract" value={order?.contract ? `${order.contract.contractNumber} · ${contractLabel(order.contract.type)}` : "Not on contract"} />
          <DetailRow label="Required capacity" value={trip.requiredTankerCapacityLtr != null ? litres(trip.requiredTankerCapacityLtr) : "No size requirement"} />
          <DetailRow label="Loading point" value={trip.loadingPoint?.name ?? "Not available"} />
          <DetailRow label="Tanker" value={trip.vehicle ? `${trip.vehicle.plateNumber} · ${litres(trip.vehicle.capacityLiters)}` : "Unassigned"} />
          <DetailRow label="Driver" value={trip.driver?.name ?? "Unassigned"} />
          <DetailRow label="Delivery status" value={firstStop ? <StatusBadge status={firstStop.status} /> : "Not available"} />
          {firstStop?.epod && <DetailRow label="Delivered loads" value={firstStop.epod.deliveredQty} />}
          {firstStop?.epod && <DetailRow label="POD receiver" value={firstStop.epod.recipientName ?? "Not captured"} />}
          {order?.status === "FAILED" && <DetailRow label="Failure reason" value={order.failureReason ?? "Not specified"} />}
          {/* Finance cross-link only — Dispatch never approves or rejects expenses. */}
          {trip.vehicle && (
            <DetailRow label="Vehicle expenses" value={<a href={`/admin/expenses?vehicleId=${trip.vehicle.id}`} className="text-aquaDark hover:underline">View in Finance</a>} />
          )}
        </div>
        <div>
          <p className="text-steel text-xs uppercase tracking-wide mb-2">Lifecycle timeline</p>
          <ol className="space-y-2 text-sm">
            {buildTripTimeline(trip, order, firstStop, ctRow).map((ev, i) => (
              <li key={i} className="flex items-start justify-between gap-3 border-b border-slate-50 pb-2">
                <span>{ev.label}</span>
                <span className="text-right text-steel text-xs shrink-0">{ev.at ? new Date(ev.at).toLocaleString() : "(timestamp not available)"}</span>
              </li>
            ))}
          </ol>
        </div>
      </aside>
    </div>
  );
}

// Milestone W, Part 6 — reconstructed lifecycle timeline from persisted
// timestamps only (order/trip/stop/ePOD). Never invents a time.
function buildTripTimeline(trip: OperationalTripDto, order: OperationalTripDto["order"], stop: OperationalTripDto["stops"][number] | null, ctRow: any) {
  const events: { label: string; at: string | null }[] = [];
  if (order?.createdAt) events.push({ label: "Order created", at: order.createdAt });
  if (trip.createdAt) events.push({ label: "Assigned to trip", at: trip.createdAt });
  if (trip.loadingConfirmedAt) events.push({ label: "Loading confirmed", at: trip.loadingConfirmedAt });
  if (trip.dispatchedAt ?? trip.startedAt) events.push({ label: "Dispatched", at: trip.dispatchedAt ?? trip.startedAt });
  if (stop?.arrivedAt) events.push({ label: "Driver arrived on site", at: stop.arrivedAt });
  if (stop?.status === "FAILED" && stop.completedAt) {
    events.push({ label: `Failed — ${order?.failureReason ?? "reason not specified"}`, at: stop.completedAt });
  } else if ((stop?.status === "DELIVERED" || stop?.status === "PARTIALLY_DELIVERED") && stop.epod?.deliveredAt) {
    events.push({ label: stop.status === "PARTIALLY_DELIVERED" ? "Partially delivered (POD captured)" : "Delivered (POD captured)", at: stop.epod.deliveredAt });
  }
  if (ctRow?.billingStatus === "DEFERRED_MONTHLY") events.push({ label: "Billing deferred to monthly consolidation", at: null });
  else if (ctRow?.billingStatus === "INVOICED_PENDING" || ctRow?.billingStatus === "INVOICED_PAID") events.push({ label: "Invoice created", at: null });
  if (trip.completedAt) events.push({ label: "Trip closed", at: trip.completedAt });
  return events;
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-50 pb-2">
      <span className="text-steel">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

// ── Exception Center (BR-11 / Milestone W) ─────────────────────────────────
// Every failed or partially-delivered stop ("Mark Failed" in the driver app)
// lands here until a dispatcher resolves it. Escalating does not close it.
function ExceptionCenter({ exceptions, onChange }: { exceptions: any[]; onChange: () => void }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function post(url: string, body: unknown, id: string) {
    setBusyId(id); setError(null);
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) setError(errorText(await readJson(res), "Action failed"));
    } catch {
      setError("Network error — action not confirmed.");
    } finally {
      setBusyId(null);
    }
  }
  const resolve = async (id: string, action: string) => {
    await post(`/api/exceptions/${id}/resolve`, { action, notes: notes || undefined }, id);
    setExpandedId(null); setNotes(""); onChange();
  };
  const escalate = async (id: string) => { await post(`/api/exceptions/${id}/escalate`, {}, id); onChange(); };

  return (
    <section className="card border-danger/30" aria-label="Exception Center">
      <div className="card-header">
        <h2 className="text-sm font-semibold text-ink flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-danger" />Exception Center <span className="text-steel font-normal">({exceptions.length} open)</span></h2>
        <span className="text-2xs text-steel">Failed deliveries awaiting a dispatcher decision</span>
      </div>
      {error && <p className="px-4 pt-3 text-xs text-danger">{error}</p>}
      <div className="divide-y divide-slate-100">
        {exceptions.map((ex) => (
          <div key={ex.id} className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{ex.order?.customer?.name}</span>
                <span className="text-steel text-xs">{ex.order?.orderNumber}</span>
                <StatusBadge status={ex.type} />
                {ex.escalated && <span className="text-xs text-warn font-medium">Escalated</span>}
              </div>
              <button onClick={() => setExpandedId(expandedId === ex.id ? null : ex.id)} className="text-aquaDark text-xs font-medium">
                {expandedId === ex.id ? "Cancel" : "Act on this"}
              </button>
            </div>
            <p className="text-steel text-xs mt-1">{ex.reason}</p>
            {expandedId === ex.id && (
              <div className="mt-3 pt-3 border-t border-slate-100 space-y-2">
                <input className="form-input text-xs" placeholder="Resolution notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
                <div className="flex flex-wrap gap-2">
                  <button disabled={busyId === ex.id} onClick={() => resolve(ex.id, "RESCHEDULE")} className="btn btn-sm bg-ink text-white disabled:opacity-40">Reschedule</button>
                  <button disabled={busyId === ex.id} onClick={() => resolve(ex.id, "REASSIGN")} className="btn btn-sm bg-ink text-white disabled:opacity-40">Reassign</button>
                  <button disabled={busyId === ex.id} onClick={() => resolve(ex.id, "RETURN")} className="btn btn-sm btn-outline disabled:opacity-40">Return</button>
                  <button disabled={busyId === ex.id} onClick={() => resolve(ex.id, "CANCEL")} className="btn btn-sm btn-outline disabled:opacity-40">Cancel order</button>
                  {!ex.escalated && <button disabled={busyId === ex.id} onClick={() => escalate(ex.id)} className="btn btn-sm btn-ghost text-warn">Escalate</button>}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

// ── SLA Escalations (BR-20 / Milestone AA) ─────────────────────────────────
// SLA escalations — separate from failed deliveries (Exception Center):
// orders taking longer than expected. Acknowledge claims one; Resolve closes it.
function EscalationsPanel({ escalations, onChange }: { escalations: any[]; onChange: () => void }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");

  async function acknowledge(id: string) {
    setBusyId(id);
    await fetch(`/api/escalations/${id}/acknowledge`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => {});
    setBusyId(null);
    onChange();
  }
  async function resolve(id: string) {
    setBusyId(id);
    await fetch(`/api/escalations/${id}/resolve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ notes: notes || undefined }) }).catch(() => {});
    setBusyId(null); setResolvingId(null); setNotes("");
    onChange();
  }

  return (
    <section className="card border-warn/40" aria-label="SLA Escalations">
      <div className="card-header">
        <h3 className="font-medium text-sm flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-warn" />SLA Escalations <span className="text-steel font-normal text-xs">({escalations.length} open)</span></h3>
        <span className="text-2xs text-steel">Orders taking longer than expected — separate from failed deliveries</span>
      </div>
      <div className="divide-y divide-slate-100">
        {escalations.slice().sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "HIGH" ? -1 : 1)).map((esc) => (
          <div key={esc.id} className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`badge ${esc.severity === "HIGH" ? "bg-dangerLight text-danger" : "bg-warnLight text-warn"}`}>{esc.severity}</span>
                <span className="text-sm font-medium">{esc.order?.customer?.name}</span>
                <a href={`/dispatch?orderId=${esc.orderId}`} className="text-aquaDark hover:underline text-xs">{esc.order?.orderNumber}</a>
                {esc.status === "ACKNOWLEDGED" && <span className="text-xs text-aquaDark font-medium">Acknowledged</span>}
              </div>
              <div className="flex gap-3">
                {esc.status === "OPEN" && <button disabled={busyId === esc.id} onClick={() => acknowledge(esc.id)} className="text-aquaDark text-xs font-medium disabled:opacity-40">Acknowledge</button>}
                <button disabled={busyId === esc.id} onClick={() => setResolvingId(resolvingId === esc.id ? null : esc.id)} className="text-steel text-xs font-medium disabled:opacity-40">
                  {resolvingId === esc.id ? "Cancel" : "Resolve"}
                </button>
              </div>
            </div>
            {resolvingId === esc.id && (
              <div className="mt-2 flex gap-2">
                <input className="form-input text-xs flex-1" placeholder="Resolution notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
                <button disabled={busyId === esc.id} onClick={() => resolve(esc.id)} className="btn btn-sm bg-ink text-white disabled:opacity-40">Confirm</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
