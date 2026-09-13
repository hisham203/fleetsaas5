export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { warehouses, inventoryItems } from "@/lib/db/schema";
import { genId } from "@/lib/helpers";
import { enforceRbac } from "@/lib/enforceRbac";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { resolveEntityCode, linkLedgerToRecord } from "@/lib/businessCodes";

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
  const _deny = await enforceRbac(session, tenantId, "dispatch"); if (_deny) return _deny;

  const rows = await db.query.warehouses.findMany({ where: eq(warehouses.tenantId, tenantId) });
  return NextResponse.json(rows);
}

// Task L audit finding: this route previously created two "19L Bottle"
// inventory rows for EVERY new warehouse unconditionally, regardless of
// tenant — nonsensical for a tanker-only tenant like Riyadh Bulk Water,
// which deliberately tracks zero inventory at its loading point (see
// scripts/seedRiyadhBulkWaterData.ts, and the Inventory tab's own
// "No stock items yet." handling of that same state). Fixed generically,
// with no hardcoded tenant name or sector check: only auto-create the
// baseline bottle items when this tenant already has inventory tracking
// on at least one other warehouse — a legacy bottle-water tenant keeps
// exactly the same behavior as before (every new warehouse gets the
// same starting items, for operational consistency), while a tenant
// that has never used inventory tracking anywhere (Riyadh today, or any
// future tanker-only tenant) gets a clean loading point with nothing
// forced onto it, matching Part 5's "do not force inventory tracking"
// requirement.
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
  const tenantTracksInventory = await db.query.inventoryItems.findFirst({ where: eq(inventoryItems.tenantId, tenantId) });

  // Milestone AG — internal loading point code: system-generated and
  // immutable. Allocated before the transaction so a missing series
  // fails cleanly without a half-created warehouse.
  const resolvedCode = await resolveEntityCode({
    tenantId, entityType: "LOADING_POINT", entityLabel: "loading point", codeLabel: "Loading point code",
    provided: (body as any)?.loadingPointCode,
  });
  if (!resolvedCode.ok) return NextResponse.json({ error: resolvedCode.error }, { status: resolvedCode.status });

  const id = genId();
  await db.transaction(async (tx) => {
    await tx.insert(warehouses).values({ id, tenantId, loadingPointCode: resolvedCode.code, ...parsed.data, isDefault: !existingDefault });
    if (tenantTracksInventory) {
      await tx.insert(inventoryItems).values([
        { id: genId(), tenantId, warehouseId: id, itemName: "19L Bottle - Full", quantity: 0, unit: "bottle" },
        { id: genId(), tenantId, warehouseId: id, itemName: "19L Bottle - Empty", quantity: 0, unit: "bottle" },
      ]);
    }
  });

  await linkLedgerToRecord({ tenantId, seriesId: resolvedCode.seriesId, generatedNumber: resolvedCode.code, referenceTable: "warehouses", referenceId: id });

  const created = await db.query.warehouses.findFirst({ where: eq(warehouses.id, id) });
  return NextResponse.json(created, { status: 201 });
}
