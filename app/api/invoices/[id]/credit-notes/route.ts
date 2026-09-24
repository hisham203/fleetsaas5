export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { invoices, creditNotes } from "@/lib/db/schema";
import { genId, genNumber } from "@/lib/helpers";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, and, sql } from "drizzle-orm";
import { z } from "zod";
import { checkPermission, PERMISSIONS } from "@/lib/requirePermission";

const createSchema = z.object({
  amount: z.number().positive(),
  reason: z.string().min(1),
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: invoiceId } = await params;
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = getSessionTenantId(session)!;
  const _permDeny1 = await checkPermission(session, tenantId, PERMISSIONS.BILLING_CREATE);
  if (_permDeny1) return _permDeny1;
  const _permDeny2 = await checkPermission(session, tenantId, PERMISSIONS.BILLING_CREATE); if (_permDeny2) return _permDeny2;

  const invoice = await db.query.invoices.findFirst({ where: and(eq(invoices.id, invoiceId), eq(invoices.tenantId, tenantId)) });
  if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

  const rows = await db.query.creditNotes.findMany({ where: eq(creditNotes.invoiceId, invoiceId) });
  return NextResponse.json(rows);
}

// BR-18: a credit note is an adjustment against an already-issued invoice
// — it never modifies the original invoice record. Only ADMIN can issue
// one, and the amount can never exceed what's still outstanding on the
// invoice (total minus any credit notes already issued against it).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: invoiceId } = await params;
  const session = await getSessionFromRequest(req);

  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!getSessionTenantId(session)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  {
    const { hasRole: _hr3, getSessionTenantId: _gst3 } = await import("@/lib/auth");
    if (!_hr3(session, ["ADMIN"])) {
      const { checkPermission: _cp3, PERMISSIONS: _P3 } = await import("@/lib/requirePermission");
      const _tenId3 = _gst3(session)!;
      const _d3 = await _cp3(session, _tenId3, _P3.BILLING_CREATE);
      if (_d3) return _d3;
    }
  }
  const tenantId = getSessionTenantId(session)!;
  const userId = session!.type === "USER" ? session!.user.id : null;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const invoice = await db.query.invoices.findFirst({ where: and(eq(invoices.id, invoiceId), eq(invoices.tenantId, tenantId)) });
  if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const existingRows = await db
    .select({ total: sql<number>`coalesce(sum(${creditNotes.amount}), 0)` })
    .from(creditNotes)
    .where(eq(creditNotes.invoiceId, invoice.id));
  const alreadyCredited = existingRows[0]?.total ?? 0;
  const remaining = invoice.total - alreadyCredited;

  if (parsed.data.amount > remaining) {
    return NextResponse.json(
      { error: `Credit note amount (SAR ${parsed.data.amount.toFixed(2)}) exceeds the remaining invoice balance (SAR ${remaining.toFixed(2)})` },
      { status: 422 }
    );
  }

  const id = genId();
  await db.insert(creditNotes).values({
    id,
    tenantId,
    invoiceId: invoice.id,
    customerId: invoice.customerId,
    creditNoteNumber: genNumber("CN"),
    amount: parsed.data.amount,
    reason: parsed.data.reason,
    createdByUserId: userId,
  });

  const created = await db.query.creditNotes.findFirst({ where: eq(creditNotes.id, id) });
  return NextResponse.json(created, { status: 201 });
}
