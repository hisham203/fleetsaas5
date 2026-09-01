"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import TopNav from "@/components/TopNav";
import StatusBadge from "@/components/StatusBadge";
import { useRequireSession } from "@/lib/useSession";
import { computeSlaStatus } from "@/lib/sla";

export default function DriverPage() {
  const { session, loading: sessionLoading } = useRequireSession(["DRIVER"]);
  const [trips, setTrips] = useState<any[]>([]);
  const [epodStop, setEpodStop] = useState<any | null>(null);
  const [tasks, setTasks] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const gpsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const driverId = session?.driverProfileId ?? null;

  const load = useCallback(async () => {
    if (!session) return;
    const [tr, tk, ex] = await Promise.all([
      fetch(`/api/trips?tenantId=${session.tenantId}`).then((r) => r.json()),
      fetch(`/api/tasks`).then((r) => r.json()),
      fetch(`/api/expenses`).then((r) => r.json()),
    ]);
    setTrips(tr);
    setTasks(tk);
    setExpenses(ex);
  }, [session]);

  useEffect(() => {
    if (!session) return;
    load();
    const interval = setInterval(load, 4000);
    return () => clearInterval(interval);
  }, [session, load]);

  const myTrip = trips.find(
    (t) => t.driverId === driverId && (t.status === "DISPATCHED" || t.status === "IN_PROGRESS")
  );

  // BR-12 Live Location Tracking (simulated): while a trip is dispatched,
  // interpolate a position along the stop sequence and ping the server
  // every few seconds — standing in for a real device's GPS updates. See
  // README for how to swap this for a real GPS/IoT integration.
  useEffect(() => {
    if (gpsIntervalRef.current) {
      clearInterval(gpsIntervalRef.current);
      gpsIntervalRef.current = null;
    }
    if (!myTrip) return;

    const coords = myTrip.stops
      .filter((s: any) => s.order?.lat != null && s.order?.lng != null)
      .sort((a: any, b: any) => a.sequence - b.sequence)
      .map((s: any) => ({ lat: s.order.lat, lng: s.order.lng }));
    if (coords.length === 0) return;

    let step = 0;
    const totalSteps = coords.length * 10; // 10 ticks between each stop, ~30s at 3s/tick

    gpsIntervalRef.current = setInterval(() => {
      const segment = Math.min(Math.floor(step / 10), coords.length - 1);
      const nextSegment = Math.min(segment + 1, coords.length - 1);
      const t = (step % 10) / 10;
      const lat = coords[segment].lat + (coords[nextSegment].lat - coords[segment].lat) * t;
      const lng = coords[segment].lng + (coords[nextSegment].lng - coords[segment].lng) * t;

      fetch(`/api/trips/${myTrip.id}/gps`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat, lng }),
      }).catch(() => {});

      step = (step + 1) % (totalSteps + 1);
    }, 3000);

    return () => {
      if (gpsIntervalRef.current) clearInterval(gpsIntervalRef.current);
    };
    // Intentional: depending on the full `myTrip` object (which gets a new
    // reference on every 4s poll even when nothing changed) would restart
    // this interval constantly; only restart when the trip actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myTrip?.id]);

  async function checkIn(tripId: string, stopId: string) {
    await fetch(`/api/trips/${tripId}/stops/${stopId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "arrive" }),
    });
    load();
  }

  async function markFailed(tripId: string, stopId: string, reason: string) {
    await fetch(`/api/trips/${tripId}/stops/${stopId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "fail", failureReason: reason }),
    });
    load();
  }

  if (sessionLoading || !session) {
    return <main className="min-h-screen bg-paper"><TopNav role="Driver" /><p className="p-6 text-steel">Loading…</p></main>;
  }

  return (
    <main className="min-h-screen bg-paper">
      <TopNav role={`Driver — ${session.name}`} />
      <div className="p-6 max-w-lg mx-auto">
        {!myTrip && (
          <div className="bg-white rounded-xl border border-slate-200 p-4 text-center text-steel text-sm">
            No dispatched trip right now. Check back once the dispatcher assigns one.
          </div>
        )}

        {myTrip && (
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="font-mono text-sm">{myTrip.tripNumber}</span>
              <StatusBadge status={myTrip.status} />
            </div>
            <p className="text-steel text-xs mb-4">Vehicle {myTrip.vehicle.plateNumber} · {myTrip.stops.length} stop(s)</p>

            <div className="space-y-3">
              {myTrip.stops
                .sort((a: any, b: any) => a.sequence - b.sequence)
                .map((stop: any) => (
                  <StopCard
                    key={stop.id}
                    stop={stop}
                    tripId={myTrip.id}
                    onArrive={() => checkIn(myTrip.id, stop.id)}
                    onDeliver={() => setEpodStop({ ...stop, tripId: myTrip.id })}
                    onFail={(reason: string) => markFailed(myTrip.id, stop.id, reason)}
                  />
                ))}
            </div>
          </div>
        )}

        <DriverTasksAndExpenses driverId={driverId} tasks={tasks} expenses={expenses} vehicleId={myTrip?.vehicle?.id} tripId={myTrip?.id} onChange={load} />
      </div>

      {epodStop && (
        <EpodModal
          stop={epodStop}
          onClose={() => setEpodStop(null)}
          onSubmit={async (payload: Record<string, unknown>) => {
            await fetch(`/api/trips/${epodStop.tripId}/stops/${epodStop.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            });
            setEpodStop(null);
            load();
          }}
        />
      )}
    </main>
  );
}

function StopCard({ stop, onArrive, onDeliver, onFail }: any) {
  const [showFail, setShowFail] = useState(false);
  const [reason, setReason] = useState("");

  const sla = stop.order.createdAt
    ? computeSlaStatus({
        createdAt: stop.order.createdAt,
        slaMinutes: stop.order.slaMinutes ?? 180,
        status: stop.order.status,
        completedAt: stop.order.completedAt,
      })
    : null;

  return (
    <div className="border border-slate-100 rounded-lg p-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-medium">{stop.sequence}. {stop.order.customer?.name}</span>
        <div className="flex items-center gap-1.5">
          {sla && (sla.slaStatus === "AT_RISK" || sla.slaStatus === "BREACHED") && (
            <StatusBadge status={sla.slaStatus} />
          )}
          <StatusBadge status={stop.status} />
        </div>
      </div>
      <p className="text-steel text-xs mb-2">{stop.order.deliveryAddress}</p>
      <p className="text-steel text-xs mb-2">
        Order: {stop.order.qtyOrdered} × {stop.order.bottleSizeLtr}L
        {stop.order.emptyBottlesToCollect ? ` · collect ${stop.order.emptyBottlesToCollect} empties` : ""}
      </p>

      {stop.status === "PENDING" && (
        <button onClick={onArrive} className="w-full bg-ink text-white rounded-lg py-1.5 text-xs font-medium">
          Arrived at stop
        </button>
      )}

      {stop.status === "ARRIVED" && !showFail && (
        <div className="flex gap-2">
          <button onClick={onDeliver} className="flex-1 bg-ok text-white rounded-lg py-1.5 text-xs font-medium">
            Confirm delivery
          </button>
          <button onClick={() => setShowFail(true)} className="flex-1 bg-danger text-white rounded-lg py-1.5 text-xs font-medium">
            Report failure
          </button>
        </div>
      )}

      {showFail && (
        <div className="space-y-2 mt-2">
          <input className="w-full border rounded-lg px-2 py-1.5 text-xs" placeholder="Reason (e.g. customer not home)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex gap-2">
            <button onClick={() => { onFail(reason || "Not specified"); setShowFail(false); }} className="flex-1 bg-danger text-white rounded-lg py-1.5 text-xs font-medium">
              Confirm failure
            </button>
            <button onClick={() => setShowFail(false)} className="flex-1 border border-slate-200 rounded-lg py-1.5 text-xs">
              Cancel
            </button>
          </div>
        </div>
      )}

      {(stop.status === "DELIVERED" || stop.status === "PARTIALLY_DELIVERED") && stop.epod && (
        <p className="text-ok text-xs">
          Delivered {stop.epod.deliveredQty} bottle(s){stop.epod.recipientName ? ` to ${stop.epod.recipientName}` : ""}
        </p>
      )}
      {stop.status === "FAILED" && <p className="text-danger text-xs">Marked failed</p>}
    </div>
  );
}

function EpodModal({ stop, onClose, onSubmit }: any) {
  const [deliveredQty, setQty] = useState(stop.order.qtyOrdered);
  const [emptiesCollected, setEmpties] = useState(stop.order.emptyBottlesToCollect ?? 0);
  const [recipientName, setRecipient] = useState("");
  const [notes, setNotes] = useState("");

  const isPartial = deliveredQty < stop.order.qtyOrdered;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl p-5 w-full max-w-sm">
        <h3 className="font-medium mb-1">Proof of delivery</h3>
        <p className="text-steel text-xs mb-4">{stop.order.customer?.name} · {stop.order.orderNumber}</p>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-steel">Bottles delivered</label>
            <input type="number" className="w-full border rounded-lg px-3 py-2 text-sm mt-1" value={deliveredQty} onChange={(e) => setQty(Number(e.target.value))} />
            {isPartial && <p className="text-warn text-xs mt-1">Less than ordered ({stop.order.qtyOrdered}) — will record as partial delivery.</p>}
          </div>
          <div>
            <label className="text-xs text-steel">Empty bottles collected</label>
            <input type="number" className="w-full border rounded-lg px-3 py-2 text-sm mt-1" value={emptiesCollected} onChange={(e) => setEmpties(Number(e.target.value))} />
          </div>
          <div>
            <label className="text-xs text-steel">Recipient name</label>
            <input className="w-full border rounded-lg px-3 py-2 text-sm mt-1" value={recipientName} onChange={(e) => setRecipient(e.target.value)} placeholder="Who received it" />
          </div>
          <div>
            <label className="text-xs text-steel">Notes</label>
            <input className="w-full border rounded-lg px-3 py-2 text-sm mt-1" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
          </div>
        </div>

        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="flex-1 border border-slate-200 rounded-lg py-2 text-sm">Cancel</button>
          <button
            onClick={() =>
              onSubmit({
                action: isPartial ? "partial" : "deliver",
                deliveredQty,
                emptiesCollected,
                recipientName,
                notes,
              })
            }
            className="flex-1 bg-ok text-white rounded-lg py-2 text-sm font-medium"
          >
            Submit ePOD
          </button>
        </div>
      </div>
    </div>
  );
}

// BR-23: Task, Expense & Field Activity Management — tasks beyond ordinary
// delivery stops (inspection, collection, visit, refuel, exception
// handling), plus an expense-claim form. Every submitted expense needs
// either the active trip or a typed reason (enforced server-side); the
// receipt field is text-only — there's no real file/photo upload wired
// into this build.
function DriverTasksAndExpenses({ driverId, tasks, expenses, vehicleId, tripId, onChange }: any) {
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [category, setCategory] = useState("FUEL");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [receiptDescription, setReceiptDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const openTasks = tasks.filter((t: any) => t.status === "ASSIGNED" || t.status === "IN_PROGRESS");

  async function taskAction(taskId: string, action: string) {
    await fetch(`/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, completionNotes: action === "COMPLETE" ? "Completed via driver app" : undefined }),
    });
    onChange();
  }

  async function submitExpense() {
    setError("");
    setSubmitting(true);
    const res = await fetch("/api/expenses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        driverId,
        vehicleId,
        tripId: tripId || undefined,
        reason: tripId ? undefined : reason,
        category,
        amount: Number(amount),
        receiptDescription: receiptDescription || undefined,
      }),
    });
    const data = await res.json();
    setSubmitting(false);
    if (!res.ok) {
      setError(typeof data.error === "string" ? data.error : "Failed to submit expense");
      return;
    }
    setAmount("");
    setReason("");
    setReceiptDescription("");
    setShowExpenseForm(false);
    onChange();
  }

  return (
    <div className="mt-4 space-y-4">
      {openTasks.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h3 className="font-medium text-sm mb-2">Your tasks</h3>
          <div className="space-y-2">
            {openTasks.map((t: any) => (
              <div key={t.id} className="border border-slate-100 rounded-lg p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{t.title}</span>
                  <StatusBadge status={t.type} />
                </div>
                <p className="text-steel text-xs mt-1">{t.status}</p>
                <div className="flex gap-2 mt-2">
                  {t.status === "ASSIGNED" && (
                    <button onClick={() => taskAction(t.id, "START")} className="bg-ink text-white rounded-lg px-3 py-1 text-xs font-medium">
                      Start
                    </button>
                  )}
                  {(t.status === "ASSIGNED" || t.status === "IN_PROGRESS") && (
                    <button onClick={() => taskAction(t.id, "COMPLETE")} className="bg-ok text-white rounded-lg px-3 py-1 text-xs font-medium">
                      Complete
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-medium text-sm">Expenses</h3>
          <button onClick={() => setShowExpenseForm((s) => !s)} className="text-aquaDark text-xs font-medium">
            {showExpenseForm ? "Cancel" : "+ Submit expense"}
          </button>
        </div>

        {showExpenseForm && (
          <div className="space-y-2 mb-3 pb-3 border-b border-slate-100">
            <select className="w-full border rounded-lg px-3 py-2 text-sm" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="FUEL">Fuel</option>
              <option value="TOLL">Road toll</option>
              <option value="MAINTENANCE">Emergency maintenance</option>
              <option value="OTHER">Other</option>
            </select>
            <input type="number" className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Amount (SAR)" value={amount} onChange={(e) => setAmount(e.target.value)} />
            {!tripId && (
              <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Reason (required — no active trip)" value={reason} onChange={(e) => setReason(e.target.value)} />
            )}
            <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Receipt details (optional)" value={receiptDescription} onChange={(e) => setReceiptDescription(e.target.value)} />
            {error && <p className="text-danger text-xs">{error}</p>}
            <button
              disabled={!amount || (!tripId && !reason) || submitting}
              onClick={submitExpense}
              className="w-full bg-ink text-white rounded-lg py-2 text-sm font-medium disabled:opacity-40"
            >
              Submit for approval
            </button>
          </div>
        )}

        <div className="space-y-2">
          {expenses.slice(0, 5).map((e: any) => (
            <div key={e.id} className="flex items-center justify-between text-sm">
              <span>{e.category} — SAR {e.amount.toFixed(2)}</span>
              <span className={e.status === "APPROVED" ? "text-ok text-xs" : e.status === "REJECTED" ? "text-danger text-xs" : "text-steel text-xs"}>
                {e.status}
              </span>
            </div>
          ))}
          {expenses.length === 0 && <p className="text-steel text-xs">No expenses submitted yet.</p>}
        </div>
      </div>
    </div>
  );
}
