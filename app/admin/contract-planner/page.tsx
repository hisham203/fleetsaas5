"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useRequireSession } from "@/lib/useSession";
import AdminShell from "@/components/AdminShell";
import KpiCard from "@/components/KpiCard";

// Milestone Q, Gate Q5 — Contract Trip Planner. Bridges commercial
// contracts and daily operations by surfacing which active contracts are
// genuinely ready for their next delivery to be planned into dispatch,
// and which are blocked and why. This never creates a trip or an order
// itself — "Plan in Control Tower" links to the existing order-creation
// flow (Dispatch Control Tower / the live Dispatch console), reusing the
// real creation API rather than building a second, parallel path.
//
// Milestone S: useSearchParams() requires a Suspense boundary, per
// Next.js's own build requirement.
export default function ContractPlannerPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-paper flex items-center justify-center text-steel text-sm">Loading…</div>}>
      <ContractPlannerPageInner />
    </Suspense>
  );
}

function ContractPlannerPageInner() {
  const { session, loading: sessionLoading } = useRequireSession(["ADMIN", "DISPATCHER"]);
  const searchParams = useSearchParams();
  // Milestone S, Part 3/7: preserves the exact contract a user clicked
  // "View in Planner" for from Contract Management — read once, matching
  // the same one-time deep-link pattern already used elsewhere.
  const focusContractId = searchParams.get("contractId");
  const [deepLinkNotice, setDeepLinkNotice] = useState<string | null>(null);
  const [deepLinkResolved, setDeepLinkResolved] = useState(false);
  const [tenant, setTenant] = useState<any>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"all" | "ready" | "blocked">("all");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    const tRes = await fetch("/api/tenant");
    if (tRes.ok) setTenant(await tRes.json());
    const res = await fetch("/api/contract-planner");
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(typeof data.error === "string" ? data.error : "Failed to load contract planning data");
      setLoading(false);
      return;
    }
    setError("");
    setRows(await res.json());
    setLoading(false);
  }, [session]);

  useEffect(() => {
    load();
  }, [load]);

  // Milestone S, Part 3/7: resolves the deep link once rows have loaded.
  // Part 8's own requirement — a filter must never silently hide the
  // item a deep link points at — is satisfied here by forcing the tab
  // back to "all" whenever a real, matching contract is found, rather
  // than leaving it at whatever tab happened to be selected before.
  useEffect(() => {
    if (deepLinkResolved) return;
    if (!focusContractId) {
      setDeepLinkResolved(true);
      return;
    }
    if (loading) return;
    const match = rows.find((r) => r.contractId === focusContractId);
    if (match) {
      setTab("all");
    } else {
      setDeepLinkNotice(`Contract ${focusContractId} was not found among active contracts — it may be inactive or belongs to a different tenant.`);
    }
    setDeepLinkResolved(true);
  }, [deepLinkResolved, focusContractId, rows, loading]);

  if (sessionLoading || !session) {
    return <div className="min-h-screen bg-paper flex items-center justify-center text-steel text-sm">Loading…</div>;
  }

  const readyCount = rows.filter((r) => r.readyForDispatch).length;
  const blockedCount = rows.filter((r) => !r.readyForDispatch).length;
  const tripCountNearLimit = rows.filter(
    (r) => r.type === "ONE_TIME_TRIP_COUNT" && r.totalTripsPurchased != null && r.tripsUsed >= r.totalTripsPurchased
  ).length;

  const filteredRows = rows.filter((r) => {
    if (tab === "ready") return r.readyForDispatch;
    if (tab === "blocked") return !r.readyForDispatch;
    return true;
  });

  return (
    <AdminShell title="Contract Trip Planner" tenantName={tenant?.name}>
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard label="Active Contracts" value={rows.length} />
          <KpiCard label="Ready for Dispatch" value={readyCount} tone="ok" />
          <KpiCard label="Blocked / Missing Data" value={blockedCount} tone={blockedCount > 0 ? "warn" : "default"} />
          <KpiCard label="At/Over Trip Limit" value={tripCountNearLimit} tone={tripCountNearLimit > 0 ? "warn" : "default"} />
        </div>

        <div className="flex gap-2">
          {(["all", "ready", "blocked"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border capitalize ${tab === t ? "bg-ink text-white border-ink" : "bg-white text-steel border-slate-200 hover:border-ink"}`}
            >
              {t}
            </button>
          ))}
        </div>

        {error && <p className="text-danger text-sm">{error}</p>}
        {deepLinkNotice && (
          <div className="bg-warn/10 border border-warn/30 rounded-lg px-4 py-2 text-warn text-sm">{deepLinkNotice}</div>
        )}

        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          {loading ? (
            <p className="p-6 text-steel text-sm">Loading…</p>
          ) : filteredRows.length === 0 ? (
            <p className="p-6 text-steel text-sm text-center">No contracts match this view.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-paper text-steel text-xs uppercase">
                  <tr>
                    <th className="text-left px-4 py-2">Contract</th>
                    <th className="text-left px-4 py-2">Type</th>
                    <th className="text-left px-4 py-2">Customer</th>
                    <th className="text-left px-4 py-2">Site Scope</th>
                    <th className="text-left px-4 py-2">Usage</th>
                    <th className="text-left px-4 py-2">Readiness</th>
                    <th className="text-left px-4 py-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((r) => (
                    <tr key={r.contractId} className={`border-t border-slate-100 ${focusContractId === r.contractId ? "bg-aqua/10" : ""}`}>
                      <td className="px-4 py-2 font-medium">
                        <a href={`/admin/contracts?contractId=${r.contractId}`} className="text-ink hover:text-aquaDark hover:underline">{r.contractNumber}</a>
                      </td>
                      <td className="px-4 py-2 text-steel">{r.type.replace(/_/g, " ")}</td>
                      <td className="px-4 py-2">{r.customer?.name ?? "—"}</td>
                      <td className="px-4 py-2 text-steel">{r.appliesToAllSites ? "All sites" : `${r.siteCount} site(s)`}</td>
                      <td className="px-4 py-2 text-steel">
                        {r.type === "ONE_TIME_TRIP_COUNT" && r.totalTripsPurchased != null
                          ? `${r.tripsUsed} / ${r.totalTripsPurchased} trips`
                          : "Monthly accumulation"}
                      </td>
                      <td className="px-4 py-2">
                        {r.readyForDispatch ? (
                          <span className="status-pill bg-ok/15 text-ok">Ready</span>
                        ) : (
                          <span className="status-pill bg-warn/15 text-warn" title={r.blockedReasons.join(", ")}>
                            Blocked: {r.blockedReasons[0] ?? "Not ready"}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        {r.readyForDispatch ? (
                          <a href={`/admin/dispatch?contractId=${r.contractId}`} className="text-aquaDark hover:underline text-xs font-medium">Plan in Control Tower</a>
                        ) : (
                          <a href={`/admin/contracts?contractId=${r.contractId}`} className="text-aquaDark hover:underline text-xs font-medium">Fix in Contract Management</a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AdminShell>
  );
}
