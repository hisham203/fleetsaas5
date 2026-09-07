export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { suppliers } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { optionalEmailSchema } from "@/lib/helpers";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

const patchSchema = z.object({
  supplierCode: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  contactName: z.string().optional(),
  phone: z.string().optional(),
  email: optionalEmailSchema(),
  address: z.string().optional(),
  taxNumber: z.string().optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  notes: z.string().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;

  const row = await db.query.suppliers.findFirst({ where: and(eq(suppliers.id, id), eq(suppliers.tenantId, tenantId)) });
  if (!row) {
    return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
  }

  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  if (data.supplierCode && data.supplierCode !== row.supplierCode) {
    const dup = await db.query.suppliers.findFirst({ where: and(eq(suppliers.tenantId, tenantId), eq(suppliers.supplierCode, data.supplierCode)) });
    if (dup) {
      return NextResponse.json({ error: `A supplier with code "${data.supplierCode}" already exists for this tenant` }, { status: 409 });
    }
  }

  const updates: Record<string, unknown> = {};
  for (const key of Object.keys(body)) {
    if (key in data) updates[key] = (data as Record<string, unknown>)[key];
  }
  updates.updatedAt = new Date();
  await db.update(suppliers).set(updates).where(eq(suppliers.id, id));

  const updated = await db.query.suppliers.findFirst({ where: eq(suppliers.id, id) });
  return NextResponse.json(updated);
}
