export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { plannedContractDemands } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, and } from "drizzle-orm";

// Milestone V.1 — read-only, tenant-wide list with optional filters,
// matching the same query-param filtering convention already used by
// GET /api/orders (contractId, customerId) and GET /api/contracts
// (status). No generation, approval, or conversion exists yet — this
// route exists purely so future UI (the Planner, contract detail,
// customer hub — all V.5) has a real, safe endpoint to call once that
// code is built. The underlying table is empty in every environment
// today, so every response from this route is currently `[]`.
export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;

  const contractId = req.nextUrl.searchParams.get("contractId");
  const customerId = req.nextUrl.searchParams.get("customerId");
  const status = req.nextUrl.searchParams.get("status");

  const conditions = [
    eq(plannedContractDemands.tenantId, tenantId),
    contractId ? eq(plannedContractDemands.contractId, contractId) : undefined,
    customerId ? eq(plannedContractDemands.customerId, customerId) : undefined,
    status ? eq(plannedContractDemands.status, status) : undefined,
  ].filter(Boolean) as any[];

  const rows = await db.query.plannedContractDemands.findMany({ where: and(...conditions) });
  return NextResponse.json(rows);
}
