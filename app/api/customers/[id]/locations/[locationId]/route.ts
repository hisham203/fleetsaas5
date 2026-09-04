export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { customerLocations, customers, distanceBands, orders, invoices, invoiceLineItems } from "@/lib/db/schema";
import { getSessionFromRequest, getSessionTenantId } from "@/lib/auth";
import { eq, and, inArray } from "drizzle-orm";
import { z } from "zod";
import { isAdminSession, pricingFieldsTouchedBy } from "@/lib/siteFieldGovernance";

// Task K.2 audit finding — nothing in this schema ever snapshots a
// location's cityCode/zoneCode/distanceBandCode onto an order or
// invoice: calculateContractPrice() (lib/contractPricing.ts) always
// live-joins to order.location at the moment pricing actually runs
// (trip creation's preview, and — the real risk — monthly invoice
// generation, which is manual and can happen well after delivery for a
// MONTHLY_ACCUMULATED contract). An already-invoiced order is safe: its
// dollar amounts are frozen in invoice_line_items and are never
// recalculated. The real risk window is a DELIVERED order that hasn't
// been invoiced yet — editing this site's pricing dimensions in that
// window would silently change what that order gets billed at,
// compared to what was in effect when it was actually delivered.
//
// No schema-level snapshot exists to detect "what the values were at
// delivery time" — building one would be a schema change, out of scope
// here. The safest guard achievable with the existing schema: block
// editing cityCode/zoneCode/distanceBandCode outright while this site
// has any delivered-but-not-yet-invoiced order. Address/label/
// coordinates/contact info carry no pricing meaning at all and are
// never restricted.
const patchSchema = z.object({
  label: z.string().min(1).optional(),
  address: z.string().min(1).optional(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  contactName: z.string().nullable().optional(),
  contactPhone: z.string().nullable().optional(),
  cityCode: z.string().nullable().optional(),
  zoneCode: z.string().nullable().optional(),
  distanceBandCode: z.string().nullable().optional(),
});

async function canAccessCustomer(session: any, customerId: string) {
  if (!session) return false;
  if (session.type === "CUSTOMER") return session.customer.id === customerId;
  if (!["ADMIN", "DISPATCHER"].includes(session.user.role)) return false;
  const customer = await db.query.customers.findFirst({ where: eq(customers.id, customerId) });
  return !!customer && customer.tenantId === getSessionTenantId(session);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; locationId: string }> }
) {
  const { id: customerId, locationId } = await params;
  const session = await getSessionFromRequest(req);
  if (!(await canAccessCustomer(session, customerId))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Ownership check: this site must genuinely belong to the customer
  // named in the URL — never editable via a mismatched customerId/
  // locationId pair, regardless of which tenant either happens to be in.
  const location = await db.query.customerLocations.findFirst({
    where: and(eq(customerLocations.id, locationId), eq(customerLocations.customerId, customerId)),
  });
  if (!location) {
    return NextResponse.json({ error: "Site not found for this customer" }, { status: 404 });
  }

  const body = await req.json();

  // Task K.3, step 2 of this route's own documented order (auth ->
  // field-level role authorization -> historical-pricing safety guard
  // -> validation -> update): only ADMIN may touch cityCode/zoneCode/
  // distanceBandCode. Checked here, before the historical-pricing
  // guard and before Zod validation — an unauthorized attempt is
  // rejected before either of those run at all.
  const touchedPricingFields = pricingFieldsTouchedBy(body);
  if (touchedPricingFields.length > 0 && !isAdminSession(session)) {
    return NextResponse.json(
      { error: `Only an admin can change ${touchedPricingFields.join("/")} — these fields affect contract pricing eligibility.` },
      { status: 403 }
    );
  }

  // Task K.3, step 3 of this route's own documented order: the
  // historical-pricing safety guard runs next, before Zod validation —
  // it only needs to know WHICH fields are being touched (already
  // known from touchedPricingFields above), not their new values, so
  // there's no need to wait for validated data first.
  if (touchedPricingFields.length > 0) {
    const unbilled = await db.query.orders.findMany({
      where: and(eq(orders.locationId, locationId), inArray(orders.status, ["DELIVERED", "PARTIALLY_DELIVERED"])),
    });
    if (unbilled.length > 0) {
      const unbilledIds = unbilled.map((o) => o.id);
      // An order can be billed via either path this schema supports: a
      // direct single-order invoice (invoices.orderId) or as a line item
      // on a monthly consolidated one (invoice_line_items.orderId) — an
      // order counts as billed if it appears in EITHER.
      const [directlyBilled, lineItemBilled] = await Promise.all([
        db.query.invoices.findMany({ where: inArray(invoices.orderId, unbilledIds) }),
        db.query.invoiceLineItems.findMany({ where: inArray(invoiceLineItems.orderId, unbilledIds) }),
      ]);
      const billedIds = new Set([...directlyBilled.map((i) => i.orderId), ...lineItemBilled.map((li) => li.orderId)]);
      const stillUnbilled = unbilled.filter((o) => !billedIds.has(o.id));
      if (stillUnbilled.length > 0) {
        return NextResponse.json(
          {
            error:
              `Cannot change city/zone/distance band — this site has ${stillUnbilled.length} delivered order(s) not yet invoiced. ` +
              "Editing these fields now would change what those orders are billed at compared to when they were delivered. " +
              "Invoice or otherwise resolve them first, then edit this site.",
          },
          { status: 422 }
        );
      }
    }
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  if (data.distanceBandCode) {
    const customer = await db.query.customers.findFirst({ where: eq(customers.id, customerId) });
    const band = await db.query.distanceBands.findFirst({
      where: and(eq(distanceBands.tenantId, customer!.tenantId), eq(distanceBands.code, data.distanceBandCode)),
    });
    if (!band) {
      return NextResponse.json({ error: `Distance band "${data.distanceBandCode}" does not exist for this tenant` }, { status: 422 });
    }
    if (!band.isActive) {
      return NextResponse.json({ error: `Distance band "${data.distanceBandCode}" has been retired and cannot be newly assigned` }, { status: 422 });
    }
  }

  const updates: Record<string, unknown> = {};
  for (const key of Object.keys(body)) {
    if (key in data) updates[key] = (data as Record<string, unknown>)[key];
  }
  if (Object.keys(updates).length > 0) {
    await db.update(customerLocations).set(updates).where(eq(customerLocations.id, locationId));
  }

  const updated = await db.query.customerLocations.findFirst({ where: eq(customerLocations.id, locationId) });
  return NextResponse.json(updated);
}
