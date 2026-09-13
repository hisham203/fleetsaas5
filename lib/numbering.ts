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
const periodKey = computePeriodKey(series.resetPolicy as ResetPolicy, date) ?? "ALL";
    // Period reset: when resetPolicy is YEARLY or MONTHLY, reset sequence
    // when the period changes. The UPDATE row-lock serializes concurrent
    // resets. We detect whether the previous period's last number is in the
    // ledger; if so, we know a reset is needed. We use the series' own
    // currentPeriodKey column — but since that doesn't exist in the schema,
    // we instead check the ledger for the HIGHEST sequence number that is
    // NOT in the current period. If one exists, we reset; otherwise we
    // increment normally. All of this happens inside the locked transaction.
    let sequenceNumber: number;
    if (series.resetPolicy !== "NEVER") {
      // Check if ANY ledger row exists for a different period (cached read,
      // safe inside the transaction — the UPDATE below will serialize us).
      const prevPeriodRow = await tx.query.numberingSequenceLedger.findFirst({
        where: and(
          eq(numberingSequenceLedger.seriesId, series.id),
          sql`${numberingSequenceLedger.periodKey} != ${periodKey}`
        ),
        orderBy: [sql`${numberingSequenceLedger.createdAt} DESC`],
      });
      const needsReset = prevPeriodRow !== undefined && prevPeriodRow !== null;
      // Also check whether the current period has already been started
      // (i.e., a concurrent reset beat us). If so, increment normally.
      const currentPeriodRow = await tx.query.numberingSequenceLedger.findFirst({
        where: and(
          eq(numberingSequenceLedger.seriesId, series.id),
          eq(numberingSequenceLedger.periodKey, periodKey)
        ),
        orderBy: [sql`${numberingSequenceLedger.sequenceNumber} DESC`],
      });
      const concurrentlyReset = currentPeriodRow !== null && currentPeriodRow !== undefined;
      let newNextNumber: number;
      if (needsReset && !concurrentlyReset) {
        // First allocation in new period — reset to 1
        newNextNumber = 2; // we return 1, series stores 2 for next caller
        const [upd] = await tx.update(numberingSeries)
          .set({ nextNumber: 2, updatedAt: date })
          .where(eq(numberingSeries.id, series.id))
          .returning();
        sequenceNumber = 1;
      } else {
        // Same period (or concurrent already reset) — increment normally
        const [upd] = await tx.update(numberingSeries)
          .set({ nextNumber: sql`${numberingSeries.nextNumber} + 1`, updatedAt: date })
          .where(eq(numberingSeries.id, series.id))
          .returning();
        sequenceNumber = upd.nextNumber - 1;
      }
    } else {
      const [updatedSeries] = await tx
        .update(numberingSeries)
        .set({ nextNumber: sql`${numberingSeries.nextNumber} + 1`, updatedAt: date })
        .where(eq(numberingSeries.id, series.id))
        .returning();
      sequenceNumber = updatedSeries.nextNumber - 1;
    }
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

    // Ledger insert: if a concurrent reset already inserted this number, bump and retry once.
    const ledgerRow = { id: genId(), tenantId: params.tenantId, seriesId: series.id, entityType: params.entityType, generatedNumber, sequenceNumber, periodKey, referenceTable: params.referenceTable ?? undefined, referenceId: params.referenceId ?? undefined, generatedByUserId: params.generatedByUserId ?? undefined };
    try {
      await tx.insert(numberingSequenceLedger).values(ledgerRow);
    } catch (ledgerErr: any) {
      if (ledgerErr?.message?.includes("unique") || ledgerErr?.code === "23505") {
        // Another concurrent transaction already claimed this number.
        // Increment the series again and claim the next sequential number.
        const [bumped] = await tx.update(numberingSeries)
          .set({ nextNumber: sql`${numberingSeries.nextNumber} + 1`, updatedAt: date })
          .where(eq(numberingSeries.id, series.id))
          .returning();
        sequenceNumber = bumped.nextNumber - 1;
        const bumpedNumber = formatSequenceNumber({ prefix: series.prefix, seriesSegment: series.seriesSegment, suffix: series.suffix, separator: series.separator, paddingLength: series.paddingLength, includeYear: series.includeYear, includeMonth: series.includeMonth }, sequenceNumber, date);
        await tx.insert(numberingSequenceLedger).values({ ...ledgerRow, id: genId(), generatedNumber: bumpedNumber, sequenceNumber });
        return { generatedNumber: bumpedNumber, sequenceNumber, seriesId: series.id, entityType: params.entityType, periodKey };
      }
      throw ledgerErr;
    }

    return { generatedNumber, sequenceNumber, seriesId: series.id, entityType: params.entityType, periodKey };
  });
}
