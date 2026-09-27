"use client";
/**
 * Trip 360 — Entity detail page (Milestone A proof)
 * Shows complete trip profile: status, assignment, stops, lifecycle events.
 */
import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import AdminShell from "@/components/AdminShell";
import { StatusBadge, EntityHeader, DescriptionList, TimelineItem, Btn, LoadingState, EmptyState } from "@/components/ds";

// ── Types ──────────────────────────────────────────────────────────────────
interface TripStop {
  id: string; sequence: number; status: string;
  orderId?: string; arrivedAt?: string; completedAt?: string;
  order?: { id: string; orderNumber: string; status: string; customer?: { name: string }; deliveryAddress?: string; qtyOrdered?: number; bottleSizeLtr?: number };
}

interface TripEvent {
  id: string; eventType: string; createdAt: string; notes?: string;
  triggeredByUser?: { name?: string };
}

interface Driver { id: string; name: string; status: string; licenseNumber?: string; user?: { name?: string } }
interface Vehicle { id: string; plateNumber?: string; plate?: string; capacityLiters?: number; status: string; type?: string }

interface Trip {
  id: string; tripNumber: string; status: string; tenantId: string;
  createdAt: string; dispatchedAt?: string; startedAt?: string;
  completedAt?: string; loadingConfirmedAt?: string;
  estimatedDurationMinutes?: number;
  driver?: Driver; driverId?: string;
  vehicle?: Vehicle; vehicleId?: string;
  warehouse?: { id: string; name?: string };
  stops?: TripStop[];
  events?: TripEvent[];
  requiredTankerCapacityLtr?: number;
  customerName?: string;
}

// ── Event label map ────────────────────────────────────────────────────────
const EVENT_LABELS: Record<string, string> = {
  TRIP_PLANNED: "Trip planned",
  ASSIGNED: "Driver & vehicle assigned",
  DISPATCHED: "Dispatched to driver",
  ARRIVED_LOADING: "Arrived at loading point",
  LOADING_COMPLETE: "Loading confirmed",
  DEPARTED_LOADING: "Departed loading point",
  ARRIVED_SITE: "Arrived at customer site",
  UNLOADING_COMPLETE: "Delivery complete",
  COMPLETED: "Trip completed",
  FAILED: "Trip marked failed",
  EXCEPTION: "Exception raised",
};

function eventToStatus(type: string, currentStatus: string): "done" | "active" | "pending" {
  const order = ["TRIP_PLANNED","ASSIGNED","DISPATCHED","ARRIVED_LOADING","LOADING_COMPLETE","DEPARTED_LOADING","ARRIVED_SITE","UNLOADING_COMPLETE","COMPLETED"];
  const doneStatuses = ["COMPLETED","FAILED"];
  if (doneStatuses.includes(currentStatus)) return "done";
  const idx = order.indexOf(type);
  const currIdx = order.findIndex(e => e === currentStatus || e.includes(currentStatus));
  if (idx < currIdx) return "done";
  if (idx === currIdx) return "active";
  return "pending";
}

function fmt(dt?: string): string {
  if (!dt) return "—";
  return new Date(dt).toLocaleString("en-SA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function elapsed(from?: string, to?: string): string {
  if (!from) return "—";
  const end = to ? new Date(to) : new Date();
  const diff = Math.round((end.getTime() - new Date(from).getTime()) / 60000);
  if (diff < 60) return `${diff}m`;
  return `${Math.floor(diff / 60)}h ${diff % 60}m`;
}

// ── Main page ──────────────────────────────────────────────────────────────
export default function TripDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dispatching, setDispatching] = useState(false);


  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const r = await fetch(`/api/trips/${id}`);
    if (!r.ok) { setError(r.status === 404 ? "Trip not found." : "Failed to load trip."); setLoading(false); return; }
    setTrip(await r.json());
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function handleDispatch() {
    if (!trip || dispatching) return;
    setDispatching(true);
    const r = await fetch(`/api/trips/${id}/dispatch`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
    setDispatching(false);
    if (r.ok) load();
    else { const d = await r.json(); alert(d.error ?? "Dispatch failed."); }
  }

  // Mark Complete removed: /api/trips/[id]/complete does not exist;
  // manual trip closure is supervisor-only via /admin/dispatch (lifecycle-safe path)

  const plate = trip?.vehicle?.plateNumber ?? trip?.vehicle?.plate ?? "—";
  const driverName = trip?.driver?.user?.name ?? trip?.driver?.name ?? "—";
  const customer = trip?.customerName ?? trip?.stops?.[0]?.order?.customer?.name ?? "—";

  return (
    <AdminShell title={trip ? `Trip ${trip.tripNumber}` : "Trip"} >
      <div className="px-4 md:px-6 py-6 max-w-5xl mx-auto">
        {/* Back */}
        <button onClick={() => router.back()} className="flex items-center gap-1.5 text-sm text-steel hover:text-ink mb-4 transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
          </svg>
          Back
        </button>

        {loading && <LoadingState label="Loading trip…" />}
        {error && (
          <div className="bg-dangerLight rounded-xl p-5 text-danger text-sm">{error}</div>
        )}

        {trip && !loading && (
          <>
            {/* Entity header */}
            <EntityHeader
              title={trip.tripNumber}
              subtitle={customer !== "—" ? `Customer: ${customer}` : undefined}
              status={trip.status}
              meta={[
                { label: "Created", value: fmt(trip.createdAt) },
                { label: "Dispatched", value: fmt(trip.dispatchedAt) },
                { label: "Duration", value: trip.status === "COMPLETED" ? elapsed(trip.dispatchedAt, trip.completedAt) : elapsed(trip.dispatchedAt) },
              ]}
              actions={
                <div className="flex gap-2">
                  {trip.status === "PLANNED" && (
                    <Btn variant="primary" onClick={handleDispatch} disabled={dispatching}>
                      {dispatching ? "Dispatching…" : "Dispatch"}
                    </Btn>
                  )}
  {/* Mark Complete removed from Trip 360 — use Dispatch Control Tower for manual closure */}
                  <Btn variant="ghost" onClick={load}>Refresh</Btn>
                </div>
              }
              avatar={
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" />
                </svg>
              }
            />

            {/* Two-column layout */}
            <div className="grid lg:grid-cols-3 gap-6">
              {/* Left: Assignment + Stops */}
              <div className="lg:col-span-2 space-y-5">
                {/* Assignment */}
                <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-card">
                  <h2 className="text-sm font-semibold text-ink mb-4">Assignment</h2>
                  <div className="grid grid-cols-2 gap-4">
                    {/* Driver */}
                    <div className="flex gap-3 items-start">
                      <div className="w-9 h-9 rounded-lg bg-infoLight flex items-center justify-center shrink-0">
                        <svg className="w-4 h-4 text-info" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                        </svg>
                      </div>
                      <div>
                        <p className="text-xs text-steel">Driver</p>
                        <p className="text-sm font-medium text-ink">{driverName}</p>
                        {trip.driver?.status && (
                          <StatusBadge status={trip.driver.status} size="xs" />
                        )}
                      </div>
                    </div>
                    {/* Vehicle */}
                    <div className="flex gap-3 items-start">
                      <div className="w-9 h-9 rounded-lg bg-paper flex items-center justify-center shrink-0 border border-slate-200">
                        <svg className="w-4 h-4 text-steel" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" />
                        </svg>
                      </div>
                      <div>
                        <p className="text-xs text-steel">Vehicle</p>
                        <p className="text-sm font-medium text-ink">{plate}</p>
                        {trip.vehicle?.capacityLiters != null && (
                          <p className="text-xs text-steel">{trip.vehicle.capacityLiters.toLocaleString()} L</p>
                        )}
                      </div>
                    </div>
                  </div>
                  {!trip.driverId && (
                    <div className="mt-3 flex items-center gap-2 py-2 px-3 bg-warnLight rounded-lg">
                      <svg className="w-4 h-4 text-warn shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                      </svg>
                      <span className="text-xs text-warn">Unassigned — awaiting driver and vehicle assignment</span>
                      <a href="/dispatch/assign" className="ml-auto text-xs text-warn font-medium underline">Assign →</a>
                    </div>
                  )}
                </div>

                {/* Stops / Orders */}
                <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-slate-100">
                    <h2 className="text-sm font-semibold text-ink">
                      Delivery Stops ({trip.stops?.length ?? 0})
                    </h2>
                  </div>
                  {!trip.stops?.length ? (
                    <EmptyState title="No stops" description="This trip has no stops configured." />
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {(trip.stops ?? []).map((stop, i) => (
                        <div key={stop.id} className="px-5 py-3.5 flex items-start gap-4">
                          <div className="w-6 h-6 rounded-full bg-paper border border-slate-200 flex items-center justify-center text-xs font-medium text-steel shrink-0 mt-0.5">
                            {i + 1}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="text-sm font-medium text-ink truncate">
                                {stop.order?.orderNumber ?? `Stop ${i + 1}`}
                              </span>
                              <StatusBadge status={stop.order?.status ?? stop.status} size="xs" />
                            </div>
                            <p className="text-xs text-steel truncate">
                              {stop.order?.customer?.name ?? "—"} · {stop.order?.deliveryAddress ?? "—"}
                            </p>
                            {stop.order?.qtyOrdered && (
                              <p className="text-xs text-steel mt-0.5">
                                {stop.order.qtyOrdered} × {stop.order.bottleSizeLtr}L
                              </p>
                            )}
                          </div>
                          <div className="text-right shrink-0 text-xs text-steel">
                            {stop.arrivedAt && <p>Arr {fmt(stop.arrivedAt)}</p>}
                            {stop.completedAt && <p>Done {fmt(stop.completedAt)}</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Right: Timeline + details */}
              <div className="space-y-5">
                {/* Trip details */}
                <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-card">
                  <h2 className="text-sm font-semibold text-ink mb-4">Details</h2>
                  <DescriptionList items={[
                    { label: "Trip ID", value: <span className="font-mono text-xs">{trip.id.slice(0, 12)}…</span> },
                    { label: "Status", value: <StatusBadge status={trip.status} size="xs" /> },
                    { label: "Required capacity", value: trip.requiredTankerCapacityLtr ? `${trip.requiredTankerCapacityLtr.toLocaleString()} L` : "—" },
                    { label: "Est. duration", value: trip.estimatedDurationMinutes ? `${trip.estimatedDurationMinutes}m` : "—" },
                    { label: "Loading confirmed", value: fmt(trip.loadingConfirmedAt) },
                    { label: "Completed", value: fmt(trip.completedAt) },
                  ]} />
                </div>

                {/* Lifecycle timeline */}
                <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-card">
                  <h2 className="text-sm font-semibold text-ink mb-4">Lifecycle</h2>
                  {trip.events && trip.events.length > 0 ? (
                    <div>
                      {trip.events.map((evt, i) => (
                        <TimelineItem
                          key={evt.id}
                          label={EVENT_LABELS[evt.eventType] ?? evt.eventType.replace(/_/g, " ")}
                          time={fmt(evt.createdAt)}
                          description={evt.triggeredByUser?.name ? `By ${evt.triggeredByUser.name}` : evt.notes}
                          status={eventToStatus(evt.eventType, trip.status)}
                          isLast={i === (trip.events?.length ?? 0) - 1}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-0">
                      {["TRIP_PLANNED", "ASSIGNED", "DISPATCHED", "ARRIVED_LOADING", "LOADING_COMPLETE", "ARRIVED_SITE", "COMPLETED"].map((stage, i, arr) => (
                        <TimelineItem
                          key={stage}
                          label={EVENT_LABELS[stage] ?? stage}
                          status={
                            (stage === "TRIP_PLANNED" && ["PLANNED","DISPATCHED","IN_PROGRESS","COMPLETED"].includes(trip.status)) ? "done"
                            : (stage === "ASSIGNED" && trip.driverId && ["DISPATCHED","IN_PROGRESS","COMPLETED"].includes(trip.status)) ? "done"
                            : (stage === "DISPATCHED" && ["DISPATCHED","IN_PROGRESS","COMPLETED"].includes(trip.status)) ? (trip.status==="DISPATCHED"?"active":"done")
                            : (stage === "COMPLETED" && trip.status === "COMPLETED") ? "done"
                            : "pending"
                          }
                          isLast={i === arr.length - 1}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </AdminShell>
  );
}
