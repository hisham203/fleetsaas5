export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { itemSubcategories, itemCategories } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, and } from "drizzle-orm";
import { rejectCodeChange } from "@/lib/businessCodes";
import { z } from "zod";
import { checkPermission, PERMISSIONS } from "@/lib/requirePermission";

const patchSchema = z.object({
  categoryId: z.string().min(1).optional(),
  code: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = getSessionTenantId(session)!;
  const _permDeny1 = await checkPermission(session, tenantId, PERMISSIONS.INVENTORY_VIEW); if (_permDeny1) return _permDeny1;

  const row = await db.query.itemSubcategories.findFirst({ where: and(eq(itemSubcategories.id, id), eq(itemSubcategories.tenantId, tenantId)) });
  if (!row) {
    return NextResponse.json({ error: "Item sub-category not found" }, { status: 404 });
  }

  const body = await req.json();
  // Milestone AF.1 — code is immutable after creation.
  const immutable = rejectCodeChange(body, "code", row.code);
  if (immutable) return NextResponse.json({ error: immutable }, { status: 400 });
  delete body.code;
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  if (data.categoryId) {
    const category = await db.query.itemCategories.findFirst({ where: and(eq(itemCategories.id, data.categoryId), eq(itemCategories.tenantId, tenantId)) });
    if (!category) {
      return NextResponse.json({ error: "categoryId does not belong to this tenant" }, { status: 400 });
    }
  }

  if (data.code && data.code !== row.code) {
    const dup = await db.query.itemSubcategories.findFirst({ where: and(eq(itemSubcategories.tenantId, tenantId), eq(itemSubcategories.code, data.code)) });
    if (dup) {
      return NextResponse.json({ error: `An item sub-category with code "${data.code}" already exists for this tenant` }, { status: 409 });
    }
  }

  const updates: Record<string, unknown> = {};
  for (const key of Object.keys(body)) {
    if (key in data) updates[key] = (data as Record<string, unknown>)[key];
  }
  updates.updatedAt = new Date();
  await db.update(itemSubcategories).set(updates).where(eq(itemSubcategories.id, id));

  const updated = await db.query.itemSubcategories.findFirst({ where: eq(itemSubcategories.id, id) });
  return NextResponse.json(updated);
}
