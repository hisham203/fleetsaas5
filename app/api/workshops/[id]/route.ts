export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { workshops } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, and } from "drizzle-orm";
import { rejectCodeChange } from "@/lib/businessCodes";
import { z } from "zod";
import { optionalEmailSchema } from "@/lib/helpers";
import { checkPermission, PERMISSIONS } from "@/lib/requirePermission";

const patchSchema = z.object({
  workshopCode: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  workshopType: z.enum(["INTERNAL", "EXTERNAL", "MOBILE_SERVICE"]).optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  district: z.string().optional(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  contactName: z.string().optional(),
  contactPhone: z.string().optional(),
  contactEmail: optionalEmailSchema(),
  notes: z.string().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = getSessionTenantId(session)!;
  const _permDeny1 = await checkPermission(session, tenantId, PERMISSIONS.MAINTENANCE_VIEW); if (_permDeny1) return _permDeny1;

  const row = await db.query.workshops.findFirst({ where: and(eq(workshops.id, id), eq(workshops.tenantId, tenantId)) });
  if (!row) {
    return NextResponse.json({ error: "Workshop not found" }, { status: 404 });
  }

  const body = await req.json();
  // Milestone AF.1 — code is immutable after creation.
  const immutable = rejectCodeChange(body, "workshopCode", row.workshopCode);
  if (immutable) return NextResponse.json({ error: immutable }, { status: 400 });
  delete body.workshopCode;
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  if (data.workshopCode && data.workshopCode !== row.workshopCode) {
    const dup = await db.query.workshops.findFirst({ where: and(eq(workshops.tenantId, tenantId), eq(workshops.workshopCode, data.workshopCode)) });
    if (dup) {
      return NextResponse.json({ error: `A workshop with code "${data.workshopCode}" already exists for this tenant` }, { status: 409 });
    }
  }

  const updates: Record<string, unknown> = {};
  for (const key of Object.keys(body)) {
    if (key in data) updates[key] = (data as Record<string, unknown>)[key];
  }
  updates.updatedAt = new Date();
  await db.update(workshops).set(updates).where(eq(workshops.id, id));

  const updated = await db.query.workshops.findFirst({ where: eq(workshops.id, id) });
  return NextResponse.json(updated);
}
