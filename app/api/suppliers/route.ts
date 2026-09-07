export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { suppliers } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { genId, optionalEmailSchema } from "@/lib/helpers";
import { allocateNextNumber, NoActiveSeriesError } from "@/lib/numbering";
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
  let supplierCode = data.supplierCode;
  let allocatedForLedgerLink: { seriesId: string } | null = null;

  if (supplierCode) {
    // Manual code path — completely unchanged from before this
    // milestone: preserved exactly as given (leading zeros intact),
    // validated for uniqueness, no allocation, no ledger row.
    const existing = await db.query.suppliers.findFirst({ where: and(eq(suppliers.tenantId, tenantId), eq(suppliers.supplierCode, supplierCode)) });
    if (existing) {
      return NextResponse.json({ error: `A supplier with code "${supplierCode}" already exists for this tenant` }, { status: 409 });
    }
  } else {
    // Blank/omitted code — allocate from the tenant's active SUPPLIER
    // series. A missing series is a clear, actionable 400, never a
    // silent fallback to some ad hoc numbering.
    try {
      const allocated = await allocateNextNumber({ tenantId, entityType: "SUPPLIER" });
      supplierCode = allocated.generatedNumber;
      allocatedForLedgerLink = { seriesId: allocated.seriesId };
    } catch (err) {
      if (err instanceof NoActiveSeriesError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }
  }

  const id = genId();
  await db.insert(suppliers).values({
    id, tenantId,
    supplierCode: supplierCode!,
    name: data.name,
    contactName: data.contactName,
    phone: data.phone,
    email: data.email,
    address: data.address,
    taxNumber: data.taxNumber,
    status: data.status ?? "ACTIVE",
    notes: data.notes,
  });

  // Link the ledger row this allocation already created (in
  // allocateNextNumber's own transaction) back to the real supplier
  // record, now that it exists. A best-effort enrichment, not part of
  // the original allocation transaction — the number was already
  // safely allocated and logged before this supplier row ever existed.
  if (allocatedForLedgerLink) {
    const { numberingSequenceLedger } = await import("@/lib/db/schema");
    await db
      .update(numberingSequenceLedger)
      .set({ referenceTable: "suppliers", referenceId: id })
      .where(and(eq(numberingSequenceLedger.tenantId, tenantId), eq(numberingSequenceLedger.seriesId, allocatedForLedgerLink.seriesId), eq(numberingSequenceLedger.generatedNumber, supplierCode!)));
  }

  const created = await db.query.suppliers.findFirst({ where: eq(suppliers.id, id) });
  return NextResponse.json(created, { status: 201 });
}
