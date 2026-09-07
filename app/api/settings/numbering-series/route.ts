export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { numberingSeries } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { genId } from "@/lib/helpers";
import { NUMBERING_ENTITY_TYPES } from "@/lib/numbering";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

const VALID_ENTITY_TYPES = NUMBERING_ENTITY_TYPES.map((e) => e.entityType) as [string, ...string[]];

// Milestone AE, Part 2 — numbering series configuration. Creating a
// series here never allocates a number itself — it only defines the
// rules a future allocateNextNumber() call will use.
const createSchema = z.object({
  entityType: z.enum(VALID_ENTITY_TYPES as any),
  seriesCode: z.string().min(1),
  displayName: z.string().min(1),
  prefix: z.string().min(1),
  seriesSegment: z.string().optional(),
  suffix: z.string().optional(),
  separator: z.string().optional(),
  paddingLength: z.number().int().min(1).max(10).optional(),
  nextNumber: z.number().int().min(1).optional(),
  resetPolicy: z.enum(["NEVER", "YEARLY", "MONTHLY"]).optional(),
  includeYear: z.boolean().optional(),
  includeMonth: z.boolean().optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  description: z.string().optional(),
});

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;
  const status = req.nextUrl.searchParams.get("status");

  const conditions = [eq(numberingSeries.tenantId, tenantId), status ? eq(numberingSeries.status, status) : undefined].filter(Boolean) as any[];
  const rows = await db.query.numberingSeries.findMany({ where: and(...conditions) });
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

  // Part 2: "Do not allow duplicate active entityType series per
  // tenant" — enforced here at the entityType level regardless of
  // status, matching the schema's own tenant+entityType unique index
  // (one series definition per entity per tenant, active or not).
  const existingEntityType = await db.query.numberingSeries.findFirst({ where: and(eq(numberingSeries.tenantId, tenantId), eq(numberingSeries.entityType, data.entityType)) });
  if (existingEntityType) {
    return NextResponse.json({ error: `A numbering series for ${data.entityType} already exists for this tenant` }, { status: 409 });
  }
  const existingSeriesCode = await db.query.numberingSeries.findFirst({ where: and(eq(numberingSeries.tenantId, tenantId), eq(numberingSeries.seriesCode, data.seriesCode)) });
  if (existingSeriesCode) {
    return NextResponse.json({ error: `A numbering series with code "${data.seriesCode}" already exists for this tenant` }, { status: 409 });
  }

  const id = genId();
  await db.insert(numberingSeries).values({
    id, tenantId,
    entityType: data.entityType,
    seriesCode: data.seriesCode,
    displayName: data.displayName,
    prefix: data.prefix,
    seriesSegment: data.seriesSegment,
    suffix: data.suffix,
    separator: data.separator ?? "",
    paddingLength: data.paddingLength ?? 3,
    nextNumber: data.nextNumber ?? 1,
    resetPolicy: data.resetPolicy ?? "NEVER",
    includeYear: data.includeYear ?? false,
    includeMonth: data.includeMonth ?? false,
    status: data.status ?? "ACTIVE",
    description: data.description,
  });

  const created = await db.query.numberingSeries.findFirst({ where: eq(numberingSeries.id, id) });
  return NextResponse.json(created, { status: 201 });
}
