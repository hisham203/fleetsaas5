export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { customers } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

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
  if (!hasRole(session, ["ADMIN"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;

  const customer = await db.query.customers.findFirst({ where: and(eq(customers.id, id), eq(customers.tenantId, tenantId)) });
  if (!customer) return NextResponse.json({ error: "Customer not found" }, { status: 404 });

  const body = await req.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  await db.update(customers).set(parsed.data).where(eq(customers.id, customer.id));
  const updated = await db.query.customers.findFirst({ where: eq(customers.id, customer.id) });
  return NextResponse.json(updated);
}
