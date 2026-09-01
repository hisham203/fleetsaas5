export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { getExecutiveDashboard } from "@/lib/executiveDashboard";

// APP-07: Executive Dashboard. The BRD's named audience (CEO, COO, CFO,
// Operations Director, Fleet Director) doesn't map to a distinct role in
// this app's auth model — ADMIN is the closest fit (same mapping used for
// other sensitive areas like ERP connections), so this is ADMIN-only, not
// available to DISPATCHER.
export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;

  const from = req.nextUrl.searchParams.get("from") ?? undefined;
  const to = req.nextUrl.searchParams.get("to") ?? undefined;

  const dashboard = await getExecutiveDashboard(tenantId, from, to);
  return NextResponse.json(dashboard);
}
