"use client";

import { useEffect, useState, useCallback } from "react";
import AdminShell from "@/components/AdminShell";
import { useRequireSession } from "@/lib/useSession";
import { computeSiteReadinessItems, type SiteReadinessState } from "@/lib/siteReadiness";

// Task K — Customer & Site Configuration, its own standalone module
// (matching Contract Management's own precedent from Task I: a
// dedicated route, not a tab bolted onto the already very large
// app/admin/page.tsx). The existing CustomersTab there is left
// completely untouched — this is additive, not a replacement, and
// nothing here risks the working legacy customer-management flow.
//
// Task K.4: DISPATCHER is admitted here too — Model B, chosen because
// the API-level field governance this module depends on
// (lib/siteFieldGovernance.ts, Task K.3) already fully enforces
// ADMIN-only for cityCode/zoneCode/distanceBandCode server-side. This
// UI change is purely about giving a role that already has safe,
// legitimate API access an actual path to use it — it grants no new
// server-side permission. GET /api/contracts and GET /api/distance-bands
// stay ADMIN-only, unchanged (Task K.4 does not touch either route) —
// for a DISPATCHER session those simply return empty arrays via this
// page's own error-tolerant fetch helper, so contract-linkage and
// distance-band-active-status info silently isn't shown to DISPATCHER,
// which is the intended, safe degradation, not a bug.
export default function CustomersConfigPage() {
  const { session, loading: sessionLoading } = useRequireSession(["ADMIN", "DISPATCHER"]);
  const [tenant, setTenant] = useState<any>(null);
  const [customers, setCustomers] = useState<any[]>([]);
  const [contracts, setContracts] = useState<any[]>([]);
  const [distanceBands, setDistanceBands] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
    const [cust, cont, bands] = await Promise.all([
      safeFetchJson(`/api/customers?tenantId=${t.id}`),
      safeFetchJson("/api/contracts"),
      safeFetchJson("/api/distance-bands"),
    ]);
    setCustomers(Array.isArray(cust) ? cust : []);
    setContracts(Array.isArray(cont) ? cont : []);
    setDistanceBands(Array.isArray(bands) ? bands : []);
    setLoading(false);
  }, [session, safeFetchJson]);

  useEffect(() => {
    if (!session) return;
    load();
  }, [session, load]);

  if (sessionLoading || !session) {
    return <AdminShell title="Customers & Sites"><p className="p-6 text-steel">Loading…</p></AdminShell>;
  }

  const isAdmin = session.role === "ADMIN";
  const selectedCustomer = customers.find((c) => c.id === selectedId) ?? null;
  const contractsByCustomer = new Map<string, any[]>();
  for (const c of contracts) {
    const list = contractsByCustomer.get(c.customerId) ?? [];
    list.push(c);
    contractsByCustomer.set(c.customerId, list);
  }

  return (
    <AdminShell title="Customers & Sites" tenantName={tenant?.name}>
      <div className="p-6 max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-lg font-semibold">Customers & Sites</h1>
          <p className="text-steel text-sm mt-0.5">
            Customer master data and delivery sites — what contracts, pricing, and dispatch all depend on being accurate.{" "}
            {isAdmin ? (
              <>
                <a href="/admin" className="text-aquaDark hover:underline">Back to Admin</a>
                {" · "}
                <a href="/admin/contracts" className="text-aquaDark hover:underline">Contract Management</a>
              </>
            ) : (
              // Task K.4, Part 4: Contract Management is never linked
              // for DISPATCHER here — that page is ADMIN-only anyway
              // (would just redirect them away), and this task's own
              // boundary is explicit that DISPATCHER shouldn't be
              // steered toward contracts/pricing/billing at all.
              <a href="/dispatch" className="text-aquaDark hover:underline">Back to Dispatch</a>
            )}
          </p>
        </div>

        {loading ? (
          <p className="text-steel text-sm">Loading…</p>
        ) : (
          <div className="grid md:grid-cols-2 gap-6">
            <CustomerList
              customers={customers}
              contractsByCustomer={contractsByCustomer}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
            <div>
              {selectedCustomer ? (
                <CustomerSitesPanel
                  customer={selectedCustomer}
                  contracts={contractsByCustomer.get(selectedCustomer.id) ?? []}
                  distanceBands={distanceBands}
                  isAdmin={isAdmin}
                />
              ) : (
                <div className="bg-white rounded-xl border border-slate-200 p-6 text-center text-steel text-sm">
                  Select a customer to see and manage their delivery sites.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </AdminShell>
  );
}

function CustomerList({ customers, contractsByCustomer, selectedId, onSelect }: { customers: any[]; contractsByCustomer: Map<string, any[]>; selectedId: string | null; onSelect: (id: string) => void }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <h3 className="font-medium mb-3">All customers</h3>
      {customers.length === 0 ? (
        <p className="text-steel text-sm">No customers yet — use the Admin → Customers tab to add one.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-steel border-b border-slate-100">
              <th className="pb-2">Name</th>
              <th className="pb-2">Type</th>
              <th className="pb-2">Phone / Email</th>
              <th className="pb-2">Contracts</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr
                key={c.id}
                onClick={() => onSelect(c.id)}
                className={`border-b border-slate-50 cursor-pointer hover:bg-paper ${selectedId === c.id ? "bg-paper" : ""}`}
              >
                <td className="py-2">{c.name}</td>
                <td className="py-2 text-xs">{c.type}</td>
                <td className="py-2 text-steel text-xs">{c.phone ?? c.loginEmail ?? "—"}</td>
                <td className="py-2 text-xs">{(contractsByCustomer.get(c.id) ?? []).length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function SiteReadinessBadges({ site }: { site: any }) {
  const items = computeSiteReadinessItems(site);
  const styles: Record<SiteReadinessState, string> = { READY: "text-ok", WARNING: "text-warn", MISSING: "text-danger" };
  // Only surface the non-Ready rows inline — a fully-ready site shouldn't
  // need six green badges cluttering its row; the gaps are what matter.
  const gaps = items.filter((i) => i.state !== "READY");
  if (gaps.length === 0) return <span className="text-ok text-xs">Ready</span>;
  return (
    <span className="text-xs">
      {gaps.map((g, i) => (
        <span key={g.label} className={styles[g.state]}>
          {i > 0 ? ", " : ""}
          {g.label}: {g.state === "MISSING" ? "Missing" : "Warning"}
        </span>
      ))}
    </span>
  );
}

function CustomerSitesPanel({ customer, contracts, distanceBands, isAdmin }: { customer: any; contracts: any[]; distanceBands: any[]; isAdmin: boolean }) {
  const [sites, setSites] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [siteContracts, setSiteContracts] = useState<Record<string, string[]>>({});
  const [showForm, setShowForm] = useState(false);

  const [label, setLabel] = useState("");
  const [address, setAddress] = useState("");
  const [cityCode, setCityCode] = useState("");
  const [zoneCode, setZoneCode] = useState("");
  const [distanceBandCode, setDistanceBandCode] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const activeBands = distanceBands.filter((b) => b.isActive);

  // Task K.2: site editing state — a separate, per-site inline form,
  // reusing the same field set/style as the existing "+ Add site" form.
  const [editingSiteId, setEditingSiteId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editCityCode, setEditCityCode] = useState("");
  const [editZoneCode, setEditZoneCode] = useState("");
  const [editDistanceBandCode, setEditDistanceBandCode] = useState("");
  const [editLat, setEditLat] = useState("");
  const [editLng, setEditLng] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState("");

  function startEdit(site: any) {
    setEditingSiteId(site.id);
    setEditLabel(site.label ?? "");
    setEditAddress(site.address ?? "");
    setEditCityCode(site.cityCode ?? "");
    setEditZoneCode(site.zoneCode ?? "");
    setEditDistanceBandCode(site.distanceBandCode ?? "");
    setEditLat(site.lat != null ? String(site.lat) : "");
    setEditLng(site.lng != null ? String(site.lng) : "");
    setEditError("");
  }

  async function saveEdit(site: any) {
    setEditBusy(true);
    setEditError("");
    const body: Record<string, unknown> = {
      label: editLabel,
      address: editAddress,
      lat: editLat === "" ? null : Number(editLat),
      lng: editLng === "" ? null : Number(editLng),
    };
    // Task K.4: for a non-admin session, cityCode/zoneCode/
    // distanceBandCode are never included in the request body at all —
    // not even unchanged/pre-filled values — since the server's
    // field-level check (lib/siteFieldGovernance.ts) rejects a request
    // the moment any of these keys is PRESENT, regardless of whether
    // the value actually differs from what's already stored. Omitting
    // the keys entirely means a DISPATCHER editing just the address
    // never accidentally triggers that rejection on an unrelated edit.
    if (isAdmin) {
      body.cityCode = editCityCode === "" ? null : editCityCode;
      body.zoneCode = editZoneCode === "" ? null : editZoneCode;
      body.distanceBandCode = editDistanceBandCode === "" ? null : editDistanceBandCode;
    }
    const res = await fetch(`/api/customers/${customer.id}/locations/${site.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    setEditBusy(false);
    if (!res.ok) {
      setEditError(typeof data.error === "string" ? data.error : "Failed to update site");
      return;
    }
    setEditingSiteId(null);
    load(); // Task K.2, Part 5: refreshes the site list, which recomputes SiteReadinessBadges immediately — no page reload needed.
  }

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/customers/${customer.id}/locations`);
    const rows = res.ok ? await res.json() : [];
    setSites(Array.isArray(rows) ? rows : []);

    // Task K, Part 3.6: which contracts include a given site, read-only,
    // no new relationship service — an "applies to all sites" contract
    // trivially includes every site; a site-restricted one is checked
    // by fetching just that contract's own detail (already embeds its
    // siteScope), so this never does more requests than this customer
    // actually has site-restricted contracts.
    const allSitesContracts = contracts.filter((c) => c.appliesToAllSites).map((c) => c.contractNumber);
    const restrictedContracts = contracts.filter((c) => !c.appliesToAllSites);
    const perSite: Record<string, string[]> = {};
    for (const site of Array.isArray(rows) ? rows : []) {
      perSite[site.id] = [...allSitesContracts];
    }
    for (const c of restrictedContracts) {
      const detailRes = await fetch(`/api/contracts/${c.id}`);
      if (!detailRes.ok) continue;
      const detail = await detailRes.json();
      for (const s of detail.siteScope ?? []) {
        if (perSite[s.customerLocationId]) perSite[s.customerLocationId].push(c.contractNumber);
      }
    }
    setSiteContracts(perSite);
    setLoading(false);
  }, [customer.id, contracts]);

  useEffect(() => {
    load();
  }, [load]);

  async function addSite() {
    setBusy(true);
    setError("");
    const body: Record<string, unknown> = {
      label,
      address,
      lat: lat !== "" ? Number(lat) : undefined,
      lng: lng !== "" ? Number(lng) : undefined,
    };
    // Task K.4: same reasoning as saveEdit below — for a non-admin
    // session these keys are never included in the request at all.
    if (isAdmin) {
      body.cityCode = cityCode || undefined;
      body.zoneCode = zoneCode || undefined;
      body.distanceBandCode = distanceBandCode || undefined;
    }
    const res = await fetch(`/api/customers/${customer.id}/locations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(typeof data.error === "string" ? data.error : "Failed to create site");
      return;
    }
    setLabel("");
    setAddress("");
    setCityCode("");
    setZoneCode("");
    setDistanceBandCode("");
    setLat("");
    setLng("");
    setShowForm(false);
    load();
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
      <div>
        <p className="font-medium">{customer.name}</p>
        <p className="text-steel text-xs">{customer.type} · {customer.phone ?? customer.loginEmail ?? "no contact on file"}</p>
      </div>

      <div>
        <p className="text-xs text-steel uppercase tracking-wide mb-2">Delivery sites</p>
        {loading ? (
          <p className="text-steel text-sm">Loading sites…</p>
        ) : sites.length === 0 ? (
          <p className="text-steel text-sm">No sites yet for this customer.</p>
        ) : (
          <div className="space-y-2">
            {sites.map((s) => (
              <div key={s.id} className="border border-slate-100 rounded-lg p-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{s.label}</span>
                  <div className="flex items-center gap-2">
                    <SiteReadinessBadges site={s} />
                    {editingSiteId !== s.id && (
                      <button onClick={() => startEdit(s)} className="text-aquaDark text-xs font-medium">Edit</button>
                    )}
                  </div>
                </div>
                <p className="text-steel text-xs">{s.address}</p>
                <p className="text-steel text-xs">
                  {s.cityCode ?? "no city"} / {s.zoneCode ?? "no zone"} /{" "}
                  {s.distanceBandCode ? (
                    activeBands.some((b) => b.code === s.distanceBandCode) ? (
                      s.distanceBandCode
                    ) : (
                      <span className="text-warn">{s.distanceBandCode} (retired)</span>
                    )
                  ) : (
                    "no distance band"
                  )}
                  {s.lat != null && s.lng != null ? ` · ${s.lat.toFixed(4)}, ${s.lng.toFixed(4)}` : ""}
                </p>
                {(siteContracts[s.id] ?? []).length > 0 && (
                  <p className="text-steel text-xs mt-1">On contract(s): {siteContracts[s.id].join(", ")}</p>
                )}

                {editingSiteId === s.id && (
                  <div className="mt-2 space-y-2 border-t border-slate-100 pt-2">
                    {isAdmin && (siteContracts[s.id] ?? []).length > 0 && (
                      <p className="text-warn text-xs">
                        This site is used by active contracts. Changes to city/zone/distance band may affect future pricing eligibility.
                      </p>
                    )}
                    <input className="w-full border rounded-lg px-2 py-1 text-xs" placeholder="Site name" value={editLabel} onChange={(e) => setEditLabel(e.target.value)} />
                    <input className="w-full border rounded-lg px-2 py-1 text-xs" placeholder="Address" value={editAddress} onChange={(e) => setEditAddress(e.target.value)} />
                    {isAdmin ? (
                      <div className="flex gap-2">
                        <input className="w-1/3 border rounded-lg px-2 py-1 text-xs" placeholder="City code" value={editCityCode} onChange={(e) => setEditCityCode(e.target.value)} />
                        <input className="w-1/3 border rounded-lg px-2 py-1 text-xs" placeholder="Zone code" value={editZoneCode} onChange={(e) => setEditZoneCode(e.target.value)} />
                        <select className="w-1/3 border rounded-lg px-2 py-1 text-xs" value={editDistanceBandCode} onChange={(e) => setEditDistanceBandCode(e.target.value)}>
                          <option value="">No distance band</option>
                          {/* The currently-assigned band stays visible and selected even if
                              retired (so the field doesn't silently show something wrong),
                              but a RETIRED band is never offered as a NEW choice for anyone else. */}
                          {s.distanceBandCode && !activeBands.some((b) => b.code === s.distanceBandCode) && (
                            <option value={s.distanceBandCode}>{s.distanceBandCode} (retired — currently assigned)</option>
                          )}
                          {activeBands.map((b) => (
                            <option key={b.id} value={b.code}>{b.code}</option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      // Task K.4: no editable input for these three
                      // fields anywhere in this form for a non-admin
                      // session — shown read-only for reference, plus
                      // the exact note this task specified.
                      <div className="text-steel text-xs bg-paper rounded-lg px-2 py-1.5">
                        <p>Current: {s.cityCode ?? "no city"} / {s.zoneCode ?? "no zone"} / {s.distanceBandCode ?? "no distance band"}</p>
                        <p className="mt-1">City, zone, and distance band are managed by admins because they affect contractual pricing.</p>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <input type="number" step="0.0001" className="w-1/2 border rounded-lg px-2 py-1 text-xs" placeholder="Latitude" value={editLat} onChange={(e) => setEditLat(e.target.value)} />
                      <input type="number" step="0.0001" className="w-1/2 border rounded-lg px-2 py-1 text-xs" placeholder="Longitude" value={editLng} onChange={(e) => setEditLng(e.target.value)} />
                    </div>
                    {editError && <p className="text-danger text-xs">{editError}</p>}
                    <div className="flex gap-2">
                      <button disabled={!editLabel || !editAddress || editBusy} onClick={() => saveEdit(s)} className="bg-ink text-white rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-40">
                        Save
                      </button>
                      <button onClick={() => setEditingSiteId(null)} className="text-steel text-xs">Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <button onClick={() => setShowForm((v) => !v)} className="text-aquaDark text-xs font-medium">
        {showForm ? "Cancel" : "+ Add site"}
      </button>

      {showForm && (
        <div className="space-y-2 border border-slate-100 rounded-lg p-3">
          <input className="w-full border rounded-lg px-2 py-1 text-xs" placeholder="Site name" value={label} onChange={(e) => setLabel(e.target.value)} />
          <input className="w-full border rounded-lg px-2 py-1 text-xs" placeholder="Address" value={address} onChange={(e) => setAddress(e.target.value)} />
          {isAdmin ? (
            <div className="flex gap-2">
              <input className="w-1/3 border rounded-lg px-2 py-1 text-xs" placeholder="City code" value={cityCode} onChange={(e) => setCityCode(e.target.value)} />
              <input className="w-1/3 border rounded-lg px-2 py-1 text-xs" placeholder="Zone code" value={zoneCode} onChange={(e) => setZoneCode(e.target.value)} />
              <select className="w-1/3 border rounded-lg px-2 py-1 text-xs" value={distanceBandCode} onChange={(e) => setDistanceBandCode(e.target.value)}>
                <option value="">No distance band</option>
                {activeBands.map((b) => (
                  <option key={b.id} value={b.code}>{b.code}</option>
                ))}
              </select>
            </div>
          ) : (
            // Task K.4: no editable cityCode/zoneCode/distanceBandCode
            // control exists anywhere in this form for a non-admin
            // session — not disabled, not hidden-but-present-in-the-DOM,
            // genuinely absent. addSite() below never even attempts to
            // send these fields for a DISPATCHER session.
            <p className="text-steel text-xs">
              City, zone, and distance band are managed by admins because they affect contractual pricing.
            </p>
          )}
          <div className="flex gap-2">
            <input type="number" step="0.0001" className="w-1/2 border rounded-lg px-2 py-1 text-xs" placeholder="Latitude (optional)" value={lat} onChange={(e) => setLat(e.target.value)} />
            <input type="number" step="0.0001" className="w-1/2 border rounded-lg px-2 py-1 text-xs" placeholder="Longitude (optional)" value={lng} onChange={(e) => setLng(e.target.value)} />
          </div>
          {error && <p className="text-danger text-xs">{error}</p>}
          <button disabled={!label || !address || busy} onClick={addSite} className="bg-ink text-white rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-40">
            Create site
          </button>
        </div>
      )}
    </div>
  );
}
