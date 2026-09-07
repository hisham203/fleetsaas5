export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { maintenanceInventoryMovements } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, and } from "drizzle-orm";

// Milestone Z.1 — schema-only foundation. Read-only. No movement can be
// created yet (no POST route exists) — this always reflects the truly
// empty table today.
export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;
  const warehouseId = req.nextUrl.searchParams.get("warehouseId");
  const itemId = req.nextUrl.searchParams.get("itemId");

  const conditions = [
    eq(maintenanceInventoryMovements.tenantId, tenantId),
    warehouseId ? eq(maintenanceInventoryMovements.warehouseId, warehouseId) : undefined,
    itemId ? eq(maintenanceInventoryMovements.itemId, itemId) : undefined,
  ].filter(Boolean) as any[];
  const rows = await db.query.maintenanceInventoryMovements.findMany({ where: and(...conditions) });
  return NextResponse.json(rows);
}
