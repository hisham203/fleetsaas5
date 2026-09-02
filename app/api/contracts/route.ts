export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { contracts, customers } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { genId, genNumber } from "@/lib/helpers";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";
import { SAFE_CUSTOMER_COLUMNS } from "@/lib/contractHelpers";

// Contract Management Task B — API + validation only. No pricing engine, no
// order/contract attachment, no invoice changes of any kind (existing
// per-delivery invoicing is completely untouched), no monthly billing, no
// UI, no seed data. A contract created here has zero effect on anything
// else in the system until later tasks build those connections.
//
// Role note: this codebase has no "COMPANY_ADMIN" role — the real role
// enum is ADMIN | DISPATCHER | DRIVER | CUSTOMER (see lib/auth.ts). A
// contract is a commercial agreement, at least as sensitive as automation
// rules (also ADMIN-only) — restricted to ADMIN here, consistently.
// "Platform admin" access needs no special-casing: a platform admin who
// has switched into a tenant via the existing Company Switcher already
// has that tenant as their effectiveTenantId, so getSessionTenantId()
// below transparently scopes correctly with zero contract-specific code.
const createSchema = z
  .object({
    customerId: z.string().min(1),
    contractNumber: z.string().min(1).optional(), // auto-generated if omitted
    type: z.enum(["ONE_TIME_TRIP_COUNT", "MONTHLY_ACCUMULATED"]),
    status: z.enum(["DRAFT", "ACTIVE"]).default("DRAFT"), // never created pre-suspended/expired/completed/cancelled
    appliesToAllSites: z.boolean().default(true),
    totalTripsPurchased: z.number().int().positive().optional(),
    billingCadence: z.string().optional(),
    startDate: z.coerce.date(),
    endDate: z.coerce.date().optional(),
    notes: z.string().optional(),
  })
  .refine((d) => d.type !== "ONE_TIME_TRIP_COUNT" || d.totalTripsPurchased != null, {
    message: "totalTripsPurchased is required and must be a positive integer for ONE_TIME_TRIP_COUNT contracts",
    path: ["totalTripsPurchased"],
  })
  .refine((d) => d.type !== "MONTHLY_ACCUMULATED" || d.billingCadence === "MONTHLY", {
    message: "MONTHLY_ACCUMULATED contracts require billingCadence set to exactly \"MONTHLY\"",
    path: ["billingCadence"],
  });

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const customerId = searchParams.get("customerId");
  const type = searchParams.get("type");

  const conditions = [eq(contracts.tenantId, tenantId)];
  if (status) conditions.push(eq(contracts.status, status));
  if (customerId) conditions.push(eq(contracts.customerId, customerId));
  if (type) conditions.push(eq(contracts.type, type));

  const rows = await db.query.contracts.findMany({
    where: and(...conditions),
    with: { customer: { columns: SAFE_CUSTOMER_COLUMNS } },
    orderBy: desc(contracts.createdAt),
  });
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;
  const userId = session!.type === "USER" ? session!.user.id : null;

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  // Tenant isolation: a customer ID from another tenant must be rejected
  // as "not found", not leak whether it exists elsewhere.
  const customer = await db.query.customers.findFirst({
    where: and(eq(customers.id, data.customerId), eq(customers.tenantId, tenantId)),
  });
  if (!customer) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }
  if (customer.type !== "B2B") {
    return NextResponse.json(
      { error: "Contracts can only be created for company (B2B) customers — this customer is individual/home (B2C)" },
      { status: 422 }
    );
  }

  const contractNumber = data.contractNumber ?? genNumber("CNT");
  // contracts.contractNumber is a globally unique column today, not
  // per-tenant — a real, documented schema limitation (see README/
  // DEPLOYMENT.md), not something this task changes. Checking first and
  // returning a clean 409 (matching this codebase's existing convention,
  // e.g. signup's "email already registered") is safer than letting a raw
  // DB constraint violation surface as an unhandled 500.
  const existing = await db.query.contracts.findFirst({ where: eq(contracts.contractNumber, contractNumber) });
  if (existing) {
    return NextResponse.json({ error: "That contract number is already in use" }, { status: 409 });
  }

  const id = genId();
  await db.insert(contracts).values({
    id,
    tenantId,
    customerId: data.customerId,
    contractNumber,
    type: data.type,
    status: data.status,
    appliesToAllSites: data.appliesToAllSites,
    totalTripsPurchased: data.type === "ONE_TIME_TRIP_COUNT" ? data.totalTripsPurchased : undefined,
    billingCadence: data.type === "MONTHLY_ACCUMULATED" ? data.billingCadence : undefined,
    startDate: data.startDate,
    endDate: data.endDate,
    notes: data.notes,
    createdByUserId: userId ?? undefined,
  });

  const created = await db.query.contracts.findFirst({
    where: eq(contracts.id, id),
    with: { customer: { columns: SAFE_CUSTOMER_COLUMNS } },
  });
  return NextResponse.json(created, { status: 201 });
}
