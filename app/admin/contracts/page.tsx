"use client";

import { useEffect, useState, useCallback } from "react";
import TopNav from "@/components/TopNav";
import StatusBadge from "@/components/StatusBadge";
import { useRequireSession } from "@/lib/useSession";

// Task I — Contract Management Module, first slice (I.1 + a taste of I.2).
// Deliberately a standalone route (not a tab bolted onto the already very
// large app/admin/page.tsx), matching this task's explicit direction that
// Contract Management is its own module, not a corner of Billing/Orders.
//
// Scope of this slice: a contract list, a read-only detail summary
// (customer, period, trips/overage, site scope, pricing coverage,
// distance bands, monthly billing readiness), a basic create form, and
// status transitions — all against APIs that already exist and already
// work (Tasks B/C/D built them; this is the first UI to actually use
// them). Deliberately NOT in this slice: site-assignment UI, pricing-rule
// create/edit UI, distance-band create/edit UI, and the monthly invoice
// generation UI — each is its own later stage (I.2's remainder, I.3, I.4,
// I.5), left as clear, honest gaps rather than rushed.
export default function ContractsPage() {
  const { session, loading: sessionLoading } = useRequireSession(["ADMIN"]);
  const [tenant, setTenant] = useState<any>(null);
  const [contracts, setContracts] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [distanceBands, setDistanceBands] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showNewContract, setShowNewContract] = useState(false);
  const [loading, setLoading] = useState(true);

  const safeFetchJson = useCallback(async (url: string) => {
    try {
      const res = await fetch(url);
      if (!res.ok) return [];
      return await res.json();
    } catch {
      return [];
    }
  }, []);

  const load = useCallback(async () => {
    if (!session) return;
    const tRes = await fetch("/api/tenant");
    if (!tRes.ok) {
      setLoading(false);
      return;
    }
    const t = await tRes.json();
    setTenant(t);
    const [c, cust, db] = await Promise.all([
      safeFetchJson("/api/contracts"),
      safeFetchJson(`/api/customers?tenantId=${t.id}`),
      safeFetchJson("/api/distance-bands"),
    ]);
    setContracts(Array.isArray(c) ? c : []);
    setCustomers(Array.isArray(cust) ? cust.filter((x: any) => x.type === "B2B") : []);
    setDistanceBands(Array.isArray(db) ? db : []);
    setLoading(false);
  }, [session, safeFetchJson]);

  useEffect(() => {
    if (!session) return;
    load();
  }, [session, load]);

  if (sessionLoading || !session) {
    return <main className="min-h-screen bg-paper"><TopNav role="Admin" /><p className="p-6 text-steel">Loading…</p></main>;
  }

  return (
    <main className="min-h-screen bg-paper">
      <TopNav role={tenant ? `Contract Management — ${tenant.name}` : "Contract Management"} />
      <div className="p-6 max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">Contracts</h1>
            <p className="text-steel text-sm mt-0.5">
              Commercial agreements, pricing coverage, and site scope for company customers.{" "}
              <a href="/admin" className="text-aquaDark hover:underline">Back to Admin</a>
            </p>
          </div>
          <button
            onClick={() => setShowNewContract((s) => !s)}
            className="bg-ink text-white rounded-lg px-4 py-2 text-sm font-medium"
          >
            {showNewContract ? "Cancel" : "+ New contract"}
          </button>
        </div>

        {showNewContract && (
          <NewContractForm
            customers={customers}
            onCreated={() => {
              setShowNewContract(false);
              load();
            }}
          />
        )}

        {loading ? (
          <p className="text-steel text-sm">Loading…</p>
        ) : (
          <div className="grid md:grid-cols-2 gap-6">
            <ContractList
              contracts={contracts}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
            <div>
              {selectedId ? (
                <ContractDetail contractId={selectedId} onChange={load} />
              ) : (
                <div className="bg-white rounded-xl border border-slate-200 p-6 text-center text-steel text-sm">
                  Select a contract to see its full commercial detail — sites, pricing coverage, and billing readiness.
                </div>
              )}
            </div>
          </div>
        )}

        <DistanceBandsSummary bands={distanceBands} />
      </div>
    </main>
  );
}

function ContractList({ contracts, selectedId, onSelect }: { contracts: any[]; selectedId: string | null; onSelect: (id: string) => void }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <h3 className="font-medium mb-3">All contracts</h3>
      {contracts.length === 0 ? (
        <p className="text-steel text-sm">No contracts yet — use &quot;+ New contract&quot; to create the first one.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-steel border-b border-slate-100">
              <th className="pb-2">Contract #</th>
              <th className="pb-2">Customer</th>
              <th className="pb-2">Type</th>
              <th className="pb-2">Status</th>
              <th className="pb-2">Trips</th>
            </tr>
          </thead>
          <tbody>
            {contracts.map((c) => (
              <tr
                key={c.id}
                onClick={() => onSelect(c.id)}
                className={`border-b border-slate-50 cursor-pointer hover:bg-paper ${selectedId === c.id ? "bg-paper" : ""}`}
              >
                <td className="py-2 font-mono text-xs">{c.contractNumber}</td>
                <td className="py-2">{c.customer?.name ?? "—"}</td>
                <td className="py-2 text-xs">{c.type === "MONTHLY_ACCUMULATED" ? "Monthly" : "Trip count"}</td>
                <td className="py-2"><StatusBadge status={c.status} /></td>
                <td className="py-2 text-xs">
                  {c.type === "ONE_TIME_TRIP_COUNT" ? `${c.tripsUsed}/${c.totalTripsPurchased}` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const CONTRACT_STATUS_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["ACTIVE", "CANCELLED"],
  ACTIVE: ["SUSPENDED", "CANCELLED"],
  SUSPENDED: ["ACTIVE", "CANCELLED"],
};

function ContractDetail({ contractId, onChange }: { contractId: string; onChange: () => void }) {
  const [contract, setContract] = useState<any>(null);
  const [pricingRules, setPricingRules] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusError, setStatusError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const [c, pr] = await Promise.all([
      fetch(`/api/contracts/${contractId}`).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/contract-pricing-rules?contractId=${contractId}`).then((r) => (r.ok ? r.json() : [])),
    ]);
    setContract(c);
    setPricingRules(Array.isArray(pr) ? pr : []);
    setLoading(false);
  }, [contractId]);

  useEffect(() => {
    load();
  }, [load]);

  async function changeStatus(newStatus: string) {
    setStatusBusy(true);
    setStatusError("");
    const res = await fetch(`/api/contracts/${contractId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    const data = await res.json();
    setStatusBusy(false);
    if (!res.ok) {
      setStatusError(typeof data.error === "string" ? data.error : "Failed to update status");
      return;
    }
    load();
    onChange();
  }

  if (loading) return <div className="bg-white rounded-xl border border-slate-200 p-6 text-steel text-sm">Loading contract…</div>;
  if (!contract) return <div className="bg-white rounded-xl border border-slate-200 p-6 text-danger text-sm">Contract not found.</div>;

  const isMonthly = contract.type === "MONTHLY_ACCUMULATED";
  const isTripCount = contract.type === "ONE_TIME_TRIP_COUNT";
  const remaining = isTripCount ? Math.max(0, (contract.totalTripsPurchased ?? 0) - contract.tripsUsed) : null;
  const overageActive = isTripCount && contract.tripsUsed >= (contract.totalTripsPurchased ?? 0);
  const standardRules = pricingRules.filter((r) => r.rateType === "STANDARD");
  const overageRules = pricingRules.filter((r) => r.rateType === "OVERAGE");
  const capacitiesCovered = Array.from(new Set(pricingRules.map((r) => r.tankerCapacityLtr).filter((v) => v != null))).sort((a, b) => a - b);
  const currentPeriod = (contract.periods ?? []).find((p: any) => p.status === "OPEN");

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-xs text-steel">{contract.contractNumber}</p>
          <p className="font-medium">{contract.customer?.name}</p>
        </div>
        <StatusBadge status={contract.status} />
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div><span className="text-steel text-xs block">Type</span>{isMonthly ? "Monthly accumulated" : "One-time trip count"}</div>
        <div><span className="text-steel text-xs block">Billing cadence</span>{contract.billingCadence ?? "—"}</div>
        <div><span className="text-steel text-xs block">Start date</span>{new Date(contract.startDate).toLocaleDateString()}</div>
        <div><span className="text-steel text-xs block">End date</span>{contract.endDate ? new Date(contract.endDate).toLocaleDateString() : "Open-ended"}</div>
      </div>

      {isTripCount && (
        <div className="border-t border-slate-100 pt-3">
          <p className="text-xs text-steel uppercase tracking-wide mb-1">Trip usage</p>
          <p className="text-sm">
            {contract.tripsUsed} used of {contract.totalTripsPurchased} purchased ·{" "}
            <span className={overageActive ? "text-warn font-medium" : ""}>{remaining} remaining</span>
          </p>
          {overageActive && (
            <p className="text-warn text-xs mt-1">
              This contract has used its full trip allowance — any further trips are billed at the OVERAGE rate
              {overageRules.length === 0 && <span className="text-danger"> (no OVERAGE pricing rule exists yet for this contract — new trips cannot be priced until one is added)</span>}.
            </p>
          )}
        </div>
      )}

      {isMonthly && (
        <div className="border-t border-slate-100 pt-3">
          <p className="text-xs text-steel uppercase tracking-wide mb-1">Monthly billing readiness</p>
          {currentPeriod ? (
            <p className="text-sm">
              Current period: {new Date(currentPeriod.periodStart).toLocaleDateString()} – {new Date(currentPeriod.periodEnd).toLocaleDateString()}{" "}
              ({currentPeriod.periodTrips} trip(s) so far, open)
            </p>
          ) : (
            <p className="text-steel text-sm">No billing period opened yet — one is created automatically the first time a monthly invoice is generated for this contract.</p>
          )}
          <p className="text-steel text-xs mt-1">Manual monthly invoice generation is available via API only in this release.</p>
        </div>
      )}

      <div className="border-t border-slate-100 pt-3">
        <p className="text-xs text-steel uppercase tracking-wide mb-1">Site scope</p>
        {contract.appliesToAllSites ? (
          <p className="text-sm">Applies to all of this customer&apos;s sites (current and future).</p>
        ) : (contract.siteScope ?? []).length === 0 ? (
          <p className="text-warn text-sm">Restricted to specific sites, but none are assigned yet — no order can be attached to this contract until at least one site is added.</p>
        ) : (
          <ul className="text-sm space-y-1">
            {contract.siteScope.map((s: any) => (
              <li key={s.id}>
                {s.customerLocation?.label ?? s.customerLocationId}
                <span className="text-steel text-xs">
                  {" "}({s.customerLocation?.cityCode ?? "no city"} / {s.customerLocation?.zoneCode ?? "no zone"} / {s.customerLocation?.distanceBandCode ?? "no band"})
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-steel text-xs mt-1">Site assignment is available via API only in this release.</p>
      </div>

      <div className="border-t border-slate-100 pt-3">
        <p className="text-xs text-steel uppercase tracking-wide mb-1">Pricing coverage</p>
        <p className="text-sm">
          STANDARD: {standardRules.length > 0 ? <span className="text-ok">{standardRules.length} rule(s)</span> : <span className="text-danger">none — orders cannot be priced under this contract yet</span>}
        </p>
        {isTripCount && (
          <p className="text-sm">
            OVERAGE: {overageRules.length > 0 ? <span className="text-ok">{overageRules.length} rule(s)</span> : <span className="text-warn">none yet</span>}
          </p>
        )}
        {capacitiesCovered.length > 0 && (
          <p className="text-steel text-xs mt-1">Tanker capacities covered: {capacitiesCovered.map((c) => `${c.toLocaleString()} L`).join(", ")}</p>
        )}
        <p className="text-steel text-xs mt-1">Pricing rule setup is available via API only in this release.</p>
      </div>

      <div className="border-t border-slate-100 pt-3">
        <p className="text-xs text-steel uppercase tracking-wide mb-2">Status</p>
        {statusError && <p className="text-danger text-xs mb-2">{statusError}</p>}
        <div className="flex gap-2">
          {(CONTRACT_STATUS_TRANSITIONS[contract.status] ?? []).map((next) => (
            <button
              key={next}
              disabled={statusBusy}
              onClick={() => changeStatus(next)}
              className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-40 hover:border-aqua"
            >
              Move to {next}
            </button>
          ))}
          {(CONTRACT_STATUS_TRANSITIONS[contract.status] ?? []).length === 0 && (
            <span className="text-steel text-xs">This status is terminal — no further transitions available.</span>
          )}
        </div>
      </div>
    </div>
  );
}

function NewContractForm({ customers, onCreated }: { customers: any[]; onCreated: () => void }) {
  const [customerId, setCustomerId] = useState("");
  const [type, setType] = useState<"MONTHLY_ACCUMULATED" | "ONE_TIME_TRIP_COUNT">("MONTHLY_ACCUMULATED");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [appliesToAllSites, setAppliesToAllSites] = useState(true);
  const [totalTripsPurchased, setTotalTripsPurchased] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setSubmitting(true);
    setError("");
    const res = await fetch("/api/contracts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerId,
        type,
        startDate,
        endDate: endDate || undefined,
        appliesToAllSites,
        billingCadence: type === "MONTHLY_ACCUMULATED" ? "MONTHLY" : undefined,
        totalTripsPurchased: type === "ONE_TIME_TRIP_COUNT" ? Number(totalTripsPurchased) : undefined,
        notes: notes || undefined,
      }),
    });
    const data = await res.json();
    setSubmitting(false);
    if (!res.ok) {
      setError(typeof data.error === "string" ? data.error : "Failed to create contract");
      return;
    }
    onCreated();
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-2">
      <h3 className="font-medium mb-2">New contract</h3>
      <select className="w-full border rounded-lg px-3 py-2 text-sm" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
        <option value="">Select company customer…</option>
        {customers.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
      {customers.length === 0 && <p className="text-warn text-xs">No B2B (company) customers exist yet — contracts can only be created for company customers.</p>}

      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-1">
          <input type="radio" checked={type === "MONTHLY_ACCUMULATED"} onChange={() => setType("MONTHLY_ACCUMULATED")} /> Monthly accumulated
        </label>
        <label className="flex items-center gap-1">
          <input type="radio" checked={type === "ONE_TIME_TRIP_COUNT"} onChange={() => setType("ONE_TIME_TRIP_COUNT")} /> One-time trip count
        </label>
      </div>

      {type === "ONE_TIME_TRIP_COUNT" && (
        <input type="number" className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Total trips purchased" value={totalTripsPurchased} onChange={(e) => setTotalTripsPurchased(e.target.value)} />
      )}

      <div className="flex gap-2">
        <input type="date" className="w-1/2 border rounded-lg px-3 py-2 text-sm" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        <input type="date" className="w-1/2 border rounded-lg px-3 py-2 text-sm" placeholder="End date (optional)" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={appliesToAllSites} onChange={(e) => setAppliesToAllSites(e.target.checked)} />
        Applies to all of this customer&apos;s sites
      </label>
      {!appliesToAllSites && (
        <p className="text-steel text-xs">Site selection isn&apos;t available in this UI yet — assign specific sites via the API after creating this contract.</p>
      )}

      <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />

      {error && <p className="text-danger text-xs">{error}</p>}
      <button
        disabled={!customerId || !startDate || (type === "ONE_TIME_TRIP_COUNT" && !totalTripsPurchased) || submitting}
        onClick={submit}
        className="bg-ink text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-40"
      >
        Create contract
      </button>
    </div>
  );
}

function DistanceBandsSummary({ bands }: { bands: any[] }) {
  const active = bands.filter((b) => b.isActive);
  const retired = bands.filter((b) => !b.isActive);
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <h3 className="font-medium mb-3">Distance bands</h3>
      {bands.length === 0 ? (
        <p className="text-steel text-sm">No distance bands defined yet for this tenant — pricing rules that reference a distanceBandCode won&apos;t match until at least one exists.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-steel border-b border-slate-100">
              <th className="pb-2">Code</th>
              <th className="pb-2">Label</th>
              <th className="pb-2">Range</th>
              <th className="pb-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {active.map((b) => (
              <tr key={b.id} className="border-b border-slate-50">
                <td className="py-2 font-mono text-xs">{b.code}</td>
                <td className="py-2">{b.label}</td>
                <td className="py-2 text-xs">{b.fromKm}–{b.toKm ?? "∞"} km</td>
                <td className="py-2"><span className="text-ok text-xs">Active</span></td>
              </tr>
            ))}
            {retired.map((b) => (
              <tr key={b.id} className="border-b border-slate-50 opacity-60">
                <td className="py-2 font-mono text-xs">{b.code}</td>
                <td className="py-2">{b.label}</td>
                <td className="py-2 text-xs">{b.fromKm}–{b.toKm ?? "∞"} km</td>
                <td className="py-2"><span className="text-steel text-xs">Retired</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="text-steel text-xs mt-3">Creating and retiring distance bands is available via API only in this release.</p>
    </div>
  );
}
