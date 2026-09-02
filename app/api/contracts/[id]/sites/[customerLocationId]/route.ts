export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { contracts, contractSiteScope } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, and } from "drizzle-orm";

// Removes one site from a contract's scope. This only deletes the
// contract_site_scope row (the assignment) — the customerLocation itself
// is never touched, since it's the customer's own site record, not
// something owned by this contract.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; customerLocationId: string }> }
) {
  const { id, customerLocationId } = await params;
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;

  const contract = await db.query.contracts.findFirst({ where: and(eq(contracts.id, id), eq(contracts.tenantId, tenantId)) });
  if (!contract) return NextResponse.json({ error: "Contract not found" }, { status: 404 });

  const scope = await db.query.contractSiteScope.findFirst({
    where: and(eq(contractSiteScope.contractId, id), eq(contractSiteScope.customerLocationId, customerLocationId)),
  });
  if (!scope) return NextResponse.json({ error: "This site is not assigned to this contract" }, { status: 404 });

  await db.delete(contractSiteScope).where(eq(contractSiteScope.id, scope.id));

  return NextResponse.json({ success: true });
}
