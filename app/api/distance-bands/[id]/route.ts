export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { distanceBands, contractPricingRules, customerLocations } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

const patchSchema = z.object({
  label: z.string().min(1).optional(),
  fromKm: z.number().min(0).optional(),
  toKm: z.number().min(0).nullable().optional(),
});

async function isBandInUse(code: string) {
  const [ruleUsage, siteUsage] = await Promise.all([
    db.query.contractPricingRules.findFirst({ where: eq(contractPricingRules.distanceBandCode, code) }),
    db.query.customerLocations.findFirst({ where: eq(customerLocations.distanceBandCode, code) }),
  ]);
  return Boolean(ruleUsage || siteUsage);
}

// label is always editable — cosmetic, not range-defining. fromKm/toKm
// (the range itself) can only change while the band is genuinely unused —
// once a pricing rule or a customer site references this band's code,
// editing its range would silently change what that reference means
// retroactively, exactly the drift this table's immutability rule (see
// its schema comment) exists to prevent. The correct alternative once in
// use: retire this band (DELETE) and create a new one with the
// corrected range.
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

  const band = await db.query.distanceBands.findFirst({
    where: and(eq(distanceBands.id, id), eq(distanceBands.tenantId, tenantId)),
  });
  if (!band) return NextResponse.json({ error: "Distance band not found" }, { status: 404 });

  const attemptsRangeEdit = data.fromKm !== undefined || data.toKm !== undefined;
  if (attemptsRangeEdit && (await isBandInUse(band.code))) {
    return NextResponse.json(
      {
        error:
          "This band's range cannot be edited — it's already referenced by a pricing rule or customer site. " +
          "Retire this band and create a new one with the corrected range instead.",
      },
      { status: 422 }
    );
  }

  const nextFromKm = data.fromKm !== undefined ? data.fromKm : band.fromKm;
  const nextToKm = data.toKm !== undefined ? data.toKm : band.toKm;
  if (nextToKm != null && nextToKm <= nextFromKm) {
    return NextResponse.json({ error: "toKm must be greater than fromKm" }, { status: 400 });
  }

  await db
    .update(distanceBands)
    .set({
      label: data.label !== undefined ? data.label : undefined,
      fromKm: data.fromKm !== undefined ? data.fromKm : undefined,
      toKm: data.toKm !== undefined ? data.toKm : undefined,
    })
    .where(eq(distanceBands.id, id));

  const updated = await db.query.distanceBands.findFirst({ where: eq(distanceBands.id, id) });
  return NextResponse.json(updated);
}

// Retirement, never a hard delete — the schema's own isActive/retiredAt
// fields exist specifically for this (see distance_bands' schema
// comment). Retiring is safe even if the band is currently referenced:
// the row and its code both remain intact, so existing references stay
// structurally valid — retiring only prevents assigning this band to
// anything new going forward.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;

  const band = await db.query.distanceBands.findFirst({
    where: and(eq(distanceBands.id, id), eq(distanceBands.tenantId, tenantId)),
  });
  if (!band) return NextResponse.json({ error: "Distance band not found" }, { status: 404 });

  if (band.isActive) {
    await db.update(distanceBands).set({ isActive: false, retiredAt: new Date() }).where(eq(distanceBands.id, id));
  }

  return NextResponse.json({ success: true, retired: true });
}
