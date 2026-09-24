export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { userRoles, roleAuditLog } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, and } from "drizzle-orm";
import { genId } from "@/lib/helpers";
import { checkTenantAdminPermission } from "@/lib/requirePermission";
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId_rbac = getSessionTenantId(session);
  if (!tenantId_rbac) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasRole(session, ["ADMIN"])) {
    const _rbacDeny = await checkTenantAdminPermission(session, tenantId_rbac, "users.manage");
    if (_rbacDeny) return _rbacDeny;
  }
  const tenantId = getSessionTenantId(session)!;
  const actorId = (session as any).user?.id;
  const { id } = await params;
  const ur = await db.query.userRoles.findFirst({ where: and(eq(userRoles.id, id), eq(userRoles.tenantId, tenantId)) });
  if (!ur) return NextResponse.json({ error: "Assignment not found" }, { status: 404 });
  await db.delete(userRoles).where(eq(userRoles.id, id));
  await db.insert(roleAuditLog).values({ id: genId(), tenantId, actorId, action: "user.removed", targetType: "user_role", targetId: id, targetLabel: `${ur.userId} removed from role ${ur.roleId}` });
  return NextResponse.json({ ok: true });
}
