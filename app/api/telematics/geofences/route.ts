export const dynamic = "force-dynamic";
/**
 * GET  /api/telematics/geofences — list tenant geofences
 * POST /api/telematics/geofences — create geofence
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { geofenceDefinitions } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { checkPermission, PERMISSIONS } from "@/lib/requirePermission";
import { eq, desc } from "drizzle-orm";
import { genId } from "@/lib/helpers";
import { z } from "zod";

const createSchema = z.object({
  name:          z.string().min(1).max(200),
  category:      z.enum(["LOADING_POINT", "CUSTOMER_SITE", "DEPOT", "WAREHOUSE", "CUSTOM"]).default("CUSTOM"),
  centerLat:     z.number().min(-90).max(90),
  centerLng:     z.number().min(-180).max(180),
  radiusMeters:  z.number().min(50).max(50000).default(200),
  notes:         z.string().optional(),
});

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  const tenantId = getSessionTenantId(session);
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const _permDeny = await checkPermission(session, tenantId, PERMISSIONS.TRIPS_VIEW_LIVE);
  if (_permDeny) return _permDeny;
  const geofences = await db.query.geofenceDefinitions.findMany({
    where: eq(geofenceDefinitions.tenantId, tenantId),
    orderBy: desc(geofenceDefinitions.createdAt),
  });
  return NextResponse.json({ geofences });
}

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN"])) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = getSessionTenantId(session);
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const id = genId();
  await db.insert(geofenceDefinitions).values({ id, tenantId: tenantId!, ...parsed.data });
  const created = await db.query.geofenceDefinitions.findFirst({
    where: eq(geofenceDefinitions.id, id),
  });
  return NextResponse.json(created, { status: 201 });
}
