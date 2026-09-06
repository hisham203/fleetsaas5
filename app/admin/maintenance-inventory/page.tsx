"use client";

import AdminShell from "@/components/AdminShell";
import { useRequireSession } from "@/lib/useSession";

// Milestone Z, Part 12 — an honest placeholder, not a fake operational
// screen. Workshops, maintenance warehouses (distinct from dispatch
// loading points — see the note below), an ERP-style item master,
// stock balances/movements, and the full PR -> PO -> Receiving
// procurement cycle are all fully designed (schema, lifecycle, APIs,
// test plan — see DEPLOYMENT.md's Milestone Z entry) but none of it is
// implemented: no new table exists, no migration was created, and this
// page shows zero fabricated rows. It exists purely so the planned
// module has a real, discoverable home instead of being invisible
// until schema approval and Z.1 implementation.
export default function MaintenanceInventoryPage() {
  const { session, loading } = useRequireSession(["ADMIN"]);
  if (loading || !session) {
    return <div className="min-h-screen bg-paper flex items-center justify-center text-steel text-sm">Loading…</div>;
  }

  return (
    <AdminShell title="Maintenance Inventory &amp; Procurement">
      <div className="p-6 max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-lg font-semibold">Maintenance Inventory &amp; Procurement</h1>
          <p className="text-steel text-sm mt-0.5">Spare parts, tires, workshop stock, and purchasing — designed, not yet built.</p>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
          <div className="bg-warn/10 text-warn rounded-lg px-4 py-2 text-sm">
            Design pending implementation approval. No live stock data exists yet — nothing shown here is real or fabricated demo data.
          </div>

          <div>
            <h3 className="font-medium text-sm mb-1">What this will cover</h3>
            <ul className="text-steel text-sm list-disc list-inside space-y-0.5">
              <li>Workshops — internal/external service locations where trucks/tankers are maintained</li>
              <li>Maintenance warehouses — spare-part/tire storage, optionally linked to a workshop (a separate concept from Loading Points, which serve customer delivery dispatch, not maintenance stock)</li>
              <li>Item master — categories, sub-categories, items, units of measure</li>
              <li>Stock balances &amp; movements — receipts, issues to maintenance, adjustments, transfers</li>
              <li>Procurement cycle — Purchase Requisition → approval → Purchase Order → Goods Receiving → stock update</li>
            </ul>
          </div>

          <div>
            <h3 className="font-medium text-sm mb-1">What&apos;s important to understand today</h3>
            <p className="text-steel text-sm">
              The existing <strong>Inventory</strong> tab (Platform section) tracks customer-delivery product stock
              (e.g. bottles at a loading point) — a separate, already-working concept for tenants whose business needs it.
              It is not being repurposed for maintenance parts, and this new module will not touch it.
            </p>
          </div>
        </div>
      </div>
    </AdminShell>
  );
}
