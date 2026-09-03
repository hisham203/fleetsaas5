export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { contractPricingRules, contracts, distanceBands } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { genId } from "@/lib/helpers";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";

// Contract Management Task C — Pricing Rules API. Manages
// contract_pricing_rules rows only. Creating/editing a rule here has zero
// effect on any order, trip, or invoice today — nothing yet calls
// lib/contractPricing.ts from anywhere in the order/trip/invoice
// lifecycle. ADMIN-only, consistent with Task B's Contract API.
const createSchema = z
  .object({
    pricingScope: z.enum(["TENANT_DEFAULT", "CONTRACT"]),
    contractId: z.string().min(1).optional(),
    rateType: z.enum(["STANDARD", "OVERAGE"]),
    cityCode: z.string().min(1).optional(),
    zoneCode: z.string().min(1).optional(),
    distanceBandCode: z.string().min(1).optional(),
    tankerCapacityLtr: z.number().int().positive().optional(),
    priority: z.number().int().optional(),
    pricePerTrip: z.number().positive().optional(),
    pricePerLiter: z.number().positive().optional(),
    vatRate: z.number().min(0).max(1).default(0.15),
    effectiveStartDate: z.coerce.date().optional(),
    effectiveEndDate: z.coerce.date().optional(),
  })
  .refine((d) => (d.pricingScope === "CONTRACT") === (d.contractId != null), {
    message: "contractId is required when pricingScope is CONTRACT, and must be omitted when pricingScope is TENANT_DEFAULT",
    path: ["contractId"],
  })
  .refine((d) => (d.pricePerTrip != null) !== (d.pricePerLiter != null), {
    message: "Exactly one of pricePerTrip or pricePerLiter must be provided",
    path: ["pricePerTrip"],
  });

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;

  const { searchParams } = new URL(req.url);
  const conditions = [eq(contractPricingRules.tenantId, tenantId)];
  const contractId = searchParams.get("contractId");
  const pricingScope = searchParams.get("pricingScope");
  const rateType = searchParams.get("rateType");
  const cityCode = searchParams.get("cityCode");
  const zoneCode = searchParams.get("zoneCode");
  const distanceBandCode = searchParams.get("distanceBandCode");
  const tankerCapacityLtr = searchParams.get("tankerCapacityLtr");
  if (contractId) conditions.push(eq(contractPricingRules.contractId, contractId));
  if (pricingScope) conditions.push(eq(contractPricingRules.pricingScope, pricingScope));
  if (rateType) conditions.push(eq(contractPricingRules.rateType, rateType));
  if (cityCode) conditions.push(eq(contractPricingRules.cityCode, cityCode));
  if (zoneCode) conditions.push(eq(contractPricingRules.zoneCode, zoneCode));
  if (distanceBandCode) conditions.push(eq(contractPricingRules.distanceBandCode, distanceBandCode));
  if (tankerCapacityLtr) conditions.push(eq(contractPricingRules.tankerCapacityLtr, Number(tankerCapacityLtr)));

  const rows = await db.query.contractPricingRules.findMany({
    where: and(...conditions),
    orderBy: desc(contractPricingRules.createdAt),
  });
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  if (data.pricingScope === "CONTRACT") {
    const contract = await db.query.contracts.findFirst({
      where: and(eq(contracts.id, data.contractId!), eq(contracts.tenantId, tenantId)),
    });
    if (!contract) {
      return NextResponse.json({ error: "Contract not found" }, { status: 404 });
    }
  }

  if (data.distanceBandCode) {
    const band = await db.query.distanceBands.findFirst({
      where: and(eq(distanceBands.tenantId, tenantId), eq(distanceBands.code, data.distanceBandCode)),
    });
    if (!band) {
      return NextResponse.json({ error: `Distance band "${data.distanceBandCode}" not found for this tenant` }, { status: 404 });
    }
  }

  // A practical, targeted duplicate check — not a substitute for the
  // pricing engine's own full specificity/priority ambiguity detection at
  // lookup time, but catches the simple, common mistake of creating the
  // exact same rule (same scope/contract/rateType/dimensions) with
  // overlapping effective dates before it ever reaches a real lookup.
  const exactMatches = await db.query.contractPricingRules.findMany({
    where: and(
      eq(contractPricingRules.tenantId, tenantId),
      eq(contractPricingRules.pricingScope, data.pricingScope),
      eq(contractPricingRules.rateType, data.rateType),
      data.pricingScope === "CONTRACT" ? eq(contractPricingRules.contractId, data.contractId!) : undefined
    ),
  });
  const newStart = data.effectiveStartDate ?? null;
  const newEnd = data.effectiveEndDate ?? null;
  const overlaps = (aStart: Date | null, aEnd: Date | null, bStart: Date | null, bEnd: Date | null) =>
    (aStart == null || bEnd == null || aStart <= bEnd) && (aEnd == null || bStart == null || aEnd >= bStart);
  const duplicate = exactMatches.find(
    (r) =>
      (r.cityCode ?? null) === (data.cityCode ?? null) &&
      (r.zoneCode ?? null) === (data.zoneCode ?? null) &&
      (r.distanceBandCode ?? null) === (data.distanceBandCode ?? null) &&
      (r.tankerCapacityLtr ?? null) === (data.tankerCapacityLtr ?? null) &&
      overlaps(r.effectiveStartDate, r.effectiveEndDate, newStart, newEnd)
  );
  if (duplicate) {
    return NextResponse.json(
      { error: `An identical pricing rule (${duplicate.id}) already exists with an overlapping effective date range` },
      { status: 409 }
    );
  }

  const id = genId();
  await db.insert(contractPricingRules).values({
    id,
    tenantId,
    pricingScope: data.pricingScope,
    contractId: data.pricingScope === "CONTRACT" ? data.contractId : undefined,
    rateType: data.rateType,
    cityCode: data.cityCode,
    zoneCode: data.zoneCode,
    distanceBandCode: data.distanceBandCode,
    tankerCapacityLtr: data.tankerCapacityLtr,
    priority: data.priority,
    pricePerTrip: data.pricePerTrip,
    pricePerLiter: data.pricePerLiter,
    vatRate: data.vatRate,
    effectiveStartDate: data.effectiveStartDate,
    effectiveEndDate: data.effectiveEndDate,
  });

  const created = await db.query.contractPricingRules.findFirst({ where: eq(contractPricingRules.id, id) });
  return NextResponse.json(created, { status: 201 });
}
