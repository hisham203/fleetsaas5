// Milestone AD/AE/AF — numbering entry point. Pure pieces live in
// lib/numberingFormat.ts (client-safe); the DB-backed allocator lives
// here and must only be imported server-side.
export * from "./numberingFormat";
import { formatSequenceNumber, computePeriodKey, type ResetPolicy } from "./numberingFormat";

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
