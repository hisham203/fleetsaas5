"use client";

import { useEffect, useState, useCallback } from "react";
import TopNav from "@/components/TopNav";
import StatusBadge from "@/components/StatusBadge";
import LiveMap from "@/components/LiveMap";
import { useRequireSession } from "@/lib/useSession";
import { resolveTripMapPosition } from "@/lib/mapPosition";

export default function DispatchPage() {
  const { session, loading: sessionLoading } = useRequireSession(["ADMIN", "DISPATCHER"]);
  const [tenant, setTenant] = useState<any>(null);
  const [orders, setOrders] = useState<any[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [trips, setTrips] = useState<any[]>([]);
  const [focusTripId, setFocusTripId] = useState<string | null>(null);
  const [focusToken, setFocusToken] = useState(0);
  const [resetToken, setResetToken] = useState(0);
  const [resolvingStopId, setResolvingStopId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [driverId, setDriverId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [customers, setCustomers] = useState<any[]>([]);
  const [showNewOrder, setShowNewOrder] = useState(false);
  const [newCustomerId, setNewCustomerId] = useState("");
  const [newQty, setNewQty] = useState(1);
  const [newEmpties, setNewEmpties] = useState(0);
  const [newPayment, setNewPayment] = useState("CASH");
  const [newDiscount, setNewDiscount] = useState(0);
  const [orderError, setOrderError] = useState("");
  const [sla, setSla] = useState<{ orders: any[]; summary: any } | null>(null);
  const [loadingTripId, setLoadingTripId] = useState<string | null>(null);
  const [dispatchingTripId, setDispatchingTripId] = useState<string | null>(null);
  const [completingTripId, setCompletingTripId] = useState<string | null>(null);
  const [exceptions, setExceptions] = useState<any[]>([]);
  const [escalations, setEscalations] = useState<any[]>([]);
  const [inventory, setInventory] = useState<any[]>([]);

  const load = useCallback(async () => {
    if (!session) return;
    const tRes = await fetch("/api/tenant");
    if (!tRes.ok) return;
    const t = await tRes.json();
    setTenant(t);
    const [o, v, d, tr, c, s, wh, ex, esc, inv] = await Promise.all([
      fetch(`/api/orders?tenantId=${t.id}`).then((r) => r.json()),
      fetch(`/api/vehicles?tenantId=${t.id}`).then((r) => r.json()),
      fetch(`/api/drivers?tenantId=${t.id}`).then((r) => r.json()),
      fetch(`/api/trips?tenantId=${t.id}`).then((r) => r.json()),
      fetch(`/api/customers?tenantId=${t.id}`).then((r) => r.json()),
      fetch(`/api/sla?tenantId=${t.id}`).then((r) => r.json()),
      fetch(`/api/warehouses?tenantId=${t.id}`).then((r) => r.json()),
      fetch(`/api/exceptions?status=OPEN`).then((r) => r.json()),
      fetch(`/api/escalations?status=OPEN`).then((r) => r.json()),
      fetch(`/api/inventory?tenantId=${t.id}`).then((r) => (r.ok ? r.json() : [])),
    ]);
    setOrders(o);
    setVehicles(v);
    setDrivers(d);
    setTrips(tr);
    setCustomers(c);
    setWarehouses(wh);
    setWarehouseId((prev) => prev || wh.find((x: any) => x.isDefault)?.id || wh[0]?.id || "");
    setSla(s);
    setExceptions(ex);
    setEscalations(esc);
    setInventory(Array.isArray(inv) ? inv : []);
  }, [session]);

  async function createOrder() {
    setOrderError("");
    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId: tenant.id,
        customerId: newCustomerId,
        qtyOrdered: newQty,
        emptyBottlesToCollect: newEmpties,
        paymentMethod: newPayment,
        discountAmount: newDiscount,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setOrderError(typeof data.error === "string" ? data.error : "Failed to create order");
      return;
    }
    setNewCustomerId("");
    setNewQty(1);
    setNewEmpties(0);
    setNewDiscount(0);
    setShowNewOrder(false);
    load();
  }

  useEffect(() => {
    if (!session) return;
    load();
    const interval = setInterval(load, 4000);
    return () => clearInterval(interval);
  }, [session, load]);

  const pendingOrders = orders.filter((o) => o.status === "PENDING" || o.status === "VALIDATED");
  const availableVehicles = vehicles.filter((v) => v.status === "AVAILABLE");
  const availableDrivers = drivers.filter((d) => d.status === "AVAILABLE");
  const activeTrips = trips.filter((t) => t.status !== "COMPLETED");

  function toggleOrder(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  const selectedLoad = orders.filter((o) => selected.includes(o.id)).reduce((sum, o) => sum + o.qtyOrdered, 0);
  const slaByOrderId = new Map((sla?.orders ?? []).map((o: any) => [o.id, o]));

  async function createTrip() {
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ driverId, vehicleId, warehouseId, orderIds: selected }),
      });
      // G.3 audit finding: res.json() throws if the response body is
      // empty or not valid JSON — previously unhandled here, which meant
      // that exception escaped straight out of this function, skipping
      // setBusy(false) entirely and leaving the button permanently
      // disabled ("stuck") for the rest of the session, regardless of
      // what was selected afterward. The backend route itself is now
      // fixed to always return valid JSON (see app/api/trips/route.ts),
      // but this guards the frontend against any future case too.
      let data: any;
      try {
        data = await res.json();
      } catch {
        setError("Failed to create trip: the server returned an unreadable response.");
        return;
      }
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Failed to create trip");
        return;
      }
      setSelected([]);
      setDriverId("");
      setVehicleId("");
      load();
    } finally {
      setBusy(false);
    }
  }

  async function confirmLoading(tripId: string) {
    setError("");
    setLoadingTripId(tripId);
    try {
      const res = await fetch(`/api/trips/${tripId}/loading`, { method: "PATCH" });
      let data: any;
      try {
        data = await res.json();
      } catch {
        setError("Failed to confirm loading: the server returned an unreadable response.");
        return;
      }
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Failed to confirm loading");
        return;
      }
      load();
    } finally {
      setLoadingTripId(null);
    }
  }

  // Task N audit finding: this previously had no error handling at
  // all — a failed dispatch action gave the dispatcher zero feedback,
  // the button just sat there with no visible change. Now matches the
  // same busy/error pattern as every other action on this page.
  async function dispatchTrip(tripId: string) {
    setError("");
    setDispatchingTripId(tripId);
    try {
      const res = await fetch(`/api/trips/${tripId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "dispatch" }),
      });
      let data: any;
      try {
        data = await res.json();
      } catch {
        setError("Failed to dispatch trip: the server returned an unreadable response.");
        return;
      }
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Failed to dispatch trip");
        return;
      }
      load();
    } finally {
      setDispatchingTripId(null);
    }
  }

  async function completeTrip(tripId: string) {
    setError("");
    setCompletingTripId(tripId);
    try {
      const res = await fetch(`/api/trips/${tripId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "complete" }),
      });
      let data: any;
      try {
        data = await res.json();
      } catch {
        setError("Failed to close trip: the server returned an unreadable response.");
        return;
      }
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Failed to close trip");
        return;
      }
      load();
    } finally {
      setCompletingTripId(null);
    }
  }

  // Resolves a stop directly from the Dispatch console — a fallback path
  // for when a stop needs closing out without going through the driver
  // app's own arrive/deliver flow (e.g. the driver phoned it in). Uses the
  // exact same stop-action endpoint and payload shape the driver app uses
  // (action: "deliver" | "fail") — no new API, no new contract. A "Mark
  // delivered" quick action defaults to the full ordered quantity, since
  // this is a dispatcher override, not the detailed ePOD capture flow.
  //
  // Task N audit finding: this previously had no error handling at all,
  // and resolvingStopId was only ever reset after a successful fetch —
  // a network failure (fetch() itself throwing, not just a non-OK
  // response) would have left the button stuck disabled forever.
  async function resolveStop(tripId: string, stopId: string, order: any, action: "deliver" | "fail") {
    setError("");
    setResolvingStopId(stopId);
    try {
      const body =
        action === "deliver"
          ? { action: "deliver", deliveredQty: order.qtyOrdered, emptiesCollected: order.emptyBottlesToCollect ?? 0, recipientName: "Dispatcher-confirmed" }
          : { action: "fail", failureReason: "Marked failed from Dispatch console" };
      const res = await fetch(`/api/trips/${tripId}/stops/${stopId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      let data: any;
      try {
        data = await res.json();
      } catch {
        setError("Failed to update stop: the server returned an unreadable response.");
        return;
      }
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Failed to update stop");
        return;
      }
      load();
    } finally {
      setResolvingStopId(null);
    }
  }

  if (sessionLoading || !session || !tenant) return <main className="min-h-screen bg-paper"><TopNav role="Dispatcher" /><p className="p-6 text-steel">Loading…</p></main>;

  return (
    <main className="min-h-screen bg-paper">
      <TopNav role={`Dispatcher — ${tenant.name}`} />

      {sla && (sla.summary.breached > 0 || sla.summary.atRisk > 0) && (
        <div className="bg-white border-b border-slate-200 px-6 py-2 flex items-center gap-4 text-sm">
          <span className="text-steel font-medium">SLA:</span>
          {sla.summary.breached > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-danger" />
              {sla.summary.breached} breached
            </span>
          )}
          {sla.summary.atRisk > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-warn" />
              {sla.summary.atRisk} at risk
            </span>
          )}
          <span className="text-steel">{sla.summary.onTrack} on track</span>
        </div>
      )}

      {escalations.length > 0 && (
        <div className="px-6 pt-6">
          <EscalationsPanel escalations={escalations} onChange={load} />
        </div>
      )}

      {exceptions.length > 0 && (
        <div className="px-6 pt-6">
          <ExceptionCenter exceptions={exceptions} onChange={load} />
        </div>
      )}

      <div className="px-6 pt-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-medium">Live Dispatch Map</h3>
          <button onClick={() => setResetToken((x) => x + 1)} className="text-xs text-steel hover:text-ink font-medium">
            Reset map
          </button>
        </div>
        <LiveMap
          trips={trips
            .filter((t) => t.status === "DISPATCHED" || t.status === "IN_PROGRESS")
            .map((t) => {
              const firstStop = [...t.stops].sort((a: any, b: any) => a.sequence - b.sequence)[0];
              return {
                ...t,
                fallbackLat: firstStop?.order?.lat ?? null,
                fallbackLng: firstStop?.order?.lng ?? null,
                // Neutral "destination" (not "customer site") — see
                // Task N.1's multi-stop-future-readiness note in
                // LiveMap.tsx itself. Falls back to the raw delivery
                // address if the customer name is somehow unavailable,
                // rather than showing nothing.
                destinationLabel: firstStop?.order?.customer?.name ?? firstStop?.order?.deliveryAddress ?? null,
                loadingPointLabel: t.warehouse?.name ?? null,
              };
            })}
          focusTripId={focusTripId}
          focusToken={focusToken}
          resetToken={resetToken}
        />
      </div>

      <div className="p-6 grid lg:grid-cols-3 gap-6">
        {/* Order queue */}
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-medium">Dispatch queue</h3>
            <button onClick={() => setShowNewOrder((s) => !s)} className="text-xs text-aquaDark font-medium">
              {showNewOrder ? "Cancel" : "+ New order"}
            </button>
          </div>
          <p className="text-steel text-xs mb-3">{pendingOrders.length} order(s) waiting for assignment</p>

          {showNewOrder && (
            <div className="border border-slate-200 rounded-lg p-3 mb-3 space-y-2">
              <select className="w-full border rounded-lg px-2 py-1.5 text-xs" value={newCustomerId} onChange={(e) => setNewCustomerId(e.target.value)}>
                <option value="">Select customer…</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.name} ({c.type})</option>
                ))}
              </select>
              <div className="flex gap-2">
                <input type="number" min={1} className="w-1/2 border rounded-lg px-2 py-1.5 text-xs" placeholder="Quantity" value={newQty} onChange={(e) => setNewQty(Number(e.target.value))} />
                <input type="number" min={0} className="w-1/2 border rounded-lg px-2 py-1.5 text-xs" placeholder="Empties to collect" value={newEmpties} onChange={(e) => setNewEmpties(Number(e.target.value))} />
              </div>
              <select className="w-full border rounded-lg px-2 py-1.5 text-xs" value={newPayment} onChange={(e) => setNewPayment(e.target.value)}>
                <option value="CASH">Cash</option>
                <option value="CARD">Card</option>
                <option value="ONLINE">Online</option>
                <option value="ACCOUNT_CREDIT">Account credit (B2B)</option>
              </select>
              <input type="number" min={0} className="w-full border rounded-lg px-2 py-1.5 text-xs" placeholder="Discount (SAR, optional)" value={newDiscount || ""} onChange={(e) => setNewDiscount(Number(e.target.value) || 0)} />
              {orderError && <p className="text-danger text-xs">{orderError}</p>}
              <button disabled={!newCustomerId} onClick={createOrder} className="w-full bg-aquaDark text-white rounded-lg py-1.5 text-xs font-medium disabled:opacity-40">
                Create order
              </button>
            </div>
          )}

          <div className="space-y-2 max-h-[420px] overflow-auto">
            {pendingOrders.map((o) => (
              <label
                key={o.id}
                className={`flex items-start gap-2 p-2 rounded-lg border cursor-pointer text-sm ${
                  selected.includes(o.id) ? "border-aqua bg-aqua/5" : "border-slate-100"
                }`}
              >
                <input type="checkbox" className="mt-1" checked={selected.includes(o.id)} onChange={() => toggleOrder(o.id)} />
                <div className="flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium">{o.customer.name}</div>
                    {slaByOrderId.get(o.id) && <StatusBadge status={slaByOrderId.get(o.id).slaStatus} />}
                  </div>
                  <div className="text-steel text-xs">{o.orderNumber} · {o.qtyOrdered} unit(s){o.emptyBottlesToCollect ? ` · ${o.emptyBottlesToCollect} empties` : ""}</div>
                  <div className="text-steel text-xs">{o.deliveryAddress}</div>
                </div>
              </label>
            ))}
            {pendingOrders.length === 0 && <p className="text-steel text-sm">Queue is clear.</p>}
          </div>
        </div>

        {/* Trip planner */}
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h3 className="font-medium mb-3">Plan trip</h3>
          <p className="text-steel text-xs mb-2">{selected.length} order(s) selected · {selectedLoad} load(s) total</p>
          {selected.length > 0 && (
            <div className="mb-3 space-y-1.5 max-h-32 overflow-auto">
              {orders.filter((o) => selected.includes(o.id)).map((o) => (
                <div key={o.id} className="border border-slate-100 rounded-lg px-2 py-1.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{o.customer.name}</span>
                    <StatusBadge status={o.status} />
                  </div>
                  <p className="text-steel">
                    {o.location?.label ?? o.deliveryAddress}
                    {o.contract ? ` · Contract ${o.contract.contractNumber}` : ""}
                  </p>
                </div>
              ))}
            </div>
          )}
          <div className="space-y-2">
            <select className="w-full border rounded-lg px-3 py-2 text-sm" value={driverId} onChange={(e) => setDriverId(e.target.value)}>
              <option value="">Select driver…</option>
              {availableDrivers.map((d) => (
                <option key={d.id} value={d.id}>{d.user.name}</option>
              ))}
            </select>
            <select
              className="w-full border rounded-lg px-3 py-2 text-sm"
              value={vehicleId}
              onChange={(e) => {
                setVehicleId(e.target.value);
                const chosenVehicle = availableVehicles.find((v) => v.id === e.target.value);
                if (chosenVehicle?.homeWarehouseId) setWarehouseId(chosenVehicle.homeWarehouseId);
              }}
            >
              <option value="">Select vehicle…</option>
              {availableVehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.plateNumber} ({v.capacityLiters ? `${v.capacityLiters.toLocaleString()} L` : v.capacityUnits ? `${v.capacityUnits} units` : "capacity unknown"})
                </option>
              ))}
            </select>
            <select className="w-full border rounded-lg px-3 py-2 text-sm" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              <option value="">Loading point / warehouse…</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
            {warehouseId && !inventory.some((i) => i.warehouseId === warehouseId) && (
              <p className="text-steel text-xs">No tracked inventory. Loading confirmation will not require stock deduction.</p>
            )}
            {error && <p className="text-danger text-xs">{error}</p>}
            <button
              disabled={selected.length === 0 || !driverId || !vehicleId || !warehouseId || busy}
              onClick={createTrip}
              className="w-full bg-aquaDark text-white rounded-lg py-2 text-sm font-medium disabled:opacity-40"
            >
              Create &amp; assign trip
            </button>
          </div>

          <div className="mt-4 text-xs text-steel">
            Available: {availableDrivers.length} driver(s), {availableVehicles.length} vehicle(s)
          </div>
        </div>

        {/* Live trips */}
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h3 className="font-medium mb-3">Live trips</h3>
          {error && <p className="text-danger text-xs mb-2">{error}</p>}
          <div className="space-y-3 max-h-[500px] overflow-auto">
            {activeTrips.map((t) => {
              // Matches the server's own definition exactly (see the
              // "complete" action in app/api/trips/[id]/route.ts) — a stop
              // is unresolved while PENDING or ARRIVED. Keeping this in
              // sync means the button's enabled/disabled state never
              // promises something the server will actually reject, or
              // blocks something the server would actually allow.
              const unresolvedStops = t.stops.filter((s: any) => s.status === "PENDING" || s.status === "ARRIVED");
              const canResolveFromDispatch = t.status === "DISPATCHED" || t.status === "IN_PROGRESS";

              return (
                <div key={t.id} className="border border-slate-100 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-mono text-xs">{t.tripNumber}</span>
                    <StatusBadge status={t.status} />
                  </div>
                  <p className="text-sm">{t.driver.user.name} · {t.vehicle.plateNumber}</p>
                  <p className="text-steel text-xs mb-2">
                    {t.stops.length} stop(s)
                    {t.status === "PLANNED" && (t.loadingConfirmed ? " · Loaded" : " · Awaiting loading")}
                  </p>
                  <ul className="text-xs text-steel space-y-1.5 mb-2">
                    {t.stops.map((s: any) => (
                      <li key={s.id} className="border-b border-slate-50 pb-1.5 last:border-0 last:pb-0">
                        <div className="flex justify-between items-center">
                          <span>{s.sequence}. {s.order.customer?.name ?? s.orderId}</span>
                          <StatusBadge status={s.status} />
                        </div>
                        {canResolveFromDispatch && (s.status === "PENDING" || s.status === "ARRIVED") && (
                          <div className="flex gap-1.5 mt-1">
                            <button
                              onClick={() => resolveStop(t.id, s.id, s.order, "deliver")}
                              disabled={resolvingStopId === s.id}
                              className="flex-1 bg-ok text-white rounded px-2 py-1 text-[11px] font-medium disabled:opacity-40"
                            >
                              {resolvingStopId === s.id ? "…" : "Mark delivered"}
                            </button>
                            <button
                              onClick={() => resolveStop(t.id, s.id, s.order, "fail")}
                              disabled={resolvingStopId === s.id}
                              className="flex-1 border border-slate-200 text-danger rounded px-2 py-1 text-[11px] font-medium disabled:opacity-40"
                            >
                              {resolvingStopId === s.id ? "…" : "Mark failed"}
                            </button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                  {(t.status === "DISPATCHED" || t.status === "IN_PROGRESS") && (() => {
                    const firstStop = [...t.stops].sort((a: any, b: any) => a.sequence - b.sequence)[0];
                    const position = resolveTripMapPosition(t.currentLat, t.currentLng, firstStop?.order?.lat, firstStop?.order?.lng);
                    if (!position) {
                      return <p className="text-warn text-xs mb-2">Live vehicle location unavailable — destination coordinates unavailable too.</p>;
                    }
                    return (
                      <button
                        onClick={() => {
                          setFocusTripId(t.id);
                          setFocusToken((x) => x + 1);
                        }}
                        className="w-full border border-slate-200 rounded-lg py-1.5 text-xs font-medium text-aquaDark mb-2"
                      >
                        {position.isLive ? "View on map" : "View destination on map (no GPS yet)"}
                      </button>
                    );
                  })()}
                  {t.status === "PLANNED" && !t.loadingConfirmed && (
                    <button
                      onClick={() => confirmLoading(t.id)}
                      disabled={loadingTripId === t.id}
                      className="w-full bg-warn text-white rounded-lg py-1.5 text-xs font-medium disabled:opacity-40"
                    >
                      {loadingTripId === t.id ? "Confirming…" : "Confirm loading"}
                    </button>
                  )}
                  {t.status === "PLANNED" && t.loadingConfirmed && (
                    <button
                      onClick={() => dispatchTrip(t.id)}
                      disabled={dispatchingTripId === t.id}
                      className="w-full bg-ink text-white rounded-lg py-1.5 text-xs font-medium disabled:opacity-40"
                    >
                      {dispatchingTripId === t.id ? "Dispatching…" : "Dispatch trip"}
                    </button>
                  )}
                  {t.status === "DISPATCHED" && (
                    <>
                      <button
                        onClick={() => completeTrip(t.id)}
                        disabled={unresolvedStops.length > 0 || completingTripId === t.id}
                        className="w-full bg-ok text-white rounded-lg py-1.5 text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {completingTripId === t.id ? "Closing…" : "Close trip"}
                      </button>
                      {unresolvedStops.length > 0 && (
                        <p className="text-steel text-xs mt-1 text-center">Resolve all pending stops before closing this trip.</p>
                      )}
                    </>
                  )}
                </div>
              );
            })}
            {activeTrips.length === 0 && <p className="text-steel text-sm">No active trips.</p>}
          </div>
        </div>
      </div>
    </main>
  );
}

// BR-11 / APP-02 Exception Center — every failed or partially-delivered
// stop lands here until a dispatcher resolves it via one of the four
// closing actions. Escalating is separate and doesn't close the case.
function ExceptionCenter({ exceptions, onChange }: any) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");

  async function resolve(id: string, action: string) {
    setBusyId(id);
    await fetch(`/api/exceptions/${id}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, notes: notes || undefined }),
    });
    setBusyId(null);
    setExpandedId(null);
    setNotes("");
    onChange();
  }

  async function escalate(id: string) {
    setBusyId(id);
    await fetch(`/api/exceptions/${id}/escalate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    setBusyId(null);
    onChange();
  }

  return (
    <div className="bg-white rounded-xl border border-danger/30 p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-2 h-2 rounded-full bg-danger" />
        <h3 className="font-medium">Exception Center</h3>
        <span className="text-steel text-xs">({exceptions.length} open)</span>
      </div>
      <div className="space-y-2">
        {exceptions.map((ex: any) => (
          <div key={ex.id} className="border border-slate-100 rounded-lg p-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm font-medium">{ex.order.customer?.name}</span>
                <span className="text-steel text-xs ml-2">{ex.order.orderNumber}</span>
                <StatusBadge status={ex.type} />
                {ex.escalated && <span className="ml-2 text-xs text-warn font-medium">Escalated</span>}
              </div>
              <button
                onClick={() => setExpandedId(expandedId === ex.id ? null : ex.id)}
                className="text-aquaDark text-xs font-medium"
              >
                {expandedId === ex.id ? "Cancel" : "Act on this"}
              </button>
            </div>
            <p className="text-steel text-xs mt-1">{ex.reason}</p>

            {expandedId === ex.id && (
              <div className="mt-3 pt-3 border-t border-slate-100 space-y-2">
                <input
                  className="w-full border rounded-lg px-3 py-1.5 text-xs"
                  placeholder="Resolution notes (optional)"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
                <div className="flex flex-wrap gap-2">
                  <button disabled={busyId === ex.id} onClick={() => resolve(ex.id, "RESCHEDULE")} className="bg-ink text-white rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-40">
                    Reschedule
                  </button>
                  <button disabled={busyId === ex.id} onClick={() => resolve(ex.id, "REASSIGN")} className="bg-ink text-white rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-40">
                    Reassign
                  </button>
                  <button disabled={busyId === ex.id} onClick={() => resolve(ex.id, "RETURN")} className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-40">
                    Return
                  </button>
                  <button disabled={busyId === ex.id} onClick={() => resolve(ex.id, "CANCEL")} className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-40">
                    Cancel order
                  </button>
                  {!ex.escalated && (
                    <button disabled={busyId === ex.id} onClick={() => escalate(ex.id)} className="text-warn text-xs font-medium px-2">
                      Escalate
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// BR-20 Escalation Center — orders that have crossed into AT_RISK (MEDIUM)
// or BREACHED (HIGH) automatically show up here (see lib/escalations.ts).
// Acknowledge lets a dispatcher claim it without closing the case; Resolve
// closes it once the underlying situation is actually handled (often via
// the Exception Center below, if the delivery itself needs to be
// rescheduled/reassigned).
function EscalationsPanel({ escalations, onChange }: any) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");

  async function acknowledge(id: string) {
    setBusyId(id);
    await fetch(`/api/escalations/${id}/acknowledge`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    setBusyId(null);
    onChange();
  }

  async function resolve(id: string) {
    setBusyId(id);
    await fetch(`/api/escalations/${id}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: notes || undefined }),
    });
    setBusyId(null);
    setResolvingId(null);
    setNotes("");
    onChange();
  }

  return (
    <div className="bg-white rounded-xl border border-warn/40 p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-2 h-2 rounded-full bg-warn" />
        <h3 className="font-medium">Escalations</h3>
        <span className="text-steel text-xs">({escalations.length} open)</span>
      </div>
      <div className="space-y-2">
        {escalations
          .slice()
          .sort((a: any, b: any) => (a.severity === b.severity ? 0 : a.severity === "HIGH" ? -1 : 1))
          .map((esc: any) => (
            <div key={esc.id} className="border border-slate-100 rounded-lg p-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full mr-2 ${esc.severity === "HIGH" ? "bg-danger/15 text-danger" : "bg-warn/15 text-warn"}`}>
                    {esc.severity}
                  </span>
                  <span className="text-sm font-medium">{esc.order?.customer?.name}</span>
                  <span className="text-steel text-xs ml-2">{esc.order?.orderNumber}</span>
                  {esc.status === "ACKNOWLEDGED" && <span className="ml-2 text-xs text-aquaDark font-medium">Acknowledged</span>}
                </div>
                <div className="flex gap-2">
                  {esc.status === "OPEN" && (
                    <button disabled={busyId === esc.id} onClick={() => acknowledge(esc.id)} className="text-aquaDark text-xs font-medium disabled:opacity-40">
                      Acknowledge
                    </button>
                  )}
                  <button
                    disabled={busyId === esc.id}
                    onClick={() => setResolvingId(resolvingId === esc.id ? null : esc.id)}
                    className="text-steel text-xs font-medium disabled:opacity-40"
                  >
                    {resolvingId === esc.id ? "Cancel" : "Resolve"}
                  </button>
                </div>
              </div>

              {resolvingId === esc.id && (
                <div className="mt-2 flex gap-2">
                  <input
                    className="flex-1 border rounded-lg px-3 py-1.5 text-xs"
                    placeholder="Resolution notes (optional)"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                  <button disabled={busyId === esc.id} onClick={() => resolve(esc.id)} className="bg-ink text-white rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-40">
                    Confirm
                  </button>
                </div>
              )}
            </div>
          ))}
      </div>
    </div>
  );
}
