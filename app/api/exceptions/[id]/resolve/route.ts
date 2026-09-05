export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { exceptions, orders, epods, inventoryItems } from "@/lib/db/schema";
import { genId, genNumber } from "@/lib/helpers";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

const resolveSchema = z.object({
  action: z.enum(["RESCHEDULE", "RETURN", "REASSIGN", "CANCEL"]),
  notes: z.string().optional(),
  newRequestedTime: z.string().optional(), // for RESCHEDULE/REASSIGN — when to redeliver
});

// BR-11: Delivery Exceptions & Returns — the four closing actions a
// dispatcher can take on an open exception (Escalate is separate — see
// /escalate — since it doesn't close the case).
//
// Every action reconciles the undelivered quantity back to the trip's
// warehouse stock: those bottles are still physically on the vehicle,
// never delivered, and were already deducted from stock at loading time —
// without this, inventory would be permanently short by whatever failed or
// went un-delivered. RESCHEDULE/REASSIGN additionally create a follow-up
// order (a fresh PENDING order linked back to the original via
// previousOrderId) sized to the undelivered quantity, ready for the
// dispatcher to assign to a new trip through the normal flow.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN", "DISPATCHER"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;

  const exception = await db.query.exceptions.findFirst({
    where: and(eq(exceptions.id, id), eq(exceptions.tenantId, tenantId)),
    with: { order: true, tripStop: { with: { trip: true } } },
  });
  if (!exception) return NextResponse.json({ error: "Exception not found" }, { status: 404 });
  if (exception.status !== "OPEN") {
    return NextResponse.json({ error: "This exception has already been resolved" }, { status: 422 });
  }

  const body = await req.json();
  const parsed = resolveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;
  const order = exception.order;
  const trip = exception.tripStop.trip;

  let deliveredQty = 0;
  if (exception.type === "PARTIALLY_DELIVERED") {
    const epod = await db.query.epods.findFirst({ where: eq(epods.tripStopId, exception.tripStopId) });
    deliveredQty = epod?.deliveredQty ?? 0;
  }
  const undeliveredQty = order.qtyOrdered - deliveredQty;

  if ((data.action === "RESCHEDULE" || data.action === "REASSIGN") && undeliveredQty <= 0) {
    return NextResponse.json({ error: "Nothing left to redeliver — the order was already fully delivered" }, { status: 422 });
  }

  let followUpOrderId: string | null = null;
  let returnNoteNumber: string | null = null;

  await db.transaction(async (tx) => {
    // Reconcile undelivered stock back to the trip's warehouse — applies
    // to every action, since the physical bottles are on the vehicle
    // regardless of what the dispatcher decides to do next.
    if (undeliveredQty > 0) {
      const stockItem = await tx.query.inventoryItems.findFirst({
        where: and(eq(inventoryItems.warehouseId, trip.warehouseId), eq(inventoryItems.itemName, "19L Bottle - Full")),
      });
      if (stockItem) {
        await tx
          .update(inventoryItems)
          .set({ quantity: stockItem.quantity + undeliveredQty, updatedAt: new Date() })
          .where(eq(inventoryItems.id, stockItem.id));
      }
    }

    if (data.action === "RESCHEDULE" || data.action === "REASSIGN") {
      const newId = genId();
      await tx.insert(orders).values({
        id: newId,
        tenantId,
        orderNumber: genNumber("ORD"),
        customerId: order.customerId,
        locationId: order.locationId,
        // Task P.2 dependent fix: this previously dropped contractId
        // entirely — a rescheduled/reassigned contract-linked order would
        // silently revert to standard (bottle) pricing on its next
        // delivery attempt, with no error or warning anywhere, even
        // though the original order was correctly contract-priced. The
        // replacement is the same logical delivery obligation continuing
        // under the same contract, so it must carry the same contractId
        // forward, exactly as locationId already does.
        contractId: order.contractId,
        type: order.type,
        bottleSizeLtr: order.bottleSizeLtr,
        qtyOrdered: undeliveredQty,
        emptyBottlesToCollect: order.emptyBottlesToCollect,
        deliveryAddress: order.deliveryAddress,
        lat: order.lat,
        lng: order.lng,
        requestedTime: data.newRequestedTime ? new Date(data.newRequestedTime) : new Date(),
        status: "PENDING",
        paymentMethod: order.paymentMethod,
        pricePerBottle: order.pricePerBottle,
        previousOrderId: order.id,
      });
      followUpOrderId = newId;
    }

    if (data.action === "RETURN" || data.action === "CANCEL") {
      returnNoteNumber = genNumber("RTN");
    }

    if (data.action === "CANCEL") {
      await tx.update(orders).set({ status: "CANCELLED" }).where(eq(orders.id, order.id));
    }

    await tx
      .update(exceptions)
      .set({
        status: "RESOLVED",
        resolutionAction: data.action,
        resolutionNotes: data.notes,
        returnNoteNumber,
        quantityReturned: undeliveredQty > 0 ? undeliveredQty : null,
        followUpOrderId,
        // Simulated — see the schema comment on `exceptions`: no real
        // messaging provider is wired into this build.
        customerNotified: true,
        customerNotifiedAt: new Date(),
        resolvedAt: new Date(),
      })
      .where(eq(exceptions.id, exception.id));
  });

  const updated = await db.query.exceptions.findFirst({
    where: eq(exceptions.id, exception.id),
    with: { order: true },
  });
  return NextResponse.json(updated);
}
