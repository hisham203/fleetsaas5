export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { invoices } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, desc } from "drizzle-orm";
import { SAFE_CUSTOMER_COLUMNS, SAFE_USER_COLUMNS } from "@/lib/contractHelpers";

// S1 hotfix: two real, independent problems, both fixed here.
//
// 1. This route had no try/catch at all. Any unexpected error anywhere in
//    the query (a bad relation, a transient DB error, anything) escaped
//    as an unhandled exception, which Next.js turns into a bare 500 with
//    no JSON body — exactly what produces "Unexpected end of JSON input"
//    on the client, since res.json() has nothing to parse. Every path
//    through this route now returns real, valid JSON, error or not.
//
// 2. This route embedded `customer: true` and, via the deep
//    order->tripStop->trip->driver chain, `user: true` — both return
//    every column on those rows, including passwordHash. The same class
//    of pre-existing leak already found and fixed in the orders and trips
//    routes (Task D / Task D.5) — this is the third occurrence, now using
//    the same shared, consolidated safe-column constants rather than a
//    fourth independent copy.
export async function GET(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!hasRole(session, ["ADMIN", "DISPATCHER"])) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const tenantId = getSessionTenantId(session)!;

    const rows = await db.query.invoices.findMany({
      where: eq(invoices.tenantId, tenantId),
      with: {
        customer: { columns: SAFE_CUSTOMER_COLUMNS },
        order: {
          with: {
            tripStop: { with: { trip: { with: { driver: { with: { user: { columns: SAFE_USER_COLUMNS } } } } } } },
          },
        },
        creditNotes: true,
      },
      orderBy: desc(invoices.createdAt),
    });
    return NextResponse.json(rows);
  } catch (err) {
    // Never let this route return an empty-bodied 500 — the whole point
    // of this fix. Logged for real visibility, but the response itself
    // stays a clean, valid JSON error the client can always parse.
    console.error("GET /api/invoices failed:", err);
    return NextResponse.json({ error: "Failed to load invoices" }, { status: 500 });
  }
}
