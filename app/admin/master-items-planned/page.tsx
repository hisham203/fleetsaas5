"use client";

import PlannedModulePlaceholder from "@/components/PlannedModulePlaceholder";

// Milestone AB, Part 4 — Master Items owns item definitions only; it
// never holds a stock quantity (that's Inventory's job) and never
// receives goods or approves procurement itself.
export default function MasterItemsPlannedPage() {
  return (
    <PlannedModulePlaceholder
      title="Master Items"
      tagline="Item groups, categories, sub-categories, and the item master definition for fleet maintenance parts."
      covers={[
        "Item groups, categories, and sub-categories",
        "Item master — code/SKU, name, description, images, unit of measure",
        "Item type flags — spare part, tire, lubricant, consumable, tool, safety item",
        "Serialized/stockable flags, brand/model/specification, vehicle-type compatibility",
      ]}
      boundary="Master Items does not hold stock quantity, does not receive goods, does not issue stock, and does not approve procurement or perform maintenance — it defines what an item IS, not how much of it exists or where."
      relationships={[
        "Master Items is the source every other module points to: Inventory balances reference an itemId here, and every Procurement PR/PO/receipt line does too.",
        "Item creation belongs exclusively to Master Items — Inventory and Procurement both request/reference existing items rather than defining new ones themselves.",
        "Maintenance work orders will reference items here when recording parts consumed on a vehicle.",
      ]}
    />
  );
}
