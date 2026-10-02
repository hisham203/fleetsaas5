export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, getSessionTenantId } from "@/lib/auth";
import { checkPermission, PERMISSIONS } from "@/lib/requirePermission";
import { parseDateRange, getDriverAnalytics } from "@/lib/analyticsMetrics";

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = getSessionTenantId(session);
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const deny = await checkPermission(session, tenantId, PERMISSIONS.REPORTS_OPERATIONS_VIEW);
  if (deny) return deny;

  const url = new URL(req.url);
  const range = parseDateRange(url.searchParams.get("from"), url.searchParams.get("to"));
  const driverRows = await getDriverAnalytics(tenantId, range);
  return NextResponse.json({ period: { from: range.from.toISOString(), to: range.to.toISOString() }, drivers: driverRows });
}
