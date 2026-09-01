import "../lib/loadEnv";
import { spawnSync } from "child_process";
import fs from "fs";
import readline from "readline";
import { logScriptEvent } from "../lib/logger";

// `npm run db:restore -- <path-to-backup-file>` — restores a pg_dump
// custom-format file (created by `npm run db:backup`, or any pg_dump -Fc
// output) into whatever DATABASE_URL currently points at.
//
// THIS IS DESTRUCTIVE: pg_restore --clean drops existing objects before
// recreating them from the dump, so anything in the target database that
// isn't in the backup file is gone afterward. This script does NOT block
// itself in production the way scripts/seed.ts does — restoring into
// production is a completely legitimate, sometimes urgent, disaster-
// recovery operation, so an environment-based block would get in the way
// of the one thing this script exists to let you do. Instead, the
// safeguard here is a mandatory interactive confirmation that shows
// exactly which database (password redacted) is about to be overwritten,
// skippable only with an explicit --force flag for scripted/CI use where
// no human is present to type "yes".
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set — see .env.example.");
  process.exit(1);
}

const args = process.argv.slice(2);
const force = args.includes("--force");
const file = args.find((a) => !a.startsWith("--"));

if (!file) {
  console.error("Usage: npm run db:restore -- <path-to-backup-file> [--force]");
  process.exit(1);
}
if (!fs.existsSync(file)) {
  console.error(`Backup file not found: ${file}`);
  process.exit(1);
}

function redact(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = "****";
    return parsed.toString();
  } catch {
    return "(connection string could not be parsed for display)";
  }
}

async function confirm(): Promise<boolean> {
  if (force) return true;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer: string = await new Promise((resolve) => {
    rl.question('Type "yes" to continue, anything else to abort: ', resolve);
  });
  rl.close();
  return answer.trim().toLowerCase() === "yes";
}

async function main() {
  console.log("This will DROP and recreate objects in the target database, then load the backup file:");
  console.log(`  Target database : ${redact(connectionString!)}`);
  console.log(`  Backup file     : ${file}`);
  console.log("Any data currently in the target database that isn't in this backup file will be lost.");
  console.log("");

  const proceed = await confirm();
  if (!proceed) {
    logScriptEvent({ script: "restore", phase: "failure", message: "aborted_by_user" });
    console.log("Aborted — no changes made.");
    process.exit(1);
  }

  logScriptEvent({ script: "restore", phase: "start", message: file });
  console.log("Restoring...");
  const result = spawnSync(
    "pg_restore",
    ["--clean", "--if-exists", "--no-owner", "-d", connectionString!, file as string],
    { stdio: "inherit" }
  );

  if (result.error) {
    logScriptEvent({ script: "restore", phase: "failure", message: result.error.message });
    console.error("Could not run pg_restore — is the PostgreSQL client toolset installed and on PATH?");
    console.error(result.error.message);
    process.exit(1);
  }
  // pg_restore commonly exits non-zero on harmless warnings (e.g. "role
  // does not exist" for --no-owner, or objects that didn't exist to drop
  // on a first-ever restore) — it doesn't distinguish these from real
  // failures in its exit code. Review the printed output above; this
  // script surfaces the exit code rather than hiding it, but doesn't
  // treat every non-zero exit as fatal.
  logScriptEvent({ script: "restore", phase: "success", message: `exit_code_${result.status}` });
  console.log(`pg_restore finished with exit code ${result.status}. Review the output above for any real errors.`);
  console.log("Run the verification steps in BACKUP_RESTORE.md before trusting this restore.");
}

main();
