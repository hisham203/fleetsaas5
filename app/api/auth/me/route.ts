export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, getSessionTenantId } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { drivers } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  if (session.type === "USER") {
    let driverProfileId: string | null = null;
    if (session.user.role === "DRIVER") {
      const profile = await db.query.drivers.findFirst({ where: eq(drivers.userId, session.user.id) });
      driverProfileId = profile?.id ?? null;
    }
    return NextResponse.json({
      type: "USER",
      id: session.user.id,
      tenantId: session.user.tenantId, // this user's home tenant — always their own, never the switched-into one
      effectiveTenantId: getSessionTenantId(session), // the tenant currently being viewed/operated on (Company Switcher)
      isPlatformAdmin: session.user.isPlatformAdmin,
      name: session.user.name,
      email: session.user.email,
      role: session.user.role,
      driverProfileId,
    });
  }

  return NextResponse.json({
    type: "CUSTOMER",
    id: session.customer.id,
    tenantId: session.customer.tenantId,
    name: session.customer.name,
    email: session.customer.loginEmail,
    role: "CUSTOMER",
  });
}
