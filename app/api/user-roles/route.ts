export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { roles, userRoles, users } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { enforceRbac } from "@/lib/enforceRbac";
import { ensureSystemRoles } from "@/lib/rbac";
import { genId } from "@/lib/helpers";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !hasRole(session, ["ADMIN"])) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = getSessionTenantId(session)!;
  await ensureSystemRoles();
  const _deny = await enforceRbac(session, tenantId, "users"); if (_deny) return _deny;
  const tenantUsers = await db.query.users.findMany({ where: eq(users.tenantId, tenantId) });
  const urs = await db.query.userRoles.findMany({ where: eq(userRoles.tenantId, tenantId), with: { role: true } });
  return NextResponse.json({ users: tenantUsers, userRoles: urs });
}

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !hasRole(session, ["ADMIN"])) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = getSessionTenantId(session)!;
  const body = await req.json();
  const parsed = z.object({ userId: z.string().min(1), roleId: z.string().min(1) }).safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const user = await db.query.users.findFirst({ where: and(eq(users.id, parsed.data.userId), eq(users.tenantId, tenantId)) });
  if (!user) return NextResponse.json({ error: "User not found in this tenant" }, { status: 404 });
  await db.insert(userRoles).values({ id: genId(), userId: parsed.data.userId, roleId: parsed.data.roleId, tenantId }).onConflictDoNothing();
  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !hasRole(session, ["ADMIN"])) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = getSessionTenantId(session)!;
  const { userId, roleId } = await req.json();
  await db.delete(userRoles).where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, roleId), eq(userRoles.tenantId, tenantId)));
  return NextResponse.json({ ok: true });
}
