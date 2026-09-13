export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { enforceRbac } from "@/lib/enforceRbac";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { EVENT_TYPES } from "@/lib/automation";

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;
  const _deny = await enforceRbac(session, tenantId, "control_tower"); if (_deny) return _deny;
  return NextResponse.json(Object.values(EVENT_TYPES));
}
