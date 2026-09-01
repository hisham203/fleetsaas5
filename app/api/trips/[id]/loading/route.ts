export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { trips, inventoryItems } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, and } from "drizzle-orm";

const FULL_BOTTLE_ITEM = "19L Bottle - Full";

// BR-09: Warehouse, Loading & Inventory Operations — the warehouse confirms
// loading for a PLANNED trip, which deducts the required stock from that
// trip's specific warehouse and unblocks dispatch. "Do not release the trip
// before loading confirmation" is enforced here and in the trip dispatch
// action.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN", "DISPATCHER"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;

  const trip = await db.query.trips.findFirst({
    where: and(eq(trips.id, id), eq(trips.tenantId, tenantId)),
    with: { stops: { with: { order: true } } },
  });
  if (!trip) return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  if (trip.status !== "PLANNED") {
    return NextResponse.json({ error: "Only PLANNED trips can be loaded" }, { status: 422 });
  }
  if (trip.loadingConfirmed) {
    return NextResponse.json({ error: "Loading already confirmed for this trip" }, { status: 422 });
  }

  const totalNeeded = trip.stops.reduce((sum, s) => sum + s.order.qtyOrdered, 0);

  const stockItem = await db.query.inventoryItems.findFirst({
    where: and(eq(inventoryItems.warehouseId, trip.warehouseId), eq(inventoryItems.itemName, FULL_BOTTLE_ITEM)),
  });
  const available = stockItem?.quantity ?? 0;

  if (available < totalNeeded) {
    return NextResponse.json(
      { error: `Shortage: trip needs ${totalNeeded} bottles, only ${available} in stock at this warehouse` },
      { status: 422 }
    );
  }

  await db.transaction(async (tx) => {
    await tx
      .update(inventoryItems)
      .set({ quantity: available - totalNeeded, updatedAt: new Date() })
      .where(eq(inventoryItems.id, stockItem!.id));
    await tx
      .update(trips)
      .set({ loadingConfirmed: true, loadingConfirmedAt: new Date() })
      .where(eq(trips.id, trip.id));
  });

  const updated = await db.query.trips.findFirst({ where: eq(trips.id, trip.id) });
  return NextResponse.json(updated);
}
