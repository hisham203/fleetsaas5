export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { enforceRbac } from "@/lib/enforceRbac";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { syncInvoiceToOdoo } from "@/lib/erp/sync";

export async function POST(req: NextRequest, { params }: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = await params;
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;
  const _deny = await enforceRbac(session, tenantId, "settings"); if (_deny) return _deny;

  const result = await syncInvoiceToOdoo(tenantId, invoiceId);
  return NextResponse.json(result, { status: result.success ? 200 : 422 });
}
