import { db } from "@/lib/db/client";
import { users, drivers, vehicles, contracts, numberingSeries } from "@/lib/db/schema";
import { genId } from "@/lib/helpers";
import { hashPassword } from "@/lib/auth";
import { loginAs } from "./request";

// Test isolation fix: several integration test files previously hardcoded
// a specific seeded driver by email (most commonly khalid@demo-water.co)
// as "the test driver", cached once in beforeAll. This was fragile in a
// real CI run: multiple test files reach for the same small shared pool
// of seeded drivers/vehicles, sequential test-file execution order isn't
// something to rely on, and a single earlier assertion failure anywhere
// in a trip's lifecycle can abort that test before its own cleanup step
// runs — leaving the shared driver stuck busy for every later test in
// every file that also depends on that same specific driver by name.
//
// The fix is genuine test isolation, not weaker validation: each test
// file that needs a driver/vehicle to run real trips through creates its
// own dedicated ones here, used by nothing else, so there is no pool to
// contend over at all. Every real driver/vehicle availability check in
// the application itself (the actual business logic) is completely
// unchanged and still fully exercised — these fixtures are ordinary rows
// created through the same schema and constraints as any seeded driver
// or vehicle, not a special-cased bypass.
export async function createIsolatedDriverAndVehicle(tenantId: string, label: string) {
  const password = "password123";
  const passwordHash = await hashPassword(password);
  const suffix = genId().slice(0, 8);

  const userId = genId();
  const email = `test-${label}-${suffix}@isolated-test.local`;
  await db.insert(users).values({
    id: userId,
    tenantId,
    name: `Isolated Test Driver (${label})`,
    email,
    passwordHash,
    role: "DRIVER",
  });

  const driverId = genId();
  await db.insert(drivers).values({
    id: driverId,
    tenantId,
    userId,
    licenseNumber: `TEST-${suffix.toUpperCase()}`,
    phone: "0500000000",
    status: "AVAILABLE",
  });

  const vehicleId = genId();
  await db.insert(vehicles).values({
    id: vehicleId,
    tenantId,
    plateNumber: `TEST-${suffix.toUpperCase()}`,
    vehicleType: "Refill Van",
    capacityUnits: 100,
    status: "AVAILABLE",
  });

  const driverCookie = await loginAs(email, password);

  return { driverId, vehicleId, driverCookie, driverEmail: email };
}

// Milestone AF.1 — converted entities are system-numbered only, so any
// test that creates one needs an active series. Find-or-create is
// idempotent per tenant+entityType (the schema's own unique rule), so
// files sharing a tenant never collide on series creation.
export async function ensureNumberingSeries(tenantId: string, entityType: string, prefix: string) {
  const { db } = await import("@/lib/db/client");
  const { numberingSeries } = await import("@/lib/db/schema");
  const { eq, and } = await import("drizzle-orm");
  const { genId } = await import("@/lib/helpers");
  const existing = await db.query.numberingSeries.findFirst({ where: and(eq(numberingSeries.tenantId, tenantId), eq(numberingSeries.entityType, entityType)) });
  if (existing) {
    if (existing.status !== "ACTIVE") await db.update(numberingSeries).set({ status: "ACTIVE" }).where(eq(numberingSeries.id, existing.id));
    return existing.id;
  }
  const id = genId();
  await db.insert(numberingSeries).values({ id, tenantId, entityType, seriesCode: `${entityType}-${genId().slice(0, 6)}`, displayName: `${entityType} series`, prefix, seriesSegment: "06", paddingLength: 3, nextNumber: 1, status: "ACTIVE" });
  return id;
}

export const SERIES_PREFIX: Record<string, string> = {
  SUPPLIER: "V", ITEM_GROUP: "IG", ITEM_CATEGORY: "IC", ITEM_SUBCATEGORY: "ISC", ITEM: "I", WORKSHOP: "W", MAINTENANCE_WAREHOUSE: "WH",
  CUSTOMER: "C", CUSTOMER_SITE: "S", VEHICLE: "VH", DRIVER: "D", LOADING_POINT: "LP",
  CONTRACT: "CNT", EXPENSE: "EXP", PURCHASE_REQUISITION: "PR", PURCHASE_ORDER: "PO", GOODS_RECEIPT: "GRN",
};

// Milestone AG — ensures all converted entity types have an active series
// for the given tenant. Idempotent per tenant+entityType.
export async function ensureAllSeries(tenantId: string) {
  for (const [et, prefix] of Object.entries(SERIES_PREFIX)) {
    await ensureNumberingSeries(tenantId, et, prefix);
  }
}

// RC1 — cleans up allocator-numbered contracts for a tenant.
// The contracts table has a GLOBAL unique constraint on contract_number,
// so sequential allocations (CNT06001…) persist across test runs and collide.
// Call this in beforeAll of any test suite that creates contracts.
// RC1: global contract cleanup — the contracts table has a GLOBAL unique
// constraint on contract_number. Each call purges ALL allocator-generated
// contract numbers so sequential allocations from different test files don't
// collide within a single run. The tenantId argument is kept for API
// compatibility but cleanup is always global.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function cleanupAllocatedContracts(_tenantId?: string) {
  const { like } = await import("drizzle-orm");
  const { numberingSequenceLedger } = await import("@/lib/db/schema");
  // Clear all ledger rows for allocator-generated contract numbers
  await db.delete(numberingSequenceLedger).where(like(numberingSequenceLedger.generatedNumber, "%06%"));
  // Clear all contracts with allocator-style numbers
  await db.delete(contracts).where(like(contracts.contractNumber, "%06%"));
  // Reset ALL CONTRACT series nextNumbers to 1 (all tenants)
  await db.update(numberingSeries).set({ nextNumber: 1 }).where(
    (await import("drizzle-orm")).eq(numberingSeries.entityType, "CONTRACT")
  );
}
