export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { numberingSeries, numberingSequenceLedger } from "@/lib/db/schema";
import { enforceRbac } from "@/lib/enforceRbac";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

// Milestone AE, Part 2 — safe-fields-only PATCH. entityType and
// seriesCode are deliberately excluded from this schema entirely (not
// just left unvalidated) — changing entityType would silently break
// every future allocateNextNumber() lookup for the OLD entity type,
// and changing seriesCode after any ledger row exists would make past
// ledger entries reference a series identity that no longer matches
// its own display. nextNumber is excluded too, per this milestone's
// own recommendation to not allow editing it in AE.
const PREFIX_RE = /^[A-Z]{1,5}$/;
const SEGMENT_RE = /^[A-Z0-9]{1,10}$/;
const patchSchema = z.object({
  displayName: z.string().trim().min(1).optional(),
  prefix: z.string().regex(PREFIX_RE, "Prefix must be 1–5 uppercase letters").optional(),
  seriesSegment: z.string().regex(SEGMENT_RE, "Segment must be uppercase letters/digits, max 10").optional().or(z.literal("").transform(() => undefined)),
  suffix: z.string().optional(),
  separator: z.enum(["", "-", "/"]).optional(),
  paddingLength: z.number().int().min(3).max(10).optional(),
  resetPolicy: z.enum(["NEVER", "YEARLY", "MONTHLY"]).optional(),
  includeYear: z.boolean().optional(),
  includeMonth: z.boolean().optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  description: z.string().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;
  const _deny = await enforceRbac(session, tenantId, "settings"); if (_deny) return _deny;

  const row = await db.query.numberingSeries.findFirst({ where: and(eq(numberingSeries.id, id), eq(numberingSeries.tenantId, tenantId)) });
  if (!row) {
    return NextResponse.json({ error: "Numbering series not found" }, { status: 404 });
  }

  const body = await req.json();
  if ("entityType" in body || "seriesCode" in body || "nextNumber" in body) {
    return NextResponse.json({ error: "entityType, seriesCode, and nextNumber cannot be edited" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  // Part 5.14 — format-conflict check against OTHER series in this tenant,
  // applied only when this PATCH actually changes a format field. A
  // legacy series that already conflicts can still be renamed or
  // deactivated; it just cannot be changed INTO a conflicting format.
  const touchesFormat = ["prefix", "seriesSegment", "separator", "paddingLength"].some((k) => k in body);
  const eff = { prefix: data.prefix ?? row.prefix, seg: ("seriesSegment" in body ? data.seriesSegment : row.seriesSegment) ?? null, sep: data.separator ?? row.separator, pad: data.paddingLength ?? row.paddingLength };
  const others = (await db.query.numberingSeries.findMany({ where: eq(numberingSeries.tenantId, tenantId) })).filter((r) => r.id !== id);
  const clash = others.find((r) => r.prefix === eff.prefix && (r.seriesSegment ?? null) === eff.seg && r.separator === eff.sep && r.paddingLength === eff.pad);
  if (touchesFormat && clash) {
    return NextResponse.json({ error: `This format is already used by the ${clash.entityType} series "${clash.displayName}"` }, { status: 409 });
  }

  const updates: Record<string, unknown> = {};
  for (const key of Object.keys(body)) {
    if (key in data) updates[key] = (data as Record<string, unknown>)[key];
  }
  updates.updatedAt = new Date();
  await db.update(numberingSeries).set(updates).where(eq(numberingSeries.id, id));

  const updated = await db.query.numberingSeries.findFirst({ where: eq(numberingSeries.id, id) });
  return NextResponse.json(updated);
}
