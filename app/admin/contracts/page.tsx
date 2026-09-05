"use client";

import { useEffect, useState, useCallback } from "react";
import AdminShell from "@/components/AdminShell";
import StatusBadge from "@/components/StatusBadge";
import { useRequireSession } from "@/lib/useSession";
import { computeReadinessItems, type ReadinessState } from "@/lib/contractReadiness";

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
    return <AdminShell title="Contracts"><p className="p-6 text-steel">Loading…</p></AdminShell>;
  }

  return (
    <AdminShell title="Contracts" tenantName={tenant?.name}>
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
                <ContractDetail contractId={selectedId} distanceBands={distanceBands} onChange={load} />
              ) : (
                <div className="bg-white rounded-xl border border-slate-200 p-6 text-center text-steel text-sm">
                  Select a contract to see its full commercial detail — sites, pricing coverage, and billing readiness.
                </div>
              )}
            </div>
          </div>
        )}

        <DistanceBandsSummary bands={distanceBands} onChange={load} />
      </div>
    </AdminShell>
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

function ReadinessBadge({ state }: { state: ReadinessState }) {
  const styles: Record<ReadinessState, string> = {
    READY: "text-ok",
    WARNING: "text-warn",
    MISSING: "text-danger",
    UNSUPPORTED: "text-steel",
  };
  const labels: Record<ReadinessState, string> = {
    READY: "Ready",
    WARNING: "Warning",
    MISSING: "Missing",
    UNSUPPORTED: "Unsupported",
  };
  return <span className={`${styles[state]} font-medium`}>{labels[state]}</span>;
}

function ContractDetail({ contractId, distanceBands, onChange }: { contractId: string; distanceBands: any[]; onChange: () => void }) {
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
  const readinessItems = computeReadinessItems(contract, pricingRules, distanceBands);

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-xs text-steel">{contract.contractNumber}</p>
          <p className="font-medium">{contract.customer?.name}</p>
        </div>
        <StatusBadge status={contract.status} />
      </div>

      <div className="border border-slate-100 rounded-lg p-3">
        <p className="text-xs text-steel uppercase tracking-wide mb-2">Contract readiness summary</p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          {readinessItems.map((item) => (
            <div key={item.label} className="flex items-center justify-between gap-2">
              <span>{item.label}</span>
              <ReadinessBadge state={item.state} />
            </div>
          ))}
        </div>
        <p className="text-steel text-xs mt-2">Informational only — nothing here blocks using this contract.</p>
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

      {isMonthly && <MonthlyBillingReadiness contractId={contract.id} />}

      <div className="border-t border-slate-100 pt-3">
        <p className="text-xs text-steel uppercase tracking-wide mb-1">Site scope</p>
        {contract.appliesToAllSites ? (
          <p className="text-sm">Applies to all of this customer&apos;s sites (current and future).</p>
        ) : (
          <SiteScopeManager
            contractId={contract.id}
            customerId={contract.customerId}
            siteScope={contract.siteScope ?? []}
            onChange={load}
          />
        )}
      </div>

      <div className="border-t border-slate-100 pt-3">
        <p className="text-xs text-steel uppercase tracking-wide mb-1">Pricing coverage</p>
        <p className="text-sm">
          STANDARD: {standardRules.length > 0 ? <span className="text-ok">{standardRules.length} rule(s)</span> : <span className="text-danger">none — orders cannot be priced under this contract yet</span>}
        </p>
        {isTripCount && (
          <p className="text-sm">
            OVERAGE: {overageRules.length > 0 ? <span className="text-ok">{overageRules.length} rule(s)</span> : <span className="text-warn">none yet — new trips beyond the purchased count cannot be priced until one is added</span>}
          </p>
        )}
        {capacitiesCovered.length > 0 && (
          <p className="text-steel text-xs mt-1">Tanker capacities covered: {capacitiesCovered.map((c) => `${c.toLocaleString()} L`).join(", ")}</p>
        )}
        <PricingRulesManager
          contractId={contract.id}
          isTripCount={isTripCount}
          pricingRules={pricingRules}
          distanceBands={distanceBands}
          onChange={load}
        />
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

      <div className="border-t border-slate-100 pt-3">
        <p className="text-xs text-steel uppercase tracking-wide mb-2">Not yet configurable (future schema work)</p>
        <p className="text-steel text-xs mb-1">
          These are real commercial factors this module doesn&apos;t support yet — not silently missing, just not built. See Task J&apos;s configuration audit for the full list and recommended phasing.
        </p>
        <ul className="text-steel text-xs list-disc list-inside space-y-0.5">
          <li>Payment terms (due days, credit terms, grace period, payment method)</li>
          <li>Customer billing requirements (PO/reference number, VAT/tax registration, billing contact)</li>
          <li>Contract renewal (renewal date, auto-renewal, expiry alerts)</li>
          <li>SLA terms (delivery lead time, guaranteed window, failed-SLA penalty)</li>
          <li>Contract documents (signed contract reference, amendment history)</li>
          <li>Commercial surcharges (fuel, distance, zone, waiting-time, urgent/night/weekend, cancellation, rescheduling fees)</li>
        </ul>
      </div>
    </div>
  );
}

function SiteScopeManager({ contractId, customerId, siteScope, onChange }: { contractId: string; customerId: string; siteScope: any[]; onChange: () => void }) {
  const [customerLocations, setCustomerLocations] = useState<any[]>([]);
  const [locationsLoaded, setLocationsLoaded] = useState(false);
  const [selectedLocationId, setSelectedLocationId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    // I.2: only this contract's own customer's sites are ever fetched or
    // offered — GET /api/customers/[id]/locations already enforces the
    // same tenant/customer boundary server-side, this is just scoping
    // what the dropdown even shows.
    fetch(`/api/customers/${customerId}/locations`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => {
        setCustomerLocations(Array.isArray(rows) ? rows : []);
        setLocationsLoaded(true);
      });
  }, [customerId]);

  const assignedIds = new Set(siteScope.map((s: any) => s.customerLocationId));
  const unassigned = customerLocations.filter((l) => !assignedIds.has(l.id));

  async function addSite() {
    if (!selectedLocationId) return;
    setBusy(true);
    setError("");
    const res = await fetch(`/api/contracts/${contractId}/sites`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customerLocationIds: [selectedLocationId] }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(typeof data.error === "string" ? data.error : "Failed to assign site");
      return;
    }
    setSelectedLocationId("");
    onChange();
  }

  async function removeSite(customerLocationId: string) {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/contracts/${contractId}/sites/${customerLocationId}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(typeof data.error === "string" ? data.error : "Failed to remove site");
      return;
    }
    onChange();
  }

  return (
    <div>
      {siteScope.length === 0 ? (
        <p className="text-warn text-sm">Restricted to specific sites, but none are assigned yet — no order can be attached to this contract until at least one site is added.</p>
      ) : (
        <ul className="text-sm space-y-1">
          {siteScope.map((s: any) => (
            <li key={s.id} className="flex items-center justify-between">
              <span>
                {s.customerLocation?.label ?? s.customerLocationId}
                <span className="text-steel text-xs">
                  {" "}({s.customerLocation?.cityCode ?? "no city"} / {s.customerLocation?.zoneCode ?? "no zone"} / {s.customerLocation?.distanceBandCode ?? "no band"})
                </span>
              </span>
              <button disabled={busy} onClick={() => removeSite(s.customerLocationId)} className="text-danger text-xs font-medium disabled:opacity-40">
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="text-danger text-xs mt-2">{error}</p>}

      <div className="flex gap-2 mt-2">
        <select className="flex-1 border rounded-lg px-2 py-1.5 text-xs" value={selectedLocationId} onChange={(e) => setSelectedLocationId(e.target.value)} disabled={!locationsLoaded}>
          <option value="">
            {!locationsLoaded ? "Loading sites…" : unassigned.length === 0 ? "No more sites to assign" : "Select a site to add…"}
          </option>
          {unassigned.map((l) => (
            <option key={l.id} value={l.id}>{l.label} ({l.cityCode ?? "no city"}/{l.zoneCode ?? "no zone"}/{l.distanceBandCode ?? "no band"})</option>
          ))}
        </select>
        <button disabled={!selectedLocationId || busy} onClick={addSite} className="bg-ink text-white rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-40">
          Add site
        </button>
      </div>
    </div>
  );
}

function PricingRulesManager({ contractId, isTripCount, pricingRules, distanceBands, onChange }: { contractId: string; isTripCount: boolean; pricingRules: any[]; distanceBands: any[]; onChange: () => void }) {
  const [showForm, setShowForm] = useState(false);
  const [rateType, setRateType] = useState<"STANDARD" | "OVERAGE">("STANDARD");
  const [pricePerTrip, setPricePerTrip] = useState("");
  const [vatRate, setVatRate] = useState("0.15");
  const [priority, setPriority] = useState("");
  const [effectiveStartDate, setEffectiveStartDate] = useState("");
  const [effectiveEndDate, setEffectiveEndDate] = useState("");
  const [capacityChoice, setCapacityChoice] = useState(""); // "" = wildcard, "custom" = show custom input
  const [customCapacity, setCustomCapacity] = useState("");
  const [cityCode, setCityCode] = useState("");
  const [zoneCode, setZoneCode] = useState("");
  const [distanceBandCode, setDistanceBandCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const activeBands = distanceBands.filter((b) => b.isActive);

  async function createRule() {
    setBusy(true);
    setError("");
    const tankerCapacityLtr =
      capacityChoice === "" ? undefined : capacityChoice === "custom" ? (customCapacity ? Number(customCapacity) : undefined) : Number(capacityChoice);
    const res = await fetch("/api/contract-pricing-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pricingScope: "CONTRACT",
        contractId,
        rateType,
        pricePerTrip: Number(pricePerTrip),
        vatRate: Number(vatRate),
        priority: priority ? Number(priority) : undefined,
        effectiveStartDate: effectiveStartDate || undefined,
        effectiveEndDate: effectiveEndDate || undefined,
        tankerCapacityLtr,
        cityCode: cityCode || undefined,
        zoneCode: zoneCode || undefined,
        distanceBandCode: distanceBandCode || undefined,
      }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(typeof data.error === "string" ? data.error : JSON.stringify(data.error) || "Failed to create pricing rule");
      return;
    }
    setPricePerTrip("");
    setPriority("");
    setEffectiveStartDate("");
    setEffectiveEndDate("");
    setCapacityChoice("");
    setCustomCapacity("");
    setCityCode("");
    setZoneCode("");
    setDistanceBandCode("");
    setShowForm(false);
    onChange();
  }

  async function retireRule(id: string) {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/contract-pricing-rules/${id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(typeof data.error === "string" ? data.error : "Failed to retire pricing rule");
      return;
    }
    onChange();
  }

  return (
    <div className="mt-2">
      {pricingRules.length > 0 && (
        <table className="w-full text-xs mt-2">
          <thead>
            <tr className="text-left text-steel border-b border-slate-100">
              <th className="pb-1">Rate</th>
              <th className="pb-1">Capacity</th>
              <th className="pb-1">City/Zone/Band</th>
              <th className="pb-1">Price/trip</th>
              <th className="pb-1">VAT</th>
              <th className="pb-1">Priority</th>
              <th className="pb-1">Effective</th>
              <th className="pb-1"></th>
            </tr>
          </thead>
          <tbody>
            {pricingRules.map((r) => {
              const retired = r.effectiveEndDate != null && new Date(r.effectiveEndDate) <= new Date();
              return (
                <tr key={r.id} className={`border-b border-slate-50 ${retired ? "opacity-50" : ""}`}>
                  <td className="py-1">{r.rateType}</td>
                  <td className="py-1">{r.tankerCapacityLtr ? `${r.tankerCapacityLtr.toLocaleString()} L` : "any"}</td>
                  <td className="py-1">{r.cityCode ?? "—"}/{r.zoneCode ?? "—"}/{r.distanceBandCode ?? "—"}</td>
                  <td className="py-1">{r.pricePerTrip != null ? `SAR ${r.pricePerTrip}` : r.pricePerLiter != null ? `SAR ${r.pricePerLiter}/L` : "—"}</td>
                  <td className="py-1">{(r.vatRate * 100).toFixed(0)}%</td>
                  <td className="py-1">{r.priority ?? "—"}</td>
                  <td className="py-1">
                    {r.effectiveStartDate ? new Date(r.effectiveStartDate).toLocaleDateString() : "—"}
                    {" – "}
                    {r.effectiveEndDate ? new Date(r.effectiveEndDate).toLocaleDateString() : "open"}
                  </td>
                  <td className="py-1 text-right">
                    {!retired && (
                      <button disabled={busy} onClick={() => retireRule(r.id)} className="text-danger font-medium disabled:opacity-40">
                        Retire
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {error && <p className="text-danger text-xs mt-2">{error}</p>}

      <button onClick={() => setShowForm((s) => !s)} className="text-aquaDark text-xs font-medium mt-2">
        {showForm ? "Cancel" : "+ Add pricing rule"}
      </button>

      {showForm && (
        <div className="mt-2 space-y-2 border border-slate-100 rounded-lg p-3">
          <div className="flex gap-4 text-xs">
            <label className="flex items-center gap-1">
              <input type="radio" checked={rateType === "STANDARD"} onChange={() => setRateType("STANDARD")} /> STANDARD
            </label>
            <label className="flex items-center gap-1">
              <input type="radio" checked={rateType === "OVERAGE"} onChange={() => setRateType("OVERAGE")} /> OVERAGE
            </label>
          </div>
          {rateType === "OVERAGE" && !isTripCount && (
            <p className="text-steel text-xs">OVERAGE rules are normally only meaningful for one-time trip-count contracts, but this isn&apos;t enforced — create one only if it makes sense for this contract.</p>
          )}

          <div className="flex gap-2">
            <input type="number" className="flex-1 border rounded-lg px-2 py-1 text-xs" placeholder="Price per trip (SAR)" value={pricePerTrip} onChange={(e) => setPricePerTrip(e.target.value)} />
            <input type="number" step="0.01" className="w-24 border rounded-lg px-2 py-1 text-xs" placeholder="VAT (0.15)" value={vatRate} onChange={(e) => setVatRate(e.target.value)} />
          </div>

          <div>
            <label className="text-xs text-steel">Tanker capacity (optional — leave blank to match any capacity)</label>
            <div className="flex gap-2 mt-1">
              <select className="flex-1 border rounded-lg px-2 py-1 text-xs" value={capacityChoice} onChange={(e) => setCapacityChoice(e.target.value)}>
                <option value="">Any capacity</option>
                <option value="18000">18,000 L</option>
                <option value="21000">21,000 L</option>
                <option value="28000">28,000 L</option>
                <option value="custom">Custom…</option>
              </select>
              {capacityChoice === "custom" && (
                <input type="number" className="w-28 border rounded-lg px-2 py-1 text-xs" placeholder="Liters" value={customCapacity} onChange={(e) => setCustomCapacity(e.target.value)} />
              )}
            </div>
          </div>

          <div className="flex gap-2">
            <input className="w-1/3 border rounded-lg px-2 py-1 text-xs" placeholder="City code (optional)" value={cityCode} onChange={(e) => setCityCode(e.target.value)} />
            <input className="w-1/3 border rounded-lg px-2 py-1 text-xs" placeholder="Zone code (optional)" value={zoneCode} onChange={(e) => setZoneCode(e.target.value)} />
            <select className="w-1/3 border rounded-lg px-2 py-1 text-xs" value={distanceBandCode} onChange={(e) => setDistanceBandCode(e.target.value)}>
              <option value="">Any distance band</option>
              {activeBands.map((b) => (
                <option key={b.id} value={b.code}>{b.code}</option>
              ))}
            </select>
          </div>
          {activeBands.length === 0 && <p className="text-steel text-xs">No distance bands exist yet for this tenant — create one below to price by distance.</p>}

          <div className="flex gap-2">
            <input type="number" className="w-1/3 border rounded-lg px-2 py-1 text-xs" placeholder="Priority (optional)" value={priority} onChange={(e) => setPriority(e.target.value)} />
            <input type="date" className="w-1/3 border rounded-lg px-2 py-1 text-xs" placeholder="Effective from" value={effectiveStartDate} onChange={(e) => setEffectiveStartDate(e.target.value)} />
            <input type="date" className="w-1/3 border rounded-lg px-2 py-1 text-xs" placeholder="Effective to (optional)" value={effectiveEndDate} onChange={(e) => setEffectiveEndDate(e.target.value)} />
          </div>

          <button disabled={!pricePerTrip || busy} onClick={createRule} className="bg-ink text-white rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-40">
            Create pricing rule
          </button>
        </div>
      )}
    </div>
  );
}

function MonthlyBillingReadiness({ contractId }: { contractId: string }) {
  const [preview, setPreview] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    setError("");
    fetch(`/api/contracts/${contractId}/monthly-billing-preview`)
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(typeof data.error === "string" ? data.error : "Failed to load billing preview");
        setPreview(data);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [contractId]);

  return (
    <div className="border-t border-slate-100 pt-3">
      <p className="text-xs text-steel uppercase tracking-wide mb-1">Monthly billing readiness</p>
      {loading && <p className="text-steel text-sm">Checking readiness…</p>}
      {error && <p className="text-danger text-sm">{error}</p>}
      {preview && (
        <div className="space-y-1">
          <p className="text-sm">
            Period: <span className="font-medium">{preview.billingPeriod.label}</span>
          </p>

          {preview.readiness === "ALREADY_BILLED" && (
            <div>
              <p className="text-ok text-sm font-medium">This billing period has already been invoiced.</p>
              {preview.existingInvoice && (
                <p className="text-steel text-xs mt-1">
                  Invoice {preview.existingInvoice.invoiceNumber} — SAR {preview.existingInvoice.total?.toFixed(2)} ({preview.existingInvoice.status})
                </p>
              )}
            </div>
          )}

          {preview.readiness === "READY" && (
            <div>
              <p className="text-ok text-sm font-medium">Ready for monthly billing</p>
              <p className="text-sm">{preview.eligibleOrdersCount} delivered order(s) eligible</p>
              <p className="text-sm">
                Expected total: SAR {preview.expectedTotal.toFixed(2)}{" "}
                <span className="text-steel text-xs">(subtotal SAR {preview.expectedSubtotal.toFixed(2)} + VAT SAR {preview.expectedVat.toFixed(2)})</span>
              </p>
            </div>
          )}

          {preview.readiness === "NOT_READY" && (
            <div>
              <p className="text-warn text-sm font-medium">Monthly billing is not ready</p>
              {preview.eligibleOrdersCount > 0 && (
                <p className="text-sm">{preview.eligibleOrdersCount} delivered order(s) found, but not all can be priced yet.</p>
              )}
              {(preview.blockers as string[]).map((b, i) => (
                <p key={i} className="text-danger text-xs mt-1">{b}</p>
              ))}
            </div>
          )}

          {(preview.warnings as string[]).length > 0 && (
            <div className="mt-1">
              {preview.warnings.map((w: string, i: number) => (
                <p key={i} className="text-steel text-xs">{w}</p>
              ))}
            </div>
          )}

          {/* I.5A: preview-only by design — this section deliberately has
              no working action button. Invoice generation stays API-only
              until the owner has reviewed the deployed Contract
              Management module. */}
          <button
            disabled
            title="Invoice generation will be enabled after operational review."
            className="mt-2 border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-medium opacity-40 cursor-not-allowed"
          >
            Generate invoice (disabled — pending operational review)
          </button>
        </div>
      )}
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

function DistanceBandsSummary({ bands, onChange }: { bands: any[]; onChange: () => void }) {
  const active = bands.filter((b) => b.isActive);
  const retired = bands.filter((b) => !b.isActive);

  const [showForm, setShowForm] = useState(false);
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [fromKm, setFromKm] = useState("");
  const [toKm, setToKm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // I.4: basic client-side checks so an obviously-invalid submission
  // never even reaches the API — the API's own validation (fromKm < toKm,
  // non-negative, code/label required) remains the real source of truth
  // and is still fully relied on for anything this doesn't catch.
  function validationError(): string | null {
    if (!code.trim()) return "Code is required.";
    if (!label.trim()) return "Label is required.";
    const from = Number(fromKm);
    if (fromKm === "" || Number.isNaN(from) || from < 0) return "From (km) must be a non-negative number.";
    if (toKm !== "") {
      const to = Number(toKm);
      if (Number.isNaN(to) || to < 0) return "To (km) must be a non-negative number.";
      if (to <= from) return "To (km) must be greater than From (km).";
    }
    return null;
  }

  async function createBand() {
    const clientError = validationError();
    if (clientError) {
      setError(clientError);
      return;
    }
    setBusy(true);
    setError("");
    const res = await fetch("/api/distance-bands", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, label, fromKm: Number(fromKm), toKm: toKm !== "" ? Number(toKm) : undefined }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(typeof data.error === "string" ? data.error : JSON.stringify(data.error) || "Failed to create distance band");
      return;
    }
    setCode("");
    setLabel("");
    setFromKm("");
    setToKm("");
    setShowForm(false);
    onChange();
  }

  async function retireBand(id: string) {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/distance-bands/${id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(typeof data.error === "string" ? data.error : "Failed to retire distance band");
      return;
    }
    onChange();
  }

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
              <th className="pb-2"></th>
            </tr>
          </thead>
          <tbody>
            {active.map((b) => (
              <tr key={b.id} className="border-b border-slate-50">
                <td className="py-2 font-mono text-xs">{b.code}</td>
                <td className="py-2">{b.label}</td>
                <td className="py-2 text-xs">{b.fromKm}–{b.toKm ?? "∞"} km</td>
                <td className="py-2"><span className="text-ok text-xs">Active</span></td>
                <td className="py-2 text-right">
                  <button disabled={busy} onClick={() => retireBand(b.id)} className="text-danger text-xs font-medium disabled:opacity-40">
                    Retire
                  </button>
                </td>
              </tr>
            ))}
            {retired.map((b) => (
              <tr key={b.id} className="border-b border-slate-50 opacity-60">
                <td className="py-2 font-mono text-xs">{b.code}</td>
                <td className="py-2">{b.label}</td>
                <td className="py-2 text-xs">{b.fromKm}–{b.toKm ?? "∞"} km</td>
                <td className="py-2"><span className="text-steel text-xs">Retired{b.replacedByDistanceBandId ? " (replaced)" : ""}</span></td>
                <td className="py-2"></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {error && <p className="text-danger text-xs mt-3">{error}</p>}

      <button onClick={() => setShowForm((s) => !s)} className="text-aquaDark text-xs font-medium mt-3">
        {showForm ? "Cancel" : "+ New distance band"}
      </button>

      {showForm && (
        <div className="mt-2 space-y-2 border border-slate-100 rounded-lg p-3 max-w-md">
          <p className="text-steel text-xs">
            Bands already used by a pricing rule or customer site can&apos;t have their range edited afterward — retire it and create a new one instead if a range needs correcting.
          </p>
          <input className="w-full border rounded-lg px-2 py-1 text-xs" placeholder="Code (e.g. RIYADH_FAR_50_PLUS)" value={code} onChange={(e) => setCode(e.target.value)} />
          <input className="w-full border rounded-lg px-2 py-1 text-xs" placeholder="Label (e.g. Far Riyadh)" value={label} onChange={(e) => setLabel(e.target.value)} />
          <div className="flex gap-2">
            <input type="number" className="w-1/2 border rounded-lg px-2 py-1 text-xs" placeholder="From (km)" value={fromKm} onChange={(e) => setFromKm(e.target.value)} />
            <input type="number" className="w-1/2 border rounded-lg px-2 py-1 text-xs" placeholder="To (km, blank = open-ended)" value={toKm} onChange={(e) => setToKm(e.target.value)} />
          </div>
          <button disabled={busy} onClick={createBand} className="bg-ink text-white rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-40">
            Create band
          </button>
        </div>
      )}
    </div>
  );
}
