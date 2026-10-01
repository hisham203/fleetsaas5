export const dynamic = "force-dynamic";
/**
 * GET  /api/telematics/providers — list tenant providers
 * POST /api/telematics/providers — register a new provider
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { telematicsProviders } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { checkPermission, PERMISSIONS } from "@/lib/requirePermission";
import { eq, desc } from "drizzle-orm";
import { genId } from "@/lib/helpers";
import { z } from "zod";

const createSchema = z.object({
  name: z.string().min(1).max(200),
  providerType: z.enum(["HARDWARE_DEVICE", "PLATFORM_API", "DRIVER_APP", "DEMO"]),
  config: z.record(z.unknown()).optional(),
  notes: z.string().optional(),
});

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  const tenantId = getSessionTenantId(session);
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const _permDeny = await checkPermission(session, tenantId, PERMISSIONS.TRIPS_VIEW_LIVE);
  if (_permDeny) return _permDeny;
  const providers = await db.query.telematicsProviders.findMany({
    where: eq(telematicsProviders.tenantId, tenantId),
    orderBy: desc(telematicsProviders.createdAt),
  });
  return NextResponse.json({ providers });
}

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN"])) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = getSessionTenantId(session);
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { name, providerType, config, notes } = parsed.data;
  const id = genId();
  await db.insert(telematicsProviders).values({
    id, tenantId: tenantId!, name, providerType, config: config ?? null, notes: notes ?? null,
    status: "ACTIVE",
  });
  const created = await db.query.telematicsProviders.findFirst({
    where: eq(telematicsProviders.id, id),
  });
  return NextResponse.json(created, { status: 201 });
}
