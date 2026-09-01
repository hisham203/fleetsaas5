export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { erpConnections } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { odooAuthenticate } from "@/lib/erp/odoo";
import { eq } from "drizzle-orm";

// Actually calls out to Odoo's authenticate endpoint and records whether it
// succeeded — this is the one place in the ERP integration that tells you
// for certain whether your credentials/base URL are correct, since nothing
// else in this codebase can verify that (see the README's ERP sync
// section on why: no live Odoo instance is reachable from where this was
// built).
export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;

  const connection = await db.query.erpConnections.findFirst({ where: eq(erpConnections.tenantId, tenantId) });
  if (!connection) {
    return NextResponse.json({ error: "No ERP connection configured yet" }, { status: 404 });
  }

  try {
    const uid = await odooAuthenticate({
      baseUrl: connection.baseUrl,
      database: connection.database,
      username: connection.username,
      apiKey: connection.apiKey,
    });
    await db
      .update(erpConnections)
      .set({ lastTestedAt: new Date(), lastTestStatus: "SUCCESS", lastTestError: null })
      .where(eq(erpConnections.id, connection.id));
    return NextResponse.json({ success: true, uid });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown connection error";
    await db
      .update(erpConnections)
      .set({ lastTestedAt: new Date(), lastTestStatus: "FAILED", lastTestError: message })
      .where(eq(erpConnections.id, connection.id));
    return NextResponse.json({ success: false, error: message }, { status: 200 });
  }
}
