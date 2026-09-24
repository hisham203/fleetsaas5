export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { getEffectivePermissions } from "@/lib/permissions";
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN"])) {
    const _epTenantId = getSessionTenantId(session);
    if (!_epTenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { checkTenantAdminPermission: _ctap } = await import("@/lib/requirePermission");
    const _epDeny = await _ctap(session, _epTenantId, "users.view");
    if (_epDeny) return _epDeny;
    // Cross-tenant protection: Tenant Admin can only view users in their own tenant:
    const targetUserId = (await params).id;
    const { db: _db } = await import("@/lib/db/client");
    const { users: _users } = await import("@/lib/db/schema");
    const { eq: _eq, and: _and } = await import("drizzle-orm");
    const _target = await _db.query.users.findFirst({ where: _and(_eq(_users.id, targetUserId), _eq(_users.tenantId, _epTenantId)) });
    if (!_target) return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const tenantId = getSessionTenantId(session)!;
  const { id } = await params;
  const effective = await getEffectivePermissions(id, tenantId);
  return NextResponse.json({ userId: id, permissions: [...effective], count: effective.size });
}
