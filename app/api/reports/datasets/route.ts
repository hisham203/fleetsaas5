export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { DATASETS } from "@/lib/reportDatasets";
import { checkPermission, PERMISSIONS } from "@/lib/requirePermission";

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = getSessionTenantId(session)!;
  // DRIVER sessions: datasets list is for report-building staff, not drivers:
  if ((session as any)?.user?.role === "DRIVER") {
    return NextResponse.json({ error: "Unauthorized", errorCode: "PERMISSION_DENIED" }, { status: 403 });
  }
  const _permDeny1 = await checkPermission(session, tenantId, PERMISSIONS.TRIPS_VIEW); if (_permDeny1) return _permDeny1;
  return NextResponse.json(Object.values(DATASETS));
}
