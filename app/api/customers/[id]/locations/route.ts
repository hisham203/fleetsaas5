export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { customerLocations, customers, distanceBands } from "@/lib/db/schema";
import { genId } from "@/lib/helpers";
import { getSessionFromRequest, getSessionTenantId } from "@/lib/auth";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";
import { isAdminSession, pricingFieldsTouchedBy } from "@/lib/siteFieldGovernance";

// Task K audit finding: cityCode/zoneCode/distanceBandCode have existed
// on the customer_locations table since the A1 Contract Management
// schema foundation, but this route's own create schema never accepted
// them — meaning the only way to ever set them was a direct seed/DB
// insert, never through this API. Added here (all still optional and
// nullable, exactly matching the underlying columns) since the schema
// already fully supports this; no schema change of any kind.
const createSchema = z.object({
  label: z.string().min(1),
  address: z.string().min(1),
  lat: z.number().optional(),
  lng: z.number().optional(),
  contactName: z.string().optional(),
  contactPhone: z.string().optional(),
  cityCode: z.string().min(1).optional(),
  zoneCode: z.string().min(1).optional(),
  distanceBandCode: z.string().min(1).optional(),
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

  // Task K.3 governance decision: only ADMIN may set cityCode/zoneCode/
  // distanceBandCode, on creation as well as edit — see
  // lib/siteFieldGovernance.ts for the full reasoning. Checked before
  // Zod validation, and before the request body is otherwise trusted,
  // so an unauthorized attempt never even reaches field-shape validation.
  const touchedPricingFields = pricingFieldsTouchedBy(body);
  if (touchedPricingFields.length > 0 && !isAdminSession(session)) {
    return NextResponse.json(
      { error: `Only an admin can set ${touchedPricingFields.join("/")} — these fields affect contract pricing eligibility.` },
      { status: 403 }
    );
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Task K, Part 5: a distance band code is a real reference to the
  // distance_bands table, even though no DB-level foreign key enforces
  // it (see that table's own schema comment on why codes, not ids, are
  // used) — validating it here at the one place a site's band gets set
  // catches a typo or a retired band immediately, rather than silently
  // creating a site that can never match a distance-based pricing rule.
  if (parsed.data.distanceBandCode) {
    const customer = await db.query.customers.findFirst({ where: eq(customers.id, customerId) });
    const band = await db.query.distanceBands.findFirst({
      where: and(eq(distanceBands.tenantId, customer!.tenantId), eq(distanceBands.code, parsed.data.distanceBandCode)),
    });
    if (!band) {
      return NextResponse.json({ error: `Distance band "${parsed.data.distanceBandCode}" does not exist for this tenant` }, { status: 422 });
    }
    if (!band.isActive) {
      return NextResponse.json({ error: `Distance band "${parsed.data.distanceBandCode}" has been retired and cannot be assigned to a new site` }, { status: 422 });
    }
  }

  const id = genId();
  await db.insert(customerLocations).values({ id, customerId, ...parsed.data });
  const created = await db.query.customerLocations.findFirst({ where: eq(customerLocations.id, id) });
  return NextResponse.json(created, { status: 201 });
}
