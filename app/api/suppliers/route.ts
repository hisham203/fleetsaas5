export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { suppliers } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { genId, optionalEmailSchema } from "@/lib/helpers";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

// Milestone AC, Part 2 root-cause fix: the UI's email input defaults to
// and sends an empty string ("") when left blank, never undefined —
// see lib/helpers.ts's optionalEmailSchema for the full explanation.
const createSchema = z.object({
  supplierCode: z.string().min(1),
  name: z.string().min(1),
  contactName: z.string().optional(),
  phone: z.string().optional(),
  email: optionalEmailSchema(),
  address: z.string().optional(),
  taxNumber: z.string().optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  notes: z.string().optional(),
});

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;
  const status = req.nextUrl.searchParams.get("status");

  const conditions = [eq(suppliers.tenantId, tenantId), status ? eq(suppliers.status, status) : undefined].filter(Boolean) as any[];
  const rows = await db.query.suppliers.findMany({ where: and(...conditions) });
  return NextResponse.json(rows);
}

// Milestone Z.2, Part 6 — supplier master data only. Creating a
// supplier here never creates a PR/PO automatically — those remain
// entirely separate, not-yet-implemented workflows.
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

  const existing = await db.query.suppliers.findFirst({ where: and(eq(suppliers.tenantId, tenantId), eq(suppliers.supplierCode, data.supplierCode)) });
  if (existing) {
    return NextResponse.json({ error: `A supplier with code "${data.supplierCode}" already exists for this tenant` }, { status: 409 });
  }

  const id = genId();
  await db.insert(suppliers).values({
    id, tenantId,
    supplierCode: data.supplierCode,
    name: data.name,
    contactName: data.contactName,
    phone: data.phone,
    email: data.email,
    address: data.address,
    taxNumber: data.taxNumber,
    status: data.status ?? "ACTIVE",
    notes: data.notes,
  });

  const created = await db.query.suppliers.findFirst({ where: eq(suppliers.id, id) });
  return NextResponse.json(created, { status: 201 });
}
