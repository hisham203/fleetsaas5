// Vitest global setup — clears stale test-created contracts before the suite runs.
// This is needed because the contracts table has a GLOBAL unique constraint on
// contract_number, which causes cross-run collisions with sequential allocator numbers.
export async function setup() {
  try {
    const { db } = await import("../../lib/db/client");
    const { contracts, numberingSeries, numberingSequenceLedger } = await import("../../lib/db/schema");
    const { like, eq } = await import("drizzle-orm");
    await db.delete(numberingSequenceLedger).where(like(numberingSequenceLedger.generatedNumber, "CNT06%"));
    await db.delete(contracts).where(like(contracts.contractNumber, "CNT06%"));
    await db.update(numberingSeries).set({ nextNumber: 1 }).where(eq(numberingSeries.entityType, "CONTRACT"));
    console.log("[globalSetup] Contract table cleaned for fresh test run");
  } catch (e) {
    console.warn("[globalSetup] Contract cleanup failed (may not be an issue):", e);
  }
}
export async function teardown() {}
