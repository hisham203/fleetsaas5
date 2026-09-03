export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { distanceBands } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { genId } from "@/lib/helpers";
import { eq, and, asc } from "drizzle-orm";
import { z } from "zod";

// Contract Management Task C — Distance Bands API. Implemented because
// distanceBandCode is a real pricing dimension (contract_pricing_rules,
// customerLocations) that needs somewhere to be created/managed for
// pricing setup to be usable/testable at all — kept intentionally minimal
// beyond that: no edit-history UI, no bulk import, nothing speculative.
const createSchema = z
  .object({
    code: z.string().min(1),
    fromKm: z.number().min(0),
    toKm: z.number().min(0).nullable().optional(),
    label: z.string().min(1),
  })
  .refine((d) => d.toKm == null || d.toKm > d.fromKm, {
    message: "toKm must be greater than fromKm (or omitted for an open-ended upper bound)",
    path: ["toKm"],
  });

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;

  const rows = await db.query.distanceBands.findMany({
    where: eq(distanceBands.tenantId, tenantId),
    orderBy: asc(distanceBands.fromKm),
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

  // Tenant-scoped uniqueness — the same code is fine in a different
  // tenant (the DB-level unique index is itself on (tenant_id, code), not
  // code alone), but this app-level check gives a clean 409 instead of a
  // raw constraint-violation error, matching this codebase's convention.
  const existing = await db.query.distanceBands.findFirst({
    where: and(eq(distanceBands.tenantId, tenantId), eq(distanceBands.code, data.code)),
  });
  if (existing) {
    return NextResponse.json({ error: `A distance band with code "${data.code}" already exists for this tenant` }, { status: 409 });
  }

  const id = genId();
  await db.insert(distanceBands).values({
    id,
    tenantId,
    code: data.code,
    fromKm: data.fromKm,
    toKm: data.toKm ?? undefined,
    label: data.label,
  });

  const created = await db.query.distanceBands.findFirst({ where: eq(distanceBands.id, id) });
  return NextResponse.json(created, { status: 201 });
}
