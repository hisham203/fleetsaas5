export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { customers, invoices, orders } from "@/lib/db/schema";
import { getCreditExposure } from "@/lib/creditCheck";
import { getSessionFromRequest, getSessionTenantId } from "@/lib/auth";
import { eq, desc, sql } from "drizzle-orm";

// Task E.1 audit finding: this route previously fetched the customer via
// a plain db.query.customers.findFirst() with no column restriction and
// returned it raw in the response — including passwordHash. This wasn't
// caught by the S1/S2 sweep because that work specifically targeted the
// `with: { customer: true } }` EMBED pattern; here the customer is the
// primary query target, not an embed, so the same grep-based pattern
// never matched it. A genuinely new finding, not a re-occurrence.
//
// This route deliberately does NOT reuse the shared SAFE_CUSTOMER_COLUMNS
// constant from lib/contractHelpers.ts: this is a customer viewing (or
// staff viewing on their behalf) that customer's OWN statement, and
// creditLimit is explicitly, legitimately part of what this route is
// for ("so a B2B account can see exactly how much headroom they have") —
// a field SAFE_CUSTOMER_COLUMNS deliberately excludes for the generic
// "someone else is looking at this customer" case. Per the "be
// route-specific" principle: a narrower, purpose-built column list here,
// not the generic one.
const STATEMENT_SAFE_CUSTOMER_COLUMNS = {
  id: true,
  tenantId: true,
  name: true,
  type: true,
  phone: true,
  loginEmail: true,
  creditLimit: true,
  createdAt: true,
} as const;

async function canAccessCustomer(session: any, customer: any) {
  if (!session || !customer) return false;
  if (session.type === "CUSTOMER") return session.customer.id === customer.id;
  if (!["ADMIN", "DISPATCHER"].includes(session.user.role)) return false;
  return customer.tenantId === getSessionTenantId(session);
}

// APP-06 B2B Portal — Statement: invoice history plus credit-limit visibility
// (BR-04 rule), so a B2B account can see exactly how much headroom they have
// before an order would be blocked. "Exposure" includes both unpaid invoices
// and the value of orders still awaiting delivery — see lib/creditCheck.ts.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionFromRequest(req);
  const customer = await db.query.customers.findFirst({ where: eq(customers.id, id), columns: STATEMENT_SAFE_CUSTOMER_COLUMNS });

  if (!(await canAccessCustomer(session, customer))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Task E.1 audit: this query already has no orderId dependency at all
  // (filtered purely by customerId), so both single-order and monthly
  // consolidated invoices for this customer are already included here —
  // confirmed correct, no change needed for that. order: true is safe
  // (the orders table itself has no sensitive fields); this route and
  // its only consumer (app/b2b/page.tsx) never dereference .order at
  // all, so a null order (the monthly case) was already safe before this
  // audit too.
  const customerInvoices = await db.query.invoices.findMany({
    where: eq(invoices.customerId, id),
    with: { order: true, creditNotes: true },
    orderBy: desc(invoices.createdAt),
  });

  const { pendingInvoicesTotal, undeliveredOrdersValue, totalExposure } = await getCreditExposure(id);

  const orderCounts = await db
    .select({
      status: orders.status,
      count: sql<number>`count(*)`,
    })
    .from(orders)
    .where(eq(orders.customerId, id))
    .groupBy(orders.status);

  return NextResponse.json({
    customer,
    invoices: customerInvoices,
    unpaidInvoicesTotal: pendingInvoicesTotal,
    undeliveredOrdersValue,
    totalExposure,
    creditLimit: customer!.creditLimit,
    creditAvailable: customer!.creditLimit != null ? customer!.creditLimit - totalExposure : null,
    orderCounts,
  });
}
