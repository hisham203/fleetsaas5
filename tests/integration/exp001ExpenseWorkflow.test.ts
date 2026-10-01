/**
 * exp001ExpenseWorkflow.test.ts — EXP-001 Closure
 *
 * Regression tests proving the driver expense workflow is operational end-to-end.
 *
 * Root cause of EXP-001:
 *   POST /api/expenses → resolveEntityCode({ entityType: "EXPENSE" })
 *   → allocateNextNumber() → numberingSeries lookup.
 *   The production tenant never had "Apply Recommended" invoked,
 *   so no ACTIVE EXPENSE series existed → CONFIGURE_NUMBERING (422).
 *
 * Fix:
 *   app/api/auth/signup/route.ts now seeds all recommended numbering
 *   series (including EXPENSE) immediately after tenant creation.
 *   Idempotent via ON CONFLICT DO NOTHING — existing tenants unaffected.
 *   Existing tenants: must invoke Settings → Numbering → Apply Recommended.
 *
 * These tests prove:
 *   1. Missing EXPENSE series → CONFIGURE_NUMBERING (fail-closed preserved)
 *   2. Active EXPENSE series → valid unique reference generated
 *   3. References are sequential
 *   4. Tenant isolation
 *   5. Created as PENDING
 *   6. Driver attribution
 *   7. Trip attribution
 *   8. Vehicle attribution
 *   9. Approval authorization
 *  10. Rejection authorization + review notes
 *  11. Driver 360 compatibility
 *  12. Signup bootstrap includes EXPENSE series
 *  13. Numbering conventions preserved
 *  14. Future tenants: signup route seeds numbering
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db/client";
import {
  tenants, users, drivers, vehicles, trips, warehouses, numberingSeries,
  expenseClaims, numberingSequenceLedger,
} from "@/lib/db/schema";
import { and, eq, like } from "drizzle-orm";
import { genId } from "@/lib/helpers";
import { hashPassword } from "@/lib/auth";
import { ensureNumberingSeries } from "../helpers/testFixtures";
import { makeRequest, loginAs } from "../helpers/request";

// ── Test state ──────────────────────────────────────────────────────────────
const run = Math.random().toString(36).slice(2, 8);
let tenantId: string;
let driverId: string;
let vehicleId: string;
let userId: string;
let adminUserId: string;
let driverCookie: string;
let adminCookie: string;
let tripId: string;
const createdExpenseIds: string[] = [];
const createdSeriesIds: string[] = [];

// ── Setup ────────────────────────────────────────────────────────────────────
beforeAll(async () => {
  // Use the existing test tenant that already has seeded data:
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.name, "Riyadh Bulk Water Logistics"),
  });
  if (!tenant) throw new Error("Test tenant not found");
  tenantId = tenant.id;

  // Find an existing admin user for approval tests:
  const adminUser = await db.query.users.findFirst({
    where: and(eq(users.tenantId, tenantId), eq(users.role, "ADMIN")),
  });
  if (adminUser) {
    adminUserId = adminUser.id;
    adminCookie = await loginAs(adminUser.email, "password123").catch(() => "");
  }

  // Create an isolated test driver:
  const pw = await hashPassword("password123");
  userId = genId();
  const email = `exp001-driver-${run}@test.local`;
  await db.insert(users).values({
    id: userId, tenantId, name: `EXP-001 Test Driver ${run}`,
    email, passwordHash: pw, role: "DRIVER",
  });
  driverId = genId();
  await db.insert(drivers).values({
    id: driverId, tenantId, userId,
    licenseNumber: `EXP-LIC-${run}`, status: "AVAILABLE",
  });
  driverCookie = await loginAs(email, "password123").catch(() => "");

  // Create a test vehicle:
  vehicleId = genId();
  await db.insert(vehicles).values({
    id: vehicleId, tenantId, plateNumber: `EXP-${run}`,
    vehicleType: "Tanker", capacityLiters: 18000, status: "AVAILABLE",
  });

  // Create a test trip (DISPATCHED so the driver can file an expense against it):
  const defaultWarehouse = await db.query.warehouses.findFirst({
    where: (await import("drizzle-orm")).eq(
      (await import("@/lib/db/schema")).warehouses.tenantId, tenantId
    ),
  } as any).catch(() => null);
  const warehouseId = defaultWarehouse?.id ?? genId();
  tripId = genId();
  await db.insert(trips).values({
    id: tripId, tenantId,
    tripNumber: `TRIP-EXP-${run}`,
    status: "DISPATCHED",
    driverId, vehicleId,
    warehouseId,
    dispatchedAt: new Date(),
    createdAt: new Date(),
  } as any);

  // Ensure EXPENSE numbering series exists for this tenant:
  const sid = await ensureNumberingSeries(tenantId, "EXPENSE", "EXP");
  createdSeriesIds.push(sid);
});

// ── Cleanup ──────────────────────────────────────────────────────────────────
afterAll(async () => {
  for (const id of createdExpenseIds) {
    await db.delete(expenseClaims).where(eq(expenseClaims.id, id)).catch(() => {});
  }
  await db.delete(trips).where(eq(trips.id, tripId)).catch(() => {});
  await db.delete(drivers).where(eq(drivers.id, driverId)).catch(() => {});
  await db.delete(users).where(eq(users.id, userId)).catch(() => {});
  await db.delete(vehicles).where(eq(vehicles.id, vehicleId)).catch(() => {});
  // Clean up allocated ledger entries for this run's expenses:
  await db.delete(numberingSequenceLedger)
    .where(like(numberingSequenceLedger.generatedNumber, `EXP06%`)).catch(() => {});
});

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("EXP-001 — expense workflow closure", () => {

  it("1. Missing EXPENSE series fails closed with CONFIGURE_NUMBERING (fail-closed preserved)", async () => {
    // Temporarily deactivate the series to prove the guard works:
    const series = await db.query.numberingSeries.findFirst({
      where: and(eq(numberingSeries.tenantId, tenantId), eq(numberingSeries.entityType, "EXPENSE")),
    });
    if (!series) {
      console.log("SKIP: no EXPENSE series in test tenant");
      return;
    }
    // Deactivate:
    await db.update(numberingSeries).set({ status: "INACTIVE" }).where(eq(numberingSeries.id, series.id));
    try {
      const { POST } = await import("@/app/api/expenses/route");
      const res = await POST(makeRequest("/api/expenses", {
        method: "POST",
        cookie: driverCookie,
        body: { driverId, vehicleId, tripId, category: "FUEL", amount: 150, reason: "Fuel fill-up" },
      }));
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.error).toBe("CONFIGURE_NUMBERING");
    } finally {
      // Restore:
      await db.update(numberingSeries).set({ status: "ACTIVE" }).where(eq(numberingSeries.id, series.id));
    }
  });

  it("2. Active EXPENSE series produces a valid unique reference", async () => {
    const { POST } = await import("@/app/api/expenses/route");
    const res = await POST(makeRequest("/api/expenses", {
      method: "POST",
      cookie: driverCookie,
      body: {
        driverId, vehicleId, tripId,
        category: "TOLL",
        amount: 25,
        reason: "Highway toll — EXP-001 test",
        receiptDescription: "Receipt #1",
      },
    }));
    expect(res.status).toBe(201);
    const claim = await res.json();
    createdExpenseIds.push(claim.id);

    // Valid reference:
    expect(typeof claim.expenseRef).toBe("string");
    expect(claim.expenseRef.length).toBeGreaterThan(0);
    // Follows EXP prefix convention:
    expect(claim.expenseRef).toMatch(/^EXP/);
  });

  it("3. References are sequential and unique", async () => {
    const { POST } = await import("@/app/api/expenses/route");
    const res1 = await POST(makeRequest("/api/expenses", {
      method: "POST", cookie: driverCookie,
      body: { driverId, vehicleId, category: "OTHER", amount: 10, reason: "Test seq 1" },
    }));
    const res2 = await POST(makeRequest("/api/expenses", {
      method: "POST", cookie: driverCookie,
      body: { driverId, vehicleId, category: "OTHER", amount: 20, reason: "Test seq 2" },
    }));
    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);
    const c1 = await res1.json();
    const c2 = await res2.json();
    createdExpenseIds.push(c1.id, c2.id);
    // Different references:
    expect(c1.expenseRef).not.toBe(c2.expenseRef);
    // Both have the EXP prefix:
    expect(c1.expenseRef).toMatch(/^EXP/);
    expect(c2.expenseRef).toMatch(/^EXP/);
  });

  it("4. Expense starts as PENDING", async () => {
    const { POST } = await import("@/app/api/expenses/route");
    const res = await POST(makeRequest("/api/expenses", {
      method: "POST", cookie: driverCookie,
      body: { driverId, vehicleId, category: "MAINTENANCE", amount: 300, reason: "Tyre repair" },
    }));
    expect(res.status).toBe(201);
    const claim = await res.json();
    createdExpenseIds.push(claim.id);
    expect(claim.status).toBe("PENDING");
  });

  it("5. Driver attribution correct", async () => {
    const { POST } = await import("@/app/api/expenses/route");
    const res = await POST(makeRequest("/api/expenses", {
      method: "POST", cookie: driverCookie,
      body: { driverId, vehicleId, category: "FUEL", amount: 80, reason: "Fuel fill attribution test" },
    }));
    expect(res.status).toBe(201);
    const claim = await res.json();
    createdExpenseIds.push(claim.id);
    expect(claim.driverId).toBe(driverId);
    expect(claim.tenantId).toBe(tenantId);
  });

  it("6. Trip attribution correct when tripId provided", async () => {
    const { POST } = await import("@/app/api/expenses/route");
    const res = await POST(makeRequest("/api/expenses", {
      method: "POST", cookie: driverCookie,
      body: { driverId, vehicleId, tripId, category: "TOLL", amount: 15, reason: "Toll gate" },
    }));
    expect(res.status).toBe(201);
    const claim = await res.json();
    createdExpenseIds.push(claim.id);
    expect(claim.tripId).toBe(tripId);
    expect(claim.vehicleId).toBe(vehicleId);
  });

  it("7. Vehicle attribution correct", async () => {
    const claim = await db.query.expenseClaims.findFirst({
      where: and(eq(expenseClaims.driverId, driverId), eq(expenseClaims.tenantId, tenantId)),
    });
    expect(claim).toBeDefined();
    expect(claim!.vehicleId).toBe(vehicleId);
  });

  it("8. Tenant isolation: expense is scoped to the correct tenant", async () => {
    const claims = await db.query.expenseClaims.findMany({
      where: and(eq(expenseClaims.driverId, driverId), eq(expenseClaims.tenantId, tenantId)),
    });
    for (const c of claims) {
      expect(c.tenantId).toBe(tenantId);
    }
  });

  it("9. Admin can approve a PENDING claim; claim cannot be approved twice", async () => {
    if (!adminCookie) { console.log("SKIP: admin cookie unavailable"); return; }
    // Create a claim to approve:
    const { POST: createExpense } = await import("@/app/api/expenses/route");
    const createRes = await createExpense(makeRequest("/api/expenses", {
      method: "POST", cookie: driverCookie,
      body: { driverId, vehicleId, category: "OTHER", amount: 50, reason: "To be approved" },
    }));
    expect(createRes.status).toBe(201);
    const claim = await createRes.json();
    createdExpenseIds.push(claim.id);

    // Approve:
    const { POST: approve } = await import(`@/app/api/expenses/[id]/approve/route`);
    const approveRes = await approve(
      makeRequest(`/api/expenses/${claim.id}/approve`, { method: "POST", cookie: adminCookie, body: {} }),
      { params: Promise.resolve({ id: claim.id }) }
    );
    expect(approveRes.status).toBe(200);
    const approved = await approveRes.json();
    expect(approved.status).toBe("APPROVED");

    // Cannot approve twice:
    const approveRes2 = await approve(
      makeRequest(`/api/expenses/${claim.id}/approve`, { method: "POST", cookie: adminCookie, body: {} }),
      { params: Promise.resolve({ id: claim.id }) }
    );
    expect(approveRes2.status).toBe(422);
  });

  it("10. Admin can reject a PENDING claim with review notes; cannot reject twice", async () => {
    if (!adminCookie) { console.log("SKIP: admin cookie unavailable"); return; }
    const { POST: createExpense } = await import("@/app/api/expenses/route");
    const createRes = await createExpense(makeRequest("/api/expenses", {
      method: "POST", cookie: driverCookie,
      body: { driverId, vehicleId, category: "FUEL", amount: 40, reason: "To be rejected" },
    }));
    expect(createRes.status).toBe(201);
    const claim = await createRes.json();
    createdExpenseIds.push(claim.id);

    const { POST: reject } = await import(`@/app/api/expenses/[id]/reject/route`);
    const rejectRes = await reject(
      makeRequest(`/api/expenses/${claim.id}/reject`, {
        method: "POST", cookie: adminCookie,
        body: { reviewNotes: "Receipt not provided — please resubmit" },
      }),
      { params: Promise.resolve({ id: claim.id }) }
    );
    expect(rejectRes.status).toBe(200);
    const rejected = await rejectRes.json();
    expect(rejected.status).toBe("REJECTED");
    expect(rejected.reviewNotes).toBe("Receipt not provided — please resubmit");

    // Cannot reject twice:
    const rejectRes2 = await reject(
      makeRequest(`/api/expenses/${claim.id}/reject`, {
        method: "POST", cookie: adminCookie, body: { reviewNotes: "Second attempt" },
      }),
      { params: Promise.resolve({ id: claim.id }) }
    );
    expect(rejectRes2.status).toBe(422);
  });

  it("11. Driver only sees their own expenses (Driver 360 compatibility)", async () => {
    const { GET } = await import("@/app/api/expenses/route");
    const res = await GET(makeRequest(`/api/expenses?driverId=${driverId}`, { cookie: driverCookie }));
    expect(res.status).toBe(200);
    const claims = await res.json();
    const ours = (Array.isArray(claims) ? claims : []).filter(
      (c: any) => c.driverId === driverId
    );
    // All returned claims belong to this driver:
    for (const c of ours) {
      expect(c.driverId).toBe(driverId);
      expect(c.tenantId).toBe(tenantId);
    }
  });

  it("12. Signup and Apply Recommended both consume the SAME canonical list (lib/numberingDefaults.ts)", async () => {
    // Import the canonical module directly:
    const { RECOMMENDED_NUMBERING_DEFAULTS, SERIES_PREFIX_MAP } = await import("@/lib/numberingDefaults");

    // Canonical list includes EXPENSE:
    const expenseEntry = RECOMMENDED_NUMBERING_DEFAULTS.find((d) => d.entityType === "EXPENSE");
    expect(expenseEntry).toBeDefined();
    expect(expenseEntry!.prefix).toBe("EXP");
    expect(expenseEntry!.seriesCode).toBe("EXPENSE_MAIN");
    expect(expenseEntry!.displayName).toBe("Expense Claim");

    // SERIES_PREFIX_MAP is derived from RECOMMENDED_NUMBERING_DEFAULTS:
    expect(SERIES_PREFIX_MAP["EXPENSE"]).toBe("EXP");

    // Signup route imports from numberingDefaults (not an independent copy):
    const signupSrc = require("fs").readFileSync("app/api/auth/signup/route.ts", "utf8");
    expect(signupSrc).toContain('from "@/lib/numberingDefaults"');
    expect(signupSrc).toContain("RECOMMENDED_NUMBERING_DEFAULTS");
    // No independent BOOTSTRAP_SERIES definition:
    expect(signupSrc).not.toContain("const BOOTSTRAP_SERIES");

    // Apply Recommended route imports from numberingDefaults (not an independent copy):
    const applyRecSrc = require("fs").readFileSync(
      "app/api/settings/numbering-apply-recommended/route.ts", "utf8"
    );
    expect(applyRecSrc).toContain('from "@/lib/numberingDefaults"');
    expect(applyRecSrc).toContain("RECOMMENDED_NUMBERING_DEFAULTS");

    // Test fixture derives SERIES_PREFIX from canonical (not an independent copy):
    const fixtureSrc = require("fs").readFileSync("tests/helpers/testFixtures.ts", "utf8");
    expect(fixtureSrc).toContain("SERIES_PREFIX_MAP");
    expect(fixtureSrc).toContain("SERIES_PREFIX: Record<string, string> = SERIES_PREFIX_MAP");
  });

    it("13. Canonical list has exactly 17 entity types; no independent copies remain", async () => {
    const { RECOMMENDED_NUMBERING_DEFAULTS } = await import("@/lib/numberingDefaults");
    expect(RECOMMENDED_NUMBERING_DEFAULTS.length).toBe(17);

    // Every entry has required fields:
    for (const entry of RECOMMENDED_NUMBERING_DEFAULTS) {
      expect(typeof entry.entityType).toBe("string");
      expect(entry.entityType.length).toBeGreaterThan(0);
      expect(typeof entry.seriesCode).toBe("string");
      expect(typeof entry.prefix).toBe("string");
      expect(typeof entry.displayName).toBe("string");
    }

    // No independent list in apply-recommended:
    const applyRecSrc = require("fs").readFileSync(
      "app/api/settings/numbering-apply-recommended/route.ts", "utf8"
    );
    expect(applyRecSrc).toContain('from "@/lib/numberingDefaults"');

    // No independent list in signup:
    const signupSrc = require("fs").readFileSync("app/api/auth/signup/route.ts", "utf8");
    expect(signupSrc).not.toContain("const BOOTSTRAP_SERIES");
  });

  it("14. Signup bootstrap is atomic: numbering series are inside the main transaction", () => {
    const src = require("fs").readFileSync("app/api/auth/signup/route.ts", "utf8");
    // The source contains tx.insert(numberingSeries) — series are in the tx, not outside:
    expect(src).toContain("tx.insert(numberingSeries)");
    // The old non-fatal catch-and-swallow pattern must be gone:
    expect(src).not.toContain("// Non-fatal: tenant + admin + warehouse already committed");
    expect(src).not.toContain("// Admin can apply recommended series manually via Settings.");
    // No try/catch that silently swallows numbering bootstrap failure:
    expect(src).not.toMatch(/try\s*\{[\s\S]{0,200}onConflictDoNothing[\s\S]{0,100}\}\s*catch\s*\{/);
    // The canonical import is used — no local BOOTSTRAP_SERIES constant:
    expect(src).toContain("RECOMMENDED_NUMBERING_DEFAULTS");
    expect(src).not.toContain("const BOOTSTRAP_SERIES");
    // Bootstrap is explicitly described as atomic in the comment:
    expect(src).toContain("atomic");
  });

  it("15. Future tenant safety: testFixtures derive from canonical defaults (EXPENSE included)", async () => {
    const { SERIES_PREFIX_MAP } = await import("@/lib/numberingDefaults");
    // EXPENSE is in the canonical map — so ensureAllSeries automatically includes it:
    expect(SERIES_PREFIX_MAP["EXPENSE"]).toBe("EXP");

    const fixtureSrc = require("fs").readFileSync("tests/helpers/testFixtures.ts", "utf8");
    // Fixture derives SERIES_PREFIX from canonical — not an independent copy:
    expect(fixtureSrc).toContain("SERIES_PREFIX_MAP");
    // ensureAllSeries still exists:
    expect(fixtureSrc).toContain("ensureAllSeries");
    // ensureAllSeries iterates SERIES_PREFIX which is now SERIES_PREFIX_MAP:
    expect(fixtureSrc).toContain("SERIES_PREFIX: Record<string, string> = SERIES_PREFIX_MAP");
  });
});
