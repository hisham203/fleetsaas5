export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { orders, customers } from "@/lib/db/schema";
import { genId, genNumber } from "@/lib/helpers";
import { getCreditExposure } from "@/lib/creditCheck";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { runAutomationRules } from "@/lib/automation";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";

const createSchema = z.object({
  customerId: z.string(),
  type: z.enum(["ONE_TIME", "SUBSCRIPTION"]).default("ONE_TIME"),
  bottleSizeLtr: z.number().default(19),
  qtyOrdered: z.number().min(1),
  emptyBottlesToCollect: z.number().min(0).default(0),
  requestedTime: z.string().optional(),
  paymentMethod: z.enum(["CASH", "CARD", "ONLINE", "ACCOUNT_CREDIT"]).default("CASH"),
  pricePerBottle: z.number().default(8),
  discountAmount: z.number().min(0).default(0), // BR-18
});

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const status = req.nextUrl.searchParams.get("status");
  let customerId = req.nextUrl.searchParams.get("customerId");
  let tenantId: string;

  if (session.type === "CUSTOMER") {
    // A B2B customer can only ever see their own orders, regardless of
    // what customerId (if any) the request asked for.
    customerId = session.customer.id;
    tenantId = session.customer.tenantId;
  } else if (hasRole(session, ["ADMIN", "DISPATCHER", "DRIVER"])) {
    tenantId = getSessionTenantId(session)!;
  } else {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const conditions = [
    eq(orders.tenantId, tenantId),
    status ? eq(orders.status, status) : undefined,
    customerId ? eq(orders.customerId, customerId) : undefined,
  ].filter(Boolean) as any[];

  const rows = await db.query.orders.findMany({
    where: and(...conditions),
    with: { customer: true, location: true, tripStop: { with: { trip: true } } },
    orderBy: desc(orders.createdAt),
  });
  return NextResponse.json(rows);
}

// BR-05: Order Management — creation always runs through validation
// (customer exists, and B2B credit limit is respected) before entering
// the dispatch queue as PENDING.
export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN", "DISPATCHER"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  const customer = await db.query.customers.findFirst({ where: and(eq(customers.id, data.customerId), eq(customers.tenantId, tenantId)) });
  if (!customer) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }

  // BR-18 per-contract pricing: a B2B customer's negotiated rate always
  // wins over whatever price the request supplied — a contract rate can't
  // be bypassed by what a dispatcher happens to type into the order form.
  const effectivePricePerBottle = customer.contractPricePerBottle ?? data.pricePerBottle;

  // BR-04 rule: block orders that would exceed a B2B credit limit, counting
  // both unpaid invoices and the value of any order still awaiting delivery.
  if (customer.type === "B2B" && customer.creditLimit != null) {
    const { totalExposure } = await getCreditExposure(customer.id);
    const orderValue = Math.max(0, data.qtyOrdered * effectivePricePerBottle - data.discountAmount) * 1.15;
    const projected = totalExposure + orderValue;
    if (projected > customer.creditLimit) {
      return NextResponse.json(
        { error: `Order blocked: exceeds credit limit (limit ${customer.creditLimit}, current exposure ${totalExposure.toFixed(2)}, projected ${projected.toFixed(2)})` },
        { status: 422 }
      );
    }
  }

  const id = genId();
  await db.insert(orders).values({
    id,
    tenantId,
    orderNumber: genNumber("ORD"),
    customerId: data.customerId,
    type: data.type,
    bottleSizeLtr: data.bottleSizeLtr,
    qtyOrdered: data.qtyOrdered,
    emptyBottlesToCollect: data.emptyBottlesToCollect,
    deliveryAddress: customer.address,
    lat: customer.lat,
    lng: customer.lng,
    requestedTime: data.requestedTime ? new Date(data.requestedTime) : new Date(),
    status: "PENDING",
    paymentMethod: data.paymentMethod,
    pricePerBottle: effectivePricePerBottle,
    discountAmount: data.discountAmount,
  });

  const created = await db.query.orders.findFirst({ where: eq(orders.id, id), with: { customer: true } });

  // BR-22: fire the ORDER_CREATED automation event. Awaited (so the log/
  // notification exists by the time this response returns — no race with
  // a client polling right after), but errors are swallowed rather than
  // thrown — a rule-engine bug should never block the order itself from
  // being created.
  if (created) {
    await runAutomationRules(tenantId, "ORDER_CREATED", {
      orderId: created.id,
      qtyOrdered: created.qtyOrdered,
      customerType: created.customer?.type,
      paymentMethod: created.paymentMethod,
    }).catch(() => {});
  }

  return NextResponse.json(created, { status: 201 });
}
