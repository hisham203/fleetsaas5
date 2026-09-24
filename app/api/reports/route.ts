export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { savedReports } from "@/lib/db/schema";
import { genId } from "@/lib/helpers";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { getDataset, isValidColumn } from "@/lib/reportDatasets";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import { checkPermission, PERMISSIONS } from "@/lib/requirePermission";

const filterSchema = z.object({
  column: z.string(),
  operator: z.enum(["eq", "neq", "contains", "gt", "gte", "lt", "lte"]),
  value: z.union([z.string(), z.number()]),
});

const createSchema = z.object({
  name: z.string().min(1),
  datasetKey: z.string(),
  config: z.object({
    columns: z.array(z.string()).default([]),
    filters: z.array(filterSchema).default([]),
    sort: z.object({ column: z.string(), direction: z.enum(["asc", "desc"]) }).optional(),
    limit: z.number().optional(),
  }),
});

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = getSessionTenantId(session)!;
  // DRIVER sessions are blocked from reports (operational, not a driver function):
  const { hasRole: _hrRep } = await import("@/lib/auth");
  if (_hrRep(session, ["ADMIN"])) { /* platform bypass */ }
  else if (session && (session as any)?.user?.role === "DRIVER") {
    return NextResponse.json({ error: "Unauthorized", errorCode: "PERMISSION_DENIED" }, { status: 403 });
  } else {
    const _permDeny1 = await checkPermission(session, tenantId, PERMISSIONS.TRIPS_VIEW);
    if (_permDeny1) return _permDeny1;
  }

  const rows = await db.query.savedReports.findMany({
    where: eq(savedReports.tenantId, tenantId),
    orderBy: desc(savedReports.createdAt),
  });
  return NextResponse.json(rows.map((r) => ({ ...r, config: JSON.parse(r.config) })));
}

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);

  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!getSessionTenantId(session)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  {
    const { hasRole: _hr3, getSessionTenantId: _gst3 } = await import("@/lib/auth");
    if (!_hr3(session, ["ADMIN"])) {
      if ((session as any)?.user?.role === "DRIVER") {
        return NextResponse.json({ error: "Unauthorized", errorCode: "PERMISSION_DENIED" }, { status: 403 });
      }
      const { checkPermission: _cp3, PERMISSIONS: _P3 } = await import("@/lib/requirePermission");
      const _tenId3 = _gst3(session)!;
      const _d3 = await _cp3(session, _tenId3, _P3.TRIPS_VIEW);
      if (_d3) return _d3;
    }
  }
  const tenantId = getSessionTenantId(session)!;
  const userId = (session as any)?.user?.id ?? null;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const dataset = getDataset(parsed.data.datasetKey);
  if (!dataset) {
    return NextResponse.json({ error: `Unknown dataset: ${parsed.data.datasetKey}` }, { status: 400 });
  }
  for (const col of parsed.data.config.columns) {
    if (!isValidColumn(dataset, col)) {
      return NextResponse.json({ error: `Unknown column "${col}" for dataset "${parsed.data.datasetKey}"` }, { status: 400 });
    }
  }

  const id = genId();
  await db.insert(savedReports).values({
    id,
    tenantId,
    createdByUserId: userId,
    name: parsed.data.name,
    datasetKey: parsed.data.datasetKey,
    config: JSON.stringify(parsed.data.config),
  });

  const created = await db.query.savedReports.findFirst({ where: eq(savedReports.id, id) });
  return NextResponse.json(created ? { ...created, config: JSON.parse(created.config) } : null, { status: 201 });
}
