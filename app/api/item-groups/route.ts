export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { itemGroups } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, and } from "drizzle-orm";

// Milestone Z.1 — schema-only foundation. Read-only: no POST/PATCH/
// DELETE exists for this or any Z.1 table yet. Returns [] for every
// tenant today, since the table is genuinely empty everywhere — never
// fabricated data.
export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;
  const status = req.nextUrl.searchParams.get("status");

  const conditions = [eq(itemGroups.tenantId, tenantId), status ? eq(itemGroups.status, status) : undefined].filter(Boolean) as any[];
  const rows = await db.query.itemGroups.findMany({ where: and(...conditions) });
  return NextResponse.json(rows);
}
