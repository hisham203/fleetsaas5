export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { items, itemCategories, itemSubcategories, itemGroups } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { genId } from "@/lib/helpers";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

const ITEM_TYPES = ["SPARE_PART", "TIRE", "LUBRICANT", "CONSUMABLE", "TOOL", "SAFETY", "OTHER"] as const;
const UOMS = ["EA", "PCS", "LITER", "SET", "KG", "METER"] as const;

const createSchema = z.object({
  itemCode: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  itemGroupId: z.string().nullable().optional(),
  categoryId: z.string().min(1),
  subCategoryId: z.string().nullable().optional(),
  itemType: z.enum(ITEM_TYPES),
  unitOfMeasure: z.enum(UOMS),
  isStocked: z.boolean().optional(),
  isSerialized: z.boolean().optional(),
  isTire: z.boolean().optional(),
  brand: z.string().optional(),
  model: z.string().optional(),
  partNumber: z.string().optional(),
  imageUrl: z.string().url().optional(),
  compatibleVehicleType: z.string().optional(),
  minimumStockLevel: z.number().min(0).nullable().optional(),
  reorderPoint: z.number().min(0).nullable().optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
});

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;
  const categoryId = req.nextUrl.searchParams.get("categoryId");
  const status = req.nextUrl.searchParams.get("status");

  const conditions = [
    eq(items.tenantId, tenantId),
    categoryId ? eq(items.categoryId, categoryId) : undefined,
    status ? eq(items.status, status) : undefined,
  ].filter(Boolean) as any[];
  const rows = await db.query.items.findMany({ where: and(...conditions) });
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

  const category = await db.query.itemCategories.findFirst({ where: and(eq(itemCategories.id, data.categoryId), eq(itemCategories.tenantId, tenantId)) });
  if (!category) {
    return NextResponse.json({ error: "categoryId does not belong to this tenant" }, { status: 400 });
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
    // Part 10, rule 5 — subCategoryId must match the selected categoryId.
    if (subCategory.categoryId !== data.categoryId) {
      return NextResponse.json({ error: "subCategoryId does not belong to the selected categoryId" }, { status: 400 });
    }
  }

  const existing = await db.query.items.findFirst({ where: and(eq(items.tenantId, tenantId), eq(items.itemCode, data.itemCode)) });
  if (existing) {
    return NextResponse.json({ error: `An item with code "${data.itemCode}" already exists for this tenant` }, { status: 409 });
  }

  const id = genId();
  await db.insert(items).values({
    id,
    tenantId,
    itemCode: data.itemCode,
    name: data.name,
    description: data.description,
    itemGroupId: data.itemGroupId ?? undefined,
    categoryId: data.categoryId,
    subCategoryId: data.subCategoryId ?? undefined,
    itemType: data.itemType,
    unitOfMeasure: data.unitOfMeasure,
    isStocked: data.isStocked ?? true,
    isSerialized: data.isSerialized ?? false,
    isTire: data.isTire ?? false,
    brand: data.brand,
    model: data.model,
    partNumber: data.partNumber,
    imageUrl: data.imageUrl,
    compatibleVehicleType: data.compatibleVehicleType,
    minimumStockLevel: data.minimumStockLevel ?? undefined,
    reorderPoint: data.reorderPoint ?? undefined,
    status: data.status ?? "ACTIVE",
  });

  const created = await db.query.items.findFirst({ where: eq(items.id, id) });
  return NextResponse.json(created, { status: 201 });
}
