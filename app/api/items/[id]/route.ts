export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { items, itemCategories, itemSubcategories, itemGroups } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, and } from "drizzle-orm";
import { validateBusinessCode } from "@/lib/businessCodes";
import { z } from "zod";
import { optionalUrlSchema } from "@/lib/helpers";

const ITEM_TYPES = ["SPARE_PART", "TIRE", "LUBRICANT", "CONSUMABLE", "TOOL", "SAFETY", "OTHER"] as const;
const UOMS = ["EA", "PCS", "LITER", "SET", "KG", "METER"] as const;

const patchSchema = z.object({
  itemCode: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  itemGroupId: z.string().nullable().optional(),
  categoryId: z.string().min(1).optional(),
  subCategoryId: z.string().nullable().optional(),
  itemType: z.enum(ITEM_TYPES).optional(),
  unitOfMeasure: z.enum(UOMS).optional(),
  isStocked: z.boolean().optional(),
  isSerialized: z.boolean().optional(),
  isTire: z.boolean().optional(),
  brand: z.string().optional(),
  model: z.string().optional(),
  partNumber: z.string().optional(),
  imageUrl: optionalUrlSchema(),
  compatibleVehicleType: z.string().optional(),
  minimumStockLevel: z.number().min(0).nullable().optional(),
  reorderPoint: z.number().min(0).nullable().optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;

  const row = await db.query.items.findFirst({ where: and(eq(items.id, id), eq(items.tenantId, tenantId)) });
  if (!row) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  const effectiveCategoryId = data.categoryId ?? row.categoryId;

  if (data.categoryId) {
    const category = await db.query.itemCategories.findFirst({ where: and(eq(itemCategories.id, data.categoryId), eq(itemCategories.tenantId, tenantId)) });
    if (!category) {
      return NextResponse.json({ error: "categoryId does not belong to this tenant" }, { status: 400 });
    }
  }
  if (data.itemGroupId) {
    const group = await db.query.itemGroups.findFirst({ where: and(eq(itemGroups.id, data.itemGroupId), eq(itemGroups.tenantId, tenantId)) });
    if (!group) {
      return NextResponse.json({ error: "itemGroupId does not belong to this tenant" }, { status: 400 });
    }
  }
  if (data.subCategoryId) {
    const subCategory = await db.query.itemSubcategories.findFirst({ where: and(eq(itemSubcategories.id, data.subCategoryId), eq(itemSubcategories.tenantId, tenantId)) });
    if (!subCategory) {
      return NextResponse.json({ error: "subCategoryId does not belong to this tenant" }, { status: 400 });
    }
    if (subCategory.categoryId !== effectiveCategoryId) {
      return NextResponse.json({ error: "subCategoryId does not belong to the selected categoryId" }, { status: 400 });
    }
  }

  if (data.itemCode && data.itemCode !== row.itemCode) {
    const v = validateBusinessCode(data.itemCode, "Item code");
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
    data.itemCode = v.value;
    const dup = await db.query.items.findFirst({ where: and(eq(items.tenantId, tenantId), eq(items.itemCode, data.itemCode)) });
    if (dup) {
      return NextResponse.json({ error: `An item with code "${data.itemCode}" already exists for this tenant` }, { status: 409 });
    }
  }

  const updates: Record<string, unknown> = {};
  for (const key of Object.keys(body)) {
    if (key in data) updates[key] = (data as Record<string, unknown>)[key];
  }
  updates.updatedAt = new Date();
  await db.update(items).set(updates).where(eq(items.id, id));

  const updated = await db.query.items.findFirst({ where: eq(items.id, id) });
  return NextResponse.json(updated);
}
