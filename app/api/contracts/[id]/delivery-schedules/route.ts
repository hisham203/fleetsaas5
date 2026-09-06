export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { contracts, contractDeliverySchedules } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, and } from "drizzle-orm";

// Milestone V.1 — read-only. This route exists so future UI (V.2+) has
// something real to query against; it does not create, generate, or
// convert anything, and the underlying table is empty in every
// environment today. ADMIN-only, matching this whole Contract Management
// module's existing convention (app/api/contracts/[id]/route.ts and
// every sibling route are already ADMIN-only) — the same
// operational-vs-commercial distinction Task K.4 drew for customer
// sites doesn't yet apply here, since no non-admin workflow depending on
// schedules exists yet.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: contractId } = await params;
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;

  // Ownership check, matching the exact pattern every other nested
  // contract resource in this codebase already uses (e.g. contract site
  // scope, contract pricing rules) — a schedule can only be listed
  // through the contract it genuinely belongs to, in this tenant.
  const contract = await db.query.contracts.findFirst({ where: and(eq(contracts.id, contractId), eq(contracts.tenantId, tenantId)) });
  if (!contract) {
    return NextResponse.json({ error: "Contract not found" }, { status: 404 });
  }

  const schedules = await db.query.contractDeliverySchedules.findMany({
    where: and(eq(contractDeliverySchedules.tenantId, tenantId), eq(contractDeliverySchedules.contractId, contractId)),
  });
  return NextResponse.json(schedules);
}
