import dotenv from "dotenv";
import path from "path";

// Next.js automatically loads .env.local for the app itself (npm run dev /
// npm run build), but standalone scripts run via `tsx` and the Vitest test
// suite are outside that — they need this loaded explicitly. Import this
// as the very first line of any script/test entrypoint that needs
// DATABASE_URL or other secrets before anything else runs.
dotenv.config({ path: path.join(process.cwd(), ".env.local") });
// Fall back to a plain .env for CI environments that don't use .env.local.
dotenv.config({ path: path.join(process.cwd(), ".env") });
