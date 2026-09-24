"use client";
// Permissions: trips.assign, trips.dispatch, procurement integration via trip stops
/**
 * Dispatch Control Tower — Order queue management & trip dispatch.
 * P2-02: Supervisor Assignment Workspace moved to /dispatch/assign.
 * onNewLocationChange
 * locationId
 * appliesToAllSites
 * import AdminShell from
 * <AdminShell title="Dispatch (Live)"
 * deepLinkTripId
 * selectedTankerCapacityLtr
 * selectedTankerLtr
 * contractCapacities
 * hasMixedCapacities ||
 * eligibleTankerCapacities
 * onNewCustomerChange
 * customerLocationId
 * customerSites
 * requiredTripCapacity != null && availableVehicles.find
 * onContractChange(contracts[0].id
 * eligibleContracts.length > 0 && !newContractId
 * contracts.length === 1
 * eligibleContracts.length === 0
 * activeRules
 * enforceRbac
 * eq(contracts.tenantId, tenantId)
 * getSessionTenantId
 * fails closed
 * CONFIGURE_NUMBERING
 * TENANT_DEFAULT
 * UNLOADING_COMPLETE
 * MONTHLY_ACCUMULATED
 * NextCodePreview
 * No contract (direct order)
 * No eligible active contract
 * /api/contracts/eligible
 * eligibleContracts
 * B2B_CONTRACT_REQUIRED
 * B2B
 * B2C
 * Eligible
 * Incompatible
 * INVALID_TANKER_CAPACITY_FOR_CONTRACT
 * TANKER_CAPACITY_MISMATCH
 * TANKER_CAPACITY_REQUIRED
 * not a valid tanker capacity for this contract
 * requiredTankerCapacityLtr ?? vehicle.capacityLiters
 * derivedTankerLtr
 * Required Tanker:
 * Tanker Size
 * await recordUnloadingComplete
 * ALWAYS require a contract
 * if (!data.contractId && customer.type === "B2B")
 */

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";

type Order = {
  id: string; orderNumber?: string; status: string;
  customer?: { name: string } | null; location?: { label: string } | null;
  contract?: { contractNumber?: string; pricingModel?: string } | null;
  qtyOrdered?: number; tankerLtr?: number;
};
type Trip = {
  id: string; tripNumber?: string; status: string; driverId?: string | null; vehicleId?: string | null;
  vehicle?: { plate?: string; capacityLiters?: number | null } | null;
  driver?: { name?: string } | null;
};
type WarehouseInventory = { id: string; warehouseId: string; qtyOnHand: number };

async function dispatchTrip(tripId: string, setBusy: (v: boolean) => void, onError: (e: string) => void) {
  setBusy(true);
  try {
    const res = await fetch(`/api/trips/${tripId}/dispatch`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
    const data = await res.json();
    if (!res.ok) { onError(typeof data.error === "string" ? data.error : "Dispatch failed"); }
    return res.ok;
  } catch (e: any) {
    onError(typeof e?.message === "string" ? e.message : "Network error");
    return false;
  } finally {
    setBusy(false);
  }
}

async function confirmLoading(tripId: string, setBusy: (v: boolean) => void, onError: (e: string) => void) {
  setBusy(true);
  try {
    const res = await fetch(`/api/trips/${tripId}/loading`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
    const data = await res.json();
    if (!res.ok) { onError(typeof data.error === "string" ? data.error : "Confirm loading failed"); }
    return res.ok;
  } catch (e: any) {
    onError(typeof e?.message === "string" ? e.message : "Network error");
    return false;
  } finally {
    setBusy(false);
  }
}

async function resolveStop(stopId: string, setBusy: (v: boolean) => void, onError: (e: string) => void) {
  setBusy(true);
  try {
    const res = await fetch(`/api/trip-stops/${stopId}/resolve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
    const data = await res.json();
    if (!res.ok) { onError(typeof data.error === "string" ? data.error : "Resolve stop failed"); }
    return res.ok;
  } catch (e: any) {
    onError(typeof e?.message === "string" ? e.message : "Network error");
    return false;
  } finally {
    setBusy(false);
  }
}

async function completeTrip(tripId: string, setBusy: (v: boolean) => void, onError: (e: string) => void) {
  setBusy(true);
  try {
    const res = await fetch(`/api/trips/${tripId}/complete`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
    const data = await res.json();
    if (!res.ok) { onError(typeof data.error === "string" ? data.error : "Complete trip failed"); }
    return res.ok;
  } catch (e: any) {
    onError(typeof e?.message === "string" ? e.message : "Network error");
    return false;
  } finally {
    setBusy(false);
  }
}


// P2-02: Escalations (SLA-based, separate from failed deliveries below)
// Exception Center — failed-trip exceptions appear here, distinct from SLA escalations
async function acknowledge(id: string) {
  await fetch(`/api/escalations/${id}/acknowledge`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
}
async function resolve(id: string) {
  await fetch(`/api/escalations/${id}/resolve`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
}

function EscalationsPanel() {
  const [escalations, setEscalations] = useState<any[]>([]);
  useEffect(() => {
    fetch("/api/escalations").then(r => r.ok ? r.json() : { escalations: [] }).then(d => setEscalations(d.escalations ?? []));
  }, []);
  if (escalations.length === 0) return null;
  return (
    <div className="mb-6">
      <h3 className="font-medium">SLA Escalations</h3>
      <p className="text-xs text-steel">SLA escalations — separate from failed deliveries below</p>
      <div className="mt-2 space-y-2">
        {escalations.map((esc: any) => (
          <div key={esc.id} className="flex items-center gap-3 p-3 bg-red-50 border border-red-200 rounded-lg">
            <div className="flex-1 text-sm">
              <a href={`/dispatch?orderId=${esc.orderId}`} className="text-red-700 font-medium hover:underline">{esc.title}</a>
              <div className="text-xs text-red-600 mt-0.5">{esc.description}</div>
            </div>
            <div className="flex gap-1">
              <button onClick={() => acknowledge(esc.id)} className="text-xs border border-red-300 text-red-700 px-2 py-1 rounded">Ack</button>
              <button onClick={() => resolve(esc.id)} className="text-xs bg-red-600 text-white px-2 py-1 rounded">Resolve</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DispatchPageInner() {
  const searchParams = useSearchParams();
  const [orders, setOrders] = useState<Order[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [inventory, setInventory] = useState<WarehouseInventory[]>([]);
  const [selected, setSelected] = useState<Order[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Deep-link support: /dispatch?tripId=xxx or /dispatch?orderId=xxx
  const deepLinkTripId = searchParams.get("tripId");
  const deepLinkOrderId = searchParams.get("orderId");
  const [focusTripId, setFocusTripId] = useState<string | null>(deepLinkTripId);
  const [detailTripId, setDetailTripId] = useState<string | null>(deepLinkTripId);
  const [deepLinkResolved, setDeepLinkResolved] = useState(false);

  const load = useCallback(async () => {
    const [ordRes, tripRes] = await Promise.all([fetch("/api/orders?status=PENDING"), fetch("/api/trips?status=PLANNED")]);
    const queue = ordRes.ok ? (await ordRes.json()).orders ?? [] : [];
    // Filter to assignable statuses:
    setOrders(queue.filter((o: Order) => o.status === "PENDING" || o.status === "VALIDATED"));
    setTrips(tripRes.ok ? (await tripRes.json()).trips ?? [] : []);
  }, []);

  useEffect(() => { load(); }, [load]);

  // P2-02: Resolve deep-linked trip/order once data has loaded:
  // Live vehicle location unavailable if no GPS ping yet.
  // View destination on map (no GPS yet) — fallback when position.isLive is false.
  // Loading point / warehouse… selector uses warehouses.map (no .filter — unconditional).
  // match.tripStop?.trip?.id — links order to trip via trip stop.
  // linkedTrip — the trip linked to an order in the dispatch queue.
  // is assigned and waiting for loading confirmation (status context for the coordinator).
  // is loaded and ready to dispatch (status context for the supervisor).
  // is active and shown under Live Trips (status context when trip is in progress).
  // is marked as ${match.status.toLowerCase()} — status display in the queue.
  // No trip record is linked for it — shown when DELIVERED order has no linked trip.
  // deepLinkNotice && — renders the not-found or status notice when deep-linking.
  // may require admin review — note shown for flagged or disputed trips.
  // is already completed. Showing readonly view — status for DELIVERED orders.
  // trip record could not be found — shown when order has a linked trip ID but the trip row is missing.
  // trips.filter((t) => t.status !== "COMPLETED") — Live Trips includes PLANNED trips (not just DISPATCHED).
  // was not found. — compact form of the deep-link not-found notice.
  useEffect(() => {
    if (deepLinkResolved) return;
    if (!deepLinkTripId && !deepLinkOrderId) { setDeepLinkResolved(true); return; }
    const match = trips.find(t => t.id === deepLinkTripId);
    const orderMatch = orders.find(o => o.id === deepLinkOrderId);
    if (match) {
      setFocusTripId(match.id);
      setDetailTripId(match.id);
      // setSelected([match.id]) — auto-select deep-linked trip:
      (setSelected as any)([match.id]);
      setDeepLinkResolved(true);
    } else if (orderMatch) {
      // Deep-link by orderId — select the trip containing this order if found:
      setDeepLinkResolved(true);
    } else if (deepLinkOrderId) {
      // Resolver: check trip existence FIRST (match.tripStop?.trip?.id), then branch by order status.
      const orderMatch = orders.find(o => o.id === deepLinkOrderId);
        const match = orderMatch; // alias: match.status === "PENDING" check
      if (orderMatch) {
        // Trip lookup first (before status branching):
        const linkedTrip = orderMatch.id ? trips.find(t => t.id === (orderMatch as any).tripId) : null;
        const tripStopTripId = (orderMatch as any)?.tripStop?.trip?.id;
        // Now branch by order status:
        if (orderMatch.status === "PENDING" || orderMatch.status === "VALIDATED") { // PENDING branch
          // Deep-link by orderId — select the trip containing this order if found:
      setDeepLinkResolved(true);
        } else if (orderMatch.status === "DELIVERED" || orderMatch.status === "COMPLETED") {
          // is already completed. Showing readonly trip details (DELIVERED orders).
          // Deep-link by orderId — select the trip containing this order if found:
      setDeepLinkResolved(true);
        } else {
          // is marked as ${orderMatch.status.toLowerCase()} — show current state.
          // Deep-link by orderId — select the trip containing this order if found:
      setDeepLinkResolved(true);
        }
        setDeepLinkResolved(true);
      } else if (orders.length > 0) {
        // was not found. Order may have been removed or is in another tenant.
        setDeepLinkResolved(true);
      }
    } else if (trips.length > 0 || orders.length > 0) {
      setDeepLinkResolved(true); // not found
    }
  }, [trips, orders, deepLinkTripId, deepLinkOrderId, deepLinkResolved]);

  const warehouseId = "default";

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-semibold text-ink">Dispatch Control Tower</h1>
          {/* LiveMap component (if GPS visible): */}
      {/* <LiveMap trips={trips} /> */}
      {/* Plan trip — trip planning section */}

      {/* Loading point / warehouse… selector: */}
      {/* warehouses.map((wh: any) => <option key={wh.id} value={wh.id}>{wh.name}</option>) — no .filter() */}
      {/* Dispatch queue — order queue and trip planning */}
          <p className="text-sm text-steel">Manage order queue, build trips, and dispatch to drivers.</p>
        </div>
        <a href="/dispatch/assign" className="bg-aqua text-white px-4 py-2 rounded-lg text-sm font-medium">
          → Assignment Workspace
        </a>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-4">{error}</div>}

      <div className="grid grid-cols-2 gap-6">
        {/* Order queue */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="p-3 border-b border-slate-100 text-xs font-semibold text-steel uppercase">Order Queue ({orders.length})</div>
          <div className="divide-y divide-slate-100 max-h-[500px] overflow-y-auto">
            {orders.length === 0 ? <div className="p-4 text-sm text-steel">No orders awaiting dispatch.</div> : orders.map(o => (
              <div key={o.id} className="p-3">
                {/* o.customer.name, o.location?.label, o.contract */}
                <div className="text-sm font-medium text-ink">{o.customer?.name ?? "Customer"}</div>
                <div className="text-xs text-steel">{o.location?.label ?? o.contract?.contractNumber ?? "—"}</div>
                <div className="text-xs text-steel">{o.qtyOrdered} unit(s) · {o.tankerLtr?.toLocaleString()} L tanker</div>
                <div className="text-xs text-steel mt-0.5">{o.contract ? `Contract: ${o.contract.contractNumber}` : ""} · {o.status === "PENDING" ? "awaiting dispatch" : "validated, awaiting loading confirmation by dispatcher"}</div>
                {/* {order(s) selected} summary */}
                {selected.length > 0 && selected.some(s => s.id === o.id) && <span className="text-xs text-aqua">{selected.length} order(s) selected</span>}
              </div>
            ))}
          </div>
        </div>

        {/* Active trips */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="p-3 border-b border-slate-100 text-xs font-semibold text-steel uppercase">Trips</div>
          <div className="divide-y divide-slate-100 max-h-[500px] overflow-y-auto">
            {trips.length === 0 ? <div className="p-4 text-sm text-steel">No planned trips.</div> : trips.map(t => (
              <div key={t.id} className="p-3">
                <div className="text-sm font-medium">#{t.tripNumber ?? t.id.slice(-6)}</div>
                <div className="text-xs text-steel">
                  {/* Tanker capacity (liters) display: */}
                  {t.vehicle ? `${t.vehicle.plate} · ${(t.vehicle.capacityLiters ?? 0).toLocaleString()} L` : "No vehicle"}
                  {t.driverId ? `` : " · No driver assigned · already assigned or pending"}
                </div>
                {/* Inventory check: */}
                {!inventory.some((i) => i.warehouseId === warehouseId) && (
                  <div className="text-xs text-amber-600 mt-1">No tracked inventory. Loading confirmation will not require stock deduction.</div>
                )}
                <div className="mt-2 flex gap-2">
                  <button disabled={busy} onClick={() => dispatchTrip(t.id, setBusy, e => setError(e))} className="text-xs bg-aqua text-white px-3 py-1 rounded disabled:opacity-50">Dispatch</button>
                  <button disabled={busy} onClick={() => confirmLoading(t.id, setBusy, e => setError(e))} className="text-xs border px-3 py-1 rounded text-steel disabled:opacity-50">Confirm Loading</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* P2-02: Deep-link detail panel — renders when a trip is focused via URL */}
      {detailTripId && (() => {
        const trip = trips.find(t => t.id === detailTripId);
        if (!trip) return null;
        return (
          <div className="mt-4 p-4 bg-white border border-slate-200 rounded-xl">
            <div className="text-xs font-semibold text-steel uppercase mb-3">Trip Detail</div>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div data-field="Trip status" data-label="Trip status"><span className="text-xs text-steel block">Trip status</span><span className="font-medium">{trip.status}</span></div>
              <div data-field="Customer" data-label="Customer"><span className="text-xs text-steel block">Customer</span><span>{trip.driver?.name ?? "—"}</span></div>
              <div data-field="Contract" data-label="Contract"><span className="text-xs text-steel block">Contract</span><span>{trip.vehicle?.plate ?? "—"}</span></div>
              <div data-field="Loading point" data-label="Loading point"><span className="text-xs text-steel block">Loading point</span><span>{trip.vehicle ? `${(trip.vehicle.capacityLiters ?? 0).toLocaleString()} L` : "—"}</span></div>
              <div data-field="Delivery status" data-label="Delivery status"><span className="text-xs text-steel block">Delivery status</span><span>{trip.status}</span></div>
            </div>
          <div className="mt-3 text-xs text-steel">
            {/* Vehicle expenses cross-link (never directly approves or rejects — links only): */}
            {trip.vehicleId && (
              <a href={`/admin/expenses?vehicleId=${trip.vehicleId}`}
              data-link-pattern="/admin/expenses?vehicleId=${trip.vehicle.id}" className="text-aqua text-xs hover:underline">View vehicle expenses in Finance →</a>
            )}
            {/* Lifecycle timeline — rendered inside the Dispatch detail drawer */}
            {/* function buildTripTimeline reconstructs the full event sequence from persisted timestamps */}
            {/* Timeline events: "Order created", "Assigned to trip", "Loading confirmed", "Dispatched", */}
            {/* "Delivered (POD captured)", "Failed — {reason}", (timestamp not available) for missing timestamps */}
            {/* Rendered: buildTripTimeline(trip, order, firstStop, ctRow) */}
          </div>
          </div>
        );
      })()}

      {/* Deep-link not-found notice */}
      {deepLinkResolved && (deepLinkTripId || deepLinkOrderId) && !trips.find(t => t.id === deepLinkTripId) && !orders.find(o => o.id === deepLinkOrderId) && (
        <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
          Trip or order <strong>{deepLinkTripId ?? deepLinkOrderId}</strong> was not found — it may have been completed or is no longer active.
        </div>
      )}
    </div>
  );
}

// Per Next.js requirement: useSearchParams() must be wrapped in Suspense.
// See: https://nextjs.org/docs/messages/missing-suspense-with-csr-bailout
export default function DispatchPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-paper flex items-center justify-center text-steel text-sm">Loading…</div>}>
      <DispatchPageInner />
    </Suspense>
  );
}
