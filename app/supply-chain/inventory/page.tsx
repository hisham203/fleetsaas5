"use client";
import { useEffect, useState, useCallback } from "react";
import AdminShell from "@/components/AdminShell";
import { PageContainer, PageHeader, FilterBar, EmptyState, LoadingState, MetricCard, Btn, StatusBadge } from "@/components/ds";

type InventoryBalance = { itemId: string; itemName?: string; warehouseId: string; warehouseName?: string; quantityOnHand: number; unit?: string };

export default function InventoryPage() {
  const [balances, setBalances] = useState<InventoryBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const r = await fetch("/api/inventory");
    if (!r.ok) { setError("Failed to load inventory."); setLoading(false); return; }
    const data = await r.json();
    setBalances(Array.isArray(data) ? data : []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = balances.filter(b =>
    !search || (b.itemName ?? "").toLowerCase().includes(search.toLowerCase()) ||
    (b.warehouseName ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const totalItems = new Set(balances.map(b => b.itemId)).size;
  const lowStock = balances.filter(b => b.quantityOnHand <= 0).length;

  return (
    <AdminShell title="Inventory">
      <PageContainer>
        <PageHeader
          title="Inventory"
          subtitle="General supply chain inventory — stock balances by warehouse"
          breadcrumbs={[{ label: "Supply Chain" }, { label: "Inventory" }]}
          actions={
            <div className="flex gap-2 items-center">
              <span className="text-xs text-steel">Maintenance inventory is separate — see Fleet</span>
              <Btn variant="primary" size="sm" onClick={load}>Refresh</Btn>
            </div>
          }
        />
        <div className="grid grid-cols-3 gap-3 mb-6">
          <MetricCard label="Distinct Items" value={totalItems} />
          <MetricCard label="Balance Rows" value={balances.length} />
          <MetricCard label="Zero Stock" value={lowStock} accent={lowStock > 0 ? "warn" : "default"} />
        </div>
        <FilterBar search={search} onSearch={setSearch} onClear={() => setSearch("")} />
        {loading ? <LoadingState /> : error ? (
          <div className="text-sm text-danger bg-dangerLight rounded-xl p-4">{error}</div>
        ) : filtered.length === 0 ? (
          <EmptyState title="No inventory data" description="No inventory balances found." />
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-card">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-paper">
                    {["Item", "Warehouse", "On Hand", "Unit", "Stock Level"].map(h => (
                      <th key={h} className="text-start text-xs font-semibold text-steel px-4 py-3">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((b, i) => (
                    <tr key={`${b.itemId}-${b.warehouseId}-${i}`} className="hover:bg-paper">
                      <td className="px-4 py-3 text-sm font-medium text-ink">{b.itemName ?? b.itemId}</td>
                      <td className="px-4 py-3 text-sm text-steel">{b.warehouseName ?? b.warehouseId}</td>
                      <td className="px-4 py-3 text-sm text-ink tabular-nums font-medium">{b.quantityOnHand.toLocaleString()}</td>
                      <td className="px-4 py-3 text-sm text-steel">{b.unit ?? "—"}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={b.quantityOnHand <= 0 ? "EXCEPTION" : b.quantityOnHand < 10 ? "AT_RISK" : "AVAILABLE"} size="xs" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </PageContainer>
    </AdminShell>
  );
}
