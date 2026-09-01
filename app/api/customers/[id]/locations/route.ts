export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { customerLocations, customers } from "@/lib/db/schema";
import { genId } from "@/lib/helpers";
import { getSessionFromRequest, getSessionTenantId } from "@/lib/auth";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";

const createSchema = z.object({
  label: z.string().min(1),
  address: z.string().min(1),
  lat: z.number().optional(),
  lng: z.number().optional(),
  contactName: z.string().optional(),
  contactPhone: z.string().optional(),
});

// A customer session may only touch its own locations. Internal staff
// (ADMIN/DISPATCHER) may manage any customer's locations, but only within
// their own tenant — this is the multi-tenant boundary, not just the B2B
// data-isolation boundary from Phase 2.
async function canAccessCustomer(session: any, customerId: string) {
  if (!session) return false;
  if (session.type === "CUSTOMER") return session.customer.id === customerId;
  if (!["ADMIN", "DISPATCHER"].includes(session.user.role)) return false;
  const customer = await db.query.customers.findFirst({ where: eq(customers.id, customerId) });
  return !!customer && customer.tenantId === getSessionTenantId(session);
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: customerId } = await params;
  const session = await getSessionFromRequest(req);
  if (!(await canAccessCustomer(session, customerId))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await db.query.customerLocations.findMany({
    where: eq(customerLocations.customerId, customerId),
    orderBy: desc(customerLocations.createdAt),
  });
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: customerId } = await params;
  const session = await getSessionFromRequest(req);
  if (!(await canAccessCustomer(session, customerId))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const id = genId();
  await db.insert(customerLocations).values({ id, customerId, ...parsed.data });
  const created = await db.query.customerLocations.findFirst({ where: eq(customerLocations.id, id) });
  return NextResponse.json(created, { status: 201 });
}
