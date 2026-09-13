export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { enforceRbac } from "@/lib/enforceRbac";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { DATASETS } from "@/lib/reportDatasets";

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN", "DISPATCHER"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;
  const _deny = await enforceRbac(session, tenantId, "reports"); if (_deny) return _deny;
  return NextResponse.json(Object.values(DATASETS));
}
