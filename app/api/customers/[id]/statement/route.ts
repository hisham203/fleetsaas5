export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { customers, invoices, orders } from "@/lib/db/schema";
import { getCreditExposure } from "@/lib/creditCheck";
import { getSessionFromRequest, getSessionTenantId } from "@/lib/auth";
import { eq, desc, sql } from "drizzle-orm";

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
  const customer = await db.query.customers.findFirst({ where: eq(customers.id, id) });

  if (!(await canAccessCustomer(session, customer))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
