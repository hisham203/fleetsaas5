export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { vehicles, warehouses } from "@/lib/db/schema";
import { genId } from "@/lib/helpers";
import { enforceRbac } from "@/lib/enforceRbac";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";
import { resolveEntityCode, linkLedgerToRecord } from "@/lib/businessCodes";

const createSchema = z.object({
  plateNumber: z.string().min(1),
  vehicleType: z.string().min(1),
  capacityUnits: z.number().optional(),
  capacityLiters: z.number().optional(),
  homeWarehouseId: z.string().optional(),
});

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN", "DISPATCHER"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;
  const _deny = await enforceRbac(session, tenantId, "fleet"); if (_deny) return _deny;

  const rows = await db.query.vehicles.findMany({
    where: eq(vehicles.tenantId, tenantId),
    orderBy: desc(vehicles.createdAt),
  });
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

  if (parsed.data.homeWarehouseId) {
    const warehouse = await db.query.warehouses.findFirst({
      where: and(eq(warehouses.id, parsed.data.homeWarehouseId), eq(warehouses.tenantId, tenantId)),
    });
    if (!warehouse) return NextResponse.json({ error: "Home warehouse not found" }, { status: 404 });
  }

  const id = genId();
  // Milestone AG — internal code: system-generated, immutable, and
  // entirely separate from any legal identifier on this record.
  const resolvedCode = await resolveEntityCode({
    tenantId, entityType: "VEHICLE", entityLabel: "vehicle", codeLabel: "vehicle code",
    provided: (body as any)?.vehicleCode,
  });
  if (!resolvedCode.ok) return NextResponse.json({ error: resolvedCode.error }, { status: resolvedCode.status });

  await db.insert(vehicles).values({ vehicleCode: resolvedCode.code, id, tenantId, ...parsed.data });
  await linkLedgerToRecord({ tenantId, seriesId: resolvedCode.seriesId, generatedNumber: resolvedCode.code, referenceTable: "vehicles", referenceId: id });

  const created = await db.query.vehicles.findFirst({ where: eq(vehicles.id, id) });
  return NextResponse.json(created, { status: 201 });
}
