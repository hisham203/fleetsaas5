export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { numberingSeries } from "@/lib/db/schema";
import { enforceRbac } from "@/lib/enforceRbac";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { formatSequenceNumber, computePeriodKey, NUMBERING_ENTITY_TYPES, type ResetPolicy } from "@/lib/numberingFormat";
import { NO_ACTIVE_SERIES } from "@/lib/businessCodes";
import { eq, and } from "drizzle-orm";

// Milestone AF.1, Part 4 — non-consuming next-code preview. Reads the
// active series and formats series.nextNumber with the SAME
// formatSequenceNumber() the allocator uses. It never updates
// nextNumber and never inserts a ledger row — so concurrent previews
// cannot consume numbers, and the saved code may legitimately advance
// past the preview if another user saves first (the UI says so).
export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN"])) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = getSessionTenantId(session)!;
  const _deny = await enforceRbac(session, tenantId, "settings"); if (_deny) return _deny;

  const entityType = req.nextUrl.searchParams.get("entityType") ?? "";
  if (!NUMBERING_ENTITY_TYPES.some((e) => e.entityType === entityType)) {
    return NextResponse.json({ error: "Unknown entityType" }, { status: 400 });
  }

  const series = await db.query.numberingSeries.findFirst({
    where: and(eq(numberingSeries.tenantId, tenantId), eq(numberingSeries.entityType, entityType), eq(numberingSeries.status, "ACTIVE")),
  });
  if (!series) return NextResponse.json({ error: NO_ACTIVE_SERIES }, { status: 400 });

  const now = new Date();
  const previewNumber = formatSequenceNumber(
    { prefix: series.prefix, seriesSegment: series.seriesSegment, suffix: series.suffix, separator: series.separator, paddingLength: series.paddingLength, includeYear: series.includeYear, includeMonth: series.includeMonth },
    series.nextNumber,
    now
  );
  return NextResponse.json({
    entityType,
    previewNumber,
    seriesId: series.id,
    seriesCode: series.seriesCode,
    displayName: series.displayName,
    nextNumber: series.nextNumber,
    resetPolicy: series.resetPolicy,
    periodKey: computePeriodKey(series.resetPolicy as ResetPolicy, now) ?? "ALL",
    note: "Preview only. Final number is allocated on save.",
  });
}
