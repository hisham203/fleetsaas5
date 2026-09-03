import { describe, it, expect } from "vitest";
import { db } from "@/lib/db/client";
import { tenants, users, contracts, contractPricingRules, vehicles, customers } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { seedRiyadhBulkWaterTenant } from "../../scripts/seedRiyadhBulkWaterData";

// S3 hotfix — proves the actual reported Railway failure is fixed: the
// global test setup already seeds Demo Water Co. + Acme + Riyadh Bulk
// Water once (via seedDemoData()), so by the time this file runs, the
// database is already in exactly the state that broke on Railway
// (old seed data + the Riyadh tenant both present). Calling
// seedRiyadhBulkWaterTenant() again here, directly, is the real
// regression test: if it isn't genuinely idempotent, this throws a
// duplicate-key error exactly like Railway did.
describe("Riyadh Bulk Water seed hotfix — idempotency (S3)", () => {
  it("1. running the seed function again on a database that already has old Demo Water seed data does not throw", async () => {
    const demoWaterAdmin = await db.query.users.findFirst({ where: eq(users.email, "admin@demo-water.co") });
    expect(demoWaterAdmin, "sanity check — old seed data must already exist for this test to be meaningful").toBeTruthy();

    // This is the exact call that used to fail on Railway with
    // "duplicate key value violates unique constraint users_email_unique".
    await expect(seedRiyadhBulkWaterTenant("irrelevant-hash-for-this-test", Date.now())).resolves.toBeTruthy();
  });

  it("2. running it twice in a row does not create a duplicate tenant or duplicate users", async () => {
    const first = await seedRiyadhBulkWaterTenant("irrelevant-hash-for-this-test", Date.now());
    const second = await seedRiyadhBulkWaterTenant("irrelevant-hash-for-this-test", Date.now());

    expect(second.tenantId).toBe(first.tenantId); // same tenant reused, not a new one
    expect(second.reused.tenant).toBe(true);
    expect(second.created.tenant).toBe(false);
    expect(second.created.users).toBe(0);
    expect(second.reused.users).toBe(6);

    const allRiyadhTenants = await db.query.tenants.findMany({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    expect(allRiyadhTenants.length).toBe(1); // never more than one, no matter how many times this runs

    const adminUsers = await db.query.users.findMany({ where: eq(users.email, "admin@riyadh-bulk-water.co") });
    expect(adminUsers.length).toBe(1); // never a duplicate user row either
  });

  it("3. required Riyadh demo data exists and is well-formed after the (idempotent) seed", async () => {
    const result = await seedRiyadhBulkWaterTenant("irrelevant-hash-for-this-test", Date.now());

    const vehicleRows = await db.query.vehicles.findMany({ where: eq(vehicles.tenantId, result.tenantId) });
    expect(vehicleRows.length).toBe(6);
    expect(vehicleRows.filter((v) => v.capacityLiters === 18000).length).toBe(2);
    expect(vehicleRows.filter((v) => v.capacityLiters === 21000).length).toBe(2);
    expect(vehicleRows.filter((v) => v.capacityLiters === 28000).length).toBe(2);

    const customerRows = await db.query.customers.findMany({ where: eq(customers.tenantId, result.tenantId) });
    expect(customerRows.length).toBe(6);
    expect(customerRows.every((c) => c.type === "B2B")).toBe(true);

    const contractRows = await db.query.contracts.findMany({ where: eq(contracts.tenantId, result.tenantId) });
    expect(contractRows.length).toBe(4);
    expect(contractRows.filter((c) => c.type === "MONTHLY_ACCUMULATED").length).toBe(2);
    expect(contractRows.filter((c) => c.type === "ONE_TIME_TRIP_COUNT").length).toBe(2);

    const pricingRuleRows = await db.query.contractPricingRules.findMany({ where: eq(contractPricingRules.tenantId, result.tenantId) });
    expect(pricingRuleRows.length).toBe(10);
  });

  it("4. old Demo Water Co. and Acme data are completely untouched by any of this", async () => {
    await seedRiyadhBulkWaterTenant("irrelevant-hash-for-this-test", Date.now());

    const demoWaterTenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Demo Water Co.") });
    const acmeTenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Acme Fuel Delivery Co.") });
    expect(demoWaterTenant).toBeTruthy();
    expect(acmeTenant).toBeTruthy();

    const demoWaterAdmins = await db.query.users.findMany({ where: eq(users.email, "admin@demo-water.co") });
    expect(demoWaterAdmins.length).toBe(1); // still exactly one — never duplicated, never modified

    const demoWaterTenants = await db.query.tenants.findMany({ where: eq(tenants.name, "Demo Water Co.") });
    expect(demoWaterTenants.length).toBe(1);
  });
});
