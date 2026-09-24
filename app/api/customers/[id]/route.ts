export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { customers } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { rejectCodeChange } from "@/lib/businessCodes";
import { checkPermission, PERMISSIONS } from "@/lib/requirePermission";

const updateSchema = z.object({
  contractPricePerBottle: z.number().positive().nullable().optional(),
  creditLimit: z.number().positive().nullable().optional(),
  // Milestone U, Part 3 — safe master-data fields, editable by any admin.
  // `type` is deliberately excluded: changing B2C/B2B has real downstream
  // effects on pricing/statement logic elsewhere in this codebase and
  // isn't something this task asked for. `loginEmail`/`passwordHash` are
  // login credentials, not master data, and are excluded too.
  name: z.string().min(1).optional(),
  phone: z.string().min(1).nullable().optional(),
  address: z.string().min(1).optional(),
});

// BR-18: sets (or clears) a B2B customer's negotiated contract rate. Once
// set, every subsequent order for this customer uses this rate regardless
// of what price the order request supplies — see app/api/orders/route.ts
// and app/api/orders/bulk/route.ts.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  {
    const { hasRole: _hPatch } = await import("@/lib/auth");
    const _tId = getSessionTenantId(session);
    if (!_tId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!_hPatch(session, ["ADMIN"])) {
      const { checkPermission: _cpPatch, PERMISSIONS: _PPatch } = await import("@/lib/requirePermission");
      const _dPatch = await _cpPatch(session, _tId, _PPatch.CUSTOMERS_EDIT);
      if (_dPatch) return _dPatch;
    }
  }
  const tenantId = getSessionTenantId(session)!;
  // GET uses CUSTOMERS_VIEW; PATCH/DELETE uses CUSTOMERS_EDIT
  // (This checkPermission is in the handler that calls it — see handler-specific guards below)
  // CUSTOMERS_VIEW guard removed here — applied per-method below

  const customer = await db.query.customers.findFirst({ where: and(eq(customers.id, id), eq(customers.tenantId, tenantId)) });
  if (!customer) return NextResponse.json({ error: "Customer not found" }, { status: 404 });

  const body = await req.json();
  // Milestone AG — the internal code is immutable after creation.
  const immutableCode = rejectCodeChange(body as any, "customerCode", (customer as any).customerCode ?? "");
  if (immutableCode) return NextResponse.json({ error: immutableCode }, { status: 400 });
  delete (body as any).customerCode;
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  await db.update(customers).set(parsed.data).where(eq(customers.id, customer.id));
  const updated = await db.query.customers.findFirst({ where: eq(customers.id, customer.id) });
  return NextResponse.json(updated);
}
