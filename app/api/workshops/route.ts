export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { workshops } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { genId, optionalEmailSchema } from "@/lib/helpers";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

const createSchema = z.object({
  workshopCode: z.string().min(1),
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
  if (!hasRole(session, ["ADMIN"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;
  const status = req.nextUrl.searchParams.get("status");

  const conditions = [eq(workshops.tenantId, tenantId), status ? eq(workshops.status, status) : undefined].filter(Boolean) as any[];
  const rows = await db.query.workshops.findMany({ where: and(...conditions) });
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

  const existing = await db.query.workshops.findFirst({ where: and(eq(workshops.tenantId, tenantId), eq(workshops.workshopCode, data.workshopCode)) });
  if (existing) {
    return NextResponse.json({ error: `A workshop with code "${data.workshopCode}" already exists for this tenant` }, { status: 409 });
  }

  const id = genId();
  await db.insert(workshops).values({
    id, tenantId,
    workshopCode: data.workshopCode,
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

  const created = await db.query.workshops.findFirst({ where: eq(workshops.id, id) });
  return NextResponse.json(created, { status: 201 });
}
