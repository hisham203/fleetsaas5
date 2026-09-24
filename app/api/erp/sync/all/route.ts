export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { syncAllUnsyncedInvoices } from "@/lib/erp/sync";
import { checkPermission, PERMISSIONS } from "@/lib/requirePermission";

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = getSessionTenantId(session)!;
  const _permDeny1 = await checkPermission(session, tenantId, PERMISSIONS.ROLES_VIEW); if (_permDeny1) return _permDeny1;

  const result = await syncAllUnsyncedInvoices(tenantId);
  return NextResponse.json(result);
}
