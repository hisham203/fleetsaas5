export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { maintenanceInventoryBalances } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, and } from "drizzle-orm";

// Milestone Z.1 — schema-only foundation. Read-only. No stock-posting
// logic exists anywhere yet — this route only ever reflects what's
// already in the table (nothing, today).
export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;
  const warehouseId = req.nextUrl.searchParams.get("warehouseId");
  const itemId = req.nextUrl.searchParams.get("itemId");

  const conditions = [
    eq(maintenanceInventoryBalances.tenantId, tenantId),
    warehouseId ? eq(maintenanceInventoryBalances.warehouseId, warehouseId) : undefined,
    itemId ? eq(maintenanceInventoryBalances.itemId, itemId) : undefined,
  ].filter(Boolean) as any[];
  const rows = await db.query.maintenanceInventoryBalances.findMany({ where: and(...conditions) });
  return NextResponse.json(rows);
}
