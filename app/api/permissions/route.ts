export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { permissions } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId} from "@/lib/auth";
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
  const allPerms = await db.query.permissions.findMany({ orderBy: (t, { asc }) => [asc(t.category), asc(t.module), asc(t.action)] });
  // Group by category:
  const grouped: Record<string, typeof allPerms> = {};
  for (const p of allPerms) {
    const cat = p.category ?? "OTHER";
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(p);
  }
  return NextResponse.json({ permissions: allPerms, grouped, total: allPerms.length });
}
