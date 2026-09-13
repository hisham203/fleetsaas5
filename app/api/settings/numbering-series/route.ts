export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { numberingSeries } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { enforceRbac } from "@/lib/enforceRbac";
import { genId } from "@/lib/helpers";
import { NUMBERING_ENTITY_TYPES } from "@/lib/numbering";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

const VALID_ENTITY_TYPES = NUMBERING_ENTITY_TYPES.map((e) => e.entityType) as [string, ...string[]];

// Milestone AE, Part 2 — numbering series configuration. Creating a
// series here never allocates a number itself — it only defines the
// rules a future allocateNextNumber() call will use.
// Milestone AF.1, Part 5 — ERP-grade series validation. entityType comes
// only from the registry (no free text, uppercase constants), prefix is
// 1–5 uppercase letters, segment is uppercase/digits ≤10, separator is
// one of "", "-", "/", padding 3–10, nextNumber ≥ 1 (creation only).
const PREFIX_RE = /^[A-Z]{1,5}$/;
const SEGMENT_RE = /^[A-Z0-9]{1,10}$/;
const SEPARATORS = ["", "-", "/"] as const;

const createSchema = z.object({
  entityType: z.enum(VALID_ENTITY_TYPES as any),
  seriesCode: z.string().trim().min(1),
  displayName: z.string().trim().min(1),
  prefix: z.string().regex(PREFIX_RE, "Prefix must be 1–5 uppercase letters"),
  seriesSegment: z.string().regex(SEGMENT_RE, "Segment must be uppercase letters/digits, max 10").optional().or(z.literal("").transform(() => undefined)),
  suffix: z.string().optional(),
  separator: z.enum(SEPARATORS).optional(),
  paddingLength: z.number().int().min(3).max(10).optional(),
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
  const _deny = await enforceRbac(session, tenantId, "settings"); if (_deny) return _deny;
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

  // Part 5.14 — the same effective format (prefix + segment + separator +
  // padding) for another entity in this tenant would let two entities
  // mint visually identical codes (the reported Workshop/Warehouse case).
  const all = await db.query.numberingSeries.findMany({ where: eq(numberingSeries.tenantId, tenantId) });
  const sep = data.separator ?? ""; const pad = data.paddingLength ?? 3; const seg = data.seriesSegment ?? null;
  const clash = all.find((r) => r.prefix === data.prefix && (r.seriesSegment ?? null) === seg && r.separator === sep && r.paddingLength === pad);
  if (clash) {
    return NextResponse.json({ error: `This format (${data.prefix}${sep}${seg ?? ""}${sep}${"0".repeat(pad)}) is already used by the ${clash.entityType} series "${clash.displayName}"` }, { status: 409 });
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
