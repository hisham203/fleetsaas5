export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { tripStops, epods, orders, invoices, inventoryItems, drivers, trips, exceptions, contracts } from "@/lib/db/schema";
import { genId, genNumber, calcInvoiceTotals, VAT_RATE } from "@/lib/helpers";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { runAutomationRules } from "@/lib/automation";
import { calculateContractPrice, PricingEngineError } from "@/lib/contractPricing";
import { determineRateType } from "@/lib/contractEligibility";
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

  // Task P.2: trip.vehicle is now embedded — a ONE_TIME_TRIP_COUNT contract
  // invoice needs the assigned vehicle's real capacityLiters as a pricing
  // dimension, and it was never fetched here before.
  const trip = await db.query.trips.findFirst({
    where: and(eq(trips.id, id), eq(trips.tenantId, tenantId)),
    with: { vehicle: true },
  });
  if (!trip) return NextResponse.json({ error: "Trip not found" }, { status: 404 });

  // A driver can only act on stops belonging to their own trip.
  if (session!.type === "USER" && session!.user.role === "DRIVER") {
    const driverProfile = await db.query.drivers.findFirst({ where: eq(drivers.userId, session!.user.id) });
    if (!driverProfile || driverProfile.id !== trip.driverId) {
      return NextResponse.json({ error: "Not your trip" }, { status: 403 });
    }
  }

  const body = await req.json();

  // Task P.2: stop.order.location is now embedded — a ONE_TIME_TRIP_COUNT
  // contract invoice needs cityCode/zoneCode/distanceBandCode as pricing
  // dimensions when the order has a location set; null when it doesn't,
  // which the pricing engine already treats as a wildcard match.
  const stop = await db.query.tripStops.findFirst({
    where: eq(tripStops.id, stopId),
    with: { order: { with: { location: true } }, epod: true },
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
    if (stop.status === "FAILED") {
      // Task P.2 idempotency fix: a retry (e.g. driver's app resubmitting
      // after a network timeout it never got a response for) previously
      // re-ran this whole block — inserting a second, duplicate exception
      // row every time. Not billing-related, but the same "retries must be
      // safe" principle this task requires for the deliver path applies
      // here too, and it was a real gap sitting right next to the one this
      // task exists to fix.
      const existing = await db.query.tripStops.findFirst({ where: eq(tripStops.id, stop.id) });
      return NextResponse.json(existing);
    }
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

  // Task P.2 idempotency fix (Part 3/4 of this task): this stop may already
  // have been delivered/partially delivered by an earlier request — a
  // driver's app retrying after a network timeout it never got a response
  // for is the concrete case, but any repeat call lands here the same way.
  // Before this fix, a retry would attempt a second `invoices` insert for
  // the same orderId, which the schema's own unique constraint on
  // invoices.orderId would reject as an uncaught DB error (a real,
  // pre-existing crash risk for every order type, not just contract-priced
  // ones) — and, for a ONE_TIME_TRIP_COUNT contract, would have incremented
  // tripsUsed a second time for one real delivery. Detected by stop status
  // alone (not by re-checking for an existing invoice), since a stop that's
  // already DELIVERED/PARTIALLY_DELIVERED unambiguously means this whole
  // block already ran to completion once — nothing here is reprocessed.
  if (stop.status === "DELIVERED" || stop.status === "PARTIALLY_DELIVERED") {
    const existingStop = await db.query.tripStops.findFirst({ where: eq(tripStops.id, stop.id), with: { epod: true } });
    const existingOrder = await db.query.orders.findFirst({ where: eq(orders.id, stop.orderId) });
    const existingInvoice = await db.query.invoices.findFirst({ where: eq(invoices.orderId, stop.orderId) });
    return NextResponse.json({ stop: existingStop, order: existingOrder, invoice: existingInvoice ?? null, billingError: null });
  }

  const isPartial = data.action === "partial" || data.deliveredQty < stop.order.qtyOrdered;
  const orderStatus = isPartial ? "PARTIALLY_DELIVERED" : "DELIVERED";

  // Task E.1 audit finding, extended by Task P/P.2: this route now
  // branches into three cases by contract type.
  //
  // MONTHLY_ACCUMULATED: unchanged from Task E.1 — no invoice at delivery
  // at all, billed later via the monthly process. tripsUsed is never
  // touched here for this type; it has no included-allowance concept to
  // track (determineRateType always returns STANDARD for it).
  //
  // ONE_TIME_TRIP_COUNT (Task P.2, new): priced via calculateContractPrice
  // instead of pricePerBottle, with tripsUsed incremented exactly once per
  // successful contract-priced invoice, in the same transaction as the
  // invoice write.
  //
  // No contract: unchanged standard pricePerBottle invoice.
  let contractType: string | null = null;
  let contract: typeof contracts.$inferSelect | null = null;
  if (stop.order.contractId) {
    contract = (await db.query.contracts.findFirst({ where: eq(contracts.id, stop.order.contractId) })) ?? null;
    contractType = contract?.type ?? null;
  }
  const skipInvoiceForMonthlyContract = contractType === "MONTHLY_ACCUMULATED";
  const isTripCountContract = contractType === "ONE_TIME_TRIP_COUNT" && contract != null;

  // Task P.2: for a ONE_TIME_TRIP_COUNT contract, pricing is computed
  // BEFORE the transaction opens — calculateContractPrice is pure/
  // read-only (never writes anything), so calling it here is safe and
  // matches the exact pattern already proven by
  // generate-monthly-invoice/route.ts. Unlike that route, though, a
  // pricing failure here must NOT abort the whole delivery: the driver
  // physically completed the delivery regardless of whether the back-office
  // pricing configuration is complete, and this task's own design
  // (Task P) concluded delivery status should still succeed with a clear,
  // separate billing error — never a silent fallback to standard pricing,
  // and never a half-updated stop/order left with no explanation. The
  // billingError field on the final response is exactly that explanation.
  let contractPricingResult: Awaited<ReturnType<typeof calculateContractPrice>> | null = null;
  let billingError: { code: string; message: string } | null = null;
  if (isTripCountContract) {
    const rateType = determineRateType(contract!);
    try {
      contractPricingResult = await calculateContractPrice({
        tenantId,
        customerId: stop.order.customerId,
        contractId: contract!.id,
        pricingDate: new Date(),
        cityCode: stop.order.location?.cityCode ?? null,
        zoneCode: stop.order.location?.zoneCode ?? null,
        distanceBandCode: stop.order.location?.distanceBandCode ?? null,
        tankerCapacityLtr: trip.vehicle?.capacityLiters ?? null,
        rateType,
        quantityLiters: data.deliveredQty,
      });
    } catch (err) {
      if (err instanceof PricingEngineError) {
        billingError = { code: err.code, message: err.message };
      } else {
        billingError = { code: "UNKNOWN_ERROR", message: err instanceof Error ? err.message : String(err) };
      }
    }
  }

  // BR-18: a flat discount is applied to the subtotal before VAT (clamped
  // at zero — a discount can never make the subtotal negative, e.g. on a
  // partial delivery where the billed portion is smaller than the
  // discount amount). Applied identically whether the base amount came
  // from pricePerBottle (legacy/non-contract) or calculateContractPrice
  // (ONE_TIME_TRIP_COUNT) — discountAmount is a generic order-level field,
  // not a bottle-specific one, so there's no reason for a contract-priced
  // order to skip it.
  let rawSubtotal: number;
  let effectiveVatRate = VAT_RATE;
  if (isTripCountContract) {
    if (contractPricingResult) {
      rawSubtotal = contractPricingResult.baseAmount;
      // The pricing rule's own VAT rate must be preserved through the
      // discount recalculation below, not silently replaced by the
      // tenant default — reverse-derived from the engine's own result
      // since PricingResult doesn't separately expose the raw rate.
      effectiveVatRate = contractPricingResult.baseAmount > 0 ? contractPricingResult.vatAmount / contractPricingResult.baseAmount : VAT_RATE;
    } else {
      rawSubtotal = 0; // unused — billingError is set, invoice is never created below
    }
  } else {
    rawSubtotal = Math.round(data.deliveredQty * stop.order.pricePerBottle * 100) / 100;
  }
  const subtotal = Math.max(0, Math.round((rawSubtotal - stop.order.discountAmount) * 100) / 100);
  const { vatAmount, total } = calcInvoiceTotals(subtotal, effectiveVatRate);
  const invoiceId = genId();
  const invoiceNumber = genNumber("INV");
  const invoiceStatus = stop.order.paymentMethod === "ACCOUNT_CREDIT" ? "PENDING" : "PAID";

  // Whether an invoice (and, for a trip-count contract, a tripsUsed
  // increment) should be written in the transaction below. Never true for
  // a monthly contract (unchanged Task E.1 behavior). For a trip-count
  // contract, true only when pricing actually succeeded — a failed
  // contract-priced lookup blocks the invoice, not the delivery.
  const shouldCreateInvoice = !skipInvoiceForMonthlyContract && (!isTripCountContract || contractPricingResult != null);

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

    if (shouldCreateInvoice) {
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

      // Task P.2, Part 3: tripsUsed was confirmed never incremented by any
      // real code path before this fix — only read (determineRateType),
      // displayed (admin UI), and statically seeded. Incremented here,
      // in the same transaction as the invoice write, exactly once per
      // successful contract-priced invoice — never on assignment, loading,
      // dispatch, or a failed/ambiguous pricing lookup (billingError case
      // above never reaches this branch), and never twice for one
      // delivery (guarded by the idempotency check earlier in this
      // function, before any of this runs).
      if (isTripCountContract) {
        await tx.update(contracts).set({ tripsUsed: contract!.tripsUsed + 1 }).where(eq(contracts.id, contract!.id));
      }
    }

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
  const invoice = shouldCreateInvoice ? await db.query.invoices.findFirst({ where: eq(invoices.id, invoiceId) }) : null;

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

  return NextResponse.json({ stop: updatedStop, order: updatedOrder, invoice, billingError });
}
