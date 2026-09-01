export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { pool } from "@/lib/db/client";
import { logHealthCheckFailure } from "@/lib/logger";

// Deployment infrastructure, not a business feature: almost every managed
// hosting platform (Railway, Render, ECS/Fargate, Kubernetes liveness/
// readiness probes, a load balancer in front of multiple instances) needs
// a cheap, unauthenticated URL to confirm the app is actually up — and,
// critically, that it can reach its database, not just that the Node
// process is running. Without this, a health check would have to hit `/`
// or `/login`, which depend on the full page-render pipeline and are
// fragile to use as a liveness signal.
export async function GET() {
  try {
    await pool.query("SELECT 1");
    return NextResponse.json({ status: "ok", database: "connected" });
  } catch (err) {
    // Only the failure path is logged — see lib/logger.ts for why success
    // isn't (a health check polled every few seconds would otherwise
    // produce pure noise). The caught error's message is safe to log:
    // it's a Postgres/network-level error (e.g. connection refused, auth
    // failed against the pool), never request or credential data.
    logHealthCheckFailure({ message: err instanceof Error ? err.message : "Unknown database error" });
    return NextResponse.json({ status: "error", database: "unreachable" }, { status: 503 });
  }
}
