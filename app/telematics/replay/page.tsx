"use client";
/**
 * Trip Replay
 * Route: /telematics/replay
 *
 * IMPORTANT DISTINCTION:
 *   ACTUAL GPS TRACE — positions recorded from the vehicle/driver during the trip
 *   PLANNED ROUTE    — Google Routes computed path (via /api/trips/[id]/demo-route)
 *
 * This page shows the ACTUAL GPS TRACE only. The planned route is not shown
 * here to avoid misleading the user about actual vehicle path.
 */
import { useState, useEffect } from "react";
import AdminShell from "@/components/AdminShell";
import { PageContainer, PageHeader, EmptyState, LoadingState, Btn } from "@/components/ds";

interface TracePoint { lat: number; lng: number; speed: number | null; heading: number | null; recordedAt: string; source: string }
interface ReplayData {
  trip: { id: string; tripNumber: string; status: string; startedAt: string | null; completedAt: string | null;
          vehicle: { plateNumber: string; vehicleType: string } | null;
          driver: { name: string } | null };
  actualTrace: TracePoint[];
  traceType: "ACTUAL_GPS";
  pointCount: number;
  hasDemoPoints: boolean;
}

function fmtTime(d: string) {
  return new Date(d).toLocaleTimeString("en-SA", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function TripReplayPage() {
  const [tripId, setTripId] = useState("");
  const [data, setData] = useState<ReplayData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<number>(0); // index into actualTrace for playback
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<1|2|4>(1);

  // Playback effect:
  useEffect(() => {
    if (!playing || !data || cursor >= data.actualTrace.length - 1) {
      setPlaying(false); return;
    }
    const ms = Math.round(500 / speed);
    const tid = setTimeout(() => setCursor(c => c + 1), ms);
    return () => clearTimeout(tid);
  }, [playing, cursor, data, speed]);

  async function loadReplay() {
    if (!tripId.trim()) return;
    setLoading(true); setError(null); setData(null);
    const res = await fetch(`/api/telematics/trips/${encodeURIComponent(tripId.trim())}/replay`).catch(() => null);
    if (!res?.ok) {
      const d = await res?.json().catch(() => null);
      setError(d?.error ?? "Trip not found or you don't have access.");
      setLoading(false); return;
    }
    setData(await res.json());
    setCursor(0); setPlaying(false);
    setLoading(false);
  }

  return (
    <AdminShell title="Trip Replay">
      <PageContainer>
        <PageHeader
          title="Trip Replay"
          subtitle="View the actual GPS trace recorded during a trip"
          breadcrumbs={[{ label: "Telematics" }, { label: "Trip Replay" }]}
        />

        <div className="bg-white rounded-xl border border-slate-200 shadow-card p-5 mb-6 max-w-lg">
          <h3 className="text-sm font-semibold text-ink mb-3">Load Trip</h3>
          <div className="flex gap-2">
            <input
              className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-aqua/30"
              placeholder="Trip ID or Trip Number (e.g. TRIP-MU69IH00-697)"
              value={tripId} onChange={e => setTripId(e.target.value)}
              onKeyDown={e => e.key === "Enter" && loadReplay()}
            />
            <Btn variant="primary" size="sm" disabled={!tripId.trim() || loading} onClick={loadReplay}>
              {loading ? "Loading…" : "Load"}
            </Btn>
          </div>
          {error && <p className="text-xs text-danger mt-2">{error}</p>}
        </div>

        {loading && <LoadingState label="Loading GPS trace…" />}

        {data && (
          <div className="space-y-4">
            {/* Trip Summary */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-card p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-semibold text-ink">{data.trip.tripNumber}</p>
                  <p className="text-xs text-steel mt-0.5">
                    {data.trip.vehicle?.plateNumber ?? "—"} · {data.trip.driver?.name ?? "No driver"}
                  </p>
                </div>
                <div className="text-end">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded ${
                    data.trip.status === "COMPLETED" ? "bg-okLight text-ok" : "bg-infoLight text-info"
                  }`}>{data.trip.status}</span>
                </div>
              </div>
              {data.hasDemoPoints && (
                <div className="mt-3 text-xs bg-warnLight text-warn rounded-lg px-3 py-2">
                  ⚠ This trip includes GPS Demo (simulated) positions, marked with DEMO source below.
                </div>
              )}
              <div className="mt-3 flex gap-4 text-xs text-steel">
                <span><strong>{data.pointCount}</strong> GPS points</span>
                {data.trip.startedAt && <span>Started: {new Date(data.trip.startedAt).toLocaleString("en-SA")}</span>}
                {data.trip.completedAt && <span>Completed: {new Date(data.trip.completedAt).toLocaleString("en-SA")}</span>}
              </div>
              <p className="mt-2 text-2xs text-steel/60 italic">
                Trace type: ACTUAL_GPS — positions recorded from the vehicle/driver, NOT a computed planned route.
              </p>
            </div>

            {data.pointCount === 0 ? (
              <EmptyState title="No GPS trace recorded" description="This trip has no GPS position history. The driver may not have enabled location sharing." />
            ) : (
              <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
                <div className="px-5 py-3.5 border-b border-slate-100 bg-paper">
                  <h2 className="text-sm font-semibold text-ink">Actual GPS Trace ({data.pointCount} points)</h2>
                  <p className="text-xs text-steel mt-0.5">Chronological — oldest first</p>
                </div>
                {/* Playback Controls */}
              <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-3 bg-paper">
                <button onClick={() => setCursor(0)} className="text-xs text-steel hover:text-ink" title="Reset">⏮</button>
                <button onClick={() => setCursor(c => Math.max(0, c - 1))} className="text-xs text-steel hover:text-ink" title="Step back">⏪</button>
                <button onClick={() => setPlaying(p => !p)}
                  className="text-xs bg-aqua text-white px-3 py-1 rounded-lg font-medium hover:bg-aqua/90">
                  {playing ? "⏸ Pause" : "▶ Play"}
                </button>
                <button onClick={() => setCursor(c => Math.min((data?.pointCount ?? 1) - 1, c + 1))} className="text-xs text-steel hover:text-ink" title="Step forward">⏩</button>
                <span className="text-xs text-steel">Point {cursor + 1} / {data?.pointCount}</span>
                <span className="text-xs text-steel ms-auto">Speed:</span>
                {([1,2,4] as const).map(s => (
                  <button key={s} onClick={() => setSpeed(s)}
                    className={`text-xs px-2 py-0.5 rounded ${speed === s ? "bg-aqua text-white" : "bg-white border border-slate-200 text-steel"}`}>
                    {s}x
                  </button>
                ))}
              </div>
              <div className="overflow-x-auto max-h-96 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-paper border-b border-slate-100">
                      <tr>
                        {["#", "Time", "Lat", "Lng", "Speed (m/s)", "Heading", "Source"].map(h => (
                          <th key={h} className="text-start font-semibold text-steel px-4 py-2">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.actualTrace.map((p, i) => (
                        <tr key={i} onClick={() => setCursor(i)} className={`cursor-pointer ${i === cursor ? "bg-aqua/10 font-medium" : p.source === "DEMO" ? "bg-warnLight/20" : "hover:bg-paper"}`}>
                          <td className="px-4 py-1.5 text-steel">{i + 1}</td>
                          <td className="px-4 py-1.5 font-mono">{fmtTime(p.recordedAt)}</td>
                          <td className="px-4 py-1.5 font-mono">{p.lat.toFixed(6)}</td>
                          <td className="px-4 py-1.5 font-mono">{p.lng.toFixed(6)}</td>
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

        {!data && !loading && !error && (
          <EmptyState title="Enter a trip ID to load its GPS replay" description="Paste a Trip ID or Trip Number above and click Load." />
        )}
      </PageContainer>
    </AdminShell>
  );
}
