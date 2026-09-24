export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { getDriverEligibility } from "@/lib/dispatchEligibility";
import { checkPermission, PERMISSIONS } from "@/lib/requirePermission";
export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = getSessionTenantId(session)!;
  const _deny = await checkPermission(session, tenantId, PERMISSIONS.TRIPS_ASSIGN);
  if (_deny) return _deny;
  const results = await getDriverEligibility(tenantId);
  return NextResponse.json({ results, eligibleCount: results.filter(r => r.eligible).length });
}
