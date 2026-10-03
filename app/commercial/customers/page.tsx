"use client";
import { useEffect, useState, useCallback } from "react";
import AdminShell from "@/components/AdminShell";
import { PageContainer, PageHeader, StatusBadge, FilterBar, EmptyState, LoadingState, MetricCard, Btn } from "@/components/ds";

type Customer = { id: string; name: string; status?: string; phone?: string; email?: string; creditLimit?: number; currentBalance?: number; tenantId: string; locations?: any[] };

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const r = await fetch("/api/customers");
    if (!r.ok) { setError("Failed to load customers."); setLoading(false); return; }
    const data = await r.json();
    setCustomers(Array.isArray(data) ? data : []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = customers.filter(c =>
    !search || c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.phone ?? "").includes(search) || (c.email ?? "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <AdminShell title="Customers & Sites">
      <PageContainer>
        <PageHeader
          title="Customers & Sites"
          subtitle="B2B and B2C customer registry"
          breadcrumbs={[{ label: "Commercial" }, { label: "Customers" }]}
          actions={
            <div className="flex gap-2">
              <a href="/admin/customers" className="text-xs text-aqua border border-aqua px-3 py-1.5 rounded-lg hover:bg-aqua/5 transition-colors">Full Customer Management</a>
              <Btn variant="primary" size="sm" onClick={load}>Refresh</Btn>
            </div>
          }
        />
        <div className="grid grid-cols-2 gap-3 mb-6">
          <MetricCard label="Total Customers" value={customers.length} />
          <MetricCard label="Shown" value={filtered.length} />
        </div>
        <FilterBar search={search} onSearch={setSearch} onClear={() => setSearch("")} />
        {loading ? <LoadingState /> : error ? (
          <div className="text-sm text-danger bg-dangerLight rounded-xl p-4">{error}</div>
        ) : filtered.length === 0 ? (
          <EmptyState title="No customers found" />
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-card">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-paper">
                    {["Customer", "Phone", "Email", "Credit Limit", ""].map(h => (
                      <th key={h} className="text-start text-xs font-semibold text-steel px-4 py-3">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map(c => (
                    <tr key={c.id} className="hover:bg-paper cursor-pointer" onClick={() => window.location.href=`/admin/customers?customerId=${c.id}`}>
                      <td className="px-4 py-3 text-sm font-medium text-ink">{c.name}</td>
                      <td className="px-4 py-3 text-sm text-steel">{c.phone ?? "—"}</td>
                      <td className="px-4 py-3 text-sm text-steel">{c.email ?? "—"}</td>
                      <td className="px-4 py-3 text-sm text-ink tabular-nums">{c.creditLimit != null ? `SAR ${c.creditLimit.toLocaleString()}` : "—"}</td>
                      <td className="px-4 py-3">
                        <Btn variant="ghost" size="xs">View →</Btn>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2.5 border-t border-slate-100 text-xs text-steel">{filtered.length} of {customers.length} customers</div>
          </div>
        )}
      </PageContainer>
    </AdminShell>
  );
}
