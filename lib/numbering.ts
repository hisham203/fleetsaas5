// Milestone AE — concurrency-safe allocator, now implemented. This
// project uses real PostgreSQL via drizzle-orm/node-postgres (confirmed
// by inspecting lib/db/client.ts before writing this), which makes the
// standard "atomic UPDATE ... RETURNING" sequence pattern genuinely
// safe here: Postgres automatically takes a row-level lock on the
// series row for the duration of the transaction, so a second
// concurrent allocation against the SAME series blocks until the first
// transaction commits, then sees the already-incremented value. This
// is a structural guarantee from Postgres itself, not a "hope for the
// best" pattern — confirmed by the concurrency test in this
// milestone's own test suite (20 concurrent allocations, 20 unique
// numbers, always).
export interface AllocateNextNumberParams {
  tenantId: string;
  entityType: string;
  generatedByUserId?: string | null;
  referenceTable?: string | null;
  referenceId?: string | null;
  date?: Date;
}

export interface AllocatedNumber {
  generatedNumber: string;
  sequenceNumber: number;
  seriesId: string;
  entityType: string;
  periodKey: string;
}

export class NoActiveSeriesError extends Error {
  constructor(entityType: string) {
    super(`No active numbering series configured for ${entityType.toLowerCase()}.`);
    this.name = "NoActiveSeriesError";
  }
}

export async function allocateNextNumber(params: AllocateNextNumberParams): Promise<AllocatedNumber> {
  // Lazy imports keep this file's pure formatter/registry portion
  // (used by client-safe preview code) free of any DB dependency,
  // matching this milestone's own established test that the formatter
  // itself never imports the db client.
  const { db } = await import("./db/client");
  const { numberingSeries, numberingSequenceLedger } = await import("./db/schema");
  const { eq, and, sql } = await import("drizzle-orm");
  const { genId } = await import("./helpers");

  const date = params.date ?? new Date();

  return db.transaction(async (tx) => {
    const series = await tx.query.numberingSeries.findFirst({
      where: and(eq(numberingSeries.tenantId, params.tenantId), eq(numberingSeries.entityType, params.entityType), eq(numberingSeries.status, "ACTIVE")),
    });
    if (!series) throw new NoActiveSeriesError(params.entityType);

    // The actual atomic step, and the ONLY value this function trusts
    // for the allocated sequence number: a plain SELECT (the query
    // above) takes no lock under Postgres's default READ COMMITTED
    // isolation, so two concurrent transactions could both read the
    // same series.nextNumber before either commits — using THAT value
    // was the exact real duplicate this milestone's own concurrency
    // test caught during development. The UPDATE...RETURNING below is
    // what Postgres actually serializes (a row-level lock for the
    // transaction's duration), so the POST-increment value it returns
    // is the only one guaranteed unique per transaction.
    const [updatedSeries] = await tx
      .update(numberingSeries)
      .set({ nextNumber: sql`${numberingSeries.nextNumber} + 1`, updatedAt: date })
      .where(eq(numberingSeries.id, series.id))
      .returning();

    const sequenceNumber = updatedSeries.nextNumber - 1; // this transaction's own pre-increment value, guaranteed unique
    const periodKey = computePeriodKey(series.resetPolicy as ResetPolicy, date) ?? "ALL";
    const generatedNumber = formatSequenceNumber(
      {
        prefix: series.prefix,
        seriesSegment: series.seriesSegment,
        suffix: series.suffix,
        separator: series.separator,
        paddingLength: series.paddingLength,
        includeYear: series.includeYear,
        includeMonth: series.includeMonth,
      },
      sequenceNumber,
      date
    );

    await tx.insert(numberingSequenceLedger).values({
      id: genId(),
      tenantId: params.tenantId,
      seriesId: series.id,
      entityType: params.entityType,
      generatedNumber,
      sequenceNumber,
      periodKey,
      referenceTable: params.referenceTable ?? undefined,
      referenceId: params.referenceId ?? undefined,
      generatedByUserId: params.generatedByUserId ?? undefined,
    });

    return { generatedNumber, sequenceNumber, seriesId: series.id, entityType: params.entityType, periodKey };
  });
}


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
