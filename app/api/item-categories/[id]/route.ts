export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { itemCategories, itemGroups } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

const patchSchema = z.object({
  itemGroupId: z.string().nullable().optional(),
  code: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;

  const row = await db.query.itemCategories.findFirst({ where: and(eq(itemCategories.id, id), eq(itemCategories.tenantId, tenantId)) });
  if (!row) {
    return NextResponse.json({ error: "Item category not found" }, { status: 404 });
  }

  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  if (data.itemGroupId) {
    const group = await db.query.itemGroups.findFirst({ where: and(eq(itemGroups.id, data.itemGroupId), eq(itemGroups.tenantId, tenantId)) });
    if (!group) {
      return NextResponse.json({ error: "itemGroupId does not belong to this tenant" }, { status: 400 });
    }
  }

  if (data.code && data.code !== row.code) {
    const dup = await db.query.itemCategories.findFirst({ where: and(eq(itemCategories.tenantId, tenantId), eq(itemCategories.code, data.code)) });
    if (dup) {
      return NextResponse.json({ error: `An item category with code "${data.code}" already exists for this tenant` }, { status: 409 });
    }
  }

  const updates: Record<string, unknown> = {};
  for (const key of Object.keys(body)) {
    if (key in data) updates[key] = (data as Record<string, unknown>)[key];
  }
  updates.updatedAt = new Date();
  await db.update(itemCategories).set(updates).where(eq(itemCategories.id, id));

  const updated = await db.query.itemCategories.findFirst({ where: eq(itemCategories.id, id) });
  return NextResponse.json(updated);
}
