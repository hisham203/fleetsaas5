"use client";

import { useEffect, useState, useCallback } from "react";
import TopNav from "@/components/TopNav";
import StatusBadge from "@/components/StatusBadge";
import { useRequireSession } from "@/lib/useSession";

export default function B2BPortalPage() {
  const { session, loading: sessionLoading } = useRequireSession(["CUSTOMER"]);
  const [locations, setLocations] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [statement, setStatement] = useState<any>(null);
  const [tab, setTab] = useState<"locations" | "bulk" | "orders" | "statement">("bulk");

  const customerId = session?.id;

  const loadAccountData = useCallback(async () => {
    if (!customerId || !session) return;
    const [locs, ords, stmt] = await Promise.all([
      fetch(`/api/customers/${customerId}/locations`).then((r) => r.json()),
      fetch(`/api/orders?tenantId=${session.tenantId}&customerId=${customerId}`).then((r) => r.json()),
      fetch(`/api/customers/${customerId}/statement`).then((r) => r.json()),
    ]);
    setLocations(locs);
    setOrders(ords);
    setStatement(stmt);
  }, [customerId, session]);

  useEffect(() => {
    loadAccountData();
  }, [loadAccountData]);

  if (sessionLoading || !session) return <Shell><p className="p-6 text-steel">Loading…</p></Shell>;

  return (
    <Shell>
      <div className="p-6 max-w-2xl mx-auto">
        <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4">
          <p className="text-xs text-steel uppercase tracking-wide">B2B account</p>
          <p className="text-sm font-medium mt-1">{session.name}</p>
        </div>

        <>
            <div className="flex gap-1 border-b border-slate-200 mb-4">
              {(["bulk", "locations", "orders", "statement"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-4 py-2 text-sm font-medium capitalize border-b-2 -mb-px transition-colors ${
                    tab === t ? "border-aqua text-aquaDark" : "border-transparent text-steel hover:text-ink"
                  }`}
                >
                  {t === "bulk" ? "Bulk order" : t}
                </button>
              ))}
            </div>

            {tab === "bulk" && (
              <BulkOrderTab
                tenant={{ id: session.tenantId }}
                customer={{ id: session.id }}
                locations={locations}
                onOrderPlaced={loadAccountData}
              />
            )}
            {tab === "locations" && (
              <LocationsTab customerId={customerId} locations={locations} onChange={loadAccountData} />
            )}
            {tab === "orders" && <OrdersTab orders={orders} />}
            {tab === "statement" && <StatementTab statement={statement} />}
          </>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-paper">
      <TopNav role="B2B Portal" />
      {children}
    </main>
  );
}

function BulkOrderTab({ tenant, customer, locations, onOrderPlaced }: any) {
  const [selected, setSelected] = useState<Record<string, { qty: number; empties: number }>>({});
  const [paymentMethod, setPaymentMethod] = useState("ACCOUNT_CREDIT");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function toggleLocation(id: string) {
    setSelected((s) => {
      const next = { ...s };
      if (next[id]) delete next[id];
      else next[id] = { qty: 5, empties: 0 };
      return next;
    });
  }

  function updateQty(id: string, field: "qty" | "empties", value: number) {
    setSelected((s) => ({ ...s, [id]: { ...s[id], [field]: value } }));
  }

  const selectedIds = Object.keys(selected);
  const totalBottles = selectedIds.reduce((sum, id) => sum + selected[id].qty, 0);
  const estimatedValue = totalBottles * 8 * 1.15;

  async function submitBulkOrder() {
    setError("");
    setSuccess("");
    setSubmitting(true);
    const items = selectedIds.map((locationId) => ({
      locationId,
      qtyOrdered: selected[locationId].qty,
      emptyBottlesToCollect: selected[locationId].empties,
      bottleSizeLtr: 19,
    }));
    const res = await fetch("/api/orders/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: tenant.id, customerId: customer.id, paymentMethod, pricePerBottle: 8, items }),
    });
    const data = await res.json();
    setSubmitting(false);
    if (!res.ok) {
      setError(data.error ?? "Failed to place bulk order");
      return;
    }
    setSuccess(`${data.count} order(s) created across ${selectedIds.length} location(s).`);
    setSelected({});
    onOrderPlaced();
  }

  if (locations.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-4 text-center text-steel text-sm">
        No delivery locations on file yet. Add one under the Locations tab first.
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <h3 className="font-medium mb-1">Place a bulk order</h3>
      <p className="text-steel text-xs mb-3">Select locations and set quantities — one order is created per location.</p>

      <div className="space-y-2 mb-4">
        {locations.map((loc: any) => (
          <div
            key={loc.id}
            className={`border rounded-lg p-3 ${selected[loc.id] ? "border-aqua bg-aqua/5" : "border-slate-100"}`}
          >
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="checkbox" className="mt-1" checked={!!selected[loc.id]} onChange={() => toggleLocation(loc.id)} />
              <div className="flex-1">
                <div className="font-medium text-sm">{loc.label}</div>
                <div className="text-steel text-xs">{loc.address}</div>
              </div>
            </label>
            {selected[loc.id] && (
              <div className="flex gap-2 mt-2 ml-6">
                <div className="flex-1">
                  <label className="text-xs text-steel">Quantity</label>
                  <input
                    type="number"
                    min={1}
                    className="w-full border rounded-lg px-2 py-1 text-sm"
                    value={selected[loc.id].qty}
                    onChange={(e) => updateQty(loc.id, "qty", Number(e.target.value))}
                  />
                </div>
                <div className="flex-1">
                  <label className="text-xs text-steel">Empties to collect</label>
                  <input
                    type="number"
                    min={0}
                    className="w-full border rounded-lg px-2 py-1 text-sm"
                    value={selected[loc.id].empties}
                    onChange={(e) => updateQty(loc.id, "empties", Number(e.target.value))}
                  />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="border-t border-slate-100 pt-3 space-y-2">
        <select className="w-full border rounded-lg px-3 py-2 text-sm" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
          <option value="ACCOUNT_CREDIT">Account credit</option>
          <option value="CASH">Cash on delivery</option>
          <option value="CARD">Card</option>
          <option value="ONLINE">Online payment</option>
        </select>

        {selectedIds.length > 0 && (
          <p className="text-steel text-xs">
            {selectedIds.length} location(s) · {totalBottles} units total · est. SAR {estimatedValue.toFixed(2)} incl. VAT
          </p>
        )}

        {error && <p className="text-danger text-xs">{error}</p>}
        {success && <p className="text-ok text-xs">{success}</p>}

        <button
          disabled={selectedIds.length === 0 || submitting}
          onClick={submitBulkOrder}
          className="w-full bg-aquaDark text-white rounded-lg py-2 text-sm font-medium disabled:opacity-40"
        >
          Place bulk order
        </button>
      </div>
    </div>
  );
}

function LocationsTab({ customerId, locations, onChange }: any) {
  const [label, setLabel] = useState("");
  const [address, setAddress] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function addLocation() {
    setSubmitting(true);
    await fetch(`/api/customers/${customerId}/locations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label, address, contactName, contactPhone }),
    });
    setLabel("");
    setAddress("");
    setContactName("");
    setContactPhone("");
    setSubmitting(false);
    onChange();
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <h3 className="font-medium mb-3">Delivery locations</h3>
        <div className="space-y-2">
          {locations.map((loc: any) => (
            <div key={loc.id} className="border border-slate-100 rounded-lg p-3">
              <div className="font-medium text-sm">{loc.label}</div>
              <div className="text-steel text-xs">{loc.address}</div>
              {loc.contactName && (
                <div className="text-steel text-xs mt-1">{loc.contactName} · {loc.contactPhone}</div>
              )}
            </div>
          ))}
          {locations.length === 0 && <p className="text-steel text-sm">No locations yet.</p>}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <h3 className="font-medium mb-3">Add a location</h3>
        <div className="space-y-2">
          <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Label (e.g. Warehouse - North)" value={label} onChange={(e) => setLabel(e.target.value)} />
          <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Address" value={address} onChange={(e) => setAddress(e.target.value)} />
          <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Contact name" value={contactName} onChange={(e) => setContactName(e.target.value)} />
          <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Contact phone" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
          {/* Task K.3: city, zone, and distance band are deliberately
              never shown here — see lib/siteFieldGovernance.ts. This is
              purely informational; there's no hidden/disabled field to
              explain, since this form has never sent these values. */}
          <p className="text-steel text-xs">City, zone, and distance band are managed by the operator because they affect contractual pricing.</p>
          <button
            disabled={!label || !address || submitting}
            onClick={addLocation}
            className="w-full bg-ink text-white rounded-lg py-2 text-sm font-medium disabled:opacity-40"
          >
            Add location
          </button>
        </div>
      </div>
    </div>
  );
}

function OrdersTab({ orders }: { orders: any[] }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <h3 className="font-medium mb-3">Order history</h3>
      <div className="space-y-2 max-h-[500px] overflow-auto">
        {orders.map((o) => (
          <div key={o.id} className="border border-slate-100 rounded-lg p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="font-mono text-xs">{o.orderNumber}</span>
              <StatusBadge status={o.status} />
            </div>
            <p className="text-sm">{o.location?.label ?? o.deliveryAddress}</p>
            <p className="text-steel text-xs">
              {o.qtyOrdered} × {o.bottleSizeLtr}L · {o.paymentMethod.replace("_", " ")}
              {o.emptyBottlesToCollect ? ` · ${o.emptyBottlesToCollect} empties` : ""}
            </p>
          </div>
        ))}
        {orders.length === 0 && <p className="text-steel text-sm">No orders yet.</p>}
      </div>
    </div>
  );
}

function StatementTab({ statement }: { statement: any }) {
  if (!statement) return <p className="text-steel text-sm">Loading statement…</p>;

  const { invoices, unpaidInvoicesTotal, undeliveredOrdersValue, totalExposure, creditLimit, creditAvailable, orderCounts } = statement;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 p-3">
          <p className="text-steel text-xs uppercase">Credit limit</p>
          <p className="text-lg font-semibold mt-1">{creditLimit != null ? `SAR ${creditLimit.toLocaleString()}` : "—"}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-3">
          <p className="text-steel text-xs uppercase">Total exposure</p>
          <p className="text-lg font-semibold mt-1 text-warn">SAR {totalExposure.toFixed(2)}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-3">
          <p className="text-steel text-xs uppercase">Available</p>
          <p className="text-lg font-semibold mt-1 text-ok">
            {creditAvailable != null ? `SAR ${creditAvailable.toFixed(2)}` : "—"}
          </p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <h3 className="font-medium mb-2">Exposure breakdown</h3>
        <div className="text-sm space-y-1">
          <div className="flex justify-between">
            <span className="text-steel">Unpaid invoices</span>
            <span>SAR {unpaidInvoicesTotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-steel">Orders awaiting delivery (not yet invoiced)</span>
            <span>SAR {undeliveredOrdersValue.toFixed(2)}</span>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <h3 className="font-medium mb-3">Orders by status</h3>
        <div className="flex flex-wrap gap-2">
          {orderCounts.map((oc: any) => (
            <div key={oc.status} className="flex items-center gap-1.5 text-sm">
              <StatusBadge status={oc.status} />
              <span className="text-steel">× {oc.count}</span>
            </div>
          ))}
          {orderCounts.length === 0 && <p className="text-steel text-sm">No orders yet.</p>}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <h3 className="font-medium mb-3">Invoices</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-steel border-b border-slate-100">
              <th className="pb-2">Invoice #</th>
              <th className="pb-2">Total</th>
              <th className="pb-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv: any) => (
              <tr key={inv.id} className="border-b border-slate-50">
                <td className="py-2 font-mono text-xs">{inv.invoiceNumber}</td>
                <td className="py-2">SAR {inv.total.toFixed(2)}</td>
                <td className="py-2"><StatusBadge status={inv.status} /></td>
              </tr>
            ))}
            {invoices.length === 0 && (
              <tr><td colSpan={3} className="py-4 text-center text-steel">No invoices yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
