// RC1 — Module-level RBAC enforcement helper for API routes.
// Usage: const deny = await enforceRbac(session, tenantId, "procurement");
//        if (deny) return deny;

import { NextResponse } from "next/server";
import { canAccess, type Module } from "./rbac";
import type { Session } from "./auth";

export async function enforceRbac(
  session: Session | null,
  tenantId: string | null,
  module: Module
): Promise<NextResponse | null> {
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!tenantId) return NextResponse.json({ error: "Tenant context missing" }, { status: 401 });
  if (session.type !== "USER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const allowed = await canAccess(session.user.id, tenantId, module);
  if (!allowed) return NextResponse.json({ error: "Access denied: insufficient permissions for module: " + module }, { status: 403 });
  return null; // access granted
}
