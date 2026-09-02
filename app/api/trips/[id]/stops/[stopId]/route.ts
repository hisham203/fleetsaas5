export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { tripStops, epods, orders, invoices, inventoryItems, drivers, trips, exceptions } from "@/lib/db/schema";
import { genId, genNumber, calcInvoiceTotals } from "@/lib/helpers";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { runAutomationRules } from "@/lib/automation";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

const arriveSchema = z.object({ action: z.literal("arrive") });

const deliverSchema = z.object({
  action: z.enum(["deliver", "partial", "fail"]),
  deliveredQty: z.number().min(0).optional(),
  emptiesCollected: z.number().min(0).optional(),
  recipientName: z.string().optional(),
  notes: z.string().optional(),
  failureReason: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
});

// BR-10: Electronic Proof of Delivery — a stop cannot be considered Delivered
// without an ePOD record (geo + timestamp + recipient/qty). BR-11 covers the
// failure/partial path. On successful delivery this also triggers BR-18 billing.
//
// Role note: DISPATCHER is included alongside ADMIN and DRIVER because the
// Dispatch console's Live trips card offers a "Mark delivered"/"Mark failed"
// fallback for resolving a stop directly from dispatch (e.g. when a driver
// can't complete it themselves) — the page this console lives on
// (app/dispatch/page.tsx) is explicitly built for the Dispatcher role, so
// excluding it here would make that exact feature 401 for its own intended
// user.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; stopId: string }> }
) {
  const { id, stopId } = await params;
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN", "DISPATCHER", "DRIVER"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;

  const trip = await db.query.trips.findFirst({ where: and(eq(trips.id, id), eq(trips.tenantId, tenantId)) });
  if (!trip) return NextResponse.json({ error: "Trip not found" }, { status: 404 });

  // A driver can only act on stops belonging to their own trip.
  if (session!.type === "USER" && session!.user.role === "DRIVER") {
    const driverProfile = await db.query.drivers.findFirst({ where: eq(drivers.userId, session!.user.id) });
    if (!driverProfile || driverProfile.id !== trip.driverId) {
      return NextResponse.json({ error: "Not your trip" }, { status: 403 });
    }
  }

  const body = await req.json();

  const stop = await db.query.tripStops.findFirst({
    where: eq(tripStops.id, stopId),
    with: { order: { with: { customer: true } } },
  });
  if (!stop || stop.tripId !== id) {
    return NextResponse.json({ error: "Trip stop not found" }, { status: 404 });
  }

  // Arrival check-in
  const arriveParsed = arriveSchema.safeParse(body);
  if (arriveParsed.success) {
    if (stop.status !== "PENDING") {
      return NextResponse.json({ error: "Stop already checked in" }, { status: 422 });
    }
    const updated = await db.update(tripStops).set({ status: "ARRIVED", arrivedAt: new Date() }).where(eq(tripStops.id, stop.id)).returning();
    return NextResponse.json(updated[0]);
  }

  const parsed = deliverSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  if (data.action === "fail") {
    await db.transaction(async (tx) => {
      await tx.update(tripStops).set({ status: "FAILED", completedAt: new Date() }).where(eq(tripStops.id, stop.id));
      await tx
        .update(orders)
        .set({ status: "FAILED", failureReason: data.failureReason ?? "Not specified", completedAt: new Date() })
        .where(eq(orders.id, stop.orderId));
      // BR-11: every failed delivery becomes an open exception the
      // dispatcher must act on (Reschedule/Return/Reassign/Cancel), not
      // just a terminal status on the order.
      await tx.insert(exceptions).values({
        id: genId(),
        tenantId,
        orderId: stop.orderId,
        tripStopId: stop.id,
        type: "FAILED",
        reason: data.failureReason ?? "Not specified",
      });
    });
    const updated = await db.query.tripStops.findFirst({ where: eq(tripStops.id, stop.id) });

    await runAutomationRules(tenantId, "DELIVERY_FAILED", {
      orderId: stop.orderId,
      failureReason: data.failureReason ?? "Not specified",
    }).catch(() => {});

    return NextResponse.json(updated);
  }

  // deliver or partial — requires ePOD data
  if (data.deliveredQty == null) {
    return NextResponse.json({ error: "deliveredQty is required to confirm delivery" }, { status: 400 });
  }

  const isPartial = data.action === "partial" || data.deliveredQty < stop.order.qtyOrdered;
  const orderStatus = isPartial ? "PARTIALLY_DELIVERED" : "DELIVERED";

  // BR-18: a flat discount is applied to the subtotal before VAT (clamped
  // at zero — a discount can never make the subtotal negative, e.g. on a
  // partial delivery where the billed portion is smaller than the
  // discount amount).
  const rawSubtotal = Math.round(data.deliveredQty * stop.order.pricePerBottle * 100) / 100;
  const subtotal = Math.max(0, Math.round((rawSubtotal - stop.order.discountAmount) * 100) / 100);
  const { vatAmount, total } = calcInvoiceTotals(subtotal);
  const invoiceId = genId();
  const invoiceNumber = genNumber("INV");
  const invoiceStatus = stop.order.paymentMethod === "ACCOUNT_CREDIT" ? "PENDING" : "PAID";

  await db.transaction(async (tx) => {
    await tx
      .update(tripStops)
      .set({ status: orderStatus, completedAt: new Date() })
      .where(eq(tripStops.id, stop.id));

    await tx.insert(epods).values({
      id: genId(),
      tripStopId: stop.id,
      deliveredQty: data.deliveredQty!,
      emptiesCollected: data.emptiesCollected ?? 0,
      recipientName: data.recipientName,
      notes: data.notes,
      lat: data.lat,
      lng: data.lng,
    });

    await tx.update(orders).set({ status: orderStatus, completedAt: new Date() }).where(eq(orders.id, stop.orderId));

    // BR-09: empty bottles collected on delivery return to the trip's warehouse.
    if (data.emptiesCollected) {
      const emptyItem = await tx.query.inventoryItems.findFirst({
        where: and(eq(inventoryItems.warehouseId, trip.warehouseId), eq(inventoryItems.itemName, "19L Bottle - Empty")),
      });
      if (emptyItem) {
        await tx
          .update(inventoryItems)
          .set({ quantity: emptyItem.quantity + data.emptiesCollected, updatedAt: new Date() })
          .where(eq(inventoryItems.id, emptyItem.id));
      }
    }

    await tx.insert(invoices).values({
      id: invoiceId,
      tenantId: stop.order.tenantId,
      invoiceNumber,
      orderId: stop.order.id,
      customerId: stop.order.customerId,
      subtotal,
      discountAmount: stop.order.discountAmount,
      vatAmount,
      total,
      status: invoiceStatus,
    });

    // BR-11: a partial delivery is also an exception — the undelivered
    // portion needs the same Reschedule/Return/Reassign/Cancel handling a
    // full failure would get.
    if (isPartial) {
      await tx.insert(exceptions).values({
        id: genId(),
        tenantId,
        orderId: stop.orderId,
        tripStopId: stop.id,
        type: "PARTIALLY_DELIVERED",
        reason: data.notes ?? `Delivered ${data.deliveredQty} of ${stop.order.qtyOrdered} ordered`,
      });
    }
  });

  const updatedStop = await db.query.tripStops.findFirst({ where: eq(tripStops.id, stop.id), with: { epod: true } });
  const updatedOrder = await db.query.orders.findFirst({ where: eq(orders.id, stop.orderId) });
  const invoice = await db.query.invoices.findFirst({ where: eq(invoices.id, invoiceId) });

  await runAutomationRules(tenantId, "DELIVERY_COMPLETED", {
    orderId: stop.orderId,
    deliveredQty: data.deliveredQty,
    wasPartial: String(isPartial),
  }).catch(() => {});
  if (invoice) {
    await runAutomationRules(tenantId, "INVOICE_CREATED", {
      orderId: stop.orderId,
      total: invoice.total,
      status: invoice.status,
    }).catch(() => {});
  }

  return NextResponse.json({ stop: updatedStop, order: updatedOrder, invoice });
}
