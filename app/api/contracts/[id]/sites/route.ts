export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { contracts, contractSiteScope, customerLocations } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { genId } from "@/lib/helpers";
import { eq, and, inArray } from "drizzle-orm";
import { z } from "zod";

const assignSchema = z.object({
  customerLocationIds: z.array(z.string().min(1)).min(1),
});

// Assigns specific customer sites to a contract's scope. Only meaningful
// when the contract is restricted (appliesToAllSites = false) — a contract
// covering all sites needs no rows here at all, by design (see the
// contracts.appliesToAllSites comment in the schema).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;

  const body = await req.json();
  const parsed = assignSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const contract = await db.query.contracts.findFirst({ where: and(eq(contracts.id, id), eq(contracts.tenantId, tenantId)) });
  if (!contract) return NextResponse.json({ error: "Contract not found" }, { status: 404 });

  if (contract.appliesToAllSites) {
    return NextResponse.json(
      { error: "This contract applies to all customer sites — site-specific scoping is only available when appliesToAllSites is false" },
      { status: 422 }
    );
  }

  // customerLocations has no direct tenantId column (scoped transitively
  // via its own customerId, matching the trip_stops precedent elsewhere in
  // this schema) — tenant safety here means confirming every requested
  // location belongs to THIS CONTRACT'S customer specifically, which is
  // itself already tenant-verified above. A location belonging to a
  // different customer entirely — whether in this tenant or another one
  // — is rejected the same way.
  const locations = await db.query.customerLocations.findMany({
    where: inArray(customerLocations.id, parsed.data.customerLocationIds),
  });
  const foundIds = new Set(locations.map((l) => l.id));
  const missing = parsed.data.customerLocationIds.filter((lid) => !foundIds.has(lid));
  if (missing.length > 0) {
    return NextResponse.json({ error: `Site(s) not found: ${missing.join(", ")}` }, { status: 404 });
  }
  const wrongCustomer = locations.filter((l) => l.customerId !== contract.customerId);
  if (wrongCustomer.length > 0) {
    return NextResponse.json(
      { error: `Site(s) do not belong to this contract's customer: ${wrongCustomer.map((l) => l.id).join(", ")}` },
      { status: 422 }
    );
  }

  const existingScope = await db.query.contractSiteScope.findMany({
    where: and(eq(contractSiteScope.contractId, id), inArray(contractSiteScope.customerLocationId, parsed.data.customerLocationIds)),
  });
  if (existingScope.length > 0) {
    return NextResponse.json(
      { error: `Site(s) already assigned to this contract: ${existingScope.map((s) => s.customerLocationId).join(", ")}` },
      { status: 409 }
    );
  }

  await db.insert(contractSiteScope).values(
    parsed.data.customerLocationIds.map((customerLocationId) => ({ id: genId(), contractId: id, customerLocationId }))
  );

  const allScope = await db.query.contractSiteScope.findMany({
    where: eq(contractSiteScope.contractId, id),
    with: { customerLocation: true },
  });
  return NextResponse.json(allScope, { status: 201 });
}
