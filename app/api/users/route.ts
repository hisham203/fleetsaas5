export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { genId } from "@/lib/helpers";
import { hashPassword, getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";
import { checkPermission, checkTenantAdminPermission, PERMISSIONS } from "@/lib/requirePermission";

const createSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
  role: z.enum(["ADMIN", "DISPATCHER", "DRIVER"]),
});

function toSafeUser<T extends { passwordHash?: string | null }>(u: T) {
  const { passwordHash, ...safe } = u;
  return safe;
}

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN"])) {
    const tenantId_rbac = getSessionTenantId(session);
    if (!tenantId_rbac) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const _rbacDeny = await checkTenantAdminPermission(session, tenantId_rbac, "users.view");
    if (_rbacDeny) return _rbacDeny;
  }
  const tenantId = getSessionTenantId(session)!;
  const _permDeny1 = await checkPermission(session, tenantId, PERMISSIONS.USERS_VIEW); if (_permDeny1) return _permDeny1;

  const role = req.nextUrl.searchParams.get("role");
  const conditions = [eq(users.tenantId, tenantId), role ? eq(users.role, role) : undefined].filter(Boolean) as any[];

  const rows = await db.query.users.findMany({
    where: and(...conditions),
    with: { driverProfile: true, userRoles: { with: { role: true } } },
    orderBy: desc(users.createdAt),
  });
  return NextResponse.json(rows.map(toSafeUser));
}

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN"])) {
    const tenantId_rbac = getSessionTenantId(session);
    if (!tenantId_rbac) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const _rbacDeny = await checkTenantAdminPermission(session, tenantId_rbac, "users.manage");
    if (_rbacDeny) return _rbacDeny;
  }
  const tenantId = getSessionTenantId(session)!;

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const id = genId();
  const passwordHash = await hashPassword(parsed.data.password);
  // Privilege escalation guard: Tenant users with users.manage cannot create ADMIN accounts.
  // role="ADMIN" bypasses all checkPermission() checks — only Platform Admin may provision it.
  if (parsed.data.role === "ADMIN") {
    const { hasRole: _hasRole } = await import("@/lib/auth");
    if (!_hasRole(session, ["ADMIN"])) {
      return NextResponse.json({ error: "Only Platform Admin can provision ADMIN accounts", errorCode: "PLATFORM_ROLE_DENIED" }, { status: 403 });
    }
  }

  await db.insert(users).values({
    id,
    tenantId,
    name: parsed.data.name,
    email: parsed.data.email,
    role: parsed.data.role,
    passwordHash,
  });
  const created = await db.query.users.findFirst({ where: eq(users.id, id) });
  return NextResponse.json(created ? toSafeUser(created) : null, { status: 201 });
}
