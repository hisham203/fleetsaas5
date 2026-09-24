export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { scorecardConfigs } from "@/lib/db/schema";
import { genId } from "@/lib/helpers";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { getScorecardWeights, DEFAULT_SCORECARD_WEIGHTS } from "@/lib/scorecards";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { checkPermission, PERMISSIONS } from "@/lib/requirePermission";

const saveSchema = z.object({
  onTimeWeight: z.number().min(0),
  deliverySuccessWeight: z.number().min(0),
  tripVolumeWeight: z.number().min(0),
  tripVolumeCap: z.number().int().min(1),
});

// BR-17: lets an Admin tune how much each factor contributes to a driver's
// composite score. Weights don't need to sum to 100 — see
// lib/scorecards.ts computeDriverScore for the normalization.
export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = getSessionTenantId(session)!;
  const _permDeny1 = await checkPermission(session, tenantId, PERMISSIONS.SCORECARDS_VIEW);
  if (_permDeny1) return _permDeny1;

  const weights = await getScorecardWeights(tenantId);
  return NextResponse.json({ ...weights, isDefault: weights === DEFAULT_SCORECARD_WEIGHTS });
}

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);

  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!getSessionTenantId(session)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  {
    const { hasRole: _hr3, getSessionTenantId: _gst3 } = await import("@/lib/auth");
    if (!_hr3(session, ["ADMIN"])) {
      const { checkPermission: _cp3, PERMISSIONS: _P3 } = await import("@/lib/requirePermission");
      const _tenId3 = _gst3(session)!;
      const _d3 = await _cp3(session, _tenId3, _P3.REPORTS_OPERATIONS_VIEW);
      if (_d3) return _d3;
    }
  }
  const tenantId = getSessionTenantId(session)!;

  const body = await req.json();
  const parsed = saveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  if (parsed.data.onTimeWeight + parsed.data.deliverySuccessWeight + parsed.data.tripVolumeWeight <= 0) {
    return NextResponse.json({ error: "At least one weight must be greater than zero" }, { status: 400 });
  }

  const existing = await db.query.scorecardConfigs.findFirst({ where: eq(scorecardConfigs.tenantId, tenantId) });

  if (existing) {
    await db
      .update(scorecardConfigs)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(scorecardConfigs.id, existing.id));
  } else {
    await db.insert(scorecardConfigs).values({ id: genId(), tenantId, ...parsed.data });
  }

  const saved = await getScorecardWeights(tenantId);
  return NextResponse.json(saved, { status: existing ? 200 : 201 });
}
