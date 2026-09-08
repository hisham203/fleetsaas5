// Milestone AF — client-safe numbering primitives. This module has NO
// database dependency (not even a dynamic import): the formatter, the
// period-key helper, the entity registry, and the coverage map are all
// pure, so browser pages (Settings) can import them without dragging
// the server-only allocator — and therefore `pg` — into the bundle.
// lib/numbering.ts re-exports everything here, so existing imports of
// "@/lib/numbering" keep working unchanged.

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
  { entityType: "LOADING_POINT", recommendedPrefix: "LP", label: "Loading Point" },
  { entityType: "PURCHASE_REQUISITION", recommendedPrefix: "PR", label: "Purchase Requisition" },
  { entityType: "PURCHASE_ORDER", recommendedPrefix: "PO", label: "Purchase Order" },
  { entityType: "GOODS_RECEIPT", recommendedPrefix: "GR", label: "Goods Receipt" },
  { entityType: "MAINTENANCE_WORK_ORDER", recommendedPrefix: "WO", label: "Maintenance Work Order" },
];

// ---------- Part 4: field → numbering entityType mapping ----------
// Only entities whose schema already carries a code field appear here
// with a "converted" status. Entities marked "schema-gap" have no code
// column at all (confirmed by Milestone AF's audit) — they are listed
// so Settings can show them honestly as future, never faked.
export type CodeFieldStatus = "converted" | "audit-only" | "schema-gap";

export const CODE_FIELD_ENTITY_MAP: { field: string; entityType: string; status: CodeFieldStatus; note: string }[] = [
  { field: "supplierCode", entityType: "SUPPLIER", status: "converted", note: "Auto-numbering pilot (AE), validation hardened (AF)" },
  { field: "workshopCode", entityType: "WORKSHOP", status: "converted", note: "Converted in AF" },
  { field: "warehouseCode", entityType: "MAINTENANCE_WAREHOUSE", status: "converted", note: "Converted in AF" },
  { field: "code (item group)", entityType: "ITEM_GROUP", status: "converted", note: "Converted in AF" },
  { field: "code (item category)", entityType: "ITEM_CATEGORY", status: "converted", note: "Converted in AF" },
  { field: "code (item subcategory)", entityType: "ITEM_SUBCATEGORY", status: "converted", note: "Converted in AF" },
  { field: "itemCode", entityType: "ITEM", status: "converted", note: "Converted in AF" },
  { field: "(none)", entityType: "CUSTOMER", status: "schema-gap", note: "customers has no code column — customerCode proposed, not implemented" },
  { field: "(none)", entityType: "CUSTOMER_SITE", status: "schema-gap", note: "customer_locations has no code column — siteCode proposed, not implemented" },
  { field: "plateNumber (legal, stays manual)", entityType: "VEHICLE", status: "schema-gap", note: "Plate is the physical/legal registration — vehicleCode proposed as a separate column" },
  { field: "licenseNumber (legal, stays manual)", entityType: "DRIVER", status: "schema-gap", note: "License is a legal identifier — driverCode proposed as a separate column" },
  { field: "(none)", entityType: "LOADING_POINT", status: "schema-gap", note: "warehouses (loading points) has no code column — loadingPointCode proposed" },
  { field: "contractNumber (genNumber)", entityType: "CONTRACT", status: "audit-only", note: "Uses genNumber(\"CNT\"); tied to contract billing — deferred" },
  { field: "(display-only expenseRef)", entityType: "EXPENSE", status: "audit-only", note: "No stored reference column; expenseRef() derives from id — deferred" },
  { field: "orderNumber (genNumber)", entityType: "ORDER", status: "audit-only", note: "Dispatch/billing-critical — deferred to a dedicated milestone" },
  { field: "tripNumber (genNumber)", entityType: "TRIP", status: "audit-only", note: "Dispatch/POD-critical — deferred" },
  { field: "invoiceNumber (genNumber)", entityType: "INVOICE", status: "audit-only", note: "Billing/ERP-critical — deferred" },
  { field: "prNumber", entityType: "PURCHASE_REQUISITION", status: "audit-only", note: "No creation workflow exists yet — converts with the PR workflow" },
  { field: "poNumber", entityType: "PURCHASE_ORDER", status: "audit-only", note: "No creation workflow exists yet — converts with the PO workflow" },
  { field: "receiptNumber", entityType: "GOODS_RECEIPT", status: "audit-only", note: "No receiving workflow exists yet — converts with receiving" },
  { field: "(none)", entityType: "MAINTENANCE_WORK_ORDER", status: "audit-only", note: "No work-order entity exists yet" },
];


