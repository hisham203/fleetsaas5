export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { invoices, orders } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, and } from "drizzle-orm";

// BR-18 rule: "cash collection must be linked to driver and trip" — this is
// the reconciliation step where an Admin confirms a driver has physically
// handed over cash collected on a CASH-payment order. Only meaningful for
// CASH orders; other payment methods don't need a handoff to reconcile.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;
  const userId = session!.type === "USER" ? session!.user.id : null;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const invoice = await db.query.invoices.findFirst({
    where: and(eq(invoices.id, id), eq(invoices.tenantId, tenantId)),
    with: { order: true },
  });
  if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  if (invoice.order.paymentMethod !== "CASH") {
    return NextResponse.json({ error: "Only invoices for CASH orders need cash settlement" }, { status: 422 });
  }
  if (invoice.cashSettled) {
    return NextResponse.json({ error: "This invoice's cash has already been settled" }, { status: 422 });
  }

  await db
    .update(invoices)
    .set({ cashSettled: true, cashSettledAt: new Date(), cashSettledByUserId: userId })
    .where(eq(invoices.id, invoice.id));

  const updated = await db.query.invoices.findFirst({ where: eq(invoices.id, invoice.id) });
  return NextResponse.json(updated);
}
