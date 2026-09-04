import { db } from "./db/client";
import { orders, invoiceLineItems } from "./db/schema";
import { eq, and, inArray, gte, lte, isNotNull } from "drizzle-orm";

// Task I.5A — extracted verbatim from
// app/api/contracts/[id]/generate-monthly-invoice/route.ts's own order
// query, so the real generation route and the new read-only preview
// route are guaranteed to agree on eligibility with zero risk of drift:
// both call this exact function, neither has its own copy of the WHERE
// clause. Pure read — no writes anywhere in this module.
//
// Eligibility, exactly as the real route already defines it: same
// tenant, this contract, DELIVERED or PARTIALLY_DELIVERED, has a
// completedAt within [periodStart, periodEnd], and not already present
// on any invoice_line_items row from a prior invoice (regardless of
// which period that prior invoice covered — an order is only ever
// billed once, period).
export async function getBillableOrdersForPeriod(tenantId: string, contractId: string, periodStart: Date, periodEnd: Date) {
  const candidateOrders = await db.query.orders.findMany({
    where: and(
      eq(orders.tenantId, tenantId),
      eq(orders.contractId, contractId),
      inArray(orders.status, ["DELIVERED", "PARTIALLY_DELIVERED"]),
      isNotNull(orders.completedAt),
      gte(orders.completedAt, periodStart),
      lte(orders.completedAt, periodEnd)
    ),
    with: {
      location: true,
      tripStop: { with: { trip: { with: { vehicle: true } } } },
    },
  });

  const candidateIds = candidateOrders.map((o) => o.id);
  const alreadyBilled =
    candidateIds.length > 0
      ? await db.query.invoiceLineItems.findMany({ where: inArray(invoiceLineItems.orderId, candidateIds) })
      : [];
  const alreadyBilledIds = new Set(alreadyBilled.map((li) => li.orderId));

  const billableOrders = candidateOrders.filter((o) => !alreadyBilledIds.has(o.id));
  const excludedOrders = candidateOrders.filter((o) => alreadyBilledIds.has(o.id));

  return { candidateOrders, billableOrders, excludedOrders };
}
