export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { roles, roleAuditLog } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, or, isNull, and } from "drizzle-orm";
import { genId } from "@/lib/helpers";
import { z } from "zod";
import { checkPermission, checkTenantAdminPermission, PERMISSIONS } from "@/lib/requirePermission";

async function authorizeTenantRbacAdmin(session: any, tenantId: string): Promise<NextResponse | null> {
  // Allow Platform Admin (ADMIN role) OR tenant user with roles.view/roles.manage:
  if (hasRole(session, ["ADMIN"])) return null;
  return checkTenantAdminPermission(session, tenantId, "roles.view");
}
async function authorizeTenantRbacWrite(session: any, tenantId: string): Promise<NextResponse | null> {
  if (hasRole(session, ["ADMIN"])) return null;
  return checkTenantAdminPermission(session, tenantId, "roles.manage");
}

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const tenantId = getSessionTenantId(session);
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const deny = await authorizeTenantRbacAdmin(session, tenantId);
  if (deny) return deny;

  const roleRows = await db.query.roles.findMany({
    where: or(eq(roles.tenantId, tenantId), isNull(roles.tenantId)),
    with: { rolePermissions: { with: { permission: true } }, userRoles: true },
    orderBy: (t, { asc }) => [asc(t.name)],
  });
  return NextResponse.json({ roles: roleRows });
}

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const tenantId = getSessionTenantId(session);
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const deny = await authorizeTenantRbacWrite(session, tenantId);
  if (deny) return deny;

  const body = z.object({
    name: z.string().min(1).max(100).regex(/^[A-Z0-9_]+$/, "Must be UPPER_SNAKE_CASE"),
    label: z.string().min(1).max(100),
    description: z.string().optional(),
  }).safeParse(await req.json().catch(() => ({})));
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });

  const existing = await db.query.roles.findFirst({ where: and(eq(roles.name, body.data.name), eq(roles.tenantId, tenantId)) });
  if (existing) return NextResponse.json({ error: "A role with this name already exists in your tenant", errorCode: "ROLE_DUPLICATE" }, { status: 409 });

  const id = genId(); const actorId = (session as any).user?.id;
  await db.insert(roles).values({ id, tenantId, name: body.data.name, label: body.data.label, description: body.data.description ?? null, isSystemRole: false, isActive: true });
  await db.insert(roleAuditLog).values({ id: genId(), tenantId, actorId, action: "role.created", targetType: "role", targetId: id, targetLabel: body.data.label });
  const created = await db.query.roles.findFirst({ where: eq(roles.id, id), with: { rolePermissions: { with: { permission: true } } } });
  return NextResponse.json({ role: created }, { status: 201 });
}
