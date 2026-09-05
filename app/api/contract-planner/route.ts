export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { contracts, contractPricingRules, distanceBands, vehicles, drivers, orders } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { SAFE_CUSTOMER_COLUMNS } from "@/lib/contractHelpers";
import { computeReadinessItems } from "@/lib/contractReadiness";
import { eq, and, inArray, isNull } from "drizzle-orm";

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
//
// Milestone T, Part 7 — extended into a real capacity planner: the
// response is now {contracts, capacity, demand} instead of a bare array
// (this route's only consumer is app/admin/contract-planner/page.tsx,
// updated in this same change — nothing else in the codebase fetches
// this endpoint). Capacity groups real vehicles by their actual
// capacityLiters (18000/21000/28000 called out explicitly per this
// pilot's known tanker sizes; anything else grouped as "OTHER" rather
// than silently dropped or miscategorized) with available/total counts
// per size. Demand distinguishes contract-linked pending orders (summed
// from the same contract rows below) from non-contract cash/manual/B2C
// pending demand, which needs capacity too but has no contract row to
// attach to.
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
  const [pricingRows, bandRows, vehicleRows, driverRows, contractOrderRows, nonContractOrderRows] = await Promise.all([
    contractIds.length ? db.query.contractPricingRules.findMany({ where: inArray(contractPricingRules.contractId, contractIds) }) : Promise.resolve([]),
    db.query.distanceBands.findMany({ where: eq(distanceBands.tenantId, tenantId) }),
    db.query.vehicles.findMany({ where: eq(vehicles.tenantId, tenantId) }),
    db.query.drivers.findMany({ where: eq(drivers.tenantId, tenantId) }),
    contractIds.length
      ? db.query.orders.findMany({ where: and(eq(orders.tenantId, tenantId), inArray(orders.contractId, contractIds), inArray(orders.status, ["PENDING", "VALIDATED", "QUEUED", "ASSIGNED", "IN_TRANSIT"])) })
      : Promise.resolve([]),
    db.query.orders.findMany({ where: and(eq(orders.tenantId, tenantId), isNull(orders.contractId), inArray(orders.status, ["PENDING", "VALIDATED", "QUEUED"])) }),
  ]);
  const pricingByContract = new Map<string, typeof pricingRows>();
  for (const rule of pricingRows) {
    if (!rule.contractId) continue;
    const list = pricingByContract.get(rule.contractId) ?? [];
    list.push(rule);
    pricingByContract.set(rule.contractId, list);
  }
  const contractOrderCountByContract = new Map<string, number>();
  for (const o of contractOrderRows) {
    if (!o.contractId) continue;
    contractOrderCountByContract.set(o.contractId, (contractOrderCountByContract.get(o.contractId) ?? 0) + 1);
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
      pendingOrderCount: contractOrderCountByContract.get(contract.id) ?? 0,
    };
  });

  const capacitySizes = [18000, 21000, 28000] as const;
  const capacity = [
    ...capacitySizes.map((size) => {
      const matching = vehicleRows.filter((v) => v.capacityLiters === size);
      return { size, total: matching.length, available: matching.filter((v) => v.status === "AVAILABLE").length };
    }),
    (() => {
      const other = vehicleRows.filter((v) => v.capacityLiters == null || !capacitySizes.includes(v.capacityLiters as any));
      return { size: "OTHER" as const, total: other.length, available: other.filter((v) => v.status === "AVAILABLE").length };
    })(),
  ];
  const driversAvailable = driverRows.filter((d) => d.status === "AVAILABLE").length;

  return NextResponse.json({
    contracts: result,
    capacity: { byTankerSize: capacity, driversAvailable, driversTotal: driverRows.length },
    demand: { contractLinkedPending: contractOrderRows.length, nonContractPending: nonContractOrderRows.length },
  });
}
