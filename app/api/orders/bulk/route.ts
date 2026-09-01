export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { orders, customers, customerLocations } from "@/lib/db/schema";
import { genId, genNumber } from "@/lib/helpers";
import { getCreditExposure } from "@/lib/creditCheck";
import { getSessionFromRequest, getSessionTenantId } from "@/lib/auth";
import { eq, and, inArray } from "drizzle-orm";
import { z } from "zod";

const itemSchema = z.object({
  locationId: z.string(),
  qtyOrdered: z.number().min(1),
  emptyBottlesToCollect: z.number().min(0).default(0),
  bottleSizeLtr: z.number().default(19),
});

const bulkSchema = z.object({
  customerId: z.string(),
  paymentMethod: z.enum(["CASH", "CARD", "ONLINE", "ACCOUNT_CREDIT"]).default("ACCOUNT_CREDIT"),
  pricePerBottle: z.number().default(8),
  items: z.array(itemSchema).min(1),
});

// APP-06 B2B Portal — Bulk Orders: a B2B account places one order per
// selected location in a single action. BR-04's credit-limit rule is
// enforced against the *combined* value of the whole batch, not per-item,
// so a customer can't split a large order across locations to slip under
// their limit.
export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = bulkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  // A CUSTOMER session may only place orders for its own account; internal
  // staff (ADMIN/DISPATCHER) may place on behalf of any B2B customer.
  if (session.type === "CUSTOMER" && session.customer.id !== data.customerId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  if (session.type === "USER" && !["ADMIN", "DISPATCHER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const customer = await db.query.customers.findFirst({ where: eq(customers.id, data.customerId) });
  if (!customer) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }

  // Internal staff may only act on customers within their own tenant.
  if (session.type === "USER" && customer.tenantId !== getSessionTenantId(session)) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }

  const locationIds = data.items.map((i) => i.locationId);
  const locations = await db.query.customerLocations.findMany({
    where: and(inArray(customerLocations.id, locationIds), eq(customerLocations.customerId, customer.id)),
  });
  if (locations.length !== new Set(locationIds).size) {
    return NextResponse.json({ error: "One or more locations not found for this customer" }, { status: 404 });
  }
  const locationsById = new Map(locations.map((l) => [l.id, l]));

  // BR-18: a B2B customer's negotiated contract rate always wins over
  // whatever price the request supplied — see the same logic in
  // app/api/orders/route.ts.
  const effectivePricePerBottle = customer.contractPricePerBottle ?? data.pricePerBottle;

  // BR-04: combined batch value against remaining credit, counting both
  // unpaid invoices and value of orders still awaiting delivery.
  if (customer.type === "B2B" && customer.creditLimit != null) {
    const { totalExposure } = await getCreditExposure(customer.id);
    const batchValue = data.items.reduce((sum, i) => sum + i.qtyOrdered * effectivePricePerBottle * 1.15, 0);
    const projected = totalExposure + batchValue;
    if (projected > customer.creditLimit) {
      return NextResponse.json(
        {
          error: `Bulk order blocked: combined batch (SAR ${batchValue.toFixed(2)}) plus current exposure (SAR ${totalExposure.toFixed(2)}) exceeds credit limit (SAR ${customer.creditLimit})`,
        },
        { status: 422 }
      );
    }
  }

  const createdIds: string[] = [];
  await db.transaction(async (tx) => {
    for (const item of data.items) {
      const location = locationsById.get(item.locationId)!;
      const id = genId();
      createdIds.push(id);
      await tx.insert(orders).values({
        id,
        tenantId: customer.tenantId,
        orderNumber: genNumber("ORD"),
        customerId: data.customerId,
        locationId: item.locationId,
        type: "ONE_TIME",
        bottleSizeLtr: item.bottleSizeLtr,
        qtyOrdered: item.qtyOrdered,
        emptyBottlesToCollect: item.emptyBottlesToCollect,
        deliveryAddress: location.address,
        lat: location.lat,
        lng: location.lng,
        requestedTime: new Date(),
        status: "PENDING",
        paymentMethod: data.paymentMethod,
        pricePerBottle: effectivePricePerBottle,
      });
    }
  });

  const created = await db.query.orders.findMany({
    where: inArray(orders.id, createdIds),
    with: { location: true },
  });

  return NextResponse.json({ orders: created, count: created.length }, { status: 201 });
}
