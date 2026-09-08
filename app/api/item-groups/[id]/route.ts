export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { itemGroups } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, and } from "drizzle-orm";
import { validateBusinessCode } from "@/lib/businessCodes";
import { z } from "zod";

const patchSchema = z.object({
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

  const row = await db.query.itemGroups.findFirst({ where: and(eq(itemGroups.id, id), eq(itemGroups.tenantId, tenantId)) });
  if (!row) {
    return NextResponse.json({ error: "Item group not found" }, { status: 404 });
  }

  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  if (data.code && data.code !== row.code) {
    const v = validateBusinessCode(data.code, "Item group code");
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
    data.code = v.value;
    const dup = await db.query.itemGroups.findFirst({ where: and(eq(itemGroups.tenantId, tenantId), eq(itemGroups.code, data.code)) });
    if (dup) {
      return NextResponse.json({ error: `An item group with code "${data.code}" already exists for this tenant` }, { status: 409 });
    }
  }

  const updates: Record<string, unknown> = {};
  for (const key of Object.keys(body)) {
    if (key in data) updates[key] = (data as Record<string, unknown>)[key];
  }
  updates.updatedAt = new Date();
  await db.update(itemGroups).set(updates).where(eq(itemGroups.id, id));

  const updated = await db.query.itemGroups.findFirst({ where: eq(itemGroups.id, id) });
  return NextResponse.json(updated);
}
