export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { workshops } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { genId, optionalEmailSchema } from "@/lib/helpers";
import { eq, and } from "drizzle-orm";
import { resolveEntityCode, linkLedgerToRecord } from "@/lib/businessCodes";
import { z } from "zod";
import { checkPermission, PERMISSIONS } from "@/lib/requirePermission";

const createSchema = z.object({
  workshopCode: z.string().min(1).optional(), // AF: blank → auto-generate
  name: z.string().min(1),
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

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = getSessionTenantId(session)!;
  const _permDeny1 = await checkPermission(session, tenantId, PERMISSIONS.WORKSHOPS_VIEW);
  if (_permDeny1) return _permDeny1;
  const _permDeny2 = await checkPermission(session, tenantId, PERMISSIONS.MAINTENANCE_VIEW); if (_permDeny2) return _permDeny2;
  const status = req.nextUrl.searchParams.get("status");

  const conditions = [eq(workshops.tenantId, tenantId), status ? eq(workshops.status, status) : undefined].filter(Boolean) as any[];
  const rows = await db.query.workshops.findMany({ where: and(...conditions) });
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  {
    const _cpTenantId = getSessionTenantId(session);
    if (!_cpTenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { hasRole: _hR } = await import("@/lib/auth");
    if (!_hR(session, ["ADMIN"])) {
      const _d = await checkPermission(session, _cpTenantId, PERMISSIONS.WORKSHOPS_MANAGE);
      if (_d) return _d;
    }
  }
  const tenantId = getSessionTenantId(session)!;

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  // Milestone AF, Part 6 — shared manual-validate / blank-allocate.
  const resolved = await resolveEntityCode({
    tenantId,
    entityType: "WORKSHOP",
    entityLabel: "workshop",
    codeLabel: "Workshop code",
    provided: data.workshopCode,
    isDuplicate: async (code) => !!(await db.query.workshops.findFirst({ where: and(eq(workshops.tenantId, tenantId), eq(workshops.workshopCode, code)) })),
  });
  if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  const workshopCodeValue = resolved.code;

  const id = genId();
  await db.insert(workshops).values({
    id, tenantId,
    workshopCode: workshopCodeValue,
    name: data.name,
    workshopType: data.workshopType ?? "INTERNAL",
    status: data.status ?? "ACTIVE",
    address: data.address,
    city: data.city,
    district: data.district,
    lat: data.lat ?? undefined,
    lng: data.lng ?? undefined,
    contactName: data.contactName,
    contactPhone: data.contactPhone,
    contactEmail: data.contactEmail,
    notes: data.notes,
  });

  if (resolved.allocated) {
    await linkLedgerToRecord({ tenantId, seriesId: resolved.seriesId, generatedNumber: workshopCodeValue, referenceTable: "workshops", referenceId: id });
  }

  const created = await db.query.workshops.findFirst({ where: eq(workshops.id, id) });
  return NextResponse.json(created, { status: 201 });
}
