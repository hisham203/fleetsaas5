export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { contracts, contractPeriods, invoices } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { calculateContractPrice, PricingEngineError } from "@/lib/contractPricing";
import { determineRateType } from "@/lib/contractEligibility";
import { getBillableOrdersForPeriod } from "@/lib/monthlyBillingEligibility";
import { eq, and } from "drizzle-orm";

// Task I.5A — Monthly Billing Readiness / Preview. Strictly read-only:
// this route never writes to invoices, invoice_line_items,
// contract_periods, orders, or anywhere else. It exists so an admin can
// see exactly what POST /api/contracts/[id]/generate-monthly-invoice
// would do before ever calling it — which this route also never calls.
//
// Shares its eligibility logic with that route via
// lib/monthlyBillingEligibility.ts (both call the exact same function,
// so there is no separate "preview eligibility" that could drift from
// "real eligibility"), and its pricing logic via the same
// calculateContractPrice() the real route uses. The one deliberate
// behavioral difference: the real route aborts entirely on the first
// pricing failure (a correct all-or-nothing guarantee for something that
// writes an invoice); this route continues past a failure so it can
// report every blocking order at once, which is more useful for a
// preview and writes nothing regardless of how many orders fail.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: contractId } = await params;
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;

  const contract = await db.query.contracts.findFirst({
    where: and(eq(contracts.id, contractId), eq(contracts.tenantId, tenantId)),
  });
  if (!contract) return NextResponse.json({ error: "Contract not found" }, { status: 404 });
  if (contract.type !== "MONTHLY_ACCUMULATED") {
    return NextResponse.json(
      { error: "Monthly billing preview only applies to MONTHLY_ACCUMULATED contracts" },
      { status: 422 }
    );
  }

  // Query params are accepted for testability (checking a specific past
  // period) but the UI never exposes date pickers for this — it always
  // calls this with no params, getting "the current calendar month",
  // matching the simple "Current billing period" framing this task asks
  // for. This is a preview-only convenience; the real generation route
  // still takes explicit, caller-chosen dates and is unaffected.
  const url = new URL(req.url);
  const now = new Date();
  const periodStartParam = url.searchParams.get("periodStart");
  const periodEndParam = url.searchParams.get("periodEnd");
  const periodStart = periodStartParam ? new Date(periodStartParam) : new Date(now.getFullYear(), now.getMonth(), 1);
  const periodEnd = periodEndParam ? new Date(periodEndParam) : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime()) || periodStart >= periodEnd) {
    return NextResponse.json({ error: "Invalid period" }, { status: 400 });
  }

  const billingPeriod = {
    start: periodStart.toISOString(),
    end: periodEnd.toISOString(),
    label: periodStart.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
  };

  const blockers: string[] = [];
  const warnings: string[] = [];

  const contractEnd = contract.endDate ?? null;
  const overlaps = periodStart <= (contractEnd ?? periodStart) && periodEnd >= contract.startDate;
  if (!overlaps) {
    return NextResponse.json({
      contractId: contract.id,
      contractNumber: contract.contractNumber,
      contractType: contract.type,
      billingPeriod,
      eligibleOrdersCount: 0,
      excludedOrdersCount: 0,
      pricingReady: false,
      standardPricingPresent: null,
      expectedSubtotal: 0,
      expectedVat: 0,
      expectedTotal: 0,
      currency: "SAR",
      existingInvoice: null,
      readiness: "NOT_READY",
      blockers: ["The current period does not overlap this contract's active date range."],
      warnings: [],
    });
  }

  if (contract.status !== "ACTIVE") {
    warnings.push(`Contract status is ${contract.status}, not ACTIVE — generation would currently be rejected even if otherwise ready.`);
  }

  // Already billed for this exact period? Mirrors the real route's own
  // find-by-(contractId, periodStart, periodEnd) lookup exactly, so a
  // period this preview calls "already billed" is the same one the real
  // route would refuse to re-invoice.
  const existingPeriod = await db.query.contractPeriods.findFirst({
    where: and(
      eq(contractPeriods.contractId, contract.id),
      eq(contractPeriods.periodStart, periodStart),
      eq(contractPeriods.periodEnd, periodEnd)
    ),
  });
  if (existingPeriod?.status === "INVOICED") {
    const existingInvoiceRow = await db.query.invoices.findFirst({ where: eq(invoices.contractPeriodId, existingPeriod.id) });
    return NextResponse.json({
      contractId: contract.id,
      contractNumber: contract.contractNumber,
      contractType: contract.type,
      billingPeriod,
      eligibleOrdersCount: 0,
      excludedOrdersCount: 0,
      pricingReady: true,
      standardPricingPresent: null,
      expectedSubtotal: existingInvoiceRow?.subtotal ?? null,
      expectedVat: existingInvoiceRow?.vatAmount ?? null,
      expectedTotal: existingInvoiceRow?.total ?? null,
      currency: "SAR",
      existingInvoice: existingInvoiceRow
        ? { invoiceId: existingInvoiceRow.id, invoiceNumber: existingInvoiceRow.invoiceNumber, total: existingInvoiceRow.total, status: existingInvoiceRow.status }
        : null,
      readiness: "ALREADY_BILLED",
      blockers: [],
      warnings: [],
    });
  }

  const { billableOrders, excludedOrders } = await getBillableOrdersForPeriod(tenantId, contract.id, periodStart, periodEnd);

  const rateType = determineRateType(contract);
  const priced: { orderId: string; orderNumber: string; baseAmount: number; vatAmount: number }[] = [];
  const pricingFailures: { orderId: string; orderNumber: string; reason: string }[] = [];

  for (const order of billableOrders) {
    try {
      const vehicleCapacity = (order as any).tripStop?.trip?.vehicle?.capacityLiters ?? null;
      const result = await calculateContractPrice({
        tenantId,
        customerId: contract.customerId,
        contractId: contract.id,
        pricingDate: order.completedAt!,
        cityCode: (order as any).location?.cityCode ?? null,
        zoneCode: (order as any).location?.zoneCode ?? null,
        distanceBandCode: (order as any).location?.distanceBandCode ?? null,
        tankerCapacityLtr: vehicleCapacity,
        rateType,
        quantityLiters: order.qtyOrdered,
      });
      priced.push({ orderId: order.id, orderNumber: order.orderNumber, baseAmount: result.baseAmount, vatAmount: result.vatAmount });
    } catch (err) {
      // Deliberately caught per-order here, unlike the real route (which
      // aborts entirely on the first one) — this is the one intentional
      // behavioral difference documented above, and it never writes
      // anything either way.
      const reason = err instanceof PricingEngineError ? err.message : "Unexpected pricing error";
      pricingFailures.push({ orderId: order.id, orderNumber: order.orderNumber, reason });
    }
  }

  for (const f of pricingFailures) {
    blockers.push(`Order ${f.orderNumber} has no valid pricing: ${f.reason}`);
  }
  if (billableOrders.length === 0) {
    blockers.push("No delivered, unbilled orders found for this contract in the current period.");
  }
  if (excludedOrders.length > 0) {
    warnings.push(`${excludedOrders.length} order(s) in this period were excluded because they're already billed on a prior invoice.`);
  }

  const standardPricingPresent = pricingFailures.length === 0 && billableOrders.length > 0;
  const subtotal = Math.round(priced.reduce((s, l) => s + l.baseAmount, 0) * 100) / 100;
  const vat = Math.round(priced.reduce((s, l) => s + l.vatAmount, 0) * 100) / 100;
  const total = Math.round((subtotal + vat) * 100) / 100;

  const readiness = blockers.length > 0 ? "NOT_READY" : "READY";

  return NextResponse.json({
    contractId: contract.id,
    contractNumber: contract.contractNumber,
    contractType: contract.type,
    billingPeriod,
    eligibleOrdersCount: billableOrders.length,
    eligibleOrderIds: billableOrders.map((o) => o.id),
    excludedOrdersCount: excludedOrders.length,
    pricingReady: standardPricingPresent,
    standardPricingPresent,
    pricingFailures,
    expectedSubtotal: subtotal,
    expectedVat: vat,
    expectedTotal: total,
    currency: "SAR",
    existingInvoice: null,
    readiness,
    blockers,
    warnings,
  });
}
