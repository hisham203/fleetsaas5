export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { itemSubcategories } from "@/lib/db/schema";
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

  const conditions = [eq(itemSubcategories.tenantId, tenantId), categoryId ? eq(itemSubcategories.categoryId, categoryId) : undefined].filter(Boolean) as any[];
  const rows = await db.query.itemSubcategories.findMany({ where: and(...conditions) });
  return NextResponse.json(rows);
}
