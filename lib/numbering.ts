// Milestone AD — ERP-style numbering foundation. This file is
// deliberately pure and DB-free: formatSequenceNumber() never touches
// the database, never increments anything, and can be tested in
// complete isolation. The entity type registry below is for
// validation/UI defaults only — it does not seed or activate any
// series for any tenant.
//
// No allocation/generator function (allocateNextNumber) is implemented
// here. A concurrency-safe, transaction-locked increment against
// numbering_series.nextNumber, with a ledger row written atomically in
// the same transaction, needs careful design against this project's
// actual Postgres/Drizzle transaction primitives — rushing that in the
// same milestone as the schema itself risks exactly the kind of
// duplicate-number bug this whole foundation exists to prevent. Part 7
// of this milestone's own instructions explicitly allows deferring
// this to a design at exactly this level of uncertainty. Existing
// creation flows (genNumber(), manual codes) are completely unchanged
// and remain the only numbering in active use.

export type ResetPolicy = "NEVER" | "YEARLY" | "MONTHLY";

export interface SequenceFormatConfig {
  prefix: string;
  seriesSegment?: string | null;
  suffix?: string | null;
  separator?: string; // default ""
  paddingLength: number;
  includeYear?: boolean;
  includeMonth?: boolean;
}

// Pure formatting only — given a config and a raw sequence number,
// produce the final display string. Never mutates or reads any
// database state. Safe to call for a preview without allocating or
// consuming a real number.
export function formatSequenceNumber(config: SequenceFormatConfig, sequenceNumber: number, date: Date = new Date()): string {
  const sep = config.separator ?? "";
  const parts: string[] = [config.prefix];

  if (config.seriesSegment) parts.push(config.seriesSegment);
  if (config.includeYear) parts.push(String(date.getFullYear()));
  if (config.includeMonth) parts.push(String(date.getMonth() + 1).padStart(2, "0"));

  parts.push(String(sequenceNumber).padStart(config.paddingLength, "0"));

  let result = parts.join(sep);
  if (config.suffix) result += (sep || "") + config.suffix;
  return result;
}

// periodKey is what numbering_sequence_ledger.periodKey stores when a
// series' resetPolicy is YEARLY/MONTHLY — the actual reset boundary a
// future allocator would check against. Pure, DB-free, matching the
// same "no allocation logic" scope as the formatter above.
export function computePeriodKey(resetPolicy: ResetPolicy, date: Date = new Date()): string | null {
  if (resetPolicy === "NEVER") return null;
  const year = date.getFullYear();
  if (resetPolicy === "YEARLY") return String(year);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

// Milestone AD, Part 5 — entity type registry. Validation/UI defaults
// only: a tenant is never forced to use these prefixes, and no series
// is ever auto-created from this list.
export const NUMBERING_ENTITY_TYPES: { entityType: string; recommendedPrefix: string; label: string }[] = [
  { entityType: "CUSTOMER", recommendedPrefix: "C", label: "Customer" },
  { entityType: "CUSTOMER_SITE", recommendedPrefix: "S", label: "Customer Site" },
  { entityType: "SUPPLIER", recommendedPrefix: "V", label: "Supplier" },
  { entityType: "VEHICLE", recommendedPrefix: "VH", label: "Vehicle" },
  { entityType: "DRIVER", recommendedPrefix: "D", label: "Driver" },
  { entityType: "ORDER", recommendedPrefix: "O", label: "Order" },
  { entityType: "TRIP", recommendedPrefix: "TR", label: "Trip" },
  { entityType: "CONTRACT", recommendedPrefix: "CN", label: "Contract" },
  { entityType: "EXPENSE", recommendedPrefix: "EX", label: "Expense" },
  { entityType: "INVOICE", recommendedPrefix: "INV", label: "Invoice" },
  { entityType: "ITEM_GROUP", recommendedPrefix: "IG", label: "Item Group" },
  { entityType: "ITEM_CATEGORY", recommendedPrefix: "IC", label: "Item Category" },
  { entityType: "ITEM_SUBCATEGORY", recommendedPrefix: "ISC", label: "Item Sub-Category" },
  { entityType: "ITEM", recommendedPrefix: "I", label: "Item" },
  { entityType: "WORKSHOP", recommendedPrefix: "W", label: "Workshop" },
  { entityType: "MAINTENANCE_WAREHOUSE", recommendedPrefix: "WH", label: "Maintenance Warehouse" },
  { entityType: "PURCHASE_REQUISITION", recommendedPrefix: "PR", label: "Purchase Requisition" },
  { entityType: "PURCHASE_ORDER", recommendedPrefix: "PO", label: "Purchase Order" },
  { entityType: "GOODS_RECEIPT", recommendedPrefix: "GR", label: "Goods Receipt" },
  { entityType: "MAINTENANCE_WORK_ORDER", recommendedPrefix: "WO", label: "Maintenance Work Order" },
];
