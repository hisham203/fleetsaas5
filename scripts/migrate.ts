import "../lib/loadEnv";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "path";

// Applies migrations to whatever DATABASE_URL points at. Accepts an
// optional override so the test suite can migrate a separate test database
// without touching this process's own DATABASE_URL env var.
export async function runMigrations(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set — see .env.example.");
  }
  const pool = new Pool({ connectionString });
  const db = drizzle(pool);
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  await pool.end();
  return connectionString;
}

// CLI entrypoint — only runs when this file is executed directly
// (`npm run db:migrate`), not when imported by the test suite.
if (require.main === module) {
  runMigrations()
    .then((url) => console.log(`Migrations applied to ${url}`))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
