export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { numberingSequenceLedger } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, and } from "drizzle-orm";

// Milestone AD — schema-only foundation. Read-only. No allocator exists
// yet, so this table is genuinely empty for every tenant today.
export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;
  const entityType = req.nextUrl.searchParams.get("entityType");
  const seriesId = req.nextUrl.searchParams.get("seriesId");

  const conditions = [
    eq(numberingSequenceLedger.tenantId, tenantId),
    entityType ? eq(numberingSequenceLedger.entityType, entityType) : undefined,
    seriesId ? eq(numberingSequenceLedger.seriesId, seriesId) : undefined,
  ].filter(Boolean) as any[];
  const rows = await db.query.numberingSequenceLedger.findMany({ where: and(...conditions) });
  return NextResponse.json(rows);
}
