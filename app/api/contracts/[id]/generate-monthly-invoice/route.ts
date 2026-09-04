export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { contracts, contractPeriods, invoices, invoiceLineItems, customerLocations } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { genId, genNumber, VAT_RATE } from "@/lib/helpers";
import { calculateContractPrice, PricingEngineError } from "@/lib/contractPricing";
import { determineRateType } from "@/lib/contractEligibility";
import { getBillableOrdersForPeriod } from "@/lib/monthlyBillingEligibility";
import { runAutomationRules } from "@/lib/automation";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

// Task E — Manual Monthly Billing Foundation. API-only, manually
// triggered by an ADMIN for one contract/period at a time — no
// scheduler, no automatic month-end job, exactly as scoped. Only
// MONTHLY_ACCUMULATED contracts are eligible; ONE_TIME_TRIP_COUNT
// contracts are billed per-delivery already (unchanged, untouched by
// this task) and have no monthly concept at all.
const requestSchema = z
  .object({
    periodStart: z.coerce.date(),
    periodEnd: z.coerce.date(),
  })
  .refine((d) => d.periodStart < d.periodEnd, {
    message: "periodStart must be before periodEnd",
    path: ["periodEnd"],
  });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: contractId } = await params;
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;
  const userId = session!.type === "USER" ? session!.user.id : null;

  const body = await req.json();
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { periodStart, periodEnd } = parsed.data;

  const contract = await db.query.contracts.findFirst({
    where: and(eq(contracts.id, contractId), eq(contracts.tenantId, tenantId)),
  });
  if (!contract) return NextResponse.json({ error: "Contract not found" }, { status: 404 });
  if (contract.type !== "MONTHLY_ACCUMULATED") {
    return NextResponse.json(
      { error: "Manual monthly invoicing only applies to MONTHLY_ACCUMULATED contracts" },
      { status: 422 }
    );
  }
  if (contract.status !== "ACTIVE") {
    return NextResponse.json({ error: `Contract is ${contract.status}, not ACTIVE` }, { status: 422 });
  }

  // The requested period must genuinely overlap the contract's own active
  // date range — billing for a period entirely before the contract
  // started, or entirely after it ended, doesn't make sense.
  const contractEnd = contract.endDate ?? null;
  const overlaps = periodStart <= (contractEnd ?? periodStart) && periodEnd >= contract.startDate;
  if (!overlaps) {
    return NextResponse.json({ error: "The requested period does not overlap this contract's active date range" }, { status: 422 });
  }

  // Find-or-create the contract_period bucket for this exact range,
  // relying on the existing unique index (contractId, periodStart,
  // periodEnd) to prevent duplicates — matching the exact shape that
  // constraint was built for.
  let period = await db.query.contractPeriods.findFirst({
    where: and(
      eq(contractPeriods.contractId, contract.id),
      eq(contractPeriods.periodStart, periodStart),
      eq(contractPeriods.periodEnd, periodEnd)
    ),
  });
  if (period?.status === "INVOICED") {
    return NextResponse.json({ error: "This period has already been invoiced" }, { status: 422 });
  }

  // Billable orders: this contract, delivered (fully or partially) within
  // the requested period, not already billed on any prior invoice. Site
  // scope is not re-checked here — an order can only ever have this
  // contractId set in the first place by having already passed
  // validateContractEligibility() at order-creation time (Task D), which
  // includes the site-scope check; appliesToAllSites cannot change after
  // a contract is created (Task B's PATCH route doesn't allow it), so
  // that validation can't have gone stale since.
  const { billableOrders } = await getBillableOrdersForPeriod(tenantId, contract.id, periodStart, periodEnd);

  if (billableOrders.length === 0) {
    return NextResponse.json({ error: "No billable delivered orders found for this contract in the requested period" }, { status: 422 });
  }

  // Price every order BEFORE opening the transaction — calculateContractPrice
  // throws PricingEngineError on any missing/ambiguous rule, and that
  // must abort the entire operation with nothing written at all (no
  // partial invoice), which happens naturally here since nothing has
  // been inserted yet if this loop throws.
  const rateType = determineRateType(contract); // always STANDARD for MONTHLY_ACCUMULATED — no included-allowance concept to exceed
  const pricedLines: { order: (typeof billableOrders)[number]; result: Awaited<ReturnType<typeof calculateContractPrice>> }[] = [];
  try {
    for (const order of billableOrders) {
      const vehicleCapacity = order.tripStop?.trip?.vehicle?.capacityLiters ?? null;
      const result = await calculateContractPrice({
        tenantId,
        customerId: contract.customerId,
        contractId: contract.id,
        pricingDate: order.completedAt!,
        cityCode: order.location?.cityCode ?? null,
        zoneCode: order.location?.zoneCode ?? null,
        distanceBandCode: order.location?.distanceBandCode ?? null,
        tankerCapacityLtr: vehicleCapacity,
        rateType,
        quantityLiters: order.qtyOrdered,
      });
      pricedLines.push({ order, result });
    }
  } catch (err) {
    // Nothing has been written yet at this point (the transaction below
    // hasn't opened) — this is naturally an all-or-nothing failure, not a
    // partial invoice, exactly as required. Returned as a clear, valid
    // JSON 422 rather than an unhandled exception reaching the client as
    // an empty-bodied 500, matching the S1 hotfix's standing rule for
    // this codebase: every route always returns valid JSON, error or not.
    if (err instanceof PricingEngineError) {
      return NextResponse.json(
        { error: `Invoice generation failed: order ${err.message}`, errorCode: err.code },
        { status: 422 }
      );
    }
    console.error("POST /api/contracts/[id]/generate-monthly-invoice pricing failure:", err);
    return NextResponse.json({ error: "Invoice generation failed due to an unexpected pricing error" }, { status: 500 });
  }

  const subtotal = Math.round(pricedLines.reduce((sum, l) => sum + l.result.baseAmount, 0) * 100) / 100;
  const vatAmount = Math.round(pricedLines.reduce((sum, l) => sum + l.result.vatAmount, 0) * 100) / 100;
  const total = Math.round((subtotal + vatAmount) * 100) / 100;

  const invoiceId = genId();
  const invoiceNumber = genNumber("INV");
  const periodId = period?.id ?? genId();

  await db.transaction(async (tx) => {
    if (!period) {
      await tx.insert(contractPeriods).values({
        id: periodId,
        tenantId,
        contractId: contract.id,
        periodStart,
        periodEnd,
        status: "OPEN",
      });
    }

    await tx.insert(invoices).values({
      id: invoiceId,
      tenantId,
      invoiceNumber,
      orderId: undefined, // deliberately null — a monthly consolidated invoice has no single order
      contractPeriodId: periodId,
      customerId: contract.customerId,
      subtotal,
      // vatRate here is informational metadata (the tenant's typical
      // rate), not a strict per-invoice multiplier — this invoice's real
      // vatAmount is the sum of each line's own frozen amount, which can
      // legitimately differ per line if pricing rules were configured
      // with different rates. Same "copied for record-keeping" spirit
      // already established by discountAmount's own schema comment.
      vatRate: VAT_RATE,
      vatAmount,
      total,
      status: "PENDING",
    });

    for (const { order, result } of pricedLines) {
      await tx.insert(invoiceLineItems).values({
        id: genId(),
        tenantId,
        invoiceId,
        orderId: order.id,
        description: `Monthly delivery order ${order.orderNumber}${order.location ? ` — ${order.location.label}` : ""}`,
        quantity: order.qtyOrdered,
        unitPrice: order.qtyOrdered > 0 ? Math.round((result.baseAmount / order.qtyOrdered) * 100) / 100 : result.baseAmount,
        lineAmount: result.baseAmount,
        lineVatAmount: result.vatAmount,
      });
    }

    await tx
      .update(contractPeriods)
      .set({ status: "INVOICED", invoicedAt: new Date(), invoicedByUserId: userId ?? undefined })
      .where(eq(contractPeriods.id, periodId));
  });

  await runAutomationRules(tenantId, "INVOICE_CREATED", { orderId: undefined, total, status: "PENDING" }).catch(() => {});

  return NextResponse.json(
    {
      invoiceId,
      invoiceNumber,
      contractId: contract.id,
      contractPeriodId: periodId,
      customerId: contract.customerId,
      periodStart,
      periodEnd,
      ordersCount: billableOrders.length,
      lineItemsCount: pricedLines.length,
      subtotal,
      vatAmount,
      totalAmount: total,
      currency: "SAR",
      lineItems: pricedLines.map(({ order, result }) => ({
        orderId: order.id,
        orderNumber: order.orderNumber,
        baseAmount: result.baseAmount,
        vatAmount: result.vatAmount,
        totalAmount: result.totalAmount,
        selectedRuleId: result.selectedRuleId,
      })),
    },
    { status: 201 }
  );
}
