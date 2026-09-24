/**
 * GET /api/contracts/eligible
 * Returns ACTIVE contracts for a customer that are commercially usable today.
 * Used by Dispatch to populate the contract selector.
 */
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { contracts, contractPricingRules } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, and, or, isNull, lte, gte } from "drizzle-orm";
import { checkPermission, PERMISSIONS } from "@/lib/requirePermission";

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (false) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;
  const _permDeny1 = await checkPermission(session, tenantId, PERMISSIONS.CONTRACTS_VIEW);
  if (_permDeny1) return _permDeny1;
  const _permDeny2 = await checkPermission(session, tenantId, PERMISSIONS.CONTRACTS_VIEW); if (_permDeny2) return _permDeny2;

  const { searchParams } = new URL(req.url);
  const customerId = searchParams.get("customerId");
  const locationId = searchParams.get("locationId");

  if (!customerId) {
    return NextResponse.json({ error: "customerId is required" }, { status: 400 });
  }

  const today = new Date();

  const candidates = await db.query.contracts.findMany({
    where: and(
      eq(contracts.tenantId, tenantId),
      eq(contracts.customerId, customerId),
      eq(contracts.status, "ACTIVE"),
      lte(contracts.startDate, today),
      or(isNull(contracts.endDate), gte(contracts.endDate, today))
    ),
    with: { siteScope: { columns: { customerLocationId: true } } },
    columns: {
      id: true, contractNumber: true, type: true, status: true,
      appliesToAllSites: true, startDate: true, endDate: true,
      totalTripsPurchased: true, tripsUsed: true,
    },
  });

  // Filter by site scope if locationId was provided
  const eligible = candidates.filter((c) => {
    if (c.appliesToAllSites) return true;
    if (!locationId) return true;
    return (c.siteScope as any[]).some((s: any) => s.customerLocationId === locationId);
  });

  // Enrich with pricing capacities
  const enriched = await Promise.all(
    eligible.map(async (c) => {
      const rules = await db.query.contractPricingRules.findMany({
        where: and(eq(contractPricingRules.contractId, c.id), eq(contractPricingRules.tenantId, tenantId)),
        columns: { tankerCapacityLtr: true, rateType: true },
      });
      const uniqueCapacities = [
        ...new Set(rules.map((r) => r.tankerCapacityLtr).filter((cap): cap is number => cap != null)),
      ];
      return { ...c, siteScope: undefined, eligibleTankerCapacities: uniqueCapacities, hasPricingRules: rules.length > 0 };
    })
  );

  return NextResponse.json(enriched.filter((c) => c.hasPricingRules));
}
