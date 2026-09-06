"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import TopNav from "@/components/TopNav";
import StatusBadge from "@/components/StatusBadge";
import LiveMap from "@/components/LiveMap";
import { useRequireSession } from "@/lib/useSession";
import { resolveTripMapPosition } from "@/lib/mapPosition";

// Milestone S: useSearchParams() requires a Suspense boundary, per
// Next.js's own build requirement (the same fix Milestone R already
// applied to app/admin/page.tsx for the same reason).
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
  // Milestone S — Part 3/5: preserves the exact trip/order a user clicked
  // in the Dispatch Control Tower, rather than opening this screen
  // generically. Read once on mount; deliberately not re-read on every
  // searchParams change, since this is a one-time "arrived from a deep
  // link" action, not a persistent filter.
  const deepLinkTripId = searchParams.get("tripId");
  const deepLinkOrderId = searchParams.get("orderId");
  const [deepLinkNotice, setDeepLinkNotice] = useState<string | null>(null);
  const [detailTripId, setDetailTripId] = useState<string | null>(null);
  const [controlTowerRows, setControlTowerRows] = useState<any[]>([]);
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
    const [o, v, d, tr, c, s, wh, ex, esc, inv, ct] = await Promise.all([
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
      fetch(`/api/control-tower`).then((r) => (r.ok ? r.json() : [])),
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
    setControlTowerRows(Array.isArray(ct) ? ct : []);
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

  // Milestone S — Part 3/5: resolves a ?tripId= or ?orderId= deep link
  // from the Dispatch Control Tower into real selection state, exactly
  // once, as soon as the data needed to resolve it has loaded. Never
  // re-runs on the periodic 4s poll — this is a one-time "arrived via
  // deep link" action, not a persistent filter that should keep
  // re-triggering. If neither ID matches anything real (e.g. the trip
  // was completed and rolled off the active list, or the order was since
  // assigned), a clear notice is shown instead of a silent no-op.
  const [deepLinkResolved, setDeepLinkResolved] = useState(false);
  useEffect(() => {
    if (deepLinkResolved) return;
    if (!deepLinkTripId && !deepLinkOrderId) {
      setDeepLinkResolved(true);
      return;
    }
    if (trips.length === 0 && orders.length === 0) return; // wait for first load
    if (deepLinkTripId) {
      const match = trips.find((t) => t.id === deepLinkTripId);
      if (match) {
        setFocusTripId(match.id);
        setFocusToken((x) => x + 1);
        setDetailTripId(match.id);
      } else {
        setDeepLinkNotice(`Trip ${deepLinkTripId} was not found — it may have been completed or is no longer active.`);
      }
    } else if (deepLinkOrderId) {
      const match = orders.find((o) => o.id === deepLinkOrderId);
      if (match) {
        // Milestone T root-cause fix: trip existence is checked FIRST,
        // exactly matching lib/controlTowerStatus.ts's own ground truth
        // — the previous version branched on order.status first, which
        // is exactly how Control Tower and Dispatch ended up
        // disagreeing about the same order (Control Tower said NEW,
        // Dispatch said "marked as assigned" for an order that was
        // actually DELIVERED with no trip record at all — a real,
        // confirmed seed-data scenario, not hypothetical). GET
        // /api/orders embeds tripStop.trip precisely so this lookup is
        // possible without a second API call; the full trip object
        // (with vehicle/driver/warehouse/stops embeds the detail
        // drawer needs) is looked up from the separately-loaded `trips`
        // array, which includes every status.
        const linkedTripId = match.tripStop?.trip?.id;
        const linkedTrip = linkedTripId ? trips.find((t) => t.id === linkedTripId) : null;
        if (linkedTrip) {
          setFocusTripId(linkedTrip.id);
          setFocusToken((x) => x + 1);
          setDetailTripId(linkedTrip.id);
          if (linkedTrip.status === "PLANNED" && !linkedTrip.loadingConfirmed) {
            setDeepLinkNotice(`Order ${match.orderNumber} is assigned and waiting for loading confirmation.`);
          } else if (linkedTrip.status === "PLANNED" && linkedTrip.loadingConfirmed) {
            setDeepLinkNotice(`Order ${match.orderNumber} is loaded and ready to dispatch. Shown below under Live Trips.`);
          } else if (linkedTrip.status === "DISPATCHED") {
            setDeepLinkNotice(`Order ${match.orderNumber} is active and shown under Live Trips.`);
          } else if (linkedTrip.status === "COMPLETED") {
            setDeepLinkNotice(`Order ${match.orderNumber} is already completed. Showing readonly trip details.`);
          } else {
            setDeepLinkNotice(`Order ${match.orderNumber} is already assigned. It is shown below under Live Trips.`);
          }
        } else if (match.status === "PENDING" || match.status === "VALIDATED" || match.status === "QUEUED") {
          // No trip, and the order's own status agrees it's genuinely
          // new/unassigned demand — select it for planning, exactly as
          // Control Tower's NEW/READY_FOR_PLANNING buckets show it.
          setSelected([match.id]);
        } else if (match.status === "DELIVERED" || match.status === "PARTIALLY_DELIVERED") {
          // Genuinely completed, just never trip-tracked (the confirmed
          // seed pattern above) — readonly, not an error, and not
          // "assigned" either.
          setDeepLinkNotice(`Order ${match.orderNumber} is already completed. No trip record is linked for it (this can happen for deliveries recorded without full dispatch tracking).`);
        } else {
          // A genuine data anomaly (the order says assigned but no
          // matching trip is in the currently loaded set) — never
          // silently hidden behind the old generic message.
          setDeepLinkNotice(`Order ${match.orderNumber} is marked as ${match.status.toLowerCase()}, but its trip record could not be found — this may require admin review.`);
        }
      } else {
        setDeepLinkNotice(`Order ${deepLinkOrderId} was not found.`);
      }
    }
    setDeepLinkResolved(true);
  }, [deepLinkResolved, deepLinkTripId, deepLinkOrderId, trips, orders]);

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
      <TopNav
        role={`Dispatcher — ${tenant.name}`}
        extra={<a href="/admin/dispatch" className="text-steel hover:text-white text-sm">← Control Tower</a>}
      />

      {deepLinkNotice && (
        <div className="bg-warn/10 border-b border-warn/30 px-6 py-2 text-sm text-warn flex items-center justify-between">
          <span>{deepLinkNotice}</span>
          <button onClick={() => setDeepLinkNotice(null)} className="text-warn hover:text-ink text-xs">Dismiss</button>
        </div>
      )}

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
                <div
                  key={t.id}
                  className={`border rounded-lg p-3 ${detailTripId === t.id ? "border-aquaDark ring-2 ring-aqua/30" : "border-slate-100"}`}
                >
                  <button onClick={() => setDetailTripId(detailTripId === t.id ? null : t.id)} className="w-full text-left">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono text-xs">{t.tripNumber}</span>
                      <StatusBadge status={t.status} />
                    </div>
                  </button>
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

      {/* Milestone S, Part 4 Priority 1 — trip/order detail drawer. Reuses
          the same GET /api/control-tower data the Control Tower itself
          renders from (fetched once, above, alongside everything else)
          for the fields raw trip data doesn't carry — source, billing
          status, and contract — rather than duplicating that computation
          or adding a new endpoint. */}
      {detailTripId && (() => {
        const trip = trips.find((t) => t.id === detailTripId);
        if (!trip) return null;
        const ctRow = controlTowerRows.find((r) => r.tripId === detailTripId);
        const firstStop = [...trip.stops].sort((a: any, b: any) => a.sequence - b.sequence)[0];
        const order = firstStop?.order;
        return (
          <div className="fixed inset-0 z-40 flex justify-end">
            <div className="absolute inset-0 bg-ink/30" onClick={() => setDetailTripId(null)} />
            <aside className="relative w-full max-w-sm bg-white h-full overflow-auto shadow-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-medium">{trip.tripNumber}</h3>
                <button onClick={() => setDetailTripId(null)} className="text-steel hover:text-ink text-sm">✕</button>
              </div>
              <div className="space-y-2 text-sm">
                <DetailRow label="Trip status" value={<StatusBadge status={trip.status} />} />
                {ctRow && <DetailRow label="Operational status" value={<StatusBadge status={ctRow.operationalStatus} />} />}
                {ctRow && <DetailRow label="Billing status" value={<StatusBadge status={ctRow.billingStatus} />} />}
                {ctRow && <DetailRow label="Source" value={<StatusBadge status={ctRow.source} />} />}
                <DetailRow label="Customer" value={order?.customer?.name ?? "Not available"} />
                <DetailRow label="Site" value={ctRow?.site?.label ?? order?.deliveryAddress ?? "Not available"} />
                <DetailRow label="Contract" value={ctRow?.contract?.contractNumber ?? "Not on contract"} />
                {ctRow?.contract && <DetailRow label="Contract type" value={ctRow.contract.type.replace(/_/g, " ")} />}
                <DetailRow label="Vehicle" value={trip.vehicle?.plateNumber ?? "Not available"} />
                <DetailRow label="Tanker capacity" value={trip.vehicle?.capacityLiters ? `${trip.vehicle.capacityLiters.toLocaleString()} L` : "Not available"} />
                <DetailRow label="Driver" value={trip.driver?.user?.name ?? "Not available"} />
                <DetailRow label="Loading point" value={trip.warehouse?.name ?? "Not available"} />
                <DetailRow label="Order quantity" value={order?.qtyOrdered ?? "Not available"} />
                <DetailRow label="Loading status" value={trip.loadingConfirmed ? "Confirmed" : "Awaiting loading"} />
                <DetailRow label="Delivery status" value={firstStop?.status ?? "Not available"} />
                {firstStop?.epod && <DetailRow label="Delivered qty" value={firstStop.epod.deliveredQty} />}
                {firstStop?.epod && <DetailRow label="POD receiver" value={firstStop.epod.recipientName ?? "Not captured"} />}
                {trip.vehicle?.id && (
                  <DetailRow
                    label="Vehicle expenses"
                    value={<a href={`/admin/expenses?vehicleId=${trip.vehicle.id}`} className="text-aquaDark hover:underline">View in Finance</a>}
                  />
                )}
                {order?.status === "FAILED" && <DetailRow label="Failure reason" value={order.failureReason ?? "Not specified"} />}
              </div>

              {/* Milestone W, Part 6 — reconstructed lifecycle timeline.
                  Built entirely from timestamps this system already
                  persists (order.createdAt, trip.startedAt/completedAt,
                  stop.arrivedAt/completedAt, epod.deliveredAt,
                  invoice.createdAt) — no new event-log table. Each
                  event that genuinely happened is shown with its real
                  timestamp; nothing here is invented or backfilled for
                  an event that didn't leave a timestamp behind. */}
              <div>
                <p className="text-steel text-xs uppercase tracking-wide mb-2">Lifecycle timeline</p>
                <ol className="space-y-2 text-sm">
                  {buildTripTimeline(trip, order, firstStop, ctRow).map((ev, i) => (
                    <li key={i} className="flex items-start justify-between gap-3 border-b border-slate-50 pb-2">
                      <span>{ev.label}</span>
                      <span className="text-right text-steel text-xs shrink-0">
                        {ev.at ? new Date(ev.at).toLocaleString() : "(timestamp not available)"}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            </aside>
          </div>
        );
      })()}
    </main>
  );
}

// Milestone W, Part 6 — reconstructs a trip's lifecycle from existing
// persisted timestamps only. Every entry here corresponds to a real,
// stored timestamp on order/trip/stop/epod/invoice — this function
// never invents a time for an event that wasn't actually recorded.
// Events with no real timestamp today (loading confirmed at the exact
// moment, invoice/billing-deferred distinction) are covered by the
// closest real field available, noted inline. A true trip_lifecycle_events
// table (this milestone's own schema proposal) would let a future
// version show driver-app-open/POD-capture-attempt-level granularity
// this reconstruction cannot.
function buildTripTimeline(trip: any, order: any, stop: any, ctRow: any) {
  const events: { label: string; at: string | null }[] = [];
  if (order?.createdAt) events.push({ label: "Order created", at: order.createdAt });
  if (trip?.createdAt) events.push({ label: "Assigned to trip", at: trip.createdAt });
  if (trip?.loadingConfirmedAt) events.push({ label: "Loading confirmed", at: trip.loadingConfirmedAt });
  if (trip?.startedAt) events.push({ label: "Dispatched", at: trip.startedAt });
  if (stop?.arrivedAt) events.push({ label: "Driver arrived on site", at: stop.arrivedAt });
  if (stop?.status === "FAILED" && stop?.completedAt) {
    events.push({ label: `Failed — ${order?.failureReason ?? "reason not specified"}`, at: stop.completedAt });
  } else if ((stop?.status === "DELIVERED" || stop?.status === "PARTIALLY_DELIVERED") && stop?.epod?.deliveredAt) {
    events.push({ label: stop.status === "PARTIALLY_DELIVERED" ? "Partially delivered (POD captured)" : "Delivered (POD captured)", at: stop.epod.deliveredAt });
  }
  if (ctRow?.billingStatus === "DEFERRED_MONTHLY") {
    events.push({ label: "Billing deferred to monthly consolidation", at: null });
  } else if (ctRow?.billingStatus === "INVOICED_PENDING" || ctRow?.billingStatus === "INVOICED_PAID") {
    events.push({ label: "Invoice created", at: null });
  }
  if (trip?.completedAt) events.push({ label: "Trip closed", at: trip.completedAt });
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
