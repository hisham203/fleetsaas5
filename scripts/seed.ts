import "../lib/loadEnv";
import { pool } from "../lib/db/client";
import { seedDemoData } from "./seedData";
import { logScriptEvent } from "../lib/logger";

// CLI entrypoint for `npm run db:seed`. The reusable logic lives in
// seedData.ts so the test suite can call seedDemoData() directly without
// spawning a subprocess AND without going through this guard — that
// import path is intentional (tests always need to seed regardless of
// NODE_ENV), this file is specifically the manually-run CLI command.
//
// Production guard: this creates fictional companies and a shared,
// publicly-documented demo password (see README/DEPLOYMENT.md) — there is
// no legitimate reason to ever run it against a real production database.
// Blocked whenever NODE_ENV=production, with an explicit opt-out for the
// rare case (e.g. a disposable pre-launch staging environment that
// happens to have NODE_ENV=production set) where it's genuinely wanted —
// never bypassed silently.
if (process.env.NODE_ENV === "production" && process.env.ALLOW_SEED_IN_PRODUCTION !== "true") {
  logScriptEvent({ script: "seed", phase: "failure", message: "blocked_by_production_guard" });
  console.error(
    "Refusing to run: NODE_ENV=production and ALLOW_SEED_IN_PRODUCTION is not set to \"true\".\n" +
      "This script creates demo companies and a shared, publicly-documented password —\n" +
      "never appropriate for a real production database. If you're certain this is not\n" +
      "a real production database, set ALLOW_SEED_IN_PRODUCTION=true and re-run."
  );
  process.exit(1);
}

logScriptEvent({ script: "seed", phase: "start" });

seedDemoData()
  .then(async (result) => {
    logScriptEvent({ script: "seed", phase: "success", message: `tenant1=${result.tenant1Id} tenant2=${result.tenant2Id} tenant3=${result.tenant3Id}` });
    console.log("Seed complete.", result);
    await pool.end();
  })
  .catch(async (e) => {
    logScriptEvent({ script: "seed", phase: "failure", message: e instanceof Error ? e.message : "unknown_error" });
    console.error(e);
    await pool.end();
    process.exit(1);
  });
