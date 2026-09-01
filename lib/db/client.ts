import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

// Postgres via node-postgres (pg) + drizzle-orm/node-postgres. Requires
// DATABASE_URL — see .env.example and the README's "Database: Postgres"
// section for local setup (docker-compose or a native install) and for
// pointing at a hosted provider (Neon, Supabase, Railway, RDS, etc).
const globalForDb = globalThis as unknown as { pgPool?: Pool };

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env.local and fill it in " +
      "— see the README's Postgres setup section."
  );
}

const pool = globalForDb.pgPool ?? new Pool({ connectionString });

if (process.env.NODE_ENV !== "production") globalForDb.pgPool = pool;

export const db = drizzle(pool, { schema });
export { pool };
