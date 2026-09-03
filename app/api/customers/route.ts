export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { customers } from "@/lib/db/schema";
import { genId } from "@/lib/helpers";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";

const createSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["B2C", "B2B"]).default("B2C"),
  phone: z.string().optional(),
  address: z.string().min(1),
  lat: z.number().optional(),
  lng: z.number().optional(),
  creditLimit: z.number().optional(),
});

// Task F audit finding: this route previously returned db.query.customers
// rows raw — every column, including passwordHash — for both GET and
// POST. This is the canonical, most widely-used customer-listing
// endpoint in the app, and it slipped past both the S1 and S2 sweeps for
// the same reason app/api/customers/[id]/statement/route.ts did (fixed
// in Task E.1): the customer here is the primary query target, not an
// eager-loaded relation, so the `with: { customer: true } }` pattern
// those audits specifically targeted never matched it. Surfaced now
// because Task F's own seed data gives several B2B customers a real
// portal password for the first time, which is what a genuinely thorough
// test caught.
//
// Columns kept beyond the generic SAFE_CUSTOMER_COLUMNS: creditLimit
// (ADMIN/DISPATCHER managing customers legitimately need to see this —
// it's the same "specifically an admin/finance-facing route" exception
// SAFE_CUSTOMER_COLUMNS' own comment anticipates) and subscriptions (an
// existing, already-safe embed — the subscriptions table itself has no
// sensitive fields).
const SAFE_CUSTOMER_LIST_COLUMNS = {
  id: true,
  tenantId: true,
  name: true,
  type: true,
  phone: true,
  address: true,
  lat: true,
  lng: true,
  creditLimit: true,
  loginEmail: true,
  createdAt: true,
} as const;

// Tenant scope always comes from the session, never a client-supplied
// tenantId — see lib/auth.ts getSessionTenantId.
export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN", "DISPATCHER"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;

  const rows = await db.query.customers.findMany({
    where: eq(customers.tenantId, tenantId),
    columns: SAFE_CUSTOMER_LIST_COLUMNS,
    with: { subscriptions: true },
    orderBy: desc(customers.createdAt),
  });
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN", "DISPATCHER"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const id = genId();
  await db.insert(customers).values({ id, tenantId, ...parsed.data });
  const created = await db.query.customers.findFirst({ where: eq(customers.id, id), columns: SAFE_CUSTOMER_LIST_COLUMNS });
  return NextResponse.json(created, { status: 201 });
}
