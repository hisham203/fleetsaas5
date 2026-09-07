export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { maintenanceWarehouses, workshops } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { genId } from "@/lib/helpers";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

const createSchema = z.object({
  warehouseCode: z.string().min(1),
  name: z.string().min(1),
  warehouseType: z.enum(["WORKSHOP_STORE", "CENTRAL_SPARES", "TYRE_STORE", "MOBILE_VAN", "OTHER"]).optional(),
  workshopId: z.string().nullable().optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  district: z.string().optional(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  notes: z.string().optional(),
});

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;
  const workshopId = req.nextUrl.searchParams.get("workshopId");
  const status = req.nextUrl.searchParams.get("status");

  const conditions = [
    eq(maintenanceWarehouses.tenantId, tenantId),
    workshopId ? eq(maintenanceWarehouses.workshopId, workshopId) : undefined,
    status ? eq(maintenanceWarehouses.status, status) : undefined,
  ].filter(Boolean) as any[];
  const rows = await db.query.maintenanceWarehouses.findMany({ where: and(...conditions) });
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

  if (data.workshopId) {
    const workshop = await db.query.workshops.findFirst({ where: and(eq(workshops.id, data.workshopId), eq(workshops.tenantId, tenantId)) });
    if (!workshop) {
      return NextResponse.json({ error: "workshopId does not belong to this tenant" }, { status: 400 });
    }
  }

  const existing = await db.query.maintenanceWarehouses.findFirst({ where: and(eq(maintenanceWarehouses.tenantId, tenantId), eq(maintenanceWarehouses.warehouseCode, data.warehouseCode)) });
  if (existing) {
    return NextResponse.json({ error: `A maintenance warehouse with code "${data.warehouseCode}" already exists for this tenant` }, { status: 409 });
  }

  const id = genId();
  await db.insert(maintenanceWarehouses).values({
    id, tenantId,
    warehouseCode: data.warehouseCode,
    name: data.name,
    warehouseType: data.warehouseType ?? "WORKSHOP_STORE",
    workshopId: data.workshopId ?? undefined,
    status: data.status ?? "ACTIVE",
    address: data.address,
    city: data.city,
    district: data.district,
    lat: data.lat ?? undefined,
    lng: data.lng ?? undefined,
    notes: data.notes,
  });

  const created = await db.query.maintenanceWarehouses.findFirst({ where: eq(maintenanceWarehouses.id, id) });
  return NextResponse.json(created, { status: 201 });
}
