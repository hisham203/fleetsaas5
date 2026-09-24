export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { roles, roleAuditLog } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, and, or, isNull } from "drizzle-orm";
import { genId } from "@/lib/helpers";
import { z } from "zod";
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
    with: { rolePermissions: { with: { permission: true } }, userRoles: { with: { user: { columns: { id: true, name: true, email: true, role: true } } } } },
  });
  if (!role) return NextResponse.json({ error: "Role not found" }, { status: 404 });
  return NextResponse.json({ role });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN"])) {
    const tenantId_rbac = getSessionTenantId(session);
    if (!tenantId_rbac) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const _rbacDeny = await checkTenantAdminPermission(session, tenantId_rbac, "roles.manage");
    if (_rbacDeny) return _rbacDeny;
  }
  const tenantId = getSessionTenantId(session)!;
  const userId = (session as any).user?.id;
  const { id } = await params;
  const role = await db.query.roles.findFirst({ where: and(eq(roles.id, id), eq(roles.tenantId, tenantId)) });
  if (!role) return NextResponse.json({ error: "Role not found or not tenant-owned" }, { status: 404 });
  const body = z.object({
    label: z.string().min(1).max(100).optional(),
    description: z.string().optional(),
    isActive: z.boolean().optional(),
  }).safeParse(await req.json().catch(() => ({})));
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  const updates: any = {};
  if (body.data.label !== undefined) updates.label = body.data.label;
  if (body.data.description !== undefined) updates.description = body.data.description;
  if (body.data.isActive !== undefined) updates.isActive = body.data.isActive;
  await db.update(roles).set(updates).where(eq(roles.id, id));
  const action = updates.isActive === false ? "role.deactivated" : updates.isActive === true ? "role.activated" : "role.edited";
  await db.insert(roleAuditLog).values({ id: genId(), tenantId, actorId: userId, action, targetType: "role", targetId: id, targetLabel: role.label, detail: JSON.stringify(updates) });
  const updated = await db.query.roles.findFirst({ where: eq(roles.id, id), with: { rolePermissions: { with: { permission: true } } } });
  return NextResponse.json({ role: updated });
}
