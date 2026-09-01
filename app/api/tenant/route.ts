export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { tenants, users } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq } from "drizzle-orm";

// Returns the tenant belonging to the CURRENT SESSION — never "the first
// tenant" — since with multiple tenants that would leak one company's data
// to another company's users. See lib/auth.ts getSessionTenantId.
export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN", "DISPATCHER", "DRIVER", "CUSTOMER"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tenantId = getSessionTenantId(session)!;
  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
  if (!tenant) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }

  if (session!.type === "CUSTOMER") {
    return NextResponse.json(tenant);
  }

  const tenantUsers = await db.query.users.findMany({ where: eq(users.tenantId, tenant.id) });
  return NextResponse.json({ ...tenant, users: tenantUsers });
}
