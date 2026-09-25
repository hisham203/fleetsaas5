export const dynamic = "force-dynamic";
/**
 * P2-02: Tanker sizes a B2C Direct Order can request.
 *
 * The distinct tanker capacities that actually exist in this tenant's fleet
 * (with how many tankers of each size, and how many are currently AVAILABLE).
 * Not a tariff — B2C direct-order pricing is unchanged (see POST /api/orders).
 *
 * Response: { capacities: { capacityLiters, tankers, available }[] }
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { vehicles } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getSessionFromRequest, getSessionTenantId } from "@/lib/auth";
import { checkPermission, PERMISSIONS } from "@/lib/requirePermission";

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = getSessionTenantId(session);
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const _deny = await checkPermission(session, tenantId, PERMISSIONS.ORDERS_CREATE);
  if (_deny) return _deny;
  const fleet = await db.query.vehicles.findMany({ where: eq(vehicles.tenantId, tenantId), columns: { capacityLiters: true, status: true } });
  const byCap = new Map<number, { capacityLiters: number; tankers: number; available: number }>();
  for (const v of fleet) {
    if (v.capacityLiters == null) continue;
    const row = byCap.get(v.capacityLiters) ?? { capacityLiters: v.capacityLiters, tankers: 0, available: 0 };
    row.tankers++;
    if (v.status === "AVAILABLE") row.available++;
    byCap.set(v.capacityLiters, row);
  }
  return NextResponse.json({ capacities: [...byCap.values()].sort((a, b) => a.capacityLiters - b.capacityLiters) });
}
