import "../lib/loadEnv";
import { Pool } from "pg";

// Vitest's globalSetup runs once, in its own process, before any test file
// loads — so this is the right place to reset the test database to a
// known, freshly seeded state. All test files then share that same seeded
// data and add to it (new orders/trips/customers) rather than each
// re-seeding, which would collide on the fixture's unique emails/IDs.
export default async function setup() {
  const testUrl = process.env.DATABASE_URL_TEST;
  if (!testUrl) {
    throw new Error(
      "DATABASE_URL_TEST is not set — see .env.example. Tests need a " +
        "separate Postgres database from your dev one (e.g. fleet_ops_test)."
    );
  }
  // Point every module that reads DATABASE_URL (lib/db/client.ts, migrate.ts
  // defaults, seedData.ts) at the test database for the rest of this
  // process — this only affects this globalSetup process, not the actual
  // test-file worker processes (those get DATABASE_URL from vitest.config's
  // `test.env`, set independently).
  process.env.DATABASE_URL = testUrl;

  // Drop and recreate both the public schema AND drizzle's own migration-
  // tracking schema for a completely clean slate. Dropping only "public"
  // is not enough: drizzle records applied migrations in a separate
  // "drizzle" schema, so if that's left intact, the migrator sees migration
  // 0000 already marked as applied and skips re-running it — leaving
  // "public" with zero tables. (Found by actually running the suite twice
  // in a row rather than assuming a fresh reset was sufficient.)
  const resetPool = new Pool({ connectionString: testUrl });
  await resetPool.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
  await resetPool.query("DROP SCHEMA IF EXISTS drizzle CASCADE;");
  await resetPool.end();

  const { runMigrations } = await import("../scripts/migrate");
  await runMigrations(testUrl);

  const { seedDemoData } = await import("../scripts/seedData");
  await seedDemoData();

  const { pool } = await import("../lib/db/client");
  await pool.end();
  // globalSetup runs in its own separate process from the actual test
  // files, so closing this pool doesn't affect their connection — it just
  // releases this process's connection cleanly before those processes open
  // their own fresh ones.
}
