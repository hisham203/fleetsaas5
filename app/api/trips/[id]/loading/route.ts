export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { trips, inventoryItems } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, and } from "drizzle-orm";

// BR-09: Warehouse, Loading & Inventory Operations — the warehouse confirms
// loading for a PLANNED trip, which deducts the required stock from that
// trip's specific warehouse and unblocks dispatch. "Do not release the trip
// before loading confirmation" is enforced here and in the trip dispatch
// action.
//
// G.2 audit finding: this check was hardcoded to a single bottle-specific
// item name ("19L Bottle - Full"), which meant it only ever worked for
// Demo Water Co. — Acme's warehouses track "Diesel Tank - Full" instead,
// and Riyadh Bulk Water Logistics's loading point tracks no inventory
// item at all (a real tanker delivery loads directly from the tanker's
// own capacity, not a warehouse consumable stock). This bug was latent
// for Acme specifically because its seeded historical trips are built by
// direct DB inserts (scripts/seedData.ts's seedHistoricalDelivery), which
// never calls this route at all — it only surfaced now that a real trip
// is being loaded live through the actual API for a non-Demo-Water-Co
// tenant for the first time.
//
// Fixed generically, not tenant-specifically: look for whatever item at
// this warehouse follows the existing "<name> - Full" naming convention
// (already used consistently by every current tenant that tracks
// anything at all — bottles, diesel tanks) rather than one hardcoded
// name. If a warehouse tracks no such item — meaning it was never set up
// to track a deductible consumable at all, not that it merely ran out —
// the shortage check does not apply to it, and loading proceeds freely.
// A warehouse that DOES track something (Demo Water Co., Acme) keeps
// exactly the same shortage-blocking behavior as before, unchanged.
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

  const warehouseStockItems = await db.query.inventoryItems.findMany({ where: eq(inventoryItems.warehouseId, trip.warehouseId) });
  const stockItem = warehouseStockItems.find((i) => i.itemName.endsWith(" - Full"));

  if (stockItem) {
    const available = stockItem.quantity;
    if (available < totalNeeded) {
      const unitLabel = stockItem.unit || "unit";
      return NextResponse.json(
        { error: `Shortage: trip needs ${totalNeeded} ${unitLabel}(s) of "${stockItem.itemName}", only ${available} in stock at this warehouse` },
        { status: 422 }
      );
    }

    await db.transaction(async (tx) => {
      await tx
        .update(inventoryItems)
        .set({ quantity: available - totalNeeded, updatedAt: new Date() })
        .where(eq(inventoryItems.id, stockItem.id));
      await tx
        .update(trips)
        .set({ loadingConfirmed: true, loadingConfirmedAt: new Date() })
        .where(eq(trips.id, trip.id));
    });
  } else {
    // This warehouse tracks no deductible consumable stock at all — a
    // real tanker loading point (Riyadh Bulk Water Logistics) has
    // nothing to check against, so loading proceeds without a stock
    // deduction, exactly as it should for that operating model.
    await db.update(trips).set({ loadingConfirmed: true, loadingConfirmedAt: new Date() }).where(eq(trips.id, trip.id));
  }

  const updated = await db.query.trips.findFirst({ where: eq(trips.id, trip.id) });
  return NextResponse.json(updated);
}
