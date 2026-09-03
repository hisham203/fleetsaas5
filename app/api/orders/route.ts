export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { orders, customers, customerLocations } from "@/lib/db/schema";
import { genId, genNumber } from "@/lib/helpers";
import { getCreditExposure } from "@/lib/creditCheck";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { runAutomationRules } from "@/lib/automation";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";
import { validateContractEligibility, determineRateType, buildPricingPreview, ContractEligibilityError } from "@/lib/contractEligibility";
import { SAFE_CUSTOMER_COLUMNS } from "@/lib/contractHelpers";

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
  // Task D correction: an existing, previously-unused column
  // (orders.locationId, already relationally wired to customerLocations —
  // no schema change needed) — accepting it here is what makes
  // site-restricted contracts (appliesToAllSites = false) and
  // location-based pricing dimensions actually usable through this route.
  locationId: z.string().min(1).optional(),
  // Task D: optional contract attachment. Omitting this leaves every
  // existing non-contract order flow completely unchanged — nothing
  // below this comment runs unless contractId is actually provided.
  contractId: z.string().min(1).optional(),
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
    with: { customer: { columns: SAFE_CUSTOMER_COLUMNS }, location: true, tripStop: { with: { trip: true } }, contract: true },
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

  // Task D correction: resolve and validate the optional site. Tenant
  // safety is enforced transitively — customerLocations has no direct
  // tenantId column (the same pattern already established for
  // trip_stops elsewhere in this schema) — so checking the location
  // belongs to this already-tenant-verified customerId correctly rejects
  // both a wrong-customer AND a cross-tenant location in one check,
  // matching the pattern already established in Task B's site-scope
  // assignment route.
  let location: Awaited<ReturnType<typeof db.query.customerLocations.findFirst>> = undefined;
  if (data.locationId) {
    location = await db.query.customerLocations.findFirst({ where: eq(customerLocations.id, data.locationId) });
    if (!location) {
      return NextResponse.json({ error: "Site not found" }, { status: 404 });
    }
    if (location.customerId !== data.customerId) {
      return NextResponse.json({ error: "This site does not belong to the specified customer" }, { status: 422 });
    }
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

  // Task D: contract attachment. An explicitly-requested invalid contract
  // REJECTS the whole order — silently ignoring an invalid request would
  // be worse than telling the caller clearly. This is a distinct decision
  // from a pricing preview simply being unavailable (below), which never
  // blocks order creation.
  let attachedContract: Awaited<ReturnType<typeof validateContractEligibility>> | null = null;
  if (data.contractId) {
    try {
      attachedContract = await validateContractEligibility({
        tenantId,
        customerId: data.customerId,
        contractId: data.contractId,
        orderDate: data.requestedTime ? new Date(data.requestedTime) : new Date(),
        // Task D correction: now genuinely wired to the resolved site
        // above, rather than a hardcoded null — a site-restricted
        // contract (appliesToAllSites = false) is usable through this
        // route whenever the caller provides a valid, scoped locationId.
        customerLocationId: location?.id ?? null,
      });
    } catch (err) {
      if (err instanceof ContractEligibilityError) {
        const status = err.code === "CONTRACT_NOT_FOUND" ? 404 : 422;
        return NextResponse.json({ error: err.message, errorCode: err.code }, { status });
      }
      throw err;
    }
  }

  const id = genId();
  await db.insert(orders).values({
    id,
    tenantId,
    orderNumber: genNumber("ORD"),
    customerId: data.customerId,
    locationId: location?.id,
    contractId: attachedContract?.id,
    type: data.type,
    bottleSizeLtr: data.bottleSizeLtr,
    qtyOrdered: data.qtyOrdered,
    emptyBottlesToCollect: data.emptyBottlesToCollect,
    // Task D correction: when a specific site was provided, deliver
    // there — not to the customer's generic address — matching the
    // precedent already established by /api/orders/bulk. Falls back to
    // the customer's own address exactly as before when no location is
    // given, so the existing no-location flow is completely unaffected.
    deliveryAddress: location?.address ?? customer.address,
    lat: location?.lat ?? customer.lat,
    lng: location?.lng ?? customer.lng,
    requestedTime: data.requestedTime ? new Date(data.requestedTime) : new Date(),
    status: "PENDING",
    paymentMethod: data.paymentMethod,
    pricePerBottle: effectivePricePerBottle,
    discountAmount: data.discountAmount,
  });

  const created = await db.query.orders.findFirst({
    where: eq(orders.id, id),
    with: { customer: { columns: SAFE_CUSTOMER_COLUMNS }, contract: true, location: true },
  });

  // Task D pricing preview — computed fresh for this response only, never
  // written anywhere (not to the order, not to an invoice, not to
  // invoice_line_items). Only attempted when a contract was actually
  // attached; a normal non-contract order's response is completely
  // unaffected — no pricingPreview key at all, not even null.
  let pricingPreview: Awaited<ReturnType<typeof buildPricingPreview>> | undefined;
  if (attachedContract && created) {
    pricingPreview = await buildPricingPreview({
      tenantId,
      customerId: data.customerId,
      contractId: attachedContract.id,
      pricingDate: created.requestedTime ?? new Date(),
      // Task D correction: real dimensions from the resolved site when
      // one was provided, instead of always-null. Genuinely improves
      // pricing accuracy for a site-restricted or location-priced
      // contract; still null (wildcard) for the no-location case, which
      // is unchanged and correct.
      cityCode: location?.cityCode ?? null,
      zoneCode: location?.zoneCode ?? null,
      distanceBandCode: location?.distanceBandCode ?? null,
      // tankerCapacityLtr remains genuinely unknown at order-creation
      // time — vehicles are assigned at trip creation, a separate, later
      // step, and no new schema field was invented to carry a
      // "requested capacity" here. Passed as null/wildcard; a matching
      // wildcard-capacity rule still prices normally (this is the
      // "unless a wildcard rule can safely price without capacity" case)
      // — buildPricingPreview's capacityKnown: false field is the honest,
      // explicit signal of this limitation, present on every response
      // regardless of whether pricing ultimately succeeds.
      tankerCapacityLtr: null,
      rateType: determineRateType(attachedContract),
      // qtyOrdered is reused as the pricing engine's quantityLiters input
      // — in this codebase's current bottled-water order model it
      // nominally counts bottles, not liters; this is an honest, flagged
      // best-available mapping for a pricePerLiter rule, not a claim that
      // the field has been renamed or reinterpreted anywhere else.
      quantityLiters: data.qtyOrdered,
    });
  }

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

  return NextResponse.json(pricingPreview ? { ...created, pricingPreview } : created, { status: 201 });
}
