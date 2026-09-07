export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { items } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, and } from "drizzle-orm";

// Milestone Z.1 — schema-only foundation. Read-only.
export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;
  const categoryId = req.nextUrl.searchParams.get("categoryId");
  const status = req.nextUrl.searchParams.get("status");

  const conditions = [
    eq(items.tenantId, tenantId),
    categoryId ? eq(items.categoryId, categoryId) : undefined,
    status ? eq(items.status, status) : undefined,
  ].filter(Boolean) as any[];
  const rows = await db.query.items.findMany({ where: and(...conditions) });
  return NextResponse.json(rows);
}
