export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { contracts } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { SAFE_CUSTOMER_COLUMNS } from "@/lib/contractHelpers";

// Allowed status transitions only — no automatic EXPIRED/COMPLETED logic
// here (a later, separate task); any status not listed as a key below
// (EXPIRED, COMPLETED, or CANCELLED itself) is terminal through this
// endpoint, matching real contract lifecycle semantics — once cancelled,
// nothing reactivates it via a simple status PATCH.
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["ACTIVE", "CANCELLED"],
  ACTIVE: ["SUSPENDED", "CANCELLED"],
  SUSPENDED: ["ACTIVE", "CANCELLED"],
};

// Deliberately conservative about what "basic fields" means here: notes
// and endDate only. Everything else — customerId, contractNumber, type,
// appliesToAllSites, totalTripsPurchased, billingCadence — is a real
// change to the commercial deal's shape, not a basic edit, and changing
// pricing here isn't justified per this task's own instruction to require
// strong justification for touching pricing at all. tripsUsed is
// deliberately absent from this schema entirely — it must never be
// settable through the public API, only incremented by real delivery
// completion logic in a later task.
const patchSchema = z.object({
  status: z.enum(["ACTIVE", "SUSPENDED", "CANCELLED"]).optional(),
  notes: z.string().optional(),
  endDate: z.coerce.date().optional().nullable(),
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;

  const contract = await db.query.contracts.findFirst({
    where: and(eq(contracts.id, id), eq(contracts.tenantId, tenantId)),
    with: {
      customer: { columns: SAFE_CUSTOMER_COLUMNS },
      siteScope: { with: { customerLocation: true } },
      periods: true,
    },
  });
  if (!contract) return NextResponse.json({ error: "Contract not found" }, { status: 404 });

  return NextResponse.json(contract);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;

  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  const contract = await db.query.contracts.findFirst({ where: and(eq(contracts.id, id), eq(contracts.tenantId, tenantId)) });
  if (!contract) return NextResponse.json({ error: "Contract not found" }, { status: 404 });

  if (data.status) {
    const allowed = ALLOWED_TRANSITIONS[contract.status] ?? [];
    if (!allowed.includes(data.status)) {
      return NextResponse.json(
        { error: `Cannot transition contract from ${contract.status} to ${data.status}` },
        { status: 422 }
      );
    }
  }

  await db
    .update(contracts)
    .set({
      status: data.status ?? undefined,
      notes: data.notes !== undefined ? data.notes : undefined,
      endDate: data.endDate !== undefined ? data.endDate : undefined,
    })
    .where(eq(contracts.id, id));

  const updated = await db.query.contracts.findFirst({
    where: eq(contracts.id, id),
    with: { customer: { columns: SAFE_CUSTOMER_COLUMNS } },
  });
  return NextResponse.json(updated);
}
