"use client";
/**
 * Trip 360 V2 — Milestone B UAT Fix
 *
 * Root cause of UAT defect:
 *   The previous version used a locally-defined `Trip` type that expected
 *   raw Drizzle scalar fields (driverId, vehicleId, warehouse, stops.order.customer).
 *   The actual API (GET /api/trips/[id]) returns OperationalTripDto which has:
 *     - isAssigned (not driverId/vehicleId booleans)
 *     - trip.customer  (not trip.stops[0].order.customer)
 *     - trip.loadingPoint  (not trip.warehouse)
 *     - trip.site  (for the delivery site)
 *     - stops with only {id,sequence,status,orderId,orderNumber,arrivedAt,completedAt,epod}
 *       — NO embedded order.customer
 *
 *   This caused:
 *     - FALSE "unassigned" warning (checking !trip.driverId which was always undefined)
 *     - Customer = "—" (looking in stops[0].order.customer instead of trip.customer)
 *     - Loading Point = "—" (trip.warehouse vs trip.loadingPoint)
 *     - Stop rows showing "—" for customer (not in OperationalTripDto stops)
 *
 *   Fix: use OperationalTripDto type throughout. Single source of truth.
 */
import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import AdminShell from "@/components/AdminShell";
import {
  PageContainer, StatusBadge, EntityHeader, DescriptionList,
  TimelineItem, Tabs, Btn, EmptyState, LoadingState,
} from "@/components/ds";

// ── OperationalTripDto — mirrors lib/tripDto.ts (client-side type) ─────────
// This matches EXACTLY what GET /api/trips/[id] returns.
interface EpodDto {
  deliveredQty: number;
  recipientName: string | null;
  deliveredAt: string | null;
}

interface StopDto {
  id: string;
  sequence: number;
  status: string;
  orderId: string;
  orderNumber: string | null;
  arrivedAt: string | null;
  completedAt: string | null;
  epod: EpodDto | null;
}

interface OperationalTripDto {
  id: string;
  tripNumber: string;
  status: string;
  loadingConfirmed: boolean;
  /** Server-computed: true iff driverId && vehicleId are both set in the DB. */
  isAssigned: boolean;
  customer: { id: string; name: string; type: string } | null;
  site: { id: string; label: string; address: string; siteCode: string | null } | null;
  deliveryAddress: string | null;
  order: {
    id: string; orderNumber: string; orderType: string; status: string;
    createdAt: string | null; failureReason: string | null;
    lat: number | null; lng: number | null;
    contract: { id: string; contractNumber: string; type: string } | null;
  } | null;
  orderCount: number;
  requiredTankerCapacityLtr: number | null;
  hasMixedCapacities: boolean;
  driver: { id: string; name: string | null; status: string; driverCode: string | null } | null;
  vehicle: { id: string; plateNumber: string; capacityLiters: number | null; status: string; vehicleCode: string | null } | null;
  loadingPoint: { id: string; name: string; loadingPointCode: string | null } | null;
  scheduledAt: string | null;
  createdAt: string | null;
  loadingConfirmedAt: string | null;
  startedAt: string | null;
  dispatchedAt: string | null;
  completedAt: string | null;
  currentLat: number | null;
  currentLng: number | null;
  stops: StopDto[];
}

interface LifecycleEvent {
  id: string;
  eventType: string;
  lat?: number;
  lng?: number;
  notes?: string;
  loadedLiters?: number;
  deliveredLiters?: number;
  createdAt: string;
  triggeredByUser?: { name?: string };
}

// ── Event labels ───────────────────────────────────────────────────────────
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

// ── Helpers ────────────────────────────────────────────────────────────────
function fmtDt(dt: string | null | undefined): string {
  if (!dt) return "—";
  return new Date(dt).toLocaleString("en-SA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function fmtTime(dt: string | null | undefined): string {
  if (!dt) return "—";
  return new Date(dt).toLocaleTimeString("en-SA", { hour: "2-digit", minute: "2-digit" });
}

function elapsed(from: string | null | undefined, to?: string | null): string {
  if (!from) return "—";
  const diff = Math.round(((to ? new Date(to) : new Date()).getTime() - new Date(from).getTime()) / 60000);
  if (diff < 60) return `${diff}m`;
  return `${Math.floor(diff / 60)}h ${diff % 60}m`;
}

const STAGE_ORDER = [
  "DISPATCHED", "ARRIVED_LOADING", "LOADING_COMPLETE", "ARRIVED_SITE", "UNLOADING_COMPLETE", "COMPLETED",
];

function evtStatus(type: string, events: LifecycleEvent[]): "done" | "active" | "pending" {
  if (type === "TRIP_PLANNED" || type === "ASSIGNED") return "done";
  const reached = new Set(events.map((e) => e.eventType));
  if (reached.has(type)) return "done";
  const idx = STAGE_ORDER.indexOf(type);
  const latestIdx = Math.max(-1, ...STAGE_ORDER.map((s, i) => (reached.has(s) ? i : -1)));
  if (idx === latestIdx + 1) return "active";
  return "pending";
}

// ── Main page ──────────────────────────────────────────────────────────────
export default function Trip360Page() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [trip, setTrip] = useState<OperationalTripDto | null>(null);
  const [events, setEvents] = useState<LifecycleEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState("overview");
  const [gpsHistory, setGpsHistory] = useState<{ lat: number; lng: number; speed: number | null; heading: number | null; recordedAt: string; source: string }[] | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [dispatching, setDispatching] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [tRes, evRes] = await Promise.allSettled([
      fetch(`/api/trips/${id}`),
      fetch(`/api/trips/${id}/lifecycle`),
    ]);
    if (tRes.status === "fulfilled") {
      if (tRes.value.ok) {
        setTrip(await tRes.value.json());
      } else {
        setError(tRes.value.status === 404 ? "Trip not found." : "Failed to load trip.");
      }
    } else {
      setError("Network error loading trip.");
    }
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
    setError(null);
    try {
      const r = await fetch(`/api/trips/${id}/dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok) {
        await load();
      } else {
        setError(typeof data?.error === "string" ? data.error : "Dispatch failed.");
      }
    } catch {
      setError("Network error — dispatch was not confirmed.");
    } finally {
      setDispatching(false);
    }
  }

  if (loading) {
    return (
      <AdminShell title="Trip">
        <PageContainer><LoadingState label="Loading trip…" /></PageContainer>
      </AdminShell>
    );
  }
  if (error && !trip) {
    return (
      <AdminShell title="Trip">
        <PageContainer>
          <button onClick={() => router.back()} className="text-sm text-steel hover:text-ink mb-4 block">← Back</button>
          <div className="bg-dangerLight rounded-xl p-5 text-danger text-sm">{error}</div>
        </PageContainer>
      </AdminShell>
    );
  }
  if (!trip) return null;

  // ── Derive display values from OperationalTripDto — single canonical source ──
  const customerName = trip.customer?.name ?? "—";
  const siteName = trip.site?.label ?? "—";
  const siteAddress = trip.site?.address ?? trip.deliveryAddress ?? "—";
  const loadingPointName = trip.loadingPoint?.name ?? "—";
  const driverName = trip.driver?.name ?? "—";
  const plate = trip.vehicle?.plateNumber ?? "—";

  // Use isAssigned from the server-computed field — NOT a client-side driverId check.
  const isUnassigned = !trip.isAssigned;
  const canDispatch = trip.status === "PLANNED" && !isUnassigned;
  const hasPod = trip.stops.some((s) => s.epod != null);

  const TABS_DEF = [
    { id: "overview",   label: "Overview" },
    { id: "timeline",   label: "Timeline" },
    { id: "stops",      label: `Stops (${trip.stops.length})` },
    { id: "assignment", label: "Assignment" },
    ...(hasPod ? [{ id: "pod", label: "POD" }] : []),
    { id: "gps",        label: "GPS Trace" },
  ];

  async function loadGpsTrace() {
    if (gpsHistory !== null || !trip) return; // cached or no trip
    setGpsLoading(true);
    const res = await fetch(`/api/telematics/trips/${trip.id}/replay`).catch(() => null);
    if (res?.ok) {
      const data = await res.json();
      setGpsHistory(data.actualTrace ?? []);
    } else {
      setGpsHistory([]);
    }
    setGpsLoading(false);
  }

  const STAGES = [
    "TRIP_PLANNED", "ASSIGNED", "DISPATCHED",
    "ARRIVED_LOADING", "LOADING_COMPLETE",
    "ARRIVED_SITE", "UNLOADING_COMPLETE", "COMPLETED",
  ];

  return (
    <AdminShell title={`Trip ${trip.tripNumber}`}>
      <PageContainer>
        {/* Back */}
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-sm text-steel hover:text-ink mb-4 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
          </svg>
          Operations
        </button>

        {/* Error banner (non-blocking) */}
        {error && (
          <div className="mb-4 px-4 py-3 bg-dangerLight rounded-lg text-sm text-danger flex items-center gap-2">
            {error}
            <button onClick={() => setError(null)} className="ml-auto text-danger/60 hover:text-danger">✕</button>
          </div>
        )}

        {/* Entity header — uses OperationalTripDto.customer */}
        <EntityHeader
          title={trip.tripNumber}
          subtitle={customerName !== "—" ? `Customer: ${customerName}` : undefined}
          status={trip.status}
          meta={[
            { label: "created", value: fmtDt(trip.createdAt) },
            { label: "dispatched", value: fmtDt(trip.dispatchedAt) },
            { label: "duration", value: trip.dispatchedAt ? elapsed(trip.dispatchedAt, trip.completedAt) : "—" },
            ...(trip.requiredTankerCapacityLtr
              ? [{ label: "capacity", value: `${trip.requiredTankerCapacityLtr.toLocaleString()} L` }]
              : []),
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
                <a
                  href="/dispatch/assign"
                  className="inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 bg-warnLight text-warn border border-warn/20 rounded-lg hover:bg-warn/10 transition-colors"
                >
                  Assign Resources →
                </a>
              )}
              <Btn variant="ghost" onClick={load}>Refresh</Btn>
            </div>
          }
        />

        {/* Unassigned warning — ONLY shown when server confirms isAssigned = false */}
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
        <Tabs tabs={TABS_DEF} active={tab} onChange={(t) => {
          setTab(t);
          if (t === "gps") loadGpsTrace();
        }} />

        {/* ── OVERVIEW ── */}
        {tab === "overview" && (
          <div className="grid lg:grid-cols-2 gap-6">
            {/* Trip details — uses OperationalTripDto normalized fields */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-card">
              <h3 className="text-sm font-semibold text-ink mb-4">Trip Details</h3>
              <DescriptionList items={[
                { label: "Trip Number", value: <span className="font-mono text-sm">{trip.tripNumber}</span> },
                { label: "Status", value: <StatusBadge status={trip.status} /> },
                { label: "Order Type", value: trip.order?.orderType?.replace(/_/g, " ") ?? "—" },
                { label: "Contract", value: trip.order?.contract?.contractNumber ?? (trip.order?.orderType === "B2C_DIRECT" ? "B2C Direct" : "—") },
                { label: "Customer", value: customerName },
                { label: "Site", value: siteName },
                { label: "Address", value: siteAddress },
                { label: "Loading Point", value: loadingPointName },
                { label: "Required Capacity", value: trip.requiredTankerCapacityLtr ? `${trip.requiredTankerCapacityLtr.toLocaleString()} L` : "—" },
                { label: "Planned", value: fmtDt(trip.createdAt) },
                { label: "Dispatched", value: fmtDt(trip.dispatchedAt) },
                { label: "Loading Confirmed", value: fmtDt(trip.loadingConfirmedAt) },
                { label: "Completed", value: fmtDt(trip.completedAt) },
              ]} />
            </div>

            {/* Assigned Resources — uses isAssigned + trip.driver + trip.vehicle */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-card">
              <h3 className="text-sm font-semibold text-ink mb-4">Assigned Resources</h3>
              {isUnassigned ? (
                <EmptyState
                  title="No resources assigned"
                  description="Use the Assignment Workspace to assign a driver and vehicle."
                />
              ) : (
                <div className="space-y-4">
                  {/* Driver */}
                  <div className="flex items-center gap-3 p-3 bg-paper rounded-lg">
                    <div className="w-9 h-9 rounded-lg bg-infoLight flex items-center justify-center shrink-0">
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
                  {/* Vehicle */}
                  <div className="flex items-center gap-3 p-3 bg-paper rounded-lg">
                    <div className="w-9 h-9 rounded-lg bg-paper border border-slate-200 flex items-center justify-center shrink-0">
                      <svg className="w-4 h-4 text-steel" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-xs text-steel">Vehicle</p>
                      <p className="text-sm font-medium text-ink">{plate}</p>
                      {trip.vehicle?.capacityLiters != null && (
                        <p className="text-xs text-steel">{trip.vehicle.capacityLiters.toLocaleString()} L</p>
                      )}
                      {trip.vehicle?.status && <StatusBadge status={trip.vehicle.status} size="xs" />}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── TIMELINE ── */}
        {tab === "timeline" && (
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-card max-w-xl">
            <h3 className="text-sm font-semibold text-ink mb-5">Lifecycle Timeline</h3>
            {events.filter((e) => e.eventType !== "GPS_PING").length > 0 ? (
              <div>
                {events
                  .filter((e) => e.eventType !== "GPS_PING")
                  .map((evt, i, arr) => (
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
                      isLast={i === arr.filter((e) => e.eventType !== "GPS_PING").length - 1}
                    />
                  ))}
              </div>
            ) : (
              <div>
                {STAGES.map((stage, i, arr) => (
                  <TimelineItem
                    key={stage}
                    label={EVENT_LABEL[stage] ?? stage}
                    status={evtStatus(stage, events)}
                    isLast={i === arr.length - 1}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── STOPS ── */}
        {tab === "stops" && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
            {trip.stops.length === 0 ? (
              <EmptyState title="No stops" />
            ) : (
              <div className="divide-y divide-slate-100">
                {/* Trip-level context header */}
                <div className="px-5 py-3 bg-paper flex items-center gap-3">
                  <span className="text-xs font-semibold text-steel uppercase tracking-wide">Customer</span>
                  <span className="text-sm font-medium text-ink">{customerName}</span>
                  {siteName !== "—" && (
                    <>
                      <span className="text-steel">·</span>
                      <span className="text-sm text-steel">{siteName}</span>
                    </>
                  )}
                </div>
                {trip.stops.map((stop, i) => (
                  <div key={stop.id} className="px-5 py-4">
                    <div className="flex items-start gap-4">
                      <div className="w-7 h-7 rounded-full bg-paper border border-slate-200 flex items-center justify-center text-xs font-semibold text-steel shrink-0 mt-0.5">
                        {stop.sequence}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-semibold text-ink">
                            {stop.orderNumber ?? `Stop ${stop.sequence}`}
                          </span>
                          <StatusBadge status={stop.status} size="xs" />
                        </div>
                        {/* Customer and site come from the trip-level normalized fields */}
                        <p className="text-xs text-steel">{customerName}</p>
                        {siteAddress !== "—" && (
                          <p className="text-xs text-steel mt-0.5">{siteAddress}</p>
                        )}
                        {trip.requiredTankerCapacityLtr && (
                          <p className="text-xs text-steel mt-0.5">
                            {trip.requiredTankerCapacityLtr.toLocaleString()} L required
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

        {/* ── ASSIGNMENT ── */}
        {tab === "assignment" && (
          <div className="grid lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-card">
              <h3 className="text-sm font-semibold text-ink mb-4">Driver</h3>
              {trip.driver ? (
                <DescriptionList items={[
                  { label: "Name", value: driverName },
                  { label: "Driver Code", value: trip.driver.driverCode ?? "—" },
                  { label: "Status", value: <StatusBadge status={trip.driver.status} /> },
                ]} />
              ) : (
                <EmptyState
                  title="No driver assigned"
                  action={
                    <a href="/dispatch/assign" className="text-sm text-aqua underline">
                      Assign in Assignment Workspace →
                    </a>
                  }
                />
              )}
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-card">
              <h3 className="text-sm font-semibold text-ink mb-4">Vehicle</h3>
              {trip.vehicle ? (
                <DescriptionList items={[
                  { label: "Plate", value: plate },
                  { label: "Vehicle Code", value: trip.vehicle.vehicleCode ?? "—" },
                  {
                    label: "Capacity",
                    value: trip.vehicle.capacityLiters != null
                      ? `${trip.vehicle.capacityLiters.toLocaleString()} L`
                      : "—",
                  },
                  { label: "Status", value: <StatusBadge status={trip.vehicle.status} /> },
                ]} />
              ) : (
                <EmptyState title="No vehicle assigned" />
              )}
            </div>
          </div>
        )}

        {/* ── POD ── */}
        {tab === "pod" && (
          <div className="space-y-4">
            {trip.stops.filter((s) => s.epod).map((stop) => (
              <div key={stop.id} className="bg-white rounded-xl border border-slate-200 p-5 shadow-card">
                <div className="flex items-center gap-2 mb-3">
                  <h3 className="text-sm font-semibold text-ink">
                    Stop {stop.sequence} — {customerName}
                  </h3>
                  <StatusBadge status={stop.status} size="xs" />
                </div>
                <DescriptionList items={[
                  { label: "Order", value: stop.orderNumber ?? "—" },
                  { label: "Signed at", value: fmtDt(stop.epod!.deliveredAt) },
                  {
                    label: "Delivered",
                    value: stop.epod!.deliveredQty != null
                      ? `${stop.epod!.deliveredQty.toLocaleString()} units`
                      : "—",
                  },
                  { label: "Recipient", value: stop.epod!.recipientName ?? "—" },
                ]} />
              </div>
            ))}
            {!hasPod && (
              <EmptyState
                title="No POD available"
                description="POD is captured by the driver on delivery completion."
              />
            )}
          </div>
        )}

        {tab === "gps" && (
          <div className="space-y-4">
            <div className="bg-infoLight/20 border border-info/20 rounded-xl p-4 text-xs text-steel">
              <strong>Actual GPS Trace</strong> — positions recorded from the vehicle/driver during this trip.
              This is NOT a computed or planned route. Demo (simulated) positions are marked with DEMO source.
            </div>
            {gpsLoading ? (
              <div className="text-sm text-steel text-center py-8">Loading GPS trace…</div>
            ) : gpsHistory === null ? (
              <div className="text-sm text-steel text-center py-8">Click GPS Trace tab to load.</div>
            ) : gpsHistory.length === 0 ? (
              <div className="bg-white rounded-xl border border-slate-200 shadow-card p-8 text-center text-steel text-sm">
                No GPS data recorded for this trip.{trip.status !== "COMPLETED" ? " GPS is updated live during active trips." : ""}
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
                <div className="px-5 py-3.5 border-b border-slate-100 bg-paper flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-semibold text-ink">GPS Trace ({gpsHistory.length} points)</h2>
                    <p className="text-xs text-steel mt-0.5">Chronological — oldest first</p>
                  </div>
                  <a href={`/telematics/replay?tripId=${trip.id}`}
                    className="text-xs text-aqua hover:underline font-medium">Full Replay →</a>
                </div>
                <div className="overflow-x-auto max-h-80 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-paper border-b border-slate-100">
                      <tr>
                        {["#","Time","Lat","Lng","Speed (m/s)","Heading","Source"].map(h => (
                          <th key={h} className="text-left font-semibold text-steel px-4 py-2">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {gpsHistory.map((p, i) => (
                        <tr key={i} className={p.source === "DEMO" ? "bg-warnLight/20" : "hover:bg-paper"}>
                          <td className="px-4 py-1.5 text-steel">{i + 1}</td>
                          <td className="px-4 py-1.5 font-mono">{new Date(p.recordedAt).toLocaleTimeString("en-SA")}</td>
                          <td className="px-4 py-1.5 font-mono">{p.lat.toFixed(5)}</td>
                          <td className="px-4 py-1.5 font-mono">{p.lng.toFixed(5)}</td>
                          <td className="px-4 py-1.5">{p.speed != null ? p.speed.toFixed(1) : "—"}</td>
                          <td className="px-4 py-1.5">{p.heading != null ? `${Math.round(p.heading)}°` : "—"}</td>
                          <td className={`px-4 py-1.5 font-medium ${p.source === "DEMO" ? "text-warn" : "text-steel"}`}>{p.source}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </PageContainer>
    </AdminShell>
  );
}
