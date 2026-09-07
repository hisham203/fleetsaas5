export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { numberingSeries } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, and } from "drizzle-orm";

// Milestone AD — schema-only foundation. Read-only: no POST/PATCH
// exists yet, and no series is ever created automatically. Returns []
// for every tenant today, since the table is genuinely empty
// everywhere — never fabricated data.
export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;
  const status = req.nextUrl.searchParams.get("status");

  const conditions = [eq(numberingSeries.tenantId, tenantId), status ? eq(numberingSeries.status, status) : undefined].filter(Boolean) as any[];
  const rows = await db.query.numberingSeries.findMany({ where: and(...conditions) });
  return NextResponse.json(rows);
}
