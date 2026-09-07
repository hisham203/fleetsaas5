"use client";

import PlannedModulePlaceholder from "@/components/PlannedModulePlaceholder";

// Milestone AB, Part 4 — Procurement never creates item definitions
// (it requests existing items from Master Items) and never touches
// customer billing invoices at any step, including receiving.
export default function ProcurementPlannedPage() {
  return (
    <PlannedModulePlaceholder
      title="Procurement"
      tagline="Purchase Requisition, Purchase Order, and Goods Receiving for fleet maintenance stock."
      covers={[
        "Purchase Requisition (PR) — request, review, approve or reject",
        "Purchase Order (PO) — issued to a supplier from an approved PR",
        "Goods Receiving — full or partial, posted into a warehouse",
        "Supplier master data",
      ]}
      boundary="Procurement does not consume parts into maintenance, does not define item categories or create new items (it requests existing items from Master Items), does not approve driver expense claims, and never creates or modifies a customer billing invoice at any step."
      relationships={[
        "Every PR/PO line references an existing item from Master Items — Procurement never creates a new item definition itself.",
        "Posting a Goods Receipt creates a RECEIPT stock movement in Inventory and increases the receiving warehouse's balance — this is the only way Procurement affects Inventory.",
        "A PR may optionally link to a Workshop, Warehouse, Vehicle, or Maintenance record that originated the request.",
        "Expense approval (Finance > Expenses) remains completely separate from procurement receiving — an external service expense and a procurement purchase are two different concepts.",
      ]}
      counts={[
        { label: "Suppliers", endpoint: "/api/suppliers" },
        { label: "Purchase Requisitions", endpoint: "/api/purchase-requisitions" },
        { label: "Purchase Orders", endpoint: "/api/purchase-orders" },
        { label: "Goods Receipts", endpoint: "/api/goods-receipts" },
      ]}
    />
  );
}
