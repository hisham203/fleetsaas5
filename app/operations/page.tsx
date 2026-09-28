"use client";
/**
 * Operations Workspace V2 — Milestone B
 *
 * Primary daily workspace for the Operations Supervisor.
 * Answers: "What needs attention right now?"
 *
 * Data: real APIs only. No fake metrics.
 * Permissions: TRIPS_VIEW + CONTROL_TOWER_VIEW
 */
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import AdminShell from "@/components/AdminShell";
import {
  PageContainer, PageHeader, MetricCard, StatusBadge,
  EmptyState, LoadingState, Btn, FilterBar, Tabs,
} from "@/components/ds";

// ── Types ──────────────────────────────────────────────────────────────────
type Trip = {
  id: string; tripNumber: string; status: string; tenantId: string;
  createdAt: string; dispatchedAt?: string; completedAt?: string;
  driverId?: string; vehicleId?: string;
  driver?: { id: string; name?: string; user?: { name?: string } };
  vehicle?: { id: string; plateNumber?: string; capacityLiters?: number };
  warehouse?: { id: string; name?: string };
  stops?: Array<{
    id: string; sequence: number; status: string;
    order?: {
      id: string; orderNumber: string; status: string; type?: string;
      customer?: { name: string };
      deliveryAddress?: string; qtyOrdered?: number;
    };
  }>;
};

type OpsOrder = {
  id: string; orderNumber: string; status: string; type?: string;
  createdAt: string; slaMinutes?: number;
  customer?: { name: string }; deliveryAddress?: string;
  slaStatus?: string; minutesRemaining?: number;
  qtyOrdered?: number; bottleSizeLtr?: number;
};

type SlaOrder = OpsOrder & { slaStatus: string; minutesRemaining: number | null; dueBy: string | null };

type Exception = {
  id: string; orderId: string; tripStopId: string; type: string; reason?: string;
  status: string; escalated: boolean; createdAt: string;
  order?: { orderNumber: string; customer?: { name: string } };
};

// ── Helpers ────────────────────────────────────────────────────────────────
function elapsed(from: string): string {
  const m = Math.round((Date.now() - new Date(from).getTime()) / 60000);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
function fmt(dt?: string) {
  if (!dt) return "—";
  return new Date(dt).toLocaleTimeString("en-SA", { hour: "2-digit", minute: "2-digit" });
}
function customer(trip: Trip) {
  return trip.stops?.[0]?.order?.customer?.name ?? "—";
}

// ── Operational row ────────────────────────────────────────────────────────
function TripRow({ trip, onOpen }: { trip: Trip; onOpen: (t: Trip) => void }) {
  const plate = trip.vehicle?.plateNumber ?? "—";
  const driverName = trip.driver?.user?.name ?? trip.driver?.name ?? "—";
  const isUnassigned = !trip.driverId;
  const age = elapsed(trip.createdAt);

  return (
    <tr className="hover:bg-paper transition-colors cursor-pointer" onClick={() => onOpen(trip)}>
      <td className="px-4 py-3">
        <div className="text-sm font-semibold text-aqua">{trip.tripNumber}</div>
        <div className="text-xs text-steel">{age} ago</div>
      </td>
      <td className="px-4 py-3">
        <StatusBadge status={trip.status} size="sm" />
        {isUnassigned && trip.status === "PLANNED" && (
          <span className="ml-1.5 text-2xs text-warn font-medium">Unassigned</span>
        )}
      </td>
      <td className="px-4 py-3 text-sm text-ink">{customer(trip)}</td>
      <td className="px-4 py-3 text-sm text-steel">{plate}</td>
      <td className="px-4 py-3 text-sm text-steel">
        {driverName !== "—" ? driverName : <span className="text-warn">—</span>}
      </td>
      <td className="px-4 py-3 text-sm text-steel">{trip.warehouse?.name ?? "—"}</td>
      <td className="px-4 py-3 text-xs text-steel">{fmt(trip.dispatchedAt)}</td>
      <td className="px-4 py-3">
        <Btn variant="ghost" size="xs" onClick={() => onOpen(trip)}>View →</Btn>
      </td>
    </tr>
  );
}

function OrderRow({ order }: { order: SlaOrder }) {
  const slaColor =
    order.slaStatus === "BREACHED" ? "text-danger" :
    order.slaStatus === "AT_RISK" ? "text-warn" : "text-ok";
  const minsLeft = order.minutesRemaining != null ? Math.round(order.minutesRemaining) : null;

  return (
    <tr className="hover:bg-paper transition-colors">
      <td className="px-4 py-3 text-sm font-semibold text-ink">{order.orderNumber}</td>
      <td className="px-4 py-3">
        <StatusBadge status={order.status} size="xs" />
      </td>
      <td className="px-4 py-3 text-sm text-ink">{order.customer?.name ?? "—"}</td>
      <td className="px-4 py-3 text-sm text-steel">{order.type ?? "—"}</td>
      <td className="px-4 py-3">
        {order.slaStatus ? (
          <span className={`text-xs font-medium ${slaColor}`}>
            {order.slaStatus}{minsLeft != null ? ` (${minsLeft}m)` : ""}
          </span>
        ) : "—"}
      </td>
      <td className="px-4 py-3 text-xs text-steel">{elapsed(order.createdAt)} ago</td>
    </tr>
  );
}

function ExceptionRow({ exc }: { exc: Exception }) {
  return (
    <tr className="hover:bg-paper transition-colors">
      <td className="px-4 py-3 text-sm font-semibold text-ink">{exc.order?.orderNumber ?? "—"}</td>
      <td className="px-4 py-3 text-sm text-steel">{exc.type}</td>
      <td className="px-4 py-3 text-sm text-ink">{exc.order?.customer?.name ?? "—"}</td>
      <td className="px-4 py-3"><StatusBadge status={exc.status} size="xs" /></td>
      <td className="px-4 py-3">
        {exc.escalated && <span className="text-2xs bg-dangerLight text-danger px-1.5 py-0.5 rounded font-medium">Escalated</span>}
      </td>
      <td className="px-4 py-3 text-xs text-steel">{elapsed(exc.createdAt)} ago</td>
    </tr>
  );
}

// ── Main component ─────────────────────────────────────────────────────────
export default function OperationsWorkspacePage() {
  const router = useRouter();

  const [trips, setTrips] = useState<Trip[]>([]);
  const [slaOrders, setSlaOrders] = useState<SlaOrder[]>([]);
  const [exceptions, setExceptions] = useState<Exception[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("all");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const [tRes, sRes, eRes, vRes, dRes] = await Promise.allSettled([
      fetch("/api/trips"),
      fetch("/api/sla"),
      fetch("/api/exceptions?status=OPEN"),
      fetch("/api/vehicles"),
      fetch("/api/drivers"),
    ]);
    if (tRes.status === "fulfilled" && tRes.value.ok) setTrips(await tRes.value.json() ?? []);
    if (sRes.status === "fulfilled" && sRes.value.ok) setSlaOrders(await sRes.value.json() ?? []);
    if (eRes.status === "fulfilled" && eRes.value.ok) setExceptions(await eRes.value.json() ?? []);
    if (vRes.status === "fulfilled" && vRes.value.ok) {
      const v = await vRes.value.json();
      setVehicles(Array.isArray(v) ? v : []);
    }
    if (dRes.status === "fulfilled" && dRes.value.ok) {
      const d = await dRes.value.json();
      setDrivers(Array.isArray(d) ? d : []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const tripsArr = Array.isArray(trips) ? trips : [];
  const slaArr = Array.isArray(slaOrders) ? slaOrders : [];
  const excArr = Array.isArray(exceptions) ? exceptions : [];

  // Derived metrics
  const planned = tripsArr.filter(t => t.status === "PLANNED");
  const unassigned = planned.filter(t => !t.driverId);
  const readyToDispatch = planned.filter(t => t.driverId && t.vehicleId);
  const active = tripsArr.filter(t => t.status === "DISPATCHED" || t.status === "IN_PROGRESS");
  const completed = tripsArr.filter(t => t.status === "COMPLETED");
  const failed = tripsArr.filter(t => t.status === "FAILED");
  const atRisk = slaArr.filter(s => s.slaStatus === "AT_RISK" || s.slaStatus === "BREACHED");
  const openExceptions = excArr.filter(e => e.status === "OPEN");
  const availVehicles = vehicles.filter(v => v.status === "AVAILABLE");
  const availDrivers = drivers.filter(d => d.status === "AVAILABLE");

  // Filter trips by tab + search
  const filteredTrips = tripsArr.filter(t => {
    const matchTab =
      tab === "all" ? true :
      tab === "unassigned" ? (!t.driverId && t.status === "PLANNED") :
      tab === "ready" ? (t.driverId && t.vehicleId && t.status === "PLANNED") :
      tab === "active" ? (t.status === "DISPATCHED" || t.status === "IN_PROGRESS") :
      tab === "completed" ? t.status === "COMPLETED" :
      tab === "failed" ? t.status === "FAILED" :
      tab === "planned" ? t.status === "PLANNED" : true;
    const q = search.toLowerCase();
    const matchSearch = !q || t.tripNumber.toLowerCase().includes(q) ||
      customer(t).toLowerCase().includes(q) ||
      (t.vehicle?.plateNumber ?? "").toLowerCase().includes(q) ||
      (t.driver?.user?.name ?? t.driver?.name ?? "").toLowerCase().includes(q);
    return matchTab && matchSearch;
  });

  const TABS = [
    { id: "all", label: "All", badge: tripsArr.length },
    { id: "unassigned", label: "Unassigned", badge: unassigned.length },
    { id: "ready", label: "Ready", badge: readyToDispatch.length },
    { id: "active", label: "Active", badge: active.length },
    { id: "planned", label: "Planned", badge: planned.length },
    { id: "completed", label: "Completed", badge: completed.length },
    { id: "failed", label: "Failed", badge: failed.length },
  ];

  return (
    <AdminShell title="Operations">
      <PageContainer>
        <PageHeader
          title="Operations Workspace"
          subtitle="Live operational status — what needs attention right now"
          breadcrumbs={[{ label: "Operations" }, { label: "Workspace" }]}
          actions={
            <div className="flex gap-2">
              <a href="/dispatch" className="inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 bg-white border border-slate-200 rounded-lg hover:bg-paper transition-colors text-ink">
                + New Order
              </a>
              <a href="/dispatch/assign" className="inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 bg-aqua text-white rounded-lg hover:bg-aquaDark transition-colors">
                Assignment Workspace →
              </a>
              <Btn variant="ghost" size="sm" onClick={load}>↺</Btn>
            </div>
          }
        />

        {/* Operational KPIs — click-to-filter */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5 mb-6">
          <button onClick={() => setTab("unassigned")} className="text-left">
            <MetricCard label="Unassigned" value={unassigned.length}
              accent={unassigned.length > 0 ? "warn" : "default"}
              trendLabel="Awaiting resources" />
          </button>
          <button onClick={() => setTab("ready")} className="text-left">
            <MetricCard label="Ready" value={readyToDispatch.length}
              accent={readyToDispatch.length > 0 ? "info" : "default"}
              trendLabel="Assigned, not dispatched" />
          </button>
          <button onClick={() => setTab("active")} className="text-left">
            <MetricCard label="Active" value={active.length}
              accent={active.length > 0 ? "info" : "default"}
              trendLabel="In progress" />
          </button>
          <MetricCard label="SLA Risk" value={atRisk.length}
            accent={atRisk.length > 0 ? "danger" : "default"} trendLabel="At risk or breached" />
          <button onClick={() => setTab("all")} className="text-left">
            <MetricCard label="Exceptions" value={openExceptions.length}
              accent={openExceptions.length > 0 ? "danger" : "default"} trendLabel="Open" />
          </button>
          <MetricCard label="Avail. Drivers" value={availDrivers.length} accent="ok" />
          <MetricCard label="Avail. Vehicles" value={availVehicles.length} accent="ok" />
          <button onClick={() => setTab("completed")} className="text-left">
            <MetricCard label="Completed" value={completed.length} accent="default" />
          </button>
        </div>

        {/* Main content: trip queue + SLA + exceptions */}
        <div className="grid xl:grid-cols-3 gap-6">
          {/* Trip queue — 2/3 width */}
          <div className="xl:col-span-2">
            <Tabs tabs={TABS} active={tab} onChange={t => setTab(t)} />
            <FilterBar
              search={search} onSearch={setSearch}
              onClear={() => { setSearch(""); }}
            />
            {loading ? <LoadingState /> : filteredTrips.length === 0 ? (
              <EmptyState
                title={`No trips ${tab === "all" ? "" : `in "${tab}"`}`}
                description="Adjust filters or create a new order."
              />
            ) : (
              <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 bg-paper">
                        {["Trip", "Status", "Customer", "Vehicle", "Driver", "Loading Point", "Dispatched", ""].map(h => (
                          <th key={h} className="text-left text-xs font-semibold text-steel px-4 py-3 whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredTrips.map(t => (
                        <TripRow key={t.id} trip={t}
                          onOpen={t => router.push(`/operations/trips/${t.id}`)} />
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="px-4 py-2.5 border-t border-slate-100 text-xs text-steel">
                  {filteredTrips.length} trips
                </div>
              </div>
            )}
          </div>

          {/* Right panel: SLA risks + open exceptions */}
          <div className="space-y-5">
            {/* SLA at-risk orders */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-card">
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
                <h2 className="text-sm font-semibold text-ink">
                  SLA Monitor <span className="text-steel font-normal">({atRisk.length})</span>
                </h2>
                <a href="/admin/reports" className="text-xs text-aqua hover:underline">All SLA →</a>
              </div>
              <div className="overflow-x-auto">
                {atRisk.length === 0 ? (
                  <div className="px-5 py-6 text-center text-xs text-steel">All orders on track</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-50 bg-paper">
                        {["Order", "Customer", "SLA"].map(h => (
                          <th key={h} className="text-left text-xs font-semibold text-steel px-4 py-2">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {atRisk.slice(0, 8).map((o: SlaOrder) => {
                        const color = o.slaStatus === "BREACHED" ? "text-danger" : "text-warn";
                        return (
                          <tr key={o.id} className="hover:bg-paper">
                            <td className="px-4 py-2 text-xs font-medium text-ink">{o.orderNumber}</td>
                            <td className="px-4 py-2 text-xs text-steel truncate max-w-[100px]">{o.customer?.name ?? "—"}</td>
                            <td className={`px-4 py-2 text-xs font-semibold ${color}`}>
                              {o.slaStatus}{o.minutesRemaining != null ? ` ${Math.round(o.minutesRemaining)}m` : ""}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            {/* Open exceptions */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-card">
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
                <h2 className="text-sm font-semibold text-ink">
                  Open Exceptions <span className="text-steel font-normal">({openExceptions.length})</span>
                </h2>
                <a href="/operations/exceptions" className="text-xs text-aqua hover:underline">View all →</a>
              </div>
              {openExceptions.length === 0 ? (
                <div className="px-5 py-6 text-center text-xs text-ok">No open exceptions</div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {openExceptions.slice(0, 6).map(exc => (
                    <div key={exc.id} className="px-5 py-3 flex items-start gap-3">
                      <div className="w-1.5 h-1.5 rounded-full bg-danger mt-1.5 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-ink">{exc.order?.customer?.name ?? "—"}</p>
                        <p className="text-2xs text-steel">{exc.type} · {exc.order?.orderNumber ?? "—"}</p>
                        {exc.escalated && (
                          <span className="text-2xs text-danger font-medium">Escalated</span>
                        )}
                      </div>
                      <div className="ml-auto text-2xs text-slate-400 shrink-0">
                        {elapsed(exc.createdAt)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Quick links */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-card p-5">
              <h2 className="text-sm font-semibold text-ink mb-3">Quick Actions</h2>
              <div className="space-y-1.5">
                {[
                  { label: "Planning & Dispatch", href: "/dispatch", hint: "Create orders · Plan trips" },
                  { label: "Assignment Workspace", href: "/dispatch/assign", hint: "Assign drivers & vehicles" },
                  { label: "Control Tower", href: "/control-tower", hint: "Live fleet map" },
                  { label: "Exceptions", href: "/operations/exceptions", hint: "Manage open exceptions" },
                  { label: "Loading Points", href: "/admin/loading-points", hint: "Warehouse configuration" },
                ].map(a => (
                  <a key={a.href} href={a.href}
                    className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-paper transition-colors group">
                    <div>
                      <div className="text-sm font-medium text-ink">{a.label}</div>
                      <div className="text-2xs text-steel">{a.hint}</div>
                    </div>
                    <span className="text-slate-300 group-hover:text-steel text-sm">›</span>
                  </a>
                ))}
              </div>
            </div>
          </div>
        </div>
      </PageContainer>
    </AdminShell>
  );
}
