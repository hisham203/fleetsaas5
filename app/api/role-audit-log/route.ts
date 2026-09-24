export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { roleAuditLog } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, and, desc } from "drizzle-orm";
import { checkTenantAdminPermission } from "@/lib/requirePermission";
export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId_rbac = getSessionTenantId(session);
  if (!tenantId_rbac) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasRole(session, ["ADMIN"])) {
    const _rbacDeny = await checkTenantAdminPermission(session, tenantId_rbac, "roles.view");
    if (_rbacDeny) return _rbacDeny;
  }
  const tenantId = getSessionTenantId(session)!;
  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 200);
  const rows = await db.query.roleAuditLog.findMany({
    where: eq(roleAuditLog.tenantId, tenantId),
    orderBy: [desc(roleAuditLog.createdAt)],
    limit,
  });
  return NextResponse.json({ log: rows });
}
