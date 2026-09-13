export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { drivers, users } from "@/lib/db/schema";
import { genId } from "@/lib/helpers";
import { enforceRbac } from "@/lib/enforceRbac";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";
import { resolveEntityCode, linkLedgerToRecord } from "@/lib/businessCodes";
import { SAFE_USER_COLUMNS } from "@/lib/contractHelpers";

const createSchema = z.object({
  userId: z.string(),
  licenseNumber: z.string().min(1),
  phone: z.string().optional(),
});

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN", "DISPATCHER"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;
  const _deny = await enforceRbac(session, tenantId, "drivers"); if (_deny) return _deny;

  const rows = await db.query.drivers.findMany({
    where: eq(drivers.tenantId, tenantId),
    with: { user: { columns: SAFE_USER_COLUMNS } },
    orderBy: desc(drivers.createdAt),
  });
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // The user being turned into a driver must belong to this same tenant.
  const user = await db.query.users.findFirst({ where: and(eq(users.id, parsed.data.userId), eq(users.tenantId, tenantId)) });
  if (!user) {
    return NextResponse.json({ error: "User not found in this tenant" }, { status: 404 });
  }

  const id = genId();
  // Milestone AG — internal code: system-generated, immutable, and
  // entirely separate from any legal identifier on this record.
  const resolvedCode = await resolveEntityCode({
    tenantId, entityType: "DRIVER", entityLabel: "driver", codeLabel: "driver code",
    provided: (body as any)?.driverCode,
  });
  if (!resolvedCode.ok) return NextResponse.json({ error: resolvedCode.error }, { status: resolvedCode.status });

  await db.insert(drivers).values({ driverCode: resolvedCode.code, id, tenantId, ...parsed.data });
  await linkLedgerToRecord({ tenantId, seriesId: resolvedCode.seriesId, generatedNumber: resolvedCode.code, referenceTable: "drivers", referenceId: id });

  const created = await db.query.drivers.findFirst({ where: eq(drivers.id, id), with: { user: { columns: SAFE_USER_COLUMNS } } });
  return NextResponse.json(created, { status: 201 });
}
