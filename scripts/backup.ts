import "../lib/loadEnv";
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { logScriptEvent } from "../lib/logger";

// `npm run db:backup` — a thin, honest wrapper around pg_dump. No custom
// backup format, no retention logic, no cloud upload: this creates one
// timestamped dump file on the machine it's run from. For real production
// use, see DEPLOYMENT.md and BACKUP_RESTORE.md — most managed Postgres
// providers (RDS, Neon, Supabase, Railway) offer automated backups/PITR
// that are more reliable than a manually-run script, and should be your
// primary strategy; this script is for a manual/local safety net and for
// the "how does restore actually work" verification described in
// BACKUP_RESTORE.md, not a replacement for provider-managed backups.
//
// Uses pg_dump's custom format (-Fc): compressed, and restorable with
// pg_restore (including selective/parallel restore if ever needed) —
// strictly more useful than a plain .sql dump for the same effort.
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set — see .env.example.");
  process.exit(1);
}

const backupsDir = path.join(process.cwd(), "backups");
fs.mkdirSync(backupsDir, { recursive: true });

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputFile = path.join(backupsDir, `backup-${timestamp}.dump`);

logScriptEvent({ script: "backup", phase: "start" });
console.log(`Backing up database to ${outputFile} ...`);

// The connection string is passed as a single positional argument, read
// from the already-loaded environment — never split into a separate
// --password flag, so it never appears as its own token in process listings
// or shell history beyond what running `npm run db:backup` itself shows.
const result = spawnSync("pg_dump", [connectionString, "-Fc", "-f", outputFile], { stdio: "inherit" });

if (result.error) {
  logScriptEvent({ script: "backup", phase: "failure", message: result.error.message });
  console.error("Could not run pg_dump — is the PostgreSQL client toolset installed and on PATH?");
  console.error(result.error.message);
  process.exit(1);
}
if (result.status !== 0) {
  logScriptEvent({ script: "backup", phase: "failure", message: `pg_dump exited with status ${result.status}` });
  console.error(`pg_dump exited with status ${result.status}.`);
  process.exit(result.status ?? 1);
}

logScriptEvent({ script: "backup", phase: "success", message: outputFile });
console.log(`Backup complete: ${outputFile}`);
console.log("Keep this file somewhere other than this machine's disk for it to be useful as a real backup.");
