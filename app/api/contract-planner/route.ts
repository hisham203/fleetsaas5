export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { contracts, contractPricingRules, distanceBands } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { SAFE_CUSTOMER_COLUMNS } from "@/lib/contractHelpers";
import { computeReadinessItems } from "@/lib/contractReadiness";
import { eq, and, inArray } from "drizzle-orm";

// Milestone Q, Gate Q5 — Contract Trip Planner aggregation endpoint.
// Read-only, reuses computeReadinessItems (Task J) exactly as the
// Contract Management module's own readiness summary already does —
// no parallel readiness logic is introduced here. "Ready for Dispatch"
// below is intentionally a stricter, planner-specific verdict on top of
// that same per-item data: every item must be READY (not merely
// non-MISSING) for this contract to count as ready to plan into
// operations, since a not-yet-started or expired contract (a WARNING
// item) genuinely should not be planned even though it isn't "missing"
// anything.
export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN", "DISPATCHER"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;

  const contractRows = await db.query.contracts.findMany({
    where: and(eq(contracts.tenantId, tenantId), eq(contracts.status, "ACTIVE")),
    with: { customer: { columns: SAFE_CUSTOMER_COLUMNS }, siteScope: { with: { customerLocation: true } } },
  });

  const contractIds = contractRows.map((c) => c.id);
  const [pricingRows, bandRows] = contractIds.length
    ? await Promise.all([
        db.query.contractPricingRules.findMany({ where: inArray(contractPricingRules.contractId, contractIds) }),
        db.query.distanceBands.findMany({ where: eq(distanceBands.tenantId, tenantId) }),
      ])
    : [[], []];
  const pricingByContract = new Map<string, typeof pricingRows>();
  for (const rule of pricingRows) {
    if (!rule.contractId) continue;
    const list = pricingByContract.get(rule.contractId) ?? [];
    list.push(rule);
    pricingByContract.set(rule.contractId, list);
  }

  const result = contractRows.map((contract) => {
    const items = computeReadinessItems(contract as any, pricingByContract.get(contract.id) ?? [], bandRows);
    const readyForDispatch = items.every((i) => i.state === "READY");
    const blockedReasons = items.filter((i) => i.state === "MISSING").map((i) => i.label);
    return {
      contractId: contract.id,
      contractNumber: contract.contractNumber,
      type: contract.type,
      customer: contract.customer,
      appliesToAllSites: contract.appliesToAllSites,
      siteCount: contract.appliesToAllSites ? null : contract.siteScope.length,
      totalTripsPurchased: contract.totalTripsPurchased,
      tripsUsed: contract.tripsUsed,
      startDate: contract.startDate,
      endDate: contract.endDate,
      readinessItems: items,
      readyForDispatch,
      blockedReasons,
    };
  });

  return NextResponse.json(result);
}
