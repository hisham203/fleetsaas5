export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { warehouses, inventoryItems } from "@/lib/db/schema";
import { genId } from "@/lib/helpers";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

const createSchema = z.object({
  name: z.string().min(1),
  address: z.string().min(1),
  lat: z.number(),
  lng: z.number(),
});

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN", "DISPATCHER"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;

  const rows = await db.query.warehouses.findMany({ where: eq(warehouses.tenantId, tenantId) });
  return NextResponse.json(rows);
}

// A new warehouse starts with zero stock of the two standard water-delivery
// items — Admin adjusts it up from the Inventory tab once stock actually
// arrives there.
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

  const existingDefault = await db.query.warehouses.findFirst({
    where: and(eq(warehouses.tenantId, tenantId), eq(warehouses.isDefault, true)),
  });

  const id = genId();
  await db.transaction(async (tx) => {
    await tx.insert(warehouses).values({ id, tenantId, ...parsed.data, isDefault: !existingDefault });
    await tx.insert(inventoryItems).values([
      { id: genId(), tenantId, warehouseId: id, itemName: "19L Bottle - Full", quantity: 0, unit: "bottle" },
      { id: genId(), tenantId, warehouseId: id, itemName: "19L Bottle - Empty", quantity: 0, unit: "bottle" },
    ]);
  });

  const created = await db.query.warehouses.findFirst({ where: eq(warehouses.id, id) });
  return NextResponse.json(created, { status: 201 });
}
