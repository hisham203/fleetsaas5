"use client";

import { useEffect, useState, useCallback, Fragment } from "react";
import TopNav from "@/components/TopNav";
import StatusBadge from "@/components/StatusBadge";
import { useRequireSession } from "@/lib/useSession";

type Tenant = { id: string; name: string; sector: string; users: any[] };

export default function AdminPage() {
  const { session, loading: sessionLoading } = useRequireSession(["ADMIN"]);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [customers, setCustomers] = useState<any[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [inventory, setInventory] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [tab, setTab] = useState<"overview" | "fleet" | "drivers" | "customers" | "billing" | "maintenance" | "inventory" | "reports" | "scorecards" | "erp" | "automation" | "fieldops" | "executive">("overview");
  const [loading, setLoading] = useState(true);

  // S1 hotfix: a single failing/erroring endpoint (bad status, or a body
  // that isn't valid JSON) used to reject the whole Promise.all below,
  // which meant setLoading(false) never ran and the page stayed on
  // "Loading…" forever — exactly the reported symptom. Each fetch below
  // now degrades to an empty list on failure instead of throwing, so the
  // rest of the page still loads normally even if one API is down.
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
    const [c, v, d, inv, inventoryRows, wh] = await Promise.all([
      safeFetchJson(`/api/customers?tenantId=${t.id}`),
      safeFetchJson(`/api/vehicles?tenantId=${t.id}`),
      safeFetchJson(`/api/drivers?tenantId=${t.id}`),
      safeFetchJson(`/api/invoices?tenantId=${t.id}`),
      safeFetchJson(`/api/inventory?tenantId=${t.id}`),
      safeFetchJson(`/api/warehouses?tenantId=${t.id}`),
    ]);
    setCustomers(c);
    setVehicles(v);
    setDrivers(d);
    setInvoices(inv);
    setInventory(inventoryRows);
    setWarehouses(wh);
    setLoading(false);
  }, [session, safeFetchJson]);

  useEffect(() => {
    if (session) load();
  }, [session, load]);

  if (sessionLoading || !session || loading) return <Shell tenant={null} session={session}><p className="text-steel p-6">Loading…</p></Shell>;

  if (!tenant) {
    return (
      <Shell tenant={null} session={session}>
        <div className="p-6 max-w-lg">
          <h2 className="text-lg font-medium mb-2">No tenant found</h2>
          <p className="text-steel text-sm">
            Run <code className="bg-slate-850 text-white px-1.5 py-0.5 rounded">npm run db:seed</code> to
            create the demo tenant, then refresh this page.
          </p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell tenant={tenant} session={session}>
      <div className="px-6 pt-4">
        <div className="flex gap-1 border-b border-slate-200">
          {(["overview", "fleet", "drivers", "customers", "billing", "maintenance", "inventory", "reports", "scorecards", "erp", "automation", "fieldops", "executive"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium capitalize border-b-2 -mb-px transition-colors ${
                tab === t ? "border-aqua text-aquaDark" : "border-transparent text-steel hover:text-ink"
              }`}
            >
              {t === "erp" ? "ERP Sync" : t === "automation" ? "Automation" : t === "fieldops" ? "Field Ops" : t === "executive" ? "Executive" : t}
            </button>
          ))}
        </div>
      </div>

      <div className="p-6">
        {tab === "overview" && <Overview tenant={tenant} customers={customers} vehicles={vehicles} drivers={drivers} />}
        {tab === "fleet" && <FleetTab tenant={tenant} vehicles={vehicles} warehouses={warehouses} onChange={load} />}
        {tab === "drivers" && <DriversTab tenant={tenant} drivers={drivers} onChange={load} />}
        {tab === "customers" && <CustomersTab tenant={tenant} customers={customers} onChange={load} />}
        {tab === "billing" && <BillingTab invoices={invoices} onChange={load} />}
        {tab === "maintenance" && <MaintenanceTab tenant={tenant} vehicles={vehicles} onChange={load} />}
        {tab === "inventory" && <InventoryTab tenant={tenant} inventory={inventory} warehouses={warehouses} onChange={load} />}
        {tab === "reports" && <ReportsTab tenant={tenant} />}
        {tab === "scorecards" && <ScorecardsTab />}
        {tab === "erp" && <ErpTab />}
        {tab === "automation" && <AutomationTab />}
        {tab === "fieldops" && <FieldOpsTab drivers={drivers} vehicles={vehicles} />}
        {tab === "executive" && <ExecutiveTab />}
      </div>
    </Shell>
  );
}

function BillingTab({ invoices, onChange }: { invoices: any[]; onChange: () => void }) {
  const totalCollected = invoices.filter((i) => i.status === "PAID").reduce((s, i) => s + i.total, 0);
  const totalPending = invoices.filter((i) => i.status === "PENDING").reduce((s, i) => s + i.total, 0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [creditAmount, setCreditAmount] = useState("");
  const [creditReason, setCreditReason] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function settleCash(invoiceId: string) {
    setBusyId(invoiceId);
    await fetch(`/api/invoices/${invoiceId}/settle-cash`, { method: "POST" });
    setBusyId(null);
    onChange();
  }

  async function issueCreditNote(invoiceId: string) {
    setError("");
    setBusyId(invoiceId);
    const res = await fetch(`/api/invoices/${invoiceId}/credit-notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: Number(creditAmount), reason: creditReason }),
    });
    const data = await res.json();
    setBusyId(null);
    if (!res.ok) {
      setError(typeof data.error === "string" ? data.error : "Failed to issue credit note");
      return;
    }
    setCreditAmount("");
    setCreditReason("");
    setExpandedId(null);
    onChange();
  }

  return (
    <div>
      <div className="grid sm:grid-cols-3 gap-4 mb-6">
        <Card title="Invoices issued" value={invoices.length} />
        <Card title="Collected" value={`SAR ${totalCollected.toFixed(2)}`} />
        <Card title="Pending (credit)" value={`SAR ${totalPending.toFixed(2)}`} />
      </div>
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <h3 className="font-medium mb-3">Invoices</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-steel border-b border-slate-100">
              <th className="pb-2">Invoice #</th>
              <th className="pb-2">Customer</th>
              <th className="pb-2">Subtotal</th>
              <th className="pb-2">Discount</th>
              <th className="pb-2">VAT</th>
              <th className="pb-2">Total</th>
              <th className="pb-2">Status</th>
              <th className="pb-2">Cash</th>
              <th className="pb-2"></th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => {
              const creditedSoFar = (inv.creditNotes ?? []).reduce((s: number, c: any) => s + c.amount, 0);
              const isCash = inv.order?.paymentMethod === "CASH";
              return (
                <Fragment key={inv.id}>
                  <tr className="border-b border-slate-50">
                    <td className="py-2 font-mono text-xs">{inv.invoiceNumber}</td>
                    <td className="py-2">{inv.customer.name}</td>
                    <td className="py-2">SAR {inv.subtotal.toFixed(2)}</td>
                    <td className="py-2">{inv.discountAmount > 0 ? `SAR ${inv.discountAmount.toFixed(2)}` : "—"}</td>
                    <td className="py-2">SAR {inv.vatAmount.toFixed(2)}</td>
                    <td className="py-2 font-medium">
                      SAR {inv.total.toFixed(2)}
                      {creditedSoFar > 0 && <span className="text-steel text-xs block">−{creditedSoFar.toFixed(2)} credited</span>}
                    </td>
                    <td className="py-2"><StatusBadge status={inv.status} /></td>
                    <td className="py-2">
                      {isCash ? (
                        inv.cashSettled ? (
                          <span className="text-ok text-xs">Settled</span>
                        ) : (
                          <button disabled={busyId === inv.id} onClick={() => settleCash(inv.id)} className="text-aquaDark text-xs font-medium disabled:opacity-40">
                            Settle
                          </button>
                        )
                      ) : (
                        <span className="text-steel text-xs">—</span>
                      )}
                    </td>
                    <td className="py-2 text-right">
                      <button onClick={() => setExpandedId(expandedId === inv.id ? null : inv.id)} className="text-steel text-xs font-medium">
                        {expandedId === inv.id ? "Close" : "Credit note"}
                      </button>
                    </td>
                  </tr>
                  {expandedId === inv.id && (
                    <tr>
                      <td colSpan={9} className="bg-paper p-3">
                        <div className="flex gap-2 items-end">
                          <div>
                            <label className="text-xs text-steel">Amount (SAR)</label>
                            <input type="number" className="border rounded-lg px-2 py-1 text-xs block" value={creditAmount} onChange={(e) => setCreditAmount(e.target.value)} />
                          </div>
                          <div className="flex-1">
                            <label className="text-xs text-steel">Reason</label>
                            <input className="w-full border rounded-lg px-2 py-1 text-xs" value={creditReason} onChange={(e) => setCreditReason(e.target.value)} />
                          </div>
                          <button
                            disabled={!creditAmount || !creditReason || busyId === inv.id}
                            onClick={() => issueCreditNote(inv.id)}
                            className="bg-ink text-white rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-40"
                          >
                            Issue
                          </button>
                        </div>
                        {error && <p className="text-danger text-xs mt-1">{error}</p>}
                        {(inv.creditNotes ?? []).length > 0 && (
                          <div className="mt-2 space-y-1">
                            {inv.creditNotes.map((c: any) => (
                              <p key={c.id} className="text-xs text-steel">{c.creditNoteNumber}: SAR {c.amount.toFixed(2)} — {c.reason}</p>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {invoices.length === 0 && (
              <tr><td colSpan={9} className="py-4 text-center text-steel">No invoices yet — complete a delivery to generate one.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Shell({ tenant, session, children }: { tenant: Tenant | null; session?: any; children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-paper">
      <TopNav
        role={tenant ? `Admin — ${tenant.name}` : "Admin"}
        extra={session?.isPlatformAdmin ? <CompanySwitcher currentTenantId={tenant?.id} /> : undefined}
      />
      {children}
    </main>
  );
}

function Card({ title, value, sub }: { title: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <p className="text-steel text-xs uppercase tracking-wide">{title}</p>
      <p className="text-2xl font-semibold mt-1">{value}</p>
      {sub && <p className="text-steel text-xs mt-1">{sub}</p>}
    </div>
  );
}

function Overview({ tenant, customers, vehicles, drivers }: any) {
  return (
    <div>
      <div className="grid sm:grid-cols-4 gap-4 mb-6">
        <Card title="Sector" value={tenant.sector.replace("_", " ")} />
        <Card title="Customers" value={customers.length} />
        <Card title="Vehicles" value={vehicles.length} sub={`${vehicles.filter((v: any) => v.status === "AVAILABLE").length} available`} />
        <Card title="Drivers" value={drivers.length} sub={`${drivers.filter((d: any) => d.status === "AVAILABLE").length} available`} />
      </div>
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <h3 className="font-medium mb-3">Users</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-steel border-b border-slate-100">
              <th className="pb-2">Name</th>
              <th className="pb-2">Email</th>
              <th className="pb-2">Role</th>
            </tr>
          </thead>
          <tbody>
            {tenant.users.map((u: any) => (
              <tr key={u.id} className="border-b border-slate-50">
                <td className="py-2">{u.name}</td>
                <td className="py-2 text-steel">{u.email}</td>
                <td className="py-2">{u.role}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FleetTab({ tenant, vehicles, warehouses, onChange }: any) {
  const [plateNumber, setPlate] = useState("");
  const [vehicleType, setType] = useState("Delivery Vehicle");
  const [capacityUnits, setCapacity] = useState(100);
  // G.3: capacityLiters is genuinely optional and left blank by default —
  // unlike capacityUnits (which every legacy vehicle needs and always
  // sends), a bottle van has no meaningful liters figure, so this is
  // only included in the request when the admin actually fills it in.
  const [capacityLiters, setCapacityLiters] = useState("");
  const [homeWarehouseId, setHomeWarehouseId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [addError, setAddError] = useState("");

  async function addVehicle() {
    setAddError("");
    setSubmitting(true);
    const res = await fetch("/api/vehicles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plateNumber,
        vehicleType,
        capacityUnits,
        capacityLiters: capacityLiters !== "" ? Number(capacityLiters) : undefined,
        homeWarehouseId: homeWarehouseId || undefined,
      }),
    });
    const data = await res.json();
    setSubmitting(false);
    if (!res.ok) {
      setAddError(typeof data.error === "string" ? data.error : "Failed to add vehicle");
      return;
    }
    setPlate("");
    setCapacityLiters("");
    setHomeWarehouseId("");
    onChange();
  }

  async function updateHomeWarehouse(vehicleId: string, warehouseId: string) {
    setUpdatingId(vehicleId);
    await fetch(`/api/vehicles/${vehicleId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ homeWarehouseId: warehouseId || null }),
    });
    setUpdatingId(null);
    onChange();
  }

  return (
    <div className="grid md:grid-cols-3 gap-6">
      <div className="md:col-span-2 bg-white rounded-xl border border-slate-200 p-4">
        <h3 className="font-medium mb-3">Vehicles</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-steel border-b border-slate-100">
              <th className="pb-2">Plate</th>
              <th className="pb-2">Type</th>
              <th className="pb-2">Capacity</th>
              <th className="pb-2">Status</th>
              <th className="pb-2">Home warehouse / loading point</th>
            </tr>
          </thead>
          <tbody>
            {vehicles.map((v: any) => (
              <tr key={v.id} className="border-b border-slate-50">
                <td className="py-2 font-mono text-xs">{v.plateNumber}</td>
                <td className="py-2">{v.vehicleType}</td>
                <td className="py-2">{v.capacityLiters ? `${v.capacityLiters.toLocaleString()} L` : v.capacityUnits ? `${v.capacityUnits} units` : "—"}</td>
                <td className="py-2"><StatusBadge status={v.status} /></td>
                <td className="py-2">
                  <select
                    className="border rounded-lg px-2 py-1 text-xs"
                    value={v.homeWarehouseId ?? ""}
                    disabled={updatingId === v.id}
                    onChange={(e) => updateHomeWarehouse(v.id, e.target.value)}
                  >
                    <option value="">No default</option>
                    {warehouses.map((w: any) => (
                      <option key={w.id} value={w.id}>{w.name}</option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 p-4 h-fit">
        <h3 className="font-medium mb-3">Add vehicle</h3>
        <div className="space-y-2">
          <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Plate number" value={plateNumber} onChange={(e) => setPlate(e.target.value)} />
          <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Vehicle type" value={vehicleType} onChange={(e) => setType(e.target.value)} />
          <div>
            <label className="text-xs text-steel">Capacity units (bottle vans, etc.)</label>
            <input type="number" className="w-full border rounded-lg px-3 py-2 text-sm mt-1" placeholder="Capacity units" value={capacityUnits} onChange={(e) => setCapacity(Number(e.target.value))} />
          </div>
          <div>
            <label className="text-xs text-steel">Tanker capacity (liters) — optional, e.g. 18000 / 21000 / 28000</label>
            <input
              type="number"
              className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
              placeholder="e.g. 18000"
              value={capacityLiters}
              onChange={(e) => setCapacityLiters(e.target.value)}
            />
          </div>
          <select className="w-full border rounded-lg px-3 py-2 text-sm" value={homeWarehouseId} onChange={(e) => setHomeWarehouseId(e.target.value)}>
            <option value="">No default warehouse</option>
            {warehouses.map((w: any) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
          {addError && <p className="text-danger text-xs">{addError}</p>}
          <button
            disabled={!plateNumber || submitting}
            onClick={addVehicle}
            className="w-full bg-ink text-white rounded-lg py-2 text-sm font-medium disabled:opacity-40"
          >
            Add vehicle
          </button>
        </div>
      </div>
    </div>
  );
}

function DriversTab({ tenant, drivers, onChange }: any) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [licenseNumber, setLicense] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function addDriver() {
    setError("");
    setSubmitting(true);
    const userRes = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: tenant.id, name, email, password, role: "DRIVER" }),
    });
    const user = await userRes.json();
    if (!userRes.ok) {
      setError(user.error?.fieldErrors?.password?.[0] ?? user.error ?? "Failed to create driver login");
      setSubmitting(false);
      return;
    }
    await fetch("/api/drivers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: tenant.id, userId: user.id, licenseNumber, phone }),
    });
    setName("");
    setEmail("");
    setPassword("");
    setLicense("");
    setPhone("");
    setSubmitting(false);
    onChange();
  }

  return (
    <div className="grid md:grid-cols-3 gap-6">
      <div className="md:col-span-2 bg-white rounded-xl border border-slate-200 p-4">
        <h3 className="font-medium mb-3">Drivers</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-steel border-b border-slate-100">
              <th className="pb-2">Name</th>
              <th className="pb-2">License</th>
              <th className="pb-2">Phone</th>
              <th className="pb-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {drivers.map((d: any) => (
              <tr key={d.id} className="border-b border-slate-50">
                <td className="py-2">{d.user.name}</td>
                <td className="py-2 font-mono text-xs">{d.licenseNumber}</td>
                <td className="py-2">{d.phone}</td>
                <td className="py-2"><StatusBadge status={d.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 p-4 h-fit">
        <h3 className="font-medium mb-3">Add driver</h3>
        <div className="space-y-2">
          <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input type="password" className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Login password (min 6 chars)" value={password} onChange={(e) => setPassword(e.target.value)} />
          <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="License number" value={licenseNumber} onChange={(e) => setLicense(e.target.value)} />
          <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          {error && <p className="text-danger text-xs">{error}</p>}
          <button
            disabled={!name || !email || password.length < 6 || !licenseNumber || submitting}
            onClick={addDriver}
            className="w-full bg-ink text-white rounded-lg py-2 text-sm font-medium disabled:opacity-40"
          >
            Add driver
          </button>
        </div>
      </div>
    </div>
  );
}

function CustomersTab({ tenant, customers, onChange }: any) {
  const [name, setName] = useState("");
  const [type, setType] = useState<"B2C" | "B2B">("B2C");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [creditLimit, setCreditLimit] = useState<number | "">("");
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [contractPrice, setContractPrice] = useState("");

  async function addCustomer() {
    setSubmitting(true);
    await fetch("/api/customers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId: tenant.id,
        name,
        type,
        address,
        phone,
        creditLimit: type === "B2B" && creditLimit !== "" ? Number(creditLimit) : undefined,
      }),
    });
    setName("");
    setAddress("");
    setPhone("");
    setCreditLimit("");
    setSubmitting(false);
    onChange();
  }

  async function saveContractPrice(customerId: string) {
    await fetch(`/api/customers/${customerId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contractPricePerBottle: contractPrice === "" ? null : Number(contractPrice) }),
    });
    setEditingId(null);
    setContractPrice("");
    onChange();
  }

  return (
    <div className="grid md:grid-cols-3 gap-6">
      <div className="md:col-span-2 bg-white rounded-xl border border-slate-200 p-4">
        <h3 className="font-medium mb-3">Customers</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-steel border-b border-slate-100">
              <th className="pb-2">Name</th>
              <th className="pb-2">Type</th>
              <th className="pb-2">Address</th>
              <th className="pb-2">Credit limit</th>
              <th className="pb-2">Contract rate</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c: any) => (
              <tr key={c.id} className="border-b border-slate-50">
                <td className="py-2">{c.name}</td>
                <td className="py-2">{c.type}</td>
                <td className="py-2 text-steel">{c.address}</td>
                <td className="py-2">{c.creditLimit ? `SAR ${c.creditLimit}` : "—"}</td>
                <td className="py-2">
                  {c.type !== "B2B" ? (
                    <span className="text-steel text-xs">N/A</span>
                  ) : editingId === c.id ? (
                    <div className="flex gap-1 items-center">
                      <input
                        type="number"
                        step="0.01"
                        className="w-20 border rounded-lg px-2 py-1 text-xs"
                        placeholder="SAR"
                        value={contractPrice}
                        onChange={(e) => setContractPrice(e.target.value)}
                      />
                      <button onClick={() => saveContractPrice(c.id)} className="text-aquaDark text-xs font-medium">Save</button>
                      <button onClick={() => setEditingId(null)} className="text-steel text-xs">Cancel</button>
                    </div>
                  ) : (
                    <button
                      onClick={() => {
                        setEditingId(c.id);
                        setContractPrice(c.contractPricePerBottle != null ? String(c.contractPricePerBottle) : "");
                      }}
                      className="text-xs text-aquaDark"
                    >
                      {c.contractPricePerBottle != null ? `SAR ${c.contractPricePerBottle}` : "Set rate…"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 p-4 h-fit">
        <h3 className="font-medium mb-3">Add customer</h3>
        <div className="space-y-2">
          <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <select className="w-full border rounded-lg px-3 py-2 text-sm" value={type} onChange={(e) => setType(e.target.value as any)}>
            <option value="B2C">B2C — individual</option>
            <option value="B2B">B2B — commercial</option>
          </select>
          <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Address" value={address} onChange={(e) => setAddress(e.target.value)} />
          <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          {type === "B2B" && (
            <input type="number" className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Credit limit (SAR)" value={creditLimit} onChange={(e) => setCreditLimit(e.target.value === "" ? "" : Number(e.target.value))} />
          )}
          <button
            disabled={!name || !address || submitting}
            onClick={addCustomer}
            className="w-full bg-ink text-white rounded-lg py-2 text-sm font-medium disabled:opacity-40"
          >
            Add customer
          </button>
        </div>
      </div>
    </div>
  );
}

function MaintenanceTab({ tenant, vehicles, onChange }: any) {
  const [vehicleId, setVehicleId] = useState(vehicles[0]?.id ?? "");
  const [records, setRecords] = useState<{ maintenance: any[]; fuel: any[]; tyres: any[] }>({ maintenance: [], fuel: [], tyres: [] });
  const [subTab, setSubTab] = useState<"maintenance" | "fuel" | "tyres">("maintenance");

  const loadVehicleRecords = useCallback(async () => {
    if (!vehicleId) return;
    const [m, f, t] = await Promise.all([
      fetch(`/api/vehicles/${vehicleId}/maintenance`).then((r) => r.json()),
      fetch(`/api/vehicles/${vehicleId}/fuel`).then((r) => r.json()),
      fetch(`/api/vehicles/${vehicleId}/tyres`).then((r) => r.json()),
    ]);
    setRecords({ maintenance: m, fuel: f, tyres: t });
  }, [vehicleId]);

  useEffect(() => {
    loadVehicleRecords();
  }, [loadVehicleRecords]);

  const selectedVehicle = vehicles.find((v: any) => v.id === vehicleId);

  async function refresh() {
    await loadVehicleRecords();
    onChange();
  }

  return (
    <div>
      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4">
        <label className="text-xs text-steel uppercase tracking-wide">Vehicle</label>
        <select className="w-full border rounded-lg px-3 py-2 text-sm mt-1" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
          {vehicles.map((v: any) => (
            <option key={v.id} value={v.id}>{v.plateNumber} — {v.vehicleType} <StatusBadge status={v.status} /></option>
          ))}
        </select>
        {selectedVehicle && (
          <p className="text-steel text-xs mt-2">
            Status: <StatusBadge status={selectedVehicle.status} />
          </p>
        )}
      </div>

      <div className="flex gap-1 border-b border-slate-200 mb-4">
        {(["maintenance", "fuel", "tyres"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSubTab(s)}
            className={`px-4 py-2 text-sm font-medium capitalize border-b-2 -mb-px transition-colors ${
              subTab === s ? "border-aqua text-aquaDark" : "border-transparent text-steel hover:text-ink"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {subTab === "maintenance" && (
        <MaintenanceSubTab tenant={tenant} vehicle={selectedVehicle} records={records.maintenance} onChange={refresh} />
      )}
      {subTab === "fuel" && <FuelSubTab tenant={tenant} vehicle={selectedVehicle} records={records.fuel} onChange={refresh} />}
      {subTab === "tyres" && <TyresSubTab tenant={tenant} vehicle={selectedVehicle} records={records.tyres} onChange={refresh} />}
    </div>
  );
}

function MaintenanceSubTab({ tenant, vehicle, records, onChange }: any) {
  const [description, setDescription] = useState("");
  const [type, setType] = useState("PREVENTIVE");
  const [odometer, setOdometer] = useState<number | "">("");
  const [cost, setCost] = useState<number | "">("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function openRecord() {
    setError("");
    setSubmitting(true);
    const res = await fetch(`/api/vehicles/${vehicle.id}/maintenance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId: tenant.id,
        type,
        description,
        odometerReading: odometer === "" ? undefined : odometer,
        cost: cost === "" ? undefined : cost,
      }),
    });
    const data = await res.json();
    setSubmitting(false);
    if (!res.ok) {
      setError(data.error ?? "Failed to open maintenance record");
      return;
    }
    setDescription("");
    setOdometer("");
    setCost("");
    onChange();
  }

  async function completeRecord(recordId: string) {
    await fetch(`/api/vehicles/${vehicle.id}/maintenance/${recordId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "complete" }),
    });
    onChange();
  }

  return (
    <div className="grid md:grid-cols-3 gap-6">
      <div className="md:col-span-2 bg-white rounded-xl border border-slate-200 p-4">
        <h3 className="font-medium mb-3">Maintenance history</h3>
        <div className="space-y-2">
          {records.map((r: any) => (
            <div key={r.id} className="border border-slate-100 rounded-lg p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium">{r.type.replace("_", " ")}</span>
                <StatusBadge status={r.status} />
              </div>
              <p className="text-steel text-xs">{r.description}</p>
              <p className="text-steel text-xs mt-1">
                {r.odometerReading ? `${r.odometerReading} km · ` : ""}
                {r.cost ? `SAR ${r.cost}` : "cost pending"}
              </p>
              {r.status === "OPEN" && (
                <button onClick={() => completeRecord(r.id)} className="w-full bg-ok text-white rounded-lg py-1.5 text-xs font-medium mt-2">
                  Mark completed (returns vehicle to service)
                </button>
              )}
            </div>
          ))}
          {records.length === 0 && <p className="text-steel text-sm">No maintenance records yet.</p>}
        </div>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 p-4 h-fit">
        <h3 className="font-medium mb-3">Open a maintenance record</h3>
        <p className="text-steel text-xs mb-2">This takes the vehicle out of service until marked completed.</p>
        <div className="space-y-2">
          <select className="w-full border rounded-lg px-3 py-2 text-sm" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="PREVENTIVE">Preventive</option>
            <option value="CORRECTIVE">Corrective</option>
            <option value="EMERGENCY">Emergency</option>
          </select>
          <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
          <input type="number" className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Odometer (km)" value={odometer} onChange={(e) => setOdometer(e.target.value === "" ? "" : Number(e.target.value))} />
          <input type="number" className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Estimated cost (SAR)" value={cost} onChange={(e) => setCost(e.target.value === "" ? "" : Number(e.target.value))} />
          {error && <p className="text-danger text-xs">{error}</p>}
          <button
            disabled={!description || !vehicle || submitting}
            onClick={openRecord}
            className="w-full bg-warn text-white rounded-lg py-2 text-sm font-medium disabled:opacity-40"
          >
            Open record
          </button>
        </div>
      </div>
    </div>
  );
}

function FuelSubTab({ tenant, vehicle, records, onChange }: any) {
  const [liters, setLiters] = useState<number | "">("");
  const [cost, setCost] = useState<number | "">("");
  const [odometer, setOdometer] = useState<number | "">("");
  const [submitting, setSubmitting] = useState(false);

  async function addLog() {
    setSubmitting(true);
    await fetch(`/api/vehicles/${vehicle.id}/fuel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId: tenant.id,
        litersFilled: liters,
        costSar: cost,
        odometerReading: odometer === "" ? undefined : odometer,
      }),
    });
    setLiters("");
    setCost("");
    setOdometer("");
    setSubmitting(false);
    onChange();
  }

  return (
    <div className="grid md:grid-cols-3 gap-6">
      <div className="md:col-span-2 bg-white rounded-xl border border-slate-200 p-4">
        <h3 className="font-medium mb-3">Fuel log</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-steel border-b border-slate-100">
              <th className="pb-2">Liters</th>
              <th className="pb-2">Cost</th>
              <th className="pb-2">Odometer</th>
            </tr>
          </thead>
          <tbody>
            {records.map((r: any) => (
              <tr key={r.id} className="border-b border-slate-50">
                <td className="py-2">{r.litersFilled} L</td>
                <td className="py-2">SAR {r.costSar}</td>
                <td className="py-2 text-steel">{r.odometerReading ? `${r.odometerReading} km` : "—"}</td>
              </tr>
            ))}
            {records.length === 0 && (
              <tr><td colSpan={3} className="py-4 text-center text-steel">No fuel logs yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 p-4 h-fit">
        <h3 className="font-medium mb-3">Log a fill-up</h3>
        <div className="space-y-2">
          <input type="number" className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Liters filled" value={liters} onChange={(e) => setLiters(e.target.value === "" ? "" : Number(e.target.value))} />
          <input type="number" className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Cost (SAR)" value={cost} onChange={(e) => setCost(e.target.value === "" ? "" : Number(e.target.value))} />
          <input type="number" className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Odometer (km)" value={odometer} onChange={(e) => setOdometer(e.target.value === "" ? "" : Number(e.target.value))} />
          <button
            disabled={liters === "" || cost === "" || !vehicle || submitting}
            onClick={addLog}
            className="w-full bg-ink text-white rounded-lg py-2 text-sm font-medium disabled:opacity-40"
          >
            Log fill-up
          </button>
        </div>
      </div>
    </div>
  );
}

function TyresSubTab({ tenant, vehicle, records, onChange }: any) {
  const [position, setPosition] = useState("Front-Left");
  const [serialNumber, setSerialNumber] = useState("");
  const [cost, setCost] = useState<number | "">("");
  const [odometer, setOdometer] = useState<number | "">("");
  const [submitting, setSubmitting] = useState(false);

  async function addTyre() {
    setSubmitting(true);
    await fetch(`/api/vehicles/${vehicle.id}/tyres`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId: tenant.id,
        position,
        serialNumber: serialNumber || undefined,
        costSar: cost === "" ? undefined : cost,
        installOdometer: odometer === "" ? undefined : odometer,
      }),
    });
    setSerialNumber("");
    setCost("");
    setOdometer("");
    setSubmitting(false);
    onChange();
  }

  async function retireTyre(tyreId: string) {
    await fetch(`/api/vehicles/${vehicle.id}/tyres/${tyreId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "retire" }),
    });
    onChange();
  }

  return (
    <div className="grid md:grid-cols-3 gap-6">
      <div className="md:col-span-2 bg-white rounded-xl border border-slate-200 p-4">
        <h3 className="font-medium mb-3">Tyres</h3>
        <div className="space-y-2">
          {records.map((r: any) => (
            <div key={r.id} className="border border-slate-100 rounded-lg p-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{r.position}</p>
                <p className="text-steel text-xs">{r.serialNumber ?? "no serial"} · {r.costSar ? `SAR ${r.costSar}` : ""}</p>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={r.status} />
                {r.status === "ACTIVE" && (
                  <button onClick={() => retireTyre(r.id)} className="text-xs text-danger font-medium">Retire</button>
                )}
              </div>
            </div>
          ))}
          {records.length === 0 && <p className="text-steel text-sm">No tyre records yet.</p>}
        </div>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 p-4 h-fit">
        <h3 className="font-medium mb-3">Install a tyre</h3>
        <div className="space-y-2">
          <select className="w-full border rounded-lg px-3 py-2 text-sm" value={position} onChange={(e) => setPosition(e.target.value)}>
            <option>Front-Left</option>
            <option>Front-Right</option>
            <option>Rear-Left</option>
            <option>Rear-Right</option>
          </select>
          <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Serial number" value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} />
          <input type="number" className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Cost (SAR)" value={cost} onChange={(e) => setCost(e.target.value === "" ? "" : Number(e.target.value))} />
          <input type="number" className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Install odometer (km)" value={odometer} onChange={(e) => setOdometer(e.target.value === "" ? "" : Number(e.target.value))} />
          <button
            disabled={!vehicle || submitting}
            onClick={addTyre}
            className="w-full bg-ink text-white rounded-lg py-2 text-sm font-medium disabled:opacity-40"
          >
            Install tyre
          </button>
        </div>
      </div>
    </div>
  );
}

function InventoryTab({ tenant, inventory, warehouses, onChange }: any) {
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? "");
  const [itemName, setItemName] = useState("19L Bottle - Full");
  const [delta, setDelta] = useState<number | "">("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [showNewWarehouse, setShowNewWarehouse] = useState(false);
  const [whName, setWhName] = useState("");
  const [whAddress, setWhAddress] = useState("");
  const [whLat, setWhLat] = useState<number | "">("");
  const [whLng, setWhLng] = useState<number | "">("");
  const [whError, setWhError] = useState("");
  const [whSubmitting, setWhSubmitting] = useState(false);

  async function adjustStock() {
    setError("");
    setSubmitting(true);
    const res = await fetch("/api/inventory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ warehouseId, itemName, delta, unit: "bottle" }),
    });
    const data = await res.json();
    setSubmitting(false);
    if (!res.ok) {
      setError(data.error ?? "Failed to adjust stock");
      return;
    }
    setDelta("");
    onChange();
  }

  async function addWarehouse() {
    setWhError("");
    setWhSubmitting(true);
    const res = await fetch("/api/warehouses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: whName, address: whAddress, lat: whLat, lng: whLng }),
    });
    const data = await res.json();
    setWhSubmitting(false);
    if (!res.ok) {
      setWhError(data.error ?? "Failed to create warehouse");
      return;
    }
    setWhName("");
    setWhAddress("");
    setWhLat("");
    setWhLng("");
    setShowNewWarehouse(false);
    onChange();
  }

  const byWarehouse = warehouses.map((w: any) => ({
    warehouse: w,
    items: inventory.filter((i: any) => i.warehouseId === w.id),
  }));

  return (
    <div className="grid md:grid-cols-3 gap-6">
      <div className="md:col-span-2 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">Warehouses / Loading Points &amp; Stock</h3>
          <button onClick={() => setShowNewWarehouse((s) => !s)} className="text-xs text-aquaDark font-medium">
            {showNewWarehouse ? "Cancel" : "+ New warehouse"}
          </button>
        </div>

        {showNewWarehouse && (
          <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-2">
            <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Warehouse name" value={whName} onChange={(e) => setWhName(e.target.value)} />
            <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Address" value={whAddress} onChange={(e) => setWhAddress(e.target.value)} />
            <div className="flex gap-2">
              <input type="number" step="any" className="w-1/2 border rounded-lg px-3 py-2 text-sm" placeholder="Latitude" value={whLat} onChange={(e) => setWhLat(e.target.value === "" ? "" : Number(e.target.value))} />
              <input type="number" step="any" className="w-1/2 border rounded-lg px-3 py-2 text-sm" placeholder="Longitude" value={whLng} onChange={(e) => setWhLng(e.target.value === "" ? "" : Number(e.target.value))} />
            </div>
            {whError && <p className="text-danger text-xs">{whError}</p>}
            <button
              disabled={!whName || !whAddress || whLat === "" || whLng === "" || whSubmitting}
              onClick={addWarehouse}
              className="w-full bg-ink text-white rounded-lg py-2 text-sm font-medium disabled:opacity-40"
            >
              Create warehouse
            </button>
          </div>
        )}

        {byWarehouse.map(({ warehouse, items }: any) => (
          <div key={warehouse.id} className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-medium text-sm">{warehouse.name}</h4>
              {warehouse.isDefault && <span className="text-xs text-aquaDark">Default</span>}
            </div>
            <p className="text-steel text-xs mb-3">{warehouse.address}</p>
            <div className="grid grid-cols-2 gap-3">
              {items.map((item: any) => (
                <div key={item.id} className="border border-slate-100 rounded-lg p-3">
                  <p className="text-steel text-xs uppercase">{item.itemName}</p>
                  <p className="text-xl font-semibold mt-1">{item.quantity} <span className="text-sm font-normal text-steel">{item.unit}s</span></p>
                </div>
              ))}
              {items.length === 0 && <p className="text-steel text-sm col-span-2">No stock items yet.</p>}
            </div>
          </div>
        ))}
        {warehouses.length === 0 && (
          <div className="bg-white rounded-xl border border-slate-200 p-4 text-center text-steel text-sm">
            No warehouses yet — create one to start tracking stock and assigning trips.
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4 h-fit">
        <h3 className="font-medium mb-3">Adjust stock</h3>
        <p className="text-steel text-xs mb-2">Positive to add (e.g. new stock delivery), negative to remove (e.g. stocktake correction). Trip loading and ePOD empties adjust stock automatically.</p>
        <div className="space-y-2">
          <select className="w-full border rounded-lg px-3 py-2 text-sm" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
            <option value="">Select warehouse…</option>
            {warehouses.map((w: any) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
          <select className="w-full border rounded-lg px-3 py-2 text-sm" value={itemName} onChange={(e) => setItemName(e.target.value)}>
            <option>19L Bottle - Full</option>
            <option>19L Bottle - Empty</option>
            <option>Bulk Water - Tanker Stock (Liters)</option>
          </select>
          <input type="number" className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Adjustment (+/-)" value={delta} onChange={(e) => setDelta(e.target.value === "" ? "" : Number(e.target.value))} />
          {error && <p className="text-danger text-xs">{error}</p>}
          <button
            disabled={!warehouseId || delta === "" || submitting}
            onClick={adjustStock}
            className="w-full bg-ink text-white rounded-lg py-2 text-sm font-medium disabled:opacity-40"
          >
            Apply adjustment
          </button>
        </div>
      </div>
    </div>
  );
}

function ReportsTab({ tenant }: any) {
  const [datasets, setDatasets] = useState<any[]>([]);
  const [savedReports, setSavedReports] = useState<any[]>([]);
  const [datasetKey, setDatasetKey] = useState("");
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [filters, setFilters] = useState<{ column: string; operator: string; value: string }[]>([]);
  const [sortColumn, setSortColumn] = useState("");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [result, setResult] = useState<{ columns: any[]; rows: any[]; totalMatched: number } | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [reportName, setReportName] = useState("");
  const [showSaveForm, setShowSaveForm] = useState(false);

  const loadMeta = useCallback(async () => {
    const [ds, reports] = await Promise.all([
      fetch("/api/reports/datasets").then((r) => r.json()),
      fetch("/api/reports").then((r) => r.json()),
    ]);
    setDatasets(ds);
    setSavedReports(reports);
  }, []);

  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  const currentDataset = datasets.find((d) => d.key === datasetKey);

  function selectDataset(key: string) {
    setDatasetKey(key);
    const ds = datasets.find((d) => d.key === key);
    setSelectedColumns(ds ? ds.columns.map((c: any) => c.key) : []);
    setFilters([]);
    setSortColumn(ds?.defaultSortColumn ?? "");
    setSortDirection("desc");
    setResult(null);
  }

  function toggleColumn(key: string) {
    setSelectedColumns((cols) => (cols.includes(key) ? cols.filter((c) => c !== key) : [...cols, key]));
  }

  function addFilter() {
    if (!currentDataset) return;
    setFilters((f) => [...f, { column: currentDataset.columns[0].key, operator: "eq", value: "" }]);
  }

  function updateFilter(idx: number, patch: Partial<{ column: string; operator: string; value: string }>) {
    setFilters((f) => f.map((flt, i) => (i === idx ? { ...flt, ...patch } : flt)));
  }

  function removeFilter(idx: number) {
    setFilters((f) => f.filter((_, i) => i !== idx));
  }

  function buildConfig() {
    return {
      columns: selectedColumns,
      filters: filters
        .filter((f) => f.value !== "")
        .map((f) => {
          const colDef = currentDataset?.columns.find((c: any) => c.key === f.column);
          const value = colDef?.type === "number" ? Number(f.value) : f.value;
          return { column: f.column, operator: f.operator, value };
        }),
      sort: sortColumn ? { column: sortColumn, direction: sortDirection } : undefined,
    };
  }

  async function runReport() {
    setError("");
    setRunning(true);
    const res = await fetch("/api/reports/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ datasetKey, config: buildConfig() }),
    });
    const data = await res.json();
    setRunning(false);
    if (!res.ok) {
      setError(data.error ?? "Report failed");
      return;
    }
    setResult(data);
  }

  async function exportCsv() {
    const res = await fetch("/api/reports/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ datasetKey, config: buildConfig(), format: "csv" }),
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${datasetKey}-report.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function saveReport() {
    await fetch("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: reportName, datasetKey, config: buildConfig() }),
    });
    setReportName("");
    setShowSaveForm(false);
    loadMeta();
  }

  function loadSavedReport(report: any) {
    selectDataset(report.datasetKey);
    setSelectedColumns(report.config.columns);
    setFilters(report.config.filters.map((f: any) => ({ ...f, value: String(f.value) })));
    if (report.config.sort) {
      setSortColumn(report.config.sort.column);
      setSortDirection(report.config.sort.direction);
    }
  }

  async function deleteReport(id: string) {
    await fetch(`/api/reports/${id}`, { method: "DELETE" });
    loadMeta();
  }

  return (
    <div className="grid md:grid-cols-3 gap-6">
      <div className="md:col-span-2 space-y-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h3 className="font-medium mb-3">Build a report</h3>
          <select className="w-full border rounded-lg px-3 py-2 text-sm mb-3" value={datasetKey} onChange={(e) => selectDataset(e.target.value)}>
            <option value="">Select dataset…</option>
            {datasets.map((d) => (
              <option key={d.key} value={d.key}>{d.label} — {d.description}</option>
            ))}
          </select>

          {currentDataset && (
            <>
              <p className="text-xs text-steel uppercase tracking-wide mb-2">Columns</p>
              <div className="flex flex-wrap gap-2 mb-4">
                {currentDataset.columns.map((c: any) => (
                  <label key={c.key} className="flex items-center gap-1.5 text-xs border rounded-full px-2.5 py-1 cursor-pointer">
                    <input type="checkbox" checked={selectedColumns.includes(c.key)} onChange={() => toggleColumn(c.key)} />
                    {c.label}
                  </label>
                ))}
              </div>

              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-steel uppercase tracking-wide">Filters</p>
                <button onClick={addFilter} className="text-xs text-aquaDark font-medium">+ Add filter</button>
              </div>
              <div className="space-y-2 mb-4">
                {filters.map((f, idx) => {
                  const colDef = currentDataset.columns.find((c: any) => c.key === f.column);
                  return (
                    <div key={idx} className="flex gap-2 items-center">
                      <select className="border rounded-lg px-2 py-1.5 text-xs flex-1" value={f.column} onChange={(e) => updateFilter(idx, { column: e.target.value })}>
                        {currentDataset.columns.map((c: any) => (
                          <option key={c.key} value={c.key}>{c.label}</option>
                        ))}
                      </select>
                      <select className="border rounded-lg px-2 py-1.5 text-xs" value={f.operator} onChange={(e) => updateFilter(idx, { operator: e.target.value })}>
                        {colDef?.type === "text" && <><option value="eq">=</option><option value="contains">contains</option></>}
                        {colDef?.type === "enum" && <><option value="eq">=</option><option value="neq">≠</option></>}
                        {(colDef?.type === "number" || colDef?.type === "date") && (
                          <>
                            <option value="eq">=</option>
                            <option value="gt">&gt;</option>
                            <option value="gte">&gt;=</option>
                            <option value="lt">&lt;</option>
                            <option value="lte">&lt;=</option>
                          </>
                        )}
                      </select>
                      {colDef?.type === "enum" ? (
                        <select className="border rounded-lg px-2 py-1.5 text-xs flex-1" value={f.value} onChange={(e) => updateFilter(idx, { value: e.target.value })}>
                          <option value="">Select…</option>
                          {colDef.enumValues?.map((v: string) => <option key={v} value={v}>{v}</option>)}
                        </select>
                      ) : (
                        <input
                          className="border rounded-lg px-2 py-1.5 text-xs flex-1"
                          type={colDef?.type === "number" ? "number" : colDef?.type === "date" ? "date" : "text"}
                          value={f.value}
                          onChange={(e) => updateFilter(idx, { value: e.target.value })}
                        />
                      )}
                      <button onClick={() => removeFilter(idx)} className="text-danger text-xs">✕</button>
                    </div>
                  );
                })}
              </div>

              <div className="flex gap-2 mb-4">
                <select className="border rounded-lg px-2 py-1.5 text-xs flex-1" value={sortColumn} onChange={(e) => setSortColumn(e.target.value)}>
                  <option value="">No sort</option>
                  {currentDataset.columns.map((c: any) => (
                    <option key={c.key} value={c.key}>Sort by {c.label}</option>
                  ))}
                </select>
                <select className="border rounded-lg px-2 py-1.5 text-xs" value={sortDirection} onChange={(e) => setSortDirection(e.target.value as any)}>
                  <option value="desc">Descending</option>
                  <option value="asc">Ascending</option>
                </select>
              </div>

              {error && <p className="text-danger text-xs mb-2">{error}</p>}
              <div className="flex gap-2">
                <button onClick={runReport} disabled={running || selectedColumns.length === 0} className="flex-1 bg-aquaDark text-white rounded-lg py-2 text-sm font-medium disabled:opacity-40">
                  {running ? "Running…" : "Run report"}
                </button>
                {result && (
                  <button onClick={exportCsv} className="bg-ink text-white rounded-lg py-2 px-4 text-sm font-medium">
                    Export CSV
                  </button>
                )}
                <button onClick={() => setShowSaveForm((s) => !s)} className="border border-slate-200 rounded-lg py-2 px-4 text-sm font-medium">
                  Save…
                </button>
              </div>

              {showSaveForm && (
                <div className="flex gap-2 mt-2">
                  <input className="flex-1 border rounded-lg px-3 py-2 text-sm" placeholder="Report name" value={reportName} onChange={(e) => setReportName(e.target.value)} />
                  <button disabled={!reportName} onClick={saveReport} className="bg-ok text-white rounded-lg px-4 text-sm font-medium disabled:opacity-40">
                    Save
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {result && (
          <div className="bg-white rounded-xl border border-slate-200 p-4 overflow-auto">
            <p className="text-steel text-xs mb-2">{result.totalMatched} row(s) matched{result.rows.length < result.totalMatched ? ` (showing ${result.rows.length})` : ""}</p>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-steel border-b border-slate-100">
                  {result.columns.map((c) => <th key={c.key} className="pb-2 pr-4">{c.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, i) => (
                  <tr key={i} className="border-b border-slate-50">
                    {result.columns.map((c) => (
                      <td key={c.key} className="py-2 pr-4">{formatCellValue(row[c.key])}</td>
                    ))}
                  </tr>
                ))}
                {result.rows.length === 0 && (
                  <tr><td colSpan={result.columns.length} className="py-4 text-center text-steel">No rows matched.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4 h-fit">
        <h3 className="font-medium mb-3">Saved reports</h3>
        <div className="space-y-2">
          {savedReports.map((r) => (
            <div key={r.id} className="border border-slate-100 rounded-lg p-3">
              <p className="text-sm font-medium">{r.name}</p>
              <p className="text-steel text-xs mb-2">{r.datasetKey}</p>
              <div className="flex gap-2">
                <button onClick={() => loadSavedReport(r)} className="flex-1 bg-ink text-white rounded-lg py-1.5 text-xs font-medium">Load</button>
                <button onClick={() => deleteReport(r.id)} className="text-danger text-xs">Delete</button>
              </div>
            </div>
          ))}
          {savedReports.length === 0 && <p className="text-steel text-sm">No saved reports yet.</p>}
        </div>
      </div>
    </div>
  );
}

function formatCellValue(value: any): string {
  if (value == null) return "—";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return new Date(value).toLocaleString();
  }
  return String(value);
}

function ScorecardsTab() {
  const [driverScores, setDriverScores] = useState<any[]>([]);
  const [vehicleScores, setVehicleScores] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [weights, setWeights] = useState<any>(null);
  const [showWeights, setShowWeights] = useState(false);
  const [onTimeWeight, setOnTimeWeight] = useState(50);
  const [deliverySuccessWeight, setDeliverySuccessWeight] = useState(30);
  const [tripVolumeWeight, setTripVolumeWeight] = useState(20);
  const [tripVolumeCap, setTripVolumeCap] = useState(20);
  const [savingWeights, setSavingWeights] = useState(false);
  const [weightsError, setWeightsError] = useState("");

  const loadAll = useCallback(async () => {
    const [drivers, vehicles, config] = await Promise.all([
      fetch("/api/scorecards/drivers").then((r) => r.json()),
      fetch("/api/scorecards/vehicles").then((r) => r.json()),
      fetch("/api/scorecards/config").then((r) => r.json()),
    ]);
    setDriverScores(drivers);
    setVehicleScores(vehicles);
    setWeights(config);
    setOnTimeWeight(config.onTimeWeight);
    setDeliverySuccessWeight(config.deliverySuccessWeight);
    setTripVolumeWeight(config.tripVolumeWeight);
    setTripVolumeCap(config.tripVolumeCap);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const totalWeight = onTimeWeight + deliverySuccessWeight + tripVolumeWeight;
  const pct = (w: number) => (totalWeight > 0 ? Math.round((w / totalWeight) * 100) : 0);

  async function saveWeights() {
    setWeightsError("");
    setSavingWeights(true);
    const res = await fetch("/api/scorecards/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ onTimeWeight, deliverySuccessWeight, tripVolumeWeight, tripVolumeCap }),
    });
    const data = await res.json();
    setSavingWeights(false);
    if (!res.ok) {
      setWeightsError(typeof data.error === "string" ? data.error : "Failed to save weights");
      return;
    }
    setShowWeights(false);
    loadAll();
  }

  if (loading) return <p className="text-steel text-sm">Loading scorecards…</p>;

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-medium">Driver scorecards</h3>
          <button onClick={() => setShowWeights((s) => !s)} className="text-xs text-aquaDark font-medium">
            {showWeights ? "Cancel" : "Adjust weights"}
          </button>
        </div>
        <p className="text-steel text-xs mb-3">
          Score = {pct(onTimeWeight)}% on-time delivery rate + {pct(deliverySuccessWeight)}% delivery success rate + {pct(tripVolumeWeight)}% trip volume (capped at {tripVolumeCap} trips). Ranked highest first.
          {weights?.isDefault === false && <span className="text-aquaDark"> (custom weights)</span>}
        </p>

        {showWeights && (
          <div className="bg-paper rounded-lg p-3 mb-4 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs">
                On-time weight
                <input type="number" min={0} className="w-full border rounded-lg px-2 py-1.5 text-sm mt-1" value={onTimeWeight} onChange={(e) => setOnTimeWeight(Number(e.target.value))} />
              </label>
              <label className="text-xs">
                Delivery success weight
                <input type="number" min={0} className="w-full border rounded-lg px-2 py-1.5 text-sm mt-1" value={deliverySuccessWeight} onChange={(e) => setDeliverySuccessWeight(Number(e.target.value))} />
              </label>
              <label className="text-xs">
                Trip volume weight
                <input type="number" min={0} className="w-full border rounded-lg px-2 py-1.5 text-sm mt-1" value={tripVolumeWeight} onChange={(e) => setTripVolumeWeight(Number(e.target.value))} />
              </label>
              <label className="text-xs">
                Trip volume cap (trips for full marks)
                <input type="number" min={1} className="w-full border rounded-lg px-2 py-1.5 text-sm mt-1" value={tripVolumeCap} onChange={(e) => setTripVolumeCap(Number(e.target.value))} />
              </label>
            </div>
            <p className="text-steel text-xs">Weights don&apos;t need to sum to 100 — they&apos;re normalized automatically.</p>
            {weightsError && <p className="text-danger text-xs">{weightsError}</p>}
            <button
              disabled={savingWeights || totalWeight <= 0}
              onClick={saveWeights}
              className="bg-ink text-white rounded-lg px-4 py-1.5 text-xs font-medium disabled:opacity-40"
            >
              {savingWeights ? "Saving…" : "Save weights"}
            </button>
          </div>
        )}
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-steel border-b border-slate-100">
              <th className="pb-2">Rank</th>
              <th className="pb-2">Driver</th>
              <th className="pb-2">Score</th>
              <th className="pb-2">Trips</th>
              <th className="pb-2">Delivered</th>
              <th className="pb-2">Failed</th>
              <th className="pb-2">On-time</th>
              <th className="pb-2">Revenue</th>
              <th className="pb-2">Avg trip (min)</th>
            </tr>
          </thead>
          <tbody>
            {driverScores.map((d, i) => (
              <tr key={d.driverId} className="border-b border-slate-50">
                <td className="py-2">#{i + 1}</td>
                <td className="py-2 font-medium">{d.driverName}</td>
                <td className="py-2"><span className="font-mono">{d.score}</span></td>
                <td className="py-2">{d.tripsCompleted}</td>
                <td className="py-2">{d.ordersDelivered}</td>
                <td className="py-2">{d.ordersFailed}</td>
                <td className="py-2">{d.onTimeRate != null ? `${Math.round(d.onTimeRate * 100)}%` : "—"}</td>
                <td className="py-2">SAR {d.revenueCollectedSar.toFixed(2)}</td>
                <td className="py-2">{d.avgTripDurationMinutes ?? "—"}</td>
              </tr>
            ))}
            {driverScores.length === 0 && <tr><td colSpan={9} className="py-4 text-center text-steel">No drivers yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <h3 className="font-medium mb-1">Vehicle scorecards</h3>
        <p className="text-steel text-xs mb-3">
          Ranked by average cost per completed trip (fuel + maintenance), lowest first — vehicles with no completed trips yet sort last.
        </p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-steel border-b border-slate-100">
              <th className="pb-2">Rank</th>
              <th className="pb-2">Vehicle</th>
              <th className="pb-2">Trips</th>
              <th className="pb-2">Fuel cost</th>
              <th className="pb-2">Fuel (L)</th>
              <th className="pb-2">Maintenance cost</th>
              <th className="pb-2">Maint. count</th>
              <th className="pb-2">Cost/trip</th>
            </tr>
          </thead>
          <tbody>
            {vehicleScores.map((v, i) => (
              <tr key={v.vehicleId} className="border-b border-slate-50">
                <td className="py-2">#{i + 1}</td>
                <td className="py-2 font-medium font-mono text-xs">{v.plateNumber}</td>
                <td className="py-2">{v.tripsCompleted}</td>
                <td className="py-2">SAR {v.totalFuelCostSar.toFixed(2)}</td>
                <td className="py-2">{v.totalFuelLiters.toFixed(1)}</td>
                <td className="py-2">SAR {v.totalMaintenanceCostSar.toFixed(2)}</td>
                <td className="py-2">{v.maintenanceCount}</td>
                <td className="py-2">{v.avgCostPerTripSar != null ? `SAR ${v.avgCostPerTripSar.toFixed(2)}` : "—"}</td>
              </tr>
            ))}
            {vehicleScores.length === 0 && <tr><td colSpan={8} className="py-4 text-center text-steel">No vehicles yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ErpTab() {
  const [connection, setConnection] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [baseUrl, setBaseUrl] = useState("");
  const [database, setDatabase] = useState("");
  const [username, setUsername] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [defaultTaxId, setDefaultTaxId] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string; uid?: number } | null>(null);
  const [saveError, setSaveError] = useState("");
  const [syncStatus, setSyncStatus] = useState<any[]>([]);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [bulkSyncing, setBulkSyncing] = useState(false);
  const [bulkResult, setBulkResult] = useState<any>(null);

  const load = useCallback(async () => {
    const [conn, status] = await Promise.all([
      fetch("/api/erp/connection").then((r) => r.json()),
      fetch("/api/erp/sync/status").then((r) => r.json()),
    ]);
    setConnection(conn);
    if (conn) {
      setBaseUrl(conn.baseUrl);
      setDatabase(conn.database);
      setUsername(conn.username);
      setDefaultTaxId(conn.defaultTaxId ?? "");
    }
    setSyncStatus(status);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function saveConnection() {
    setSaveError("");
    setSaving(true);
    const res = await fetch("/api/erp/connection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseUrl,
        database,
        username,
        apiKey: apiKey || undefined,
        defaultTaxId: defaultTaxId || undefined,
      }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) {
      setSaveError(JSON.stringify(data.error) ?? "Failed to save");
      return;
    }
    setApiKey("");
    setTestResult(null);
    load();
  }

  async function testConnection() {
    setTesting(true);
    setTestResult(null);
    const res = await fetch("/api/erp/connection/test", { method: "POST" });
    const data = await res.json();
    setTesting(false);
    setTestResult(data);
    load();
  }

  async function syncOne(invoiceId: string) {
    setSyncingId(invoiceId);
    await fetch(`/api/erp/sync/invoice/${invoiceId}`, { method: "POST" });
    setSyncingId(null);
    load();
  }

  async function syncAll() {
    setBulkSyncing(true);
    setBulkResult(null);
    const res = await fetch("/api/erp/sync/all", { method: "POST" });
    const data = await res.json();
    setBulkSyncing(false);
    setBulkResult(data);
    load();
  }

  if (loading) return <p className="text-steel text-sm">Loading…</p>;

  return (
    <div className="grid md:grid-cols-3 gap-6">
      <div className="bg-white rounded-xl border border-slate-200 p-4 h-fit">
        <h3 className="font-medium mb-1">Odoo connection</h3>
        <p className="text-steel text-xs mb-3">
          BR-19: pushes each delivered order&apos;s invoice to Odoo as a customer invoice (account.move),
          creating the customer as a res.partner if needed. Not yet tested against a live Odoo
          instance in this build — always run &quot;Test connection&quot; after saving before relying on sync.
        </p>
        <div className="space-y-2">
          <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Base URL (e.g. https://mycompany.odoo.com)" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
          <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Database name" value={database} onChange={(e) => setDatabase(e.target.value)} />
          <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Username / email" value={username} onChange={(e) => setUsername(e.target.value)} />
          <input
            type="password"
            className="w-full border rounded-lg px-3 py-2 text-sm"
            placeholder={connection ? `API key (${connection.apiKeyPreview}) — leave blank to keep` : "API key"}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Default VAT tax ID (optional, Odoo account.tax id)" value={defaultTaxId} onChange={(e) => setDefaultTaxId(e.target.value)} />
          {saveError && <p className="text-danger text-xs">{saveError}</p>}
          <div className="flex gap-2">
            <button
              disabled={!baseUrl || !database || !username || (!apiKey && !connection) || saving}
              onClick={saveConnection}
              className="flex-1 bg-ink text-white rounded-lg py-2 text-sm font-medium disabled:opacity-40"
            >
              {saving ? "Saving…" : "Save connection"}
            </button>
            {connection && (
              <button
                disabled={testing}
                onClick={testConnection}
                className="flex-1 bg-aquaDark text-white rounded-lg py-2 text-sm font-medium disabled:opacity-40"
              >
                {testing ? "Testing…" : "Test connection"}
              </button>
            )}
          </div>

          {testResult && (
            <div className={`text-xs rounded-lg p-2 ${testResult.success ? "bg-ok/10 text-ok" : "bg-danger/10 text-danger"}`}>
              {testResult.success ? `Connected successfully (Odoo uid ${testResult.uid})` : `Failed: ${testResult.error}`}
            </div>
          )}
          {connection?.lastTestStatus && !testResult && (
            <p className="text-xs text-steel">
              Last test: <span className={connection.lastTestStatus === "SUCCESS" ? "text-ok" : "text-danger"}>{connection.lastTestStatus}</span>
              {connection.lastTestError ? ` — ${connection.lastTestError}` : ""}
            </p>
          )}
        </div>
      </div>

      <div className="md:col-span-2 bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-medium">Invoice sync status</h3>
          <button
            disabled={bulkSyncing || !connection}
            onClick={syncAll}
            className="bg-ink text-white rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-40"
          >
            {bulkSyncing ? "Syncing…" : "Sync all unsynced"}
          </button>
        </div>

        {!connection && (
          <p className="text-steel text-sm mb-3">Connect Odoo (left) before syncing invoices.</p>
        )}

        {bulkResult && (
          <p className="text-xs text-steel mb-3">
            Synced {bulkResult.synced}/{bulkResult.total}
            {bulkResult.failed > 0 ? ` — ${bulkResult.failed} failed` : ""}
          </p>
        )}

        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-steel border-b border-slate-100">
              <th className="pb-2">Invoice #</th>
              <th className="pb-2">Customer</th>
              <th className="pb-2">Total</th>
              <th className="pb-2">Sync status</th>
              <th className="pb-2"></th>
            </tr>
          </thead>
          <tbody>
            {syncStatus.map((inv) => (
              <tr key={inv.id} className="border-b border-slate-50">
                <td className="py-2 font-mono text-xs">{inv.invoiceNumber}</td>
                <td className="py-2">{inv.customerName}</td>
                <td className="py-2">SAR {inv.total.toFixed(2)}</td>
                <td className="py-2">
                  {inv.erpExternalId ? (
                    <span className="text-ok text-xs">Synced (Odoo #{inv.erpExternalId})</span>
                  ) : inv.erpSyncError ? (
                    <span className="text-danger text-xs" title={inv.erpSyncError}>Failed</span>
                  ) : (
                    <span className="text-steel text-xs">Not synced</span>
                  )}
                </td>
                <td className="py-2 text-right">
                  {!inv.erpExternalId && connection && (
                    <button
                      disabled={syncingId === inv.id}
                      onClick={() => syncOne(inv.id)}
                      className="text-aquaDark text-xs font-medium"
                    >
                      {syncingId === inv.id ? "Syncing…" : "Sync now"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {syncStatus.length === 0 && (
              <tr><td colSpan={5} className="py-4 text-center text-steel">No invoices yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// BR-22 Workflow Automation Engine — a real rule builder: pick an event
// type, add conditions (field/operator/value, matching the event's own
// whitelisted fields), pick an action (Notify with a {{field}} templated
// message, or Escalate with a severity). Every firing (and every
// deliberately-skipped duplicate) is visible in the Automation Logs panel.
function AutomationTab() {
  const [eventTypes, setEventTypes] = useState<any[]>([]);
  const [rules, setRules] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState("");
  const [eventType, setEventType] = useState("");
  const [conditions, setConditions] = useState<{ field: string; operator: string; value: string }[]>([]);
  const [action, setAction] = useState<"NOTIFY" | "ESCALATE">("NOTIFY");
  const [message, setMessage] = useState("");
  const [severity, setSeverity] = useState<"MEDIUM" | "HIGH">("MEDIUM");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const currentEvent = eventTypes.find((e) => e.key === eventType);

  const load = useCallback(async () => {
    const [ev, r, l, n] = await Promise.all([
      fetch("/api/automation/events").then((res) => res.json()),
      fetch("/api/automation/rules").then((res) => res.json()),
      fetch("/api/automation/logs").then((res) => res.json()),
      fetch("/api/notifications").then((res) => res.json()),
    ]);
    setEventTypes(ev);
    setRules(r);
    setLogs(l);
    setNotifications(n);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function selectEvent(key: string) {
    setEventType(key);
    setConditions([]);
  }

  function addCondition() {
    if (!currentEvent) return;
    setConditions((c) => [...c, { field: currentEvent.fields[0].key, operator: "eq", value: "" }]);
  }

  function updateCondition(idx: number, patch: Partial<{ field: string; operator: string; value: string }>) {
    setConditions((c) => c.map((cond, i) => (i === idx ? { ...cond, ...patch } : cond)));
  }

  function removeCondition(idx: number) {
    setConditions((c) => c.filter((_, i) => i !== idx));
  }

  async function saveRule() {
    setError("");
    setSaving(true);
    const actionConfig = action === "NOTIFY" ? { message } : { severity };
    const res = await fetch("/api/automation/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        eventType,
        conditions: conditions
          .filter((c) => c.value !== "")
          .map((c) => {
            const fieldDef = currentEvent?.fields.find((f: any) => f.key === c.field);
            return { field: c.field, operator: c.operator, value: fieldDef?.type === "number" ? Number(c.value) : c.value };
          }),
        action,
        actionConfig,
      }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) {
      setError(typeof data.error === "string" ? data.error : JSON.stringify(data.error));
      return;
    }
    setName("");
    setEventType("");
    setConditions([]);
    setMessage("");
    load();
  }

  async function toggleRule(id: string, enabled: boolean) {
    await fetch(`/api/automation/rules/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !enabled }),
    });
    load();
  }

  async function deleteRule(id: string) {
    await fetch(`/api/automation/rules/${id}`, { method: "DELETE" });
    load();
  }

  if (loading) return <p className="text-steel text-sm">Loading…</p>;

  return (
    <div className="space-y-6">
      <div className="grid md:grid-cols-3 gap-6">
        <div className="md:col-span-2 bg-white rounded-xl border border-slate-200 p-4">
          <h3 className="font-medium mb-3">New automation rule</h3>
          <div className="space-y-2">
            <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Rule name" value={name} onChange={(e) => setName(e.target.value)} />
            <select className="w-full border rounded-lg px-3 py-2 text-sm" value={eventType} onChange={(e) => selectEvent(e.target.value)}>
              <option value="">When this happens…</option>
              {eventTypes.map((ev) => (
                <option key={ev.key} value={ev.key}>{ev.label}</option>
              ))}
            </select>

            {currentEvent && (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-steel uppercase tracking-wide">Conditions (optional — none means always match)</p>
                  <button onClick={addCondition} className="text-xs text-aquaDark font-medium">+ Add condition</button>
                </div>
                {conditions.map((c, idx) => {
                  const fieldDef = currentEvent.fields.find((f: any) => f.key === c.field);
                  return (
                    <div key={idx} className="flex gap-2 items-center">
                      <select className="border rounded-lg px-2 py-1.5 text-xs flex-1" value={c.field} onChange={(e) => updateCondition(idx, { field: e.target.value })}>
                        {currentEvent.fields.map((f: any) => <option key={f.key} value={f.key}>{f.label}</option>)}
                      </select>
                      <select className="border rounded-lg px-2 py-1.5 text-xs" value={c.operator} onChange={(e) => updateCondition(idx, { operator: e.target.value })}>
                        {fieldDef?.type === "text" && <><option value="eq">=</option><option value="contains">contains</option></>}
                        {fieldDef?.type === "enum" && <><option value="eq">=</option><option value="neq">≠</option></>}
                        {fieldDef?.type === "number" && (
                          <><option value="eq">=</option><option value="gt">&gt;</option><option value="gte">&gt;=</option><option value="lt">&lt;</option><option value="lte">&lt;=</option></>
                        )}
                      </select>
                      {fieldDef?.type === "enum" ? (
                        <select className="border rounded-lg px-2 py-1.5 text-xs flex-1" value={c.value} onChange={(e) => updateCondition(idx, { value: e.target.value })}>
                          <option value="">Select…</option>
                          {fieldDef.enumValues?.map((v: string) => <option key={v} value={v}>{v}</option>)}
                        </select>
                      ) : (
                        <input className="border rounded-lg px-2 py-1.5 text-xs flex-1" type={fieldDef?.type === "number" ? "number" : "text"} value={c.value} onChange={(e) => updateCondition(idx, { value: e.target.value })} />
                      )}
                      <button onClick={() => removeCondition(idx)} className="text-danger text-xs">✕</button>
                    </div>
                  );
                })}

                <p className="text-xs text-steel uppercase tracking-wide pt-2">Then do this</p>
                <select className="w-full border rounded-lg px-3 py-2 text-sm" value={action} onChange={(e) => setAction(e.target.value as any)}>
                  <option value="NOTIFY">Send a notification</option>
                  <option value="ESCALATE">Create an escalation</option>
                </select>
                {action === "NOTIFY" ? (
                  <input
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                    placeholder="Message — use {{fieldName}} to insert event data, e.g. {{qtyOrdered}}"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                  />
                ) : (
                  <select className="w-full border rounded-lg px-3 py-2 text-sm" value={severity} onChange={(e) => setSeverity(e.target.value as any)}>
                    <option value="MEDIUM">Medium severity</option>
                    <option value="HIGH">High severity</option>
                  </select>
                )}

                {error && <p className="text-danger text-xs">{error}</p>}
                <button
                  disabled={!name || (action === "NOTIFY" && !message) || saving}
                  onClick={saveRule}
                  className="w-full bg-ink text-white rounded-lg py-2 text-sm font-medium disabled:opacity-40"
                >
                  Save rule
                </button>
              </>
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 h-fit">
          <h3 className="font-medium mb-3">Active rules</h3>
          <div className="space-y-2">
            {rules.map((r: any) => (
              <div key={r.id} className="border border-slate-100 rounded-lg p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{r.name}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${r.enabled ? "bg-ok/15 text-ok" : "bg-slate-100 text-steel"}`}>
                    {r.enabled ? "Enabled" : "Disabled"}
                  </span>
                </div>
                <p className="text-steel text-xs mt-1">{r.eventType} → {r.action}</p>
                <div className="flex gap-2 mt-2">
                  <button onClick={() => toggleRule(r.id, r.enabled)} className="text-aquaDark text-xs font-medium">
                    {r.enabled ? "Disable" : "Enable"}
                  </button>
                  <button onClick={() => deleteRule(r.id)} className="text-danger text-xs font-medium">Delete</button>
                </div>
              </div>
            ))}
            {rules.length === 0 && <p className="text-steel text-sm">No rules yet.</p>}
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h3 className="font-medium mb-3">Automation logs</h3>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-steel border-b border-slate-100">
                <th className="pb-2">Event</th>
                <th className="pb-2">Status</th>
                <th className="pb-2">Action</th>
                <th className="pb-2">When</th>
              </tr>
            </thead>
            <tbody>
              {logs.slice(0, 20).map((l: any) => (
                <tr key={l.id} className="border-b border-slate-50">
                  <td className="py-2">{l.eventType}</td>
                  <td className="py-2">
                    <span className={l.status === "FIRED" ? "text-ok" : "text-steel"}>{l.status}</span>
                  </td>
                  <td className="py-2">{l.actionTaken ?? "—"}</td>
                  <td className="py-2">{new Date(l.createdAt).toLocaleString()}</td>
                </tr>
              ))}
              {logs.length === 0 && <tr><td colSpan={4} className="py-4 text-center text-steel">No automation activity yet.</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h3 className="font-medium mb-3">Notifications</h3>
          <div className="space-y-2">
            {notifications.slice(0, 10).map((n: any) => (
              <div key={n.id} className="border border-slate-100 rounded-lg p-2">
                <p className="text-sm">{n.message}</p>
                <p className="text-steel text-xs mt-0.5">{new Date(n.createdAt).toLocaleString()}</p>
              </div>
            ))}
            {notifications.length === 0 && <p className="text-steel text-sm">No notifications yet.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

// BR-23: Task, Expense & Field Activity Management — assign field tasks to
// drivers (inspections, collections, visits, refuels, exception handling)
// and review driver-submitted expense claims. Every expense is either tied
// to a trip or has a stated reason (enforced server-side); large or small,
// every claim requires explicit Approve/Reject here — there's no
// auto-approval threshold in this build.
function FieldOpsTab({ drivers, vehicles }: any) {
  const [tasks, setTasks] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [subTab, setSubTab] = useState<"tasks" | "expenses">("tasks");

  const [driverId, setDriverId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [type, setType] = useState("INSPECTION");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [assigning, setAssigning] = useState(false);

  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectNotes, setRejectNotes] = useState("");

  const load = useCallback(async () => {
    const [tk, ex] = await Promise.all([
      fetch("/api/tasks").then((r) => r.json()),
      fetch("/api/expenses").then((r) => r.json()),
    ]);
    setTasks(tk);
    setExpenses(ex);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function assignTask() {
    setAssigning(true);
    await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ driverId, vehicleId: vehicleId || undefined, type, title, notes: notes || undefined }),
    });
    setDriverId("");
    setTitle("");
    setNotes("");
    setAssigning(false);
    load();
  }

  async function cancelTask(id: string) {
    await fetch(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "CANCEL" }),
    });
    load();
  }

  async function approveExpense(id: string) {
    await fetch(`/api/expenses/${id}/approve`, { method: "POST" });
    load();
  }

  async function rejectExpense(id: string) {
    await fetch(`/api/expenses/${id}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewNotes: rejectNotes || "Not approved" }),
    });
    setRejectingId(null);
    setRejectNotes("");
    load();
  }

  if (loading) return <p className="text-steel text-sm">Loading…</p>;

  const pendingExpenses = expenses.filter((e: any) => e.status === "PENDING");
  const reviewedExpenses = expenses.filter((e: any) => e.status !== "PENDING");

  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b border-slate-200">
        {(["tasks", "expenses"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setSubTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize border-b-2 -mb-px transition-colors ${
              subTab === t ? "border-aqua text-aquaDark" : "border-transparent text-steel hover:text-ink"
            }`}
          >
            {t === "expenses" && pendingExpenses.length > 0 ? `Expenses (${pendingExpenses.length} pending)` : t}
          </button>
        ))}
      </div>

      {subTab === "tasks" && (
        <div className="grid md:grid-cols-3 gap-6">
          <div className="md:col-span-2 bg-white rounded-xl border border-slate-200 p-4">
            <h3 className="font-medium mb-3">Assigned tasks</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-steel border-b border-slate-100">
                  <th className="pb-2">Driver</th>
                  <th className="pb-2">Type</th>
                  <th className="pb-2">Title</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((t: any) => (
                  <tr key={t.id} className="border-b border-slate-50">
                    <td className="py-2">{t.driver?.user?.name}</td>
                    <td className="py-2"><StatusBadge status={t.type} /></td>
                    <td className="py-2">{t.title}</td>
                    <td className="py-2"><StatusBadge status={t.status} /></td>
                    <td className="py-2 text-right">
                      {(t.status === "ASSIGNED" || t.status === "IN_PROGRESS") && (
                        <button onClick={() => cancelTask(t.id)} className="text-danger text-xs font-medium">Cancel</button>
                      )}
                    </td>
                  </tr>
                ))}
                {tasks.length === 0 && <tr><td colSpan={5} className="py-4 text-center text-steel">No tasks assigned yet.</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-4 h-fit">
            <h3 className="font-medium mb-3">Assign a task</h3>
            <div className="space-y-2">
              <select className="w-full border rounded-lg px-3 py-2 text-sm" value={driverId} onChange={(e) => setDriverId(e.target.value)}>
                <option value="">Select driver…</option>
                {drivers.map((d: any) => <option key={d.id} value={d.id}>{d.user.name}</option>)}
              </select>
              <select className="w-full border rounded-lg px-3 py-2 text-sm" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
                <option value="">No specific vehicle</option>
                {vehicles.map((v: any) => <option key={v.id} value={v.id}>{v.plateNumber}</option>)}
              </select>
              <select className="w-full border rounded-lg px-3 py-2 text-sm" value={type} onChange={(e) => setType(e.target.value)}>
                <option value="INSPECTION">Inspection</option>
                <option value="COLLECTION">Collection</option>
                <option value="VISIT">Site visit</option>
                <option value="REFUEL">Refuel</option>
                <option value="EXCEPTION_HANDLING">Exception handling</option>
                <option value="OTHER">Other</option>
              </select>
              <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
              <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
              <button
                disabled={!driverId || !title || assigning}
                onClick={assignTask}
                className="w-full bg-ink text-white rounded-lg py-2 text-sm font-medium disabled:opacity-40"
              >
                Assign task
              </button>
            </div>
          </div>
        </div>
      )}

      {subTab === "expenses" && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <h3 className="font-medium mb-3">Pending approval</h3>
            <div className="space-y-2">
              {pendingExpenses.map((e: any) => (
                <div key={e.id} className="border border-slate-100 rounded-lg p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-sm font-medium">{e.driver?.user?.name}</span>
                      <span className="text-steel text-xs ml-2">{e.vehicle?.plateNumber}</span>
                    </div>
                    <span className="text-sm font-medium">SAR {e.amount.toFixed(2)}</span>
                  </div>
                  <p className="text-steel text-xs mt-1">{e.category} — {e.reason || e.description || "linked to trip"}</p>
                  {e.receiptDescription && <p className="text-steel text-xs italic">Receipt: {e.receiptDescription}</p>}
                  <div className="flex gap-2 mt-2">
                    <button onClick={() => approveExpense(e.id)} className="bg-ok text-white rounded-lg px-3 py-1 text-xs font-medium">Approve</button>
                    <button onClick={() => setRejectingId(rejectingId === e.id ? null : e.id)} className="border border-slate-200 rounded-lg px-3 py-1 text-xs font-medium">
                      {rejectingId === e.id ? "Cancel" : "Reject"}
                    </button>
                  </div>
                  {rejectingId === e.id && (
                    <div className="flex gap-2 mt-2">
                      <input className="flex-1 border rounded-lg px-3 py-1.5 text-xs" placeholder="Reason for rejection" value={rejectNotes} onChange={(ev) => setRejectNotes(ev.target.value)} />
                      <button onClick={() => rejectExpense(e.id)} className="bg-danger text-white rounded-lg px-3 py-1.5 text-xs font-medium">Confirm</button>
                    </div>
                  )}
                </div>
              ))}
              {pendingExpenses.length === 0 && <p className="text-steel text-sm">Nothing pending review.</p>}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <h3 className="font-medium mb-3">Reviewed</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-steel border-b border-slate-100">
                  <th className="pb-2">Driver</th>
                  <th className="pb-2">Category</th>
                  <th className="pb-2">Amount</th>
                  <th className="pb-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {reviewedExpenses.slice(0, 15).map((e: any) => (
                  <tr key={e.id} className="border-b border-slate-50">
                    <td className="py-2">{e.driver?.user?.name}</td>
                    <td className="py-2">{e.category}</td>
                    <td className="py-2">SAR {e.amount.toFixed(2)}</td>
                    <td className="py-2"><StatusBadge status={e.status} /></td>
                  </tr>
                ))}
                {reviewedExpenses.length === 0 && <tr><td colSpan={4} className="py-4 text-center text-steel">No reviewed expenses yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// APP-07 Executive Dashboard — a single aggregated view for leadership.
// All KPIs come from GET /api/executive/dashboard (lib/executiveDashboard.ts
// on the server); this component only formats and displays what the API
// returns — no metric is computed or invented client-side except the CSV
// export, which just serializes the already-fetched numbers.
const KPI_METRICS: { key: string; label: string; format: (v: number) => string; sub?: string; direction: "up" | "down" | "neutral" }[] = [
  { key: "totalTrips", label: "Total Trips", format: (v) => String(v), direction: "up" },
  { key: "completedTrips", label: "Completed Trips", format: (v) => String(v), direction: "up" },
  { key: "deliveredOrders", label: "Delivered Orders", format: (v) => String(v), direction: "up" },
  { key: "failedOrders", label: "Failed Deliveries", format: (v) => String(v), direction: "down" },
  { key: "slaComplianceRate", label: "SLA Compliance", format: (v) => `${Math.round(v * 100)}%`, direction: "up" },
  { key: "totalRevenueSar", label: "Revenue", format: (v) => `SAR ${v.toFixed(2)}`, direction: "up" },
  { key: "totalFuelCostSar", label: "Fuel Cost", format: (v) => `SAR ${v.toFixed(2)}`, direction: "down" },
  { key: "totalFuelLiters", label: "Fuel Consumed", format: (v) => `${v.toFixed(1)} L`, direction: "neutral" },
  { key: "totalMaintenanceCostSar", label: "Maintenance Cost", format: (v) => `SAR ${v.toFixed(2)}`, direction: "down" },
  { key: "costPerDeliverySar", label: "Cost per Delivery", format: (v) => `SAR ${v.toFixed(2)}`, direction: "down" },
  { key: "revenuePerVehicleSar", label: "Revenue per Vehicle", format: (v) => `SAR ${v.toFixed(2)}`, direction: "up" },
  { key: "avgTripsPerVehicle", label: "Fleet Utilization", format: (v) => `${v.toFixed(1)} trips/vehicle`, direction: "up" },
  { key: "costPerKmSar", label: "Cost per KM (estimated)", format: (v) => `SAR ${v.toFixed(2)}`, direction: "down" },
];

function TrendBadge({ changePercent, direction }: { changePercent: number | null | undefined; direction: "up" | "down" | "neutral" }) {
  if (changePercent == null) return <span className="text-steel text-xs">— vs. prior period</span>;
  const isIncrease = changePercent > 0;
  const isFlat = changePercent === 0;
  const goodDirection = direction === "up" ? isIncrease : direction === "down" ? !isIncrease : null;
  const colorClass = isFlat || goodDirection === null ? "text-steel" : goodDirection ? "text-ok" : "text-danger";
  const arrow = isFlat ? "→" : isIncrease ? "↑" : "↓";
  return (
    <span className={`text-xs font-medium ${colorClass}`}>
      {arrow} {Math.abs(changePercent)}% vs. prior period
    </span>
  );
}

function ExecutiveTab() {
  const [dashboard, setDashboard] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const load = useCallback(async (fromDate?: string, toDate?: string) => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams();
    if (fromDate) params.set("from", new Date(fromDate).toISOString());
    if (toDate) params.set("to", new Date(toDate).toISOString());
    const qs = params.toString();
    try {
      const res = await fetch(`/api/executive/dashboard${qs ? `?${qs}` : ""}`);
      if (!res.ok) {
        setError("Failed to load the executive dashboard.");
        setDashboard(null);
        return;
      }
      setDashboard(await res.json());
    } catch {
      setError("Failed to load the executive dashboard.");
      setDashboard(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function applyRange() {
    load(from || undefined, to || undefined);
  }

  function clearRange() {
    setFrom("");
    setTo("");
    load();
  }

  function exportCsv() {
    if (!dashboard) return;
    const lines: string[] = ["Metric,Value,Change vs. Prior Period (%)"];
    for (const m of KPI_METRICS) {
      const value = dashboard.kpis[m.key];
      const change = dashboard.comparison?.changePercent?.[m.key];
      lines.push(`"${m.label}","${value ?? ""}","${change ?? ""}"`);
    }
    lines.push("");
    lines.push("Driver,Score,Trips Completed,On-Time Rate");
    for (const d of dashboard.topDrivers) {
      lines.push(`"${d.driverName}",${d.score},${d.tripsCompleted},"${d.onTimeRate != null ? Math.round(d.onTimeRate * 100) + "%" : "—"}"`);
    }
    lines.push("");
    lines.push("Vehicle,Avg Cost per Trip (SAR),Trips Completed");
    for (const v of dashboard.vehicleRanking) {
      lines.push(`"${v.plateNumber}",${v.avgCostPerTripSar ?? ""},${v.tripsCompleted}`);
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "executive-dashboard.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="text-xs text-steel block mb-1">From</label>
              <input type="date" className="border rounded-lg px-2 py-1.5 text-sm" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-steel block mb-1">To</label>
              <input type="date" className="border rounded-lg px-2 py-1.5 text-sm" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <button onClick={applyRange} className="bg-ink text-white rounded-lg px-3 py-1.5 text-sm font-medium">
              Apply range
            </button>
            <button onClick={clearRange} className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm font-medium">
              All time
            </button>
          </div>
          <button
            disabled={!dashboard}
            onClick={exportCsv}
            className="bg-ink text-white rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-40"
          >
            Export CSV
          </button>
        </div>
        {dashboard?.comparison && (
          <p className="text-steel text-xs mt-2">
            Comparing to the prior period of equal length, computed automatically from your selected range.
          </p>
        )}
        <p className="text-steel text-xs mt-2">
          &quot;Cost per KM&quot; is an <strong>estimate</strong> — straight-line distance from warehouse → each stop → back,
          not GPS-tracked route mileage (this system doesn&apos;t record actual driven distance).
        </p>
      </div>

      {loading && <p className="text-steel text-sm">Loading executive dashboard…</p>}
      {error && <p className="text-danger text-sm">{error}</p>}

      {!loading && !error && dashboard && (
        <>
          {dashboard.kpis.ordersTotal === 0 && (
            <p className="text-steel text-sm bg-paper rounded-lg p-3">No orders fall within the selected period.</p>
          )}

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {KPI_METRICS.map((m) => {
              const value = dashboard.kpis[m.key];
              return (
                <div key={m.key} className="bg-white rounded-xl border border-slate-200 p-4">
                  <p className="text-steel text-xs uppercase tracking-wide">{m.label}</p>
                  <p className="text-2xl font-semibold mt-1">{value != null ? m.format(value) : "—"}</p>
                  <div className="mt-1">
                    <TrendBadge changePercent={dashboard.comparison?.changePercent?.[m.key]} direction={m.direction} />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <h3 className="font-medium mb-3">Top drivers</h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-steel border-b border-slate-100">
                    <th className="pb-2">Driver</th>
                    <th className="pb-2">Score</th>
                    <th className="pb-2">Trips</th>
                    <th className="pb-2">On-time</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.topDrivers.map((d: any) => (
                    <tr key={d.driverId} className="border-b border-slate-50">
                      <td className="py-2">{d.driverName}</td>
                      <td className="py-2 font-medium">{d.score}</td>
                      <td className="py-2">{d.tripsCompleted}</td>
                      <td className="py-2">{d.onTimeRate != null ? `${Math.round(d.onTimeRate * 100)}%` : "—"}</td>
                    </tr>
                  ))}
                  {dashboard.topDrivers.length === 0 && (
                    <tr><td colSpan={4} className="py-4 text-center text-steel">No driver activity yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <h3 className="font-medium mb-3">Vehicle ranking (cost per trip, lowest first)</h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-steel border-b border-slate-100">
                    <th className="pb-2">Vehicle</th>
                    <th className="pb-2">Avg cost/trip</th>
                    <th className="pb-2">Trips</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.vehicleRanking.map((v: any) => (
                    <tr key={v.vehicleId} className="border-b border-slate-50">
                      <td className="py-2">{v.plateNumber}</td>
                      <td className="py-2 font-medium">{v.avgCostPerTripSar != null ? `SAR ${v.avgCostPerTripSar.toFixed(2)}` : "—"}</td>
                      <td className="py-2">{v.tripsCompleted}</td>
                    </tr>
                  ))}
                  {dashboard.vehicleRanking.length === 0 && (
                    <tr><td colSpan={3} className="py-4 text-center text-steel">No vehicle activity yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// Company Switcher — only ever rendered for a platform admin (see Shell
// above: the `extra` slot is only populated when session.isPlatformAdmin
// is true). Fetches the authorized tenant list itself; if it comes back
// with only one tenant (a platform admin with no grants beyond their own
// home), there's nothing useful to switch between, so nothing renders —
// an ordinary tenant Admin never even causes this component to mount.
function CompanySwitcher({ currentTenantId }: { currentTenantId?: string }) {
  const [tenants, setTenants] = useState<{ id: string; name: string; isHome: boolean }[] | null>(null);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    fetch("/api/platform/tenants")
      .then((res) => (res.ok ? res.json() : []))
      .then(setTenants)
      .catch(() => setTenants([]));
  }, []);

  async function handleSwitch(tenantId: string) {
    if (tenantId === currentTenantId || switching) return;
    setSwitching(true);
    const res = await fetch("/api/platform/switch-tenant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId }),
    });
    if (res.ok) {
      // A full reload guarantees every piece of this page's state (orders,
      // vehicles, drivers, invoices, everything) re-fetches fresh for the
      // newly-selected tenant, rather than trying to partially invalidate
      // a dozen different state variables and risking a stale mix.
      window.location.reload();
    } else {
      setSwitching(false);
    }
  }

  if (!tenants || tenants.length <= 1) return null;

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-steel text-xs">Viewing:</span>
      <select
        className="bg-ink border border-slate-600 text-white text-sm rounded-lg px-2 py-1"
        value={currentTenantId ?? ""}
        disabled={switching}
        onChange={(e) => handleSwitch(e.target.value)}
      >
        {tenants.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}{t.isHome ? " (home)" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}
