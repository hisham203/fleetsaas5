"use client";

import PlannedModulePlaceholder from "@/components/PlannedModulePlaceholder";

// Milestone AB, Part 4 — Inventory is a separate module from
// Master Items (which defines what CAN be stocked) and from
// Procurement (which brings stock IN). Inventory itself only tracks
// quantity, location, and movement.
export default function InventoryPlannedPage() {
  return (
    <PlannedModulePlaceholder
      title="Inventory"
      tagline="Stock control for spare parts, tires, lubricants, tools, and maintenance consumables."
      covers={[
        "Warehouse-level stock balances (quantity on hand, reserved, available)",
        "Stock movements — receipts, issues to maintenance, adjustments, transfers",
        "Low-stock and reorder-point visibility",
        "Per-warehouse and per-item stock views",
      ]}
      boundary="Inventory does not define the item master hierarchy (that's Master Items), does not approve purchase orders (that's Procurement), does not create customer invoices, and does not track customer-delivery/bottle stock — that concept remains fully separate (see Legacy Delivery Stock)."
      relationships={[
        "Master Items defines what can be stocked — Inventory stores quantity by warehouse, and every stock movement references an itemId from Master Items.",
        "Procurement's Goods Receiving posts a RECEIPT movement here and increases the relevant warehouse balance.",
        "Maintenance issues items from here, posting an ISSUE_TO_MAINTENANCE movement and decreasing the balance.",
        "Warehouses (physical stock locations) may optionally link to a Workshop, but are a distinct concept from Loading Points (customer delivery dispatch).",
      ]}
    />
  );
}
