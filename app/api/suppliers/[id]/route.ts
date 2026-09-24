export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { suppliers } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { optionalEmailSchema } from "@/lib/helpers";
import { rejectCodeChange } from "@/lib/businessCodes";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { checkPermission, PERMISSIONS } from "@/lib/requirePermission";

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
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = getSessionTenantId(session)!;
  const _permDeny1 = await checkPermission(session, tenantId, PERMISSIONS.INVENTORY_VIEW); if (_permDeny1) return _permDeny1;

  const row = await db.query.suppliers.findFirst({ where: and(eq(suppliers.id, id), eq(suppliers.tenantId, tenantId)) });
  if (!row) {
    return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
  }

  const body = await req.json();
  // Milestone AF.1 — code is immutable after creation.
  const immutable = rejectCodeChange(body, "supplierCode", row.supplierCode);
  if (immutable) return NextResponse.json({ error: immutable }, { status: 400 });
  delete body.supplierCode;
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  if (data.supplierCode && data.supplierCode !== row.supplierCode) {
    // Milestone AF — a changed manual code must pass the same rules as
    // on create; PATCH never allocates a number.
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
