export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { invoices } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, desc } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN", "DISPATCHER"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;

  const rows = await db.query.invoices.findMany({
    where: eq(invoices.tenantId, tenantId),
    with: {
      customer: true,
      order: { with: { tripStop: { with: { trip: { with: { driver: { with: { user: true } } } } } } } },
      creditNotes: true,
    },
    orderBy: desc(invoices.createdAt),
  });
  return NextResponse.json(rows);
}
