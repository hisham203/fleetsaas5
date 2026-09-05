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
// no parallel readiness logic is introduced here.
//
// Task S.1 fix: "Ready for Dispatch" previously required EVERY item to
// be READY, including "Payment terms" and "Billing requirements", which
// computeReadinessItems always reports as UNSUPPORTED (by design — these
// features genuinely don't exist in this schema yet, per Task J's own
// audit) and never READY. That meant no contract could ever be marked
// ready, structurally, regardless of its actual configuration — the
// root cause behind contracts always showing as blocked. Fixed to block
// only on a genuinely MISSING item, plus the one WARNING that means
// something operationally real: an expired or not-yet-started contract
// (the "Within valid date period" check) — every other WARNING (the
// monthly-billing-readiness pointer, an OVERAGE rule not yet configured
// when the contract isn't even near its limit, a partially-retired
// distance band) and every UNSUPPORTED item are informational, not hard
// blockers, exactly as Task J's own design intended them to be read.
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
    const dateItem = items.find((i) => i.label === "Within valid date period");
    const dateBlocking = dateItem?.state === "WARNING";
    const missingItems = items.filter((i) => i.state === "MISSING");
    const readyForDispatch = missingItems.length === 0 && !dateBlocking;
    const blockedReasons = [...missingItems.map((i) => i.label), ...(dateBlocking ? ["Within valid date period"] : [])];

    const isTripCount = contract.type === "ONE_TIME_TRIP_COUNT";
    const isMonthly = contract.type === "MONTHLY_ACCUMULATED";
    const tripsRemaining = isTripCount && contract.totalTripsPurchased != null ? Math.max(0, contract.totalTripsPurchased - contract.tripsUsed) : null;
    const overageActive = isTripCount && contract.totalTripsPurchased != null && contract.tripsUsed >= contract.totalTripsPurchased;

    return {
      contractId: contract.id,
      contractNumber: contract.contractNumber,
      type: contract.type,
      customer: contract.customer,
      appliesToAllSites: contract.appliesToAllSites,
      siteCount: contract.appliesToAllSites ? null : contract.siteScope.length,
      totalTripsPurchased: contract.totalTripsPurchased,
      tripsUsed: contract.tripsUsed,
      tripsRemaining,
      overageActive,
      startDate: contract.startDate,
      endDate: contract.endDate,
      readinessItems: items,
      readyForDispatch,
      blockedReasons,
      // Task S.1, Part 6/7 — the exact operational path this contract
      // type follows, used by the Planner UI to explain what happens
      // next rather than showing a bare status.
      operationalPath: isMonthly ? "MONTHLY_ACCUMULATION" : isTripCount ? "DISPATCH_READY_TRIP" : "UNKNOWN",
    };
  });

  return NextResponse.json(result);
}
