export const dynamic = "force-dynamic";
import { checkPermission, PERMISSIONS } from "@/lib/requirePermission";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { userRoles, roles, roleAuditLog, users } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, and, or, isNull } from "drizzle-orm";
import { genId } from "@/lib/helpers";
import { z } from "zod";
import { checkTenantAdminPermission } from "@/lib/requirePermission";

async function authorize(session: any, tenantId: string): Promise<NextResponse | null> {
  if (hasRole(session, ["ADMIN"])) return null;
  return checkTenantAdminPermission(session, tenantId, "users.manage");
}

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  {
    const _cpTenantId = getSessionTenantId(session);
    if (!_cpTenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { hasRole: _hR } = await import("@/lib/auth");
    if (!_hR(session, ["ADMIN"])) {
      const _d = await checkPermission(session, _cpTenantId, PERMISSIONS.ROLES_VIEW);
      if (_d) return _d;
    }
  }
  const tenantId = getSessionTenantId(session)!;
  const deny = await authorize(session, tenantId);
  if (deny) return deny;
  const assignments = await db.query.userRoles.findMany({
    where: eq(userRoles.tenantId, tenantId),
    with: { role: true, user: { columns: { id: true, name: true, email: true, role: true } } },
  });
  return NextResponse.json({ assignments });
}

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  {
    const _cpTenantId = getSessionTenantId(session);
    if (!_cpTenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { hasRole: _hR } = await import("@/lib/auth");
    if (!_hR(session, ["ADMIN"])) {
      const _d = await checkPermission(session, _cpTenantId, PERMISSIONS.ROLES_MANAGE);
      if (_d) return _d;
    }
  }
  const tenantId = getSessionTenantId(session)!;
  const deny = await authorize(session, tenantId);
  if (deny) return deny;
  const actorId = (session as any).user?.id;

  const body = z.object({ userId: z.string().min(1), roleId: z.string().min(1) }).safeParse(await req.json().catch(() => ({})));
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  const { userId, roleId } = body.data;

  // BLOCKER 7: Verify target user belongs to authenticated tenant:
  const targetUser = await db.query.users.findFirst({ where: eq(users.id, userId), columns: { id: true, tenantId: true } });
  if (!targetUser) return NextResponse.json({ error: "User not found" }, { status: 404 });
  if (targetUser.tenantId !== tenantId) return NextResponse.json({ error: "User not found" }, { status: 404 }); // non-enumerating

  // Validate role is accessible to this tenant (own or system role):
  const role = await db.query.roles.findFirst({ where: and(eq(roles.id, roleId), or(eq(roles.tenantId, tenantId), isNull(roles.tenantId))) });
  if (!role) return NextResponse.json({ error: "Role not found or not accessible" }, { status: 404 });
  if (!role.isActive) return NextResponse.json({ error: "Role is deactivated", errorCode: "ROLE_DEACTIVATED" }, { status: 422 });

  // BLOCKER 6 / BLOCKER 8: Block assignment of platform-only roles (isSystemRole can be assigned but not ADMIN-equivalent ones):
  // The ADMIN system role is a platform identity — never assign via user-roles API:
  if (role.name === "ADMIN" || role.name === "PLATFORM_ADMIN") {
    return NextResponse.json({ error: "Platform Admin cannot be assigned through the role management API", errorCode: "PLATFORM_ROLE_DENIED" }, { status: 403 });
  }

  // Check not already assigned:
  const existing = await db.query.userRoles.findFirst({ where: and(eq(userRoles.userId, userId), eq(userRoles.roleId, roleId), eq(userRoles.tenantId, tenantId)) });
  if (existing) return NextResponse.json({ error: "User already has this role", userRoleId: existing.id }, { status: 409 });

  const id = genId();
  await db.insert(userRoles).values({ id, userId, roleId, tenantId, assignedAt: new Date(), assignedBy: actorId });
  await db.insert(roleAuditLog).values({ id: genId(), tenantId, actorId, action: "user.assigned", targetType: "user_role", targetId: id, targetLabel: `${userId} → ${role.label}` });
  return NextResponse.json({ ok: true, userRoleId: id }, { status: 201 });
}
