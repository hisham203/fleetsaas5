import { defineConfig } from "vitest/config";
import dotenv from "dotenv";
import path from "path";

// Vitest's config file runs as its own Node process and doesn't get
// Next.js's automatic .env.local loading, so load it explicitly here too.
dotenv.config({ path: path.resolve(import.meta.dirname, ".env.local") });
dotenv.config({ path: path.resolve(import.meta.dirname, ".env") });

export default defineConfig({
  test: {
    environment: "node",
    globalSetup: ["./tests/globalSetup.ts"],
    env: {
      // Test worker processes get DATABASE_URL_TEST's value AS their
      // DATABASE_URL, so lib/db/client.ts (imported by route handlers under
      // test) transparently points at the test database — isolated from
      // dev.
      DATABASE_URL: process.env.DATABASE_URL_TEST ?? "",
    },
    testTimeout: 15000,
    // Sequential, not parallel: tests share one Postgres connection pool
    // per worker and a single shared seeded dataset, so concurrent test
    // files racing on the same rows would be a source of flakiness, not a
    // reflection of a real bug.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "."),
    },
  },
});
