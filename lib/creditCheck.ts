import { db } from "@/lib/db/client";
import { invoices, orders, creditNotes } from "@/lib/db/schema";
import { and, eq, notInArray, sql } from "drizzle-orm";

// BR-04 credit-limit rule, done properly: a customer's real exposure isn't
// just unpaid invoices — it's unpaid invoices (net of any credit notes
// issued against them — BR-18) PLUS the value of any order that's been
// placed but not yet delivered (net of its discount, if any), and therefore
// not yet invoiced. Without the second half, a customer could stack
// unlimited pending orders and never trip the limit, since invoices only
// get created at delivery (BR-18). Delivered/partially-delivered orders are
// excluded here since those already have an invoice counted in the first
// half; cancelled/failed orders never bill, so they're excluded too.
export async function getCreditExposure(customerId: string) {
  const pendingInvoiceRows = await db
    .select({ total: sql<number>`coalesce(sum(${invoices.total}), 0)` })
    .from(invoices)
    .where(and(eq(invoices.customerId, customerId), eq(invoices.status, "PENDING")));
  const pendingInvoicesGross = pendingInvoiceRows[0]?.total ?? 0;

  const creditNoteRows = await db
    .select({ total: sql<number>`coalesce(sum(${creditNotes.amount}), 0)` })
    .from(creditNotes)
    .innerJoin(invoices, eq(creditNotes.invoiceId, invoices.id))
    .where(and(eq(invoices.customerId, customerId), eq(invoices.status, "PENDING")));
  const creditNotesAgainstPending = creditNoteRows[0]?.total ?? 0;

  const pendingInvoicesTotal = Math.max(0, pendingInvoicesGross - creditNotesAgainstPending);

  const undeliveredRows = await db
    .select({
      total: sql<number>`coalesce(sum(greatest(${orders.qtyOrdered} * ${orders.pricePerBottle} - ${orders.discountAmount}, 0) * 1.15), 0)`,
    })
    .from(orders)
    .where(
      and(
        eq(orders.customerId, customerId),
        notInArray(orders.status, ["DELIVERED", "PARTIALLY_DELIVERED", "CANCELLED", "FAILED"])
      )
    );
  const undeliveredOrdersValue = undeliveredRows[0]?.total ?? 0;

  return {
    pendingInvoicesTotal,
    undeliveredOrdersValue,
    totalExposure: pendingInvoicesTotal + undeliveredOrdersValue,
  };
}
