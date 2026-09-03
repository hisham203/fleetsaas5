export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { contractPricingRules } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

// PATCH policy — deliberately not free-form editing of every field:
// pricingScope and contractId are never editable at all (changing either
// redefines what the rule fundamentally is, not a normal edit — same
// principle as contracts.customerId/type being non-editable in Task B).
// priority and effectiveEndDate can always be changed (neither retroactively
// changes a price that was already calculated in the past — extending or
// shortening validity is a forward-looking change, and any resulting
// ambiguity is caught by the pricing engine's own hard-fail at lookup
// time, not something this route needs to pre-validate exhaustively).
// Price-affecting fields (pricePerTrip, pricePerLiter, vatRate, and the
// matching dimensions themselves) can only be edited while the rule has
// never gone live — effectiveStartDate is null or still in the future.
// Once a rule has started, editing its price/dimensions in place would
// silently change what a past calculation "would look like" if replayed —
// the safer, explained alternative (per this task's own suggestion) is to
// end this rule's effectiveEndDate and create a new one instead of a
// destructive edit.
const patchSchema = z.object({
  priority: z.number().int().nullable().optional(),
  effectiveEndDate: z.coerce.date().nullable().optional(),
  cityCode: z.string().min(1).nullable().optional(),
  zoneCode: z.string().min(1).nullable().optional(),
  distanceBandCode: z.string().min(1).nullable().optional(),
  tankerCapacityLtr: z.number().int().positive().nullable().optional(),
  pricePerTrip: z.number().positive().nullable().optional(),
  pricePerLiter: z.number().positive().nullable().optional(),
  vatRate: z.number().min(0).max(1).optional(),
});

const PRICE_AFFECTING_FIELDS = ["cityCode", "zoneCode", "distanceBandCode", "tankerCapacityLtr", "pricePerTrip", "pricePerLiter", "vatRate"] as const;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;

  const rule = await db.query.contractPricingRules.findFirst({
    where: and(eq(contractPricingRules.id, id), eq(contractPricingRules.tenantId, tenantId)),
  });
  if (!rule) return NextResponse.json({ error: "Pricing rule not found" }, { status: 404 });
  return NextResponse.json(rule);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;

  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  const rule = await db.query.contractPricingRules.findFirst({
    where: and(eq(contractPricingRules.id, id), eq(contractPricingRules.tenantId, tenantId)),
  });
  if (!rule) return NextResponse.json({ error: "Pricing rule not found" }, { status: 404 });

  const hasStarted = rule.effectiveStartDate != null && rule.effectiveStartDate <= new Date();
  const attemptedPriceEdit = PRICE_AFFECTING_FIELDS.some((f) => data[f] !== undefined);
  if (hasStarted && attemptedPriceEdit) {
    return NextResponse.json(
      {
        error:
          "This rule is already effective — its price and matching dimensions cannot be edited in place. " +
          "Set effectiveEndDate to end it and create a new rule instead, so historical pricing stays correct.",
      },
      { status: 422 }
    );
  }

  // Re-validate price configuration if either price field is being
  // touched, using the same "exactly one" rule as creation.
  const nextPricePerTrip = data.pricePerTrip !== undefined ? data.pricePerTrip : rule.pricePerTrip;
  const nextPricePerLiter = data.pricePerLiter !== undefined ? data.pricePerLiter : rule.pricePerLiter;
  if ((nextPricePerTrip != null) === (nextPricePerLiter != null)) {
    return NextResponse.json({ error: "Exactly one of pricePerTrip or pricePerLiter must be set" }, { status: 400 });
  }

  await db
    .update(contractPricingRules)
    .set({
      priority: data.priority !== undefined ? data.priority : undefined,
      effectiveEndDate: data.effectiveEndDate !== undefined ? data.effectiveEndDate : undefined,
      cityCode: data.cityCode !== undefined ? data.cityCode : undefined,
      zoneCode: data.zoneCode !== undefined ? data.zoneCode : undefined,
      distanceBandCode: data.distanceBandCode !== undefined ? data.distanceBandCode : undefined,
      tankerCapacityLtr: data.tankerCapacityLtr !== undefined ? data.tankerCapacityLtr : undefined,
      pricePerTrip: data.pricePerTrip !== undefined ? data.pricePerTrip : undefined,
      pricePerLiter: data.pricePerLiter !== undefined ? data.pricePerLiter : undefined,
      vatRate: data.vatRate !== undefined ? data.vatRate : undefined,
    })
    .where(eq(contractPricingRules.id, id));

  const updated = await db.query.contractPricingRules.findFirst({ where: eq(contractPricingRules.id, id) });
  return NextResponse.json(updated);
}

// Soft delete via effectiveEndDate, not a hard row delete — no isActive/
// status column exists on this table (unlike distance_bands, which has
// one), but effectiveEndDate already serves exactly this purpose: setting
// it to "now" makes the rule permanently ineligible for any future
// pricing lookup (see lib/contractPricing.ts's effective-date filter)
// while preserving its historical record intact. This required no schema
// change — the existing column already does the job.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;

  const rule = await db.query.contractPricingRules.findFirst({
    where: and(eq(contractPricingRules.id, id), eq(contractPricingRules.tenantId, tenantId)),
  });
  if (!rule) return NextResponse.json({ error: "Pricing rule not found" }, { status: 404 });

  const now = new Date();
  const alreadyEnded = rule.effectiveEndDate != null && rule.effectiveEndDate <= now;
  if (!alreadyEnded) {
    await db.update(contractPricingRules).set({ effectiveEndDate: now }).where(eq(contractPricingRules.id, id));
  }

  return NextResponse.json({ success: true, deactivated: true });
}
