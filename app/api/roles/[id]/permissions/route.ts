export const dynamic = "force-dynamic";
/**
 * Role permission management — full replace semantics.
 * PUT replaces all permissions for the role (declarative, idempotent).
 * GET returns current permission set for the role.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { roles, permissions, rolePermissions, roleAuditLog } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, and, or, isNull, inArray } from "drizzle-orm";
import { genId } from "@/lib/helpers";
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
  const role = await db.query.roles.findFirst({
    where: and(eq(roles.id, id), or(eq(roles.tenantId, tenantId), isNull(roles.tenantId))),
    with: { rolePermissions: { with: { permission: true } } },
  });
  if (!role) return NextResponse.json({ error: "Role not found" }, { status: 404 });
  return NextResponse.json({ roleId: id, permissions: role.rolePermissions.map(rp => rp.permission) });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN"])) {
    const tenantId_rbac = getSessionTenantId(session);
    if (!tenantId_rbac) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const _rbacDeny = await checkTenantAdminPermission(session, tenantId_rbac, "roles.manage");
    if (_rbacDeny) return _rbacDeny;
  }
  const tenantId = getSessionTenantId(session)!;
  const userId = (session as any).user?.id;
  const { id: roleId } = await params;

  const role = await db.query.roles.findFirst({ where: and(eq(roles.id, roleId), eq(roles.tenantId, tenantId)) });
  if (!role) return NextResponse.json({ error: "Role not found or not tenant-owned" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const codes: string[] = Array.isArray(body?.permissionCodes) ? body.permissionCodes : [];

  // Resolve permission IDs from codes:
  const allPerms = await db.query.permissions.findMany();
  const permByCode = new Map(allPerms.map(p => [p.code, p]));
  const permIds = codes.map(c => permByCode.get(c)?.id).filter(Boolean) as string[];

  // Delete all existing role permissions, then re-insert:
  await db.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
  if (permIds.length > 0) {
    await db.insert(rolePermissions).values(permIds.map(permId => ({
      id: genId(), roleId, permissionId: permId, grantedAt: new Date(), grantedBy: userId,
    })));
  }

  await db.insert(roleAuditLog).values({ id: genId(), tenantId, actorId: userId,
    action: "permissions.replaced", targetType: "role", targetId: roleId, targetLabel: role.label,
    detail: JSON.stringify({ permissionCount: permIds.length, codes }),
  });

  const updated = await db.query.roles.findFirst({ where: eq(roles.id, roleId), with: { rolePermissions: { with: { permission: true } } } });
  return NextResponse.json({ ok: true, role: updated });
}
