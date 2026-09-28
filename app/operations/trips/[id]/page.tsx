"use client";
/**
 * Trip 360 V2 — Milestone B
 *
 * Authoritative trip detail page. Single source of truth for any trip.
 * Uses real lifecycle API, exception data, and POD evidence.
 * Deep-linked from: Dispatch, Assignment Workspace, Operations Workspace,
 * Control Tower, Exception Center.
 *
 * Actions: Dispatch (PLANNED + assigned). Mark Complete removed (lifecycle-safe).
 */
import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import AdminShell from "@/components/AdminShell";
import {
  PageContainer, StatusBadge, EntityHeader, DescriptionList,
  TimelineItem, Tabs, Btn, EmptyState, LoadingState,
} from "@/components/ds";

// ── Types ──────────────────────────────────────────────────────────────────
interface LifecycleEvent {
  id: string; eventType: string; lat?: number; lng?: number;
  notes?: string; loadedLiters?: number; deliveredLiters?: number;
  createdAt: string; triggeredByUser?: { name?: string };
}

interface TripStop {
  id: string; sequence: number; status: string;
  arrivedAt?: string; completedAt?: string;
  order?: {
    id: string; orderNumber: string; status: string; type?: string;
    customer?: { name: string }; deliveryAddress?: string;
    qtyOrdered?: number; bottleSizeLtr?: number; slaMinutes?: number;
  };
  epod?: { id: string; signedAt?: string; deliveredLiters?: number; recipientName?: string; photoUrl?: string };
}

interface Trip {
  id: string; tripNumber: string; status: string; tenantId: string;
  createdAt: string; dispatchedAt?: string; startedAt?: string;
  completedAt?: string; loadingConfirmedAt?: string;
  estimatedDurationMinutes?: number; requiredTankerCapacityLtr?: number;
  driverId?: string; vehicleId?: string;
  driver?: { id: string; name?: string; status: string; licenseNumber?: string; user?: { name?: string } };
  vehicle?: { id: string; plateNumber?: string; plate?: string; capacityLiters?: number; status: string };
  warehouse?: { id: string; name?: string };
  stops?: TripStop[];
}

// ── Event label map ────────────────────────────────────────────────────────
const EVENT_LABEL: Record<string, string> = {
  TRIP_PLANNED: "Trip planned",
  ASSIGNED: "Driver & vehicle assigned",
  DISPATCHED: "Dispatched to driver",
  ARRIVED_LOADING: "Driver arrived at loading point",
  LOADING_COMPLETE: "Loading confirmed",
  DEPARTED_LOADING: "Departed loading point",
  ARRIVED_SITE: "Arrived at customer site",
  UNLOADING_COMPLETE: "Delivery complete",
  COMPLETED: "Trip completed",
  FAILED: "Trip failed",
  EXCEPTION: "Exception raised",
  NOTE: "Note recorded",
  GPS_PING: "GPS ping",
  STARTED: "Trip started",
  CLOSED: "Trip closed",
};

function fmtDt(dt?: string) {
  if (!dt) return "—";
  return new Date(dt).toLocaleString("en-SA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
function fmtTime(dt?: string) {
  if (!dt) return "—";
  return new Date(dt).toLocaleTimeString("en-SA", { hour: "2-digit", minute: "2-digit" });
}
function elapsed(from: string, to?: string) {
  const diff = Math.round(((to ? new Date(to) : new Date()).getTime() - new Date(from).getTime()) / 60000);
  if (diff < 60) return `${diff}m`;
  return `${Math.floor(diff / 60)}h ${diff % 60}m`;
}

const STAGE_ORDER = ["DISPATCHED","ARRIVED_LOADING","LOADING_COMPLETE","ARRIVED_SITE","UNLOADING_COMPLETE","COMPLETED"];
function evtStatus(type: string, events: LifecycleEvent[], tripStatus: string): "done"|"active"|"pending" {
  if (type === "TRIP_PLANNED") return "done";
  if (type === "ASSIGNED") return tripStatus !== "PLANNED" || true ? "done" : "pending";
  const reached = events.map(e => e.eventType);
  if (reached.includes(type)) return "done";
  const idx = STAGE_ORDER.indexOf(type);
  const currIdx = STAGE_ORDER.findIndex(s => reached.includes(s));
  if (idx === currIdx + 1) return "active";
  return "pending";
}

// ── Main page ──────────────────────────────────────────────────────────────
export default function Trip360Page() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [events, setEvents] = useState<LifecycleEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState("overview");
  const [dispatching, setDispatching] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const [tRes, evRes] = await Promise.allSettled([
      fetch(`/api/trips/${id}`),
      fetch(`/api/trips/${id}/lifecycle`),
    ]);
    if (tRes.status === "fulfilled") {
      if (tRes.value.ok) setTrip(await tRes.value.json());
      else setError(tRes.value.status === 404 ? "Trip not found." : "Failed to load trip.");
    } else { setError("Network error loading trip."); }
    if (evRes.status === "fulfilled" && evRes.value.ok) {
      const d = await evRes.value.json();
      setEvents(Array.isArray(d.events) ? d.events : []);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function handleDispatch() {
    if (!trip || dispatching) return;
    setDispatching(true);
    const r = await fetch(`/api/trips/${id}/dispatch`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
    });
    setDispatching(false);
    if (r.ok) { await load(); }
    else { const d = await r.json(); setError(d.error ?? "Dispatch failed."); }
  }

  if (loading) return <AdminShell title="Trip"><PageContainer><LoadingState label="Loading trip…" /></PageContainer></AdminShell>;
  if (error) return (
    <AdminShell title="Trip">
      <PageContainer>
        <button onClick={() => router.back()} className="text-sm text-steel hover:text-ink mb-4 block">← Back</button>
        <div className="bg-dangerLight rounded-xl p-5 text-danger text-sm">{error}</div>
      </PageContainer>
    </AdminShell>
  );
  if (!trip) return null;

  const plate = trip.vehicle?.plateNumber ?? trip.vehicle?.plate ?? "—";
  const driverName = trip.driver?.user?.name ?? trip.driver?.name ?? "—";
  const customer = trip.stops?.[0]?.order?.customer?.name ?? "—";
  const isUnassigned = !trip.driverId;
  const canDispatch = trip.status === "PLANNED" && !isUnassigned;
  const hasPod = trip.stops?.some(s => s.epod);

  // Build stage timeline
  const STAGES = [
    "TRIP_PLANNED","ASSIGNED","DISPATCHED",
    "ARRIVED_LOADING","LOADING_COMPLETE",
    "ARRIVED_SITE","UNLOADING_COMPLETE","COMPLETED",
  ];

  const TABS_DEF = [
    { id: "overview", label: "Overview" },
    { id: "timeline", label: "Timeline" },
    { id: "stops", label: `Stops (${trip.stops?.length ?? 0})` },
    { id: "assignment", label: "Assignment" },
    ...(hasPod ? [{ id: "pod", label: "POD" }] : []),
  ];

  return (
    <AdminShell title={`Trip ${trip.tripNumber}`}>
      <PageContainer>
        {/* Back + breadcrumb */}
        <button onClick={() => router.back()}
          className="flex items-center gap-1.5 text-sm text-steel hover:text-ink mb-4 transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
          </svg>
          Operations
        </button>

        {/* Error banner */}
        {error && (
          <div className="mb-4 px-4 py-3 bg-dangerLight rounded-lg text-sm text-danger flex items-center gap-2">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="ml-auto text-danger/60 hover:text-danger">✕</button>
          </div>
        )}

        {/* Entity header */}
        <EntityHeader
          title={trip.tripNumber}
          subtitle={customer !== "—" ? `Customer: ${customer}` : undefined}
          status={trip.status}
          meta={[
            { label: "created", value: fmtDt(trip.createdAt) },
            { label: "dispatched", value: fmtDt(trip.dispatchedAt) },
            { label: "duration", value: trip.dispatchedAt ? elapsed(trip.dispatchedAt, trip.completedAt) : "—" },
            ...(trip.requiredTankerCapacityLtr ? [{ label: "capacity", value: `${trip.requiredTankerCapacityLtr.toLocaleString()} L` }] : []),
          ]}
          avatar={
            <svg className="w-6 h-6 text-steel" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375A1.125 1.125 0 012.25 17.625V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124A17.902 17.902 0 0016.5 5.557a2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" />
            </svg>
          }
          actions={
            <div className="flex gap-2">
              {canDispatch && (
                <Btn variant="primary" onClick={handleDispatch} disabled={dispatching}>
                  {dispatching ? "Dispatching…" : "Dispatch"}
                </Btn>
              )}
              {isUnassigned && trip.status === "PLANNED" && (
                <a href="/dispatch/assign"
                  className="inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 bg-warnLight text-warn border border-warn/20 rounded-lg hover:bg-warn/10 transition-colors">
                  Assign Resources →
                </a>
              )}
              <Btn variant="ghost" onClick={load}>Refresh</Btn>
            </div>
          }
        />

        {/* Unassigned warning */}
        {isUnassigned && (
          <div className="mb-4 flex items-center gap-2 px-4 py-3 bg-warnLight rounded-lg border border-warn/20">
            <svg className="w-4 h-4 text-warn shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            <span className="text-sm text-warn">This trip is unassigned — no driver or vehicle allocated.</span>
            <a href="/dispatch/assign" className="ml-auto text-sm font-medium text-warn underline whitespace-nowrap">
              Open Assignment Workspace →
            </a>
          </div>
        )}

        {/* Tabs */}
        <Tabs tabs={TABS_DEF} active={tab} onChange={setTab} />

        {/* ── OVERVIEW TAB ── */}
        {tab === "overview" && (
          <div className="grid lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-card">
              <h3 className="text-sm font-semibold text-ink mb-4">Trip Details</h3>
              <DescriptionList items={[
                { label: "Trip Number", value: <span className="font-mono text-sm">{trip.tripNumber}</span> },
                { label: "Status", value: <StatusBadge status={trip.status} /> },
                { label: "Customer", value: customer },
                { label: "Loading Point", value: trip.warehouse?.name ?? "—" },
                { label: "Required Capacity", value: trip.requiredTankerCapacityLtr ? `${trip.requiredTankerCapacityLtr.toLocaleString()} L` : "—" },
                { label: "Planned", value: fmtDt(trip.createdAt) },
                { label: "Dispatched", value: fmtDt(trip.dispatchedAt) },
                { label: "Loading Confirmed", value: fmtDt(trip.loadingConfirmedAt) },
                { label: "Completed", value: fmtDt(trip.completedAt) },
              ]} />
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-card">
              <h3 className="text-sm font-semibold text-ink mb-4">Assigned Resources</h3>
              {isUnassigned ? (
                <EmptyState title="No resources assigned" description="Use the Assignment Workspace to assign a driver and vehicle." />
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center gap-3 p-3 bg-paper rounded-lg">
                    <div className="w-9 h-9 rounded-lg bg-infoLight flex items-center justify-center">
                      <svg className="w-4 h-4 text-info" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-xs text-steel">Driver</p>
                      <p className="text-sm font-medium text-ink">{driverName}</p>
                      {trip.driver?.status && <StatusBadge status={trip.driver.status} size="xs" />}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-3 bg-paper rounded-lg">
                    <div className="w-9 h-9 rounded-lg bg-paper border border-slate-200 flex items-center justify-center">
                      <svg className="w-4 h-4 text-steel" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-xs text-steel">Vehicle</p>
                      <p className="text-sm font-medium text-ink">{plate}</p>
                      {trip.vehicle?.capacityLiters && (
                        <p className="text-xs text-steel">{trip.vehicle.capacityLiters.toLocaleString()} L</p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── TIMELINE TAB ── */}
        {tab === "timeline" && (
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-card max-w-xl">
            <h3 className="text-sm font-semibold text-ink mb-5">Lifecycle Timeline</h3>
            {events.length > 0 ? (
              <div>
                {events.filter(e => e.eventType !== "GPS_PING").map((evt, i, arr) => (
                  <TimelineItem
                    key={evt.id}
                    label={EVENT_LABEL[evt.eventType] ?? evt.eventType.replace(/_/g, " ")}
                    time={fmtDt(evt.createdAt)}
                    description={[
                      evt.triggeredByUser?.name ? `By ${evt.triggeredByUser.name}` : null,
                      evt.loadedLiters ? `Loaded: ${evt.loadedLiters.toLocaleString()} L` : null,
                      evt.deliveredLiters ? `Delivered: ${evt.deliveredLiters.toLocaleString()} L` : null,
                      evt.notes ?? null,
                    ].filter(Boolean).join(" · ") || undefined}
                    status="done"
                    isLast={i === arr.filter(e => e.eventType !== "GPS_PING").length - 1}
                  />
                ))}
              </div>
            ) : (
              <div>
                {STAGES.map((stage, i, arr) => (
                  <TimelineItem
                    key={stage}
                    label={EVENT_LABEL[stage] ?? stage}
                    status={evtStatus(stage, events, trip.status)}
                    isLast={i === arr.length - 1}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── STOPS TAB ── */}
        {tab === "stops" && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
            {!trip.stops?.length ? (
              <EmptyState title="No stops" />
            ) : (
              <div className="divide-y divide-slate-100">
                {trip.stops.map((stop, i) => (
                  <div key={stop.id} className="px-5 py-4">
                    <div className="flex items-start gap-4">
                      <div className="w-7 h-7 rounded-full bg-paper border border-slate-200 flex items-center justify-center text-xs font-semibold text-steel shrink-0 mt-0.5">
                        {i + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-semibold text-ink">{stop.order?.orderNumber ?? `Stop ${i + 1}`}</span>
                          <StatusBadge status={stop.order?.status ?? stop.status} size="xs" />
                          {stop.order?.type && (
                            <span className="text-2xs bg-slate-100 text-steel px-1.5 py-0.5 rounded">{stop.order.type}</span>
                          )}
                        </div>
                        <p className="text-xs text-steel">{stop.order?.customer?.name ?? "—"}</p>
                        {stop.order?.deliveryAddress && (
                          <p className="text-xs text-steel mt-0.5">{stop.order.deliveryAddress}</p>
                        )}
                        {stop.order?.qtyOrdered && (
                          <p className="text-xs text-steel mt-0.5">
                            {stop.order.qtyOrdered} × {stop.order.bottleSizeLtr}L
                          </p>
                        )}
                      </div>
                      <div className="text-right text-xs text-steel shrink-0">
                        {stop.arrivedAt && <p>Arrived {fmtTime(stop.arrivedAt)}</p>}
                        {stop.completedAt && <p>Done {fmtTime(stop.completedAt)}</p>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── ASSIGNMENT TAB ── */}
        {tab === "assignment" && (
          <div className="grid lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-card">
              <h3 className="text-sm font-semibold text-ink mb-4">Driver</h3>
              {trip.driver ? (
                <DescriptionList items={[
                  { label: "Name", value: driverName },
                  { label: "Status", value: <StatusBadge status={trip.driver.status} /> },
                  { label: "License", value: trip.driver.licenseNumber ?? "—" },
                ]} />
              ) : (
                <EmptyState title="No driver assigned" action={
                  <a href="/dispatch/assign" className="text-sm text-aqua underline">Assign in Assignment Workspace →</a>
                } />
              )}
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-card">
              <h3 className="text-sm font-semibold text-ink mb-4">Vehicle</h3>
              {trip.vehicle ? (
                <DescriptionList items={[
                  { label: "Plate", value: plate },
                  { label: "Capacity", value: trip.vehicle.capacityLiters ? `${trip.vehicle.capacityLiters.toLocaleString()} L` : "—" },
                  { label: "Status", value: <StatusBadge status={trip.vehicle.status} /> },
                ]} />
              ) : (
                <EmptyState title="No vehicle assigned" />
              )}
            </div>
          </div>
        )}

        {/* ── POD TAB ── */}
        {tab === "pod" && (
          <div className="space-y-4">
            {trip.stops?.filter(s => s.epod).map(stop => (
              <div key={stop.id} className="bg-white rounded-xl border border-slate-200 p-5 shadow-card">
                <div className="flex items-center gap-2 mb-3">
                  <h3 className="text-sm font-semibold text-ink">
                    Stop {stop.sequence} — {stop.order?.customer?.name ?? "—"}
                  </h3>
                  <StatusBadge status={stop.status} size="xs" />
                </div>
                <DescriptionList items={[
                  { label: "Order", value: stop.order?.orderNumber ?? "—" },
                  { label: "Signed at", value: fmtDt(stop.epod!.signedAt) },
                  { label: "Delivered", value: stop.epod!.deliveredLiters != null ? `${stop.epod!.deliveredLiters.toLocaleString()} L` : "—" },
                  { label: "Recipient", value: stop.epod!.recipientName ?? "—" },
                ]} />
              </div>
            ))}
            {!hasPod && (
              <EmptyState title="No POD available" description="POD is captured by the driver on delivery completion." />
            )}
          </div>
        )}
      </PageContainer>
    </AdminShell>
  );
}
