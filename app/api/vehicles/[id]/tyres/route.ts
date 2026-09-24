export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { tyreRecords, vehicles } from "@/lib/db/schema";
import { genId } from "@/lib/helpers";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";
import { checkPermission, PERMISSIONS } from "@/lib/requirePermission";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: vehicleId } = await params;
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = getSessionTenantId(session)!;
  const _permDeny1 = await checkPermission(session, tenantId, PERMISSIONS.MAINTENANCE_VIEW);
  if (_permDeny1) return _permDeny1;
  const _permDeny2 = await checkPermission(session, tenantId, PERMISSIONS.VEHICLES_VIEW); if (_permDeny2) return _permDeny2;

  const vehicle = await db.query.vehicles.findFirst({ where: and(eq(vehicles.id, vehicleId), eq(vehicles.tenantId, tenantId)) });
  if (!vehicle) return NextResponse.json({ error: "Vehicle not found" }, { status: 404 });

  const rows = await db.query.tyreRecords.findMany({
    where: eq(tyreRecords.vehicleId, vehicleId),
    orderBy: desc(tyreRecords.installedAt),
  });
  return NextResponse.json(rows);
}

const createSchema = z.object({
  position: z.string().min(1),
  serialNumber: z.string().optional(),
  costSar: z.number().optional(),
  installOdometer: z.number().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: vehicleId } = await params;
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  {
    const _cpTenantId = getSessionTenantId(session);
    if (!_cpTenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { hasRole: _hR } = await import("@/lib/auth");
    if (!_hR(session, ["ADMIN"])) {
      const _d = await checkPermission(session, _cpTenantId, PERMISSIONS.VEHICLES_EDIT);
      if (_d) return _d;
    }
  }
  const tenantId = getSessionTenantId(session)!;

  const vehicle = await db.query.vehicles.findFirst({ where: and(eq(vehicles.id, vehicleId), eq(vehicles.tenantId, tenantId)) });
  if (!vehicle) return NextResponse.json({ error: "Vehicle not found" }, { status: 404 });

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const id = genId();
  await db.insert(tyreRecords).values({ id, tenantId, vehicleId, ...parsed.data });
  const created = await db.query.tyreRecords.findFirst({ where: eq(tyreRecords.id, id) });
  return NextResponse.json(created, { status: 201 });
}
