export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { suppliers } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { genId, optionalEmailSchema } from "@/lib/helpers";
import { resolveEntityCode, linkLedgerToRecord } from "@/lib/businessCodes";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

// Milestone AC, Part 2 root-cause fix: the UI's email input defaults to
// and sends an empty string ("") when left blank, never undefined —
// see lib/helpers.ts's optionalEmailSchema for the full explanation.
//
// Milestone AE, Part 5 — supplierCode is now optional: if blank/omitted,
// a number is allocated from the tenant's active SUPPLIER numbering
// series (if one exists). If provided, it's used exactly as given,
// preserving leading zeros, with the existing duplicate check unchanged.
const createSchema = z.object({
  supplierCode: z.string().min(1).optional(),
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
  // Milestone AF, Part 5 — shared manual-validate / blank-allocate
  // resolution (lib/businessCodes.ts). Fixes both production findings:
  // a bare "V"/"AB" is now rejected as a prefix-not-a-code, and a
  // missing SUPPLIER series returns the clear, actionable message.
  const resolved = await resolveEntityCode({
    tenantId,
    entityType: "SUPPLIER",
    entityLabel: "supplier",
    codeLabel: "Supplier code",
    provided: data.supplierCode,
    isDuplicate: async (code) => !!(await db.query.suppliers.findFirst({ where: and(eq(suppliers.tenantId, tenantId), eq(suppliers.supplierCode, code)) })),
  });
  if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  const supplierCode = resolved.code;

  const id = genId();
  await db.insert(suppliers).values({
    id, tenantId,
    supplierCode,
    name: data.name,
    contactName: data.contactName,
    phone: data.phone,
    email: data.email,
    address: data.address,
    taxNumber: data.taxNumber,
    status: data.status ?? "ACTIVE",
    notes: data.notes,
  });

  if (resolved.allocated) {
    await linkLedgerToRecord({ tenantId, seriesId: resolved.seriesId, generatedNumber: supplierCode, referenceTable: "suppliers", referenceId: id });
  }

  const created = await db.query.suppliers.findFirst({ where: eq(suppliers.id, id) });
  return NextResponse.json(created, { status: 201 });
}
