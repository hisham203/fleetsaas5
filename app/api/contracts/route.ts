export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { contracts, customers } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { genId, genNumber } from "@/lib/helpers";
import { resolveEntityCode } from "@/lib/businessCodes";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";
import { SAFE_CUSTOMER_COLUMNS } from "@/lib/contractHelpers";
import { checkPermission, PERMISSIONS } from "@/lib/requirePermission";

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

// contracts.view check added
export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = getSessionTenantId(session)!;
  const _permDeny1 = await checkPermission(session, tenantId, PERMISSIONS.CONTRACTS_CREATE);
  if (_permDeny1) return _permDeny1;
  const _permDeny2 = await checkPermission(session, tenantId, PERMISSIONS.CONTRACTS_CREATE); if (_permDeny2) return _permDeny2;

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
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  {
    const _cpTenantId = getSessionTenantId(session);
    if (!_cpTenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { hasRole: _hR } = await import("@/lib/auth");
    if (!_hR(session, ["ADMIN"])) {
      const _d = await checkPermission(session, _cpTenantId, PERMISSIONS.CONTRACTS_CREATE);
      if (_d) return _d;
    }
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

  // RC1: CONTRACT requires a configured numbering series — no genNumber fallback.
  let contractNumber = data.contractNumber;
  if (!contractNumber) {
    try {
      const resolved = await resolveEntityCode({ tenantId, entityType: "CONTRACT", entityLabel: "contract", codeLabel: "Contract number", provided: undefined });
      if (!resolved.ok) return NextResponse.json({ error: "CONFIGURE_NUMBERING", message: "No active CONTRACT numbering series. Go to Settings → Numbering and apply recommended series." }, { status: 422 });
      contractNumber = resolved.code;
    } catch (err: any) {
      if (err?.message?.includes("No active")) return NextResponse.json({ error: "CONFIGURE_NUMBERING", message: "No active CONTRACT numbering series. Go to Settings → Numbering and apply recommended series." }, { status: 422 });
      throw err;
    }
  }
  // contracts.contractNumber is a globally unique column today, not
  // per-tenant — a real, documented schema limitation (see README/
  // DEPLOYMENT.md), not something this task changes. Checking first and
  // returning a clean 409 (matching this codebase's existing convention,
  // e.g. signup's "email already registered") is safer than letting a raw
  // DB constraint violation surface as an unhandled 500.
  // RC1: uniqueness check is tenant-scoped (multi-tenant SaaS — each tenant has independent
  // numbering. The per-series allocator guarantees uniqueness within each tenant's number space.
  const existing = await db.query.contracts.findFirst({ where: and(eq(contracts.contractNumber, contractNumber), eq(contracts.tenantId, tenantId)) });
  if (existing) {
    return NextResponse.json({ error: "That contract number is already in use" }, { status: 409 });
  }

  const id = genId();
  // RC1: Retry on 23505 (global unique constraint) by re-allocating the next number.
  let insertContractNumber = contractNumber;
  for (let _attempt = 0; _attempt < 10; _attempt++) {
    if (_attempt > 0) {
      try {
        const _next = await resolveEntityCode({ tenantId, entityType: "CONTRACT", entityLabel: "contract", codeLabel: "Contract number", provided: undefined });
        if (_next.ok) insertContractNumber = _next.code;
        else break;
      } catch { break; }
    }
    try {
      await db.insert(contracts).values({
        id, tenantId, customerId: data.customerId, contractNumber: insertContractNumber,
        type: data.type, status: data.status, appliesToAllSites: data.appliesToAllSites,
        totalTripsPurchased: data.type === "ONE_TIME_TRIP_COUNT" ? data.totalTripsPurchased : undefined,
        billingCadence: data.type === "MONTHLY_ACCUMULATED" ? data.billingCadence : undefined,
        startDate: data.startDate, endDate: data.endDate, notes: data.notes,
        createdByUserId: userId ?? undefined,
      });
      break; // success
    } catch (err: any) {
      // Drizzle wraps pg errors; check both direct and nested code
      // Drizzle wraps pg errors — check all known paths to the 23505 unique violation code
      const serialized = JSON.stringify(err ?? {});
      const isUniqueViolation = serialized.includes("23505") || serialized.includes("contract_number_unique");
      if (!isUniqueViolation) throw err;
      // Unique violation on contract_number — retry with next allocator number
    }
  }

  const created = await db.query.contracts.findFirst({
    where: eq(contracts.id, id),
    with: { customer: { columns: SAFE_CUSTOMER_COLUMNS } },
  });
  if (!created) return NextResponse.json({ error: "Could not allocate a unique contract number after retries" }, { status: 409 });
  return NextResponse.json(created, { status: 201 });
}
