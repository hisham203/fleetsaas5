export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { enforceRbac } from "@/lib/enforceRbac";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { syncAllUnsyncedInvoices } from "@/lib/erp/sync";

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;
  const _deny = await enforceRbac(session, tenantId, "settings"); if (_deny) return _deny;

  const result = await syncAllUnsyncedInvoices(tenantId);
  return NextResponse.json(result);
}
