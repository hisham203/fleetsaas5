import "../lib/loadEnv";
import { pool, db } from "../lib/db/client";
import { tenants } from "../lib/db/schema";
import { eq } from "drizzle-orm";
import { hashPassword } from "../lib/auth";
import { seedRiyadhBulkWaterTenant } from "./seedRiyadhBulkWaterData";
import { logScriptEvent } from "../lib/logger";

// S3 hotfix — CLI entrypoint for adding ONLY the Riyadh Bulk Water
// Logistics demo tenant to a database that may already contain other
// seed data (Demo Water Co., Acme, or a previous run of this exact
// script). Deliberately does NOT call seedDemoData() or touch Demo Water
// Co./Acme's data in any way — that's the whole point of this script
// existing separately from `npm run db:seed`.
//
// Production guard: identical in spirit to scripts/seed.ts's own guard —
// this still creates a fictional demo tenant with a shared, documented
// password, so the same reasoning applies. Preserved here rather than
// weakened, even though this script is explicitly meant to be run
// against Railway for this hotfix: ALLOW_SEED_IN_PRODUCTION=true is
// still required, never bypassed silently.
const DEMO_PASSWORD = "password123";

if (process.env.NODE_ENV === "production" && process.env.ALLOW_SEED_IN_PRODUCTION !== "true") {
  logScriptEvent({ script: "seed", phase: "failure", message: "riyadh_bulk_water:blocked_by_production_guard" });
  console.error(
    "Refusing to run: NODE_ENV=production and ALLOW_SEED_IN_PRODUCTION is not set to \"true\".\n" +
      "This script creates a demo tenant and a shared, publicly-documented password —\n" +
      "never appropriate for a real production database. If you're certain this is not\n" +
      "a real production database, set ALLOW_SEED_IN_PRODUCTION=true and re-run."
  );
  process.exit(1);
}

async function main() {
  logScriptEvent({ script: "seed", phase: "start", message: "riyadh_bulk_water" });

  const existingBefore = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
  console.log(
    existingBefore
      ? `"Riyadh Bulk Water Logistics" already exists (id: ${existingBefore.id}) — reusing it and filling in anything missing.`
      : `"Riyadh Bulk Water Logistics" does not exist yet — creating it fresh.`
  );

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const result = await seedRiyadhBulkWaterTenant(passwordHash, Date.now());

  console.log("\n=== Riyadh Bulk Water Logistics seed summary ===");
  console.log(`Tenant:         ${result.created.tenant ? "created" : "reused"} (id: ${result.tenantId})`);
  console.log(`Users:          ${result.created.users} created, ${result.reused.users} reused`);
  console.log(`Drivers:        ${result.created.drivers} created, ${result.reused.drivers} reused`);
  console.log(`Vehicles:       ${result.created.vehicles} created, ${result.reused.vehicles} reused`);
  console.log(`Customers:      ${result.created.customers} created, ${result.reused.customers} reused`);
  console.log(`Contracts:      ${result.created.contracts} created, ${result.reused.contracts} reused`);
  console.log(`Pricing rules:  ${result.created.pricingRules} created, ${result.reused.pricingRules} reused`);
  console.log("=================================================\n");

  logScriptEvent({
    script: "seed",
    phase: "success",
    message: `riyadh_bulk_water:tenantId=${result.tenantId} created=${JSON.stringify(result.created)} reused=${JSON.stringify(result.reused)}`,
  });
  console.log("Done. Demo Water Co. and Acme Fuel Delivery Co. were not touched.");
  await pool.end();
}

main().catch(async (e) => {
  logScriptEvent({ script: "seed", phase: "failure", message: `riyadh_bulk_water:${e instanceof Error ? e.message : "unknown_error"}` });
  console.error(e);
  await pool.end();
  process.exit(1);
});
