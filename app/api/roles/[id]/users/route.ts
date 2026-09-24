export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { roles, userRoles } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, and, or, isNull } from "drizzle-orm";
import { checkTenantAdminPermission } from "@/lib/requirePermission";
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId_rbac = getSessionTenantId(session);
  if (!tenantId_rbac) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasRole(session, ["ADMIN"])) {
    const _rbacDeny = await checkTenantAdminPermission(session, tenantId_rbac, "roles.view");
    if (_rbacDeny) return _rbacDeny;
  }
  const tenantId = getSessionTenantId(session)!;
  const { id } = await params;
  const role = await db.query.roles.findFirst({ where: and(eq(roles.id, id), or(eq(roles.tenantId, tenantId), isNull(roles.tenantId))) });
  if (!role) return NextResponse.json({ error: "Role not found" }, { status: 404 });
  const assignments = await db.query.userRoles.findMany({ where: and(eq(userRoles.roleId, id), eq(userRoles.tenantId, tenantId)), with: { user: { columns: { id: true, name: true, email: true, role: true } } } });
  return NextResponse.json({ roleId: id, users: assignments.map(ur => ({ ...ur.user, assignedAt: ur.assignedAt })) });
}
