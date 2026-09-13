export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { roles, permissions, rolePermissions, userRoles } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { enforceRbac } from "@/lib/enforceRbac";
import { ensureSystemRoles } from "@/lib/rbac";
import { genId } from "@/lib/helpers";
import { eq, and } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !hasRole(session, ["ADMIN"])) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await ensureSystemRoles();
  const tenantId = getSessionTenantId(session)!;
  const _deny = await enforceRbac(session, tenantId, "users"); if (_deny) return _deny;
  const rows = await db.query.roles.findMany({ with: { rolePermissions: { with: { permission: true } } } });
  const allPerms = await db.query.permissions.findMany();
  return NextResponse.json({ roles: rows, permissions: allPerms });
}
