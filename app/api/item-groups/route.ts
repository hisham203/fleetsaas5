export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { itemGroups } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { genId } from "@/lib/helpers";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

// Milestone Z.2 — Master Items CRUD foundation. No stock quantity is
// ever touched here (that's Inventory's job) — this table defines item
// hierarchy only.
const createSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
});

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;
  const status = req.nextUrl.searchParams.get("status");

  const conditions = [eq(itemGroups.tenantId, tenantId), status ? eq(itemGroups.status, status) : undefined].filter(Boolean) as any[];
  const rows = await db.query.itemGroups.findMany({ where: and(...conditions) });
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
  const data = parsed.data;

  const existing = await db.query.itemGroups.findFirst({ where: and(eq(itemGroups.tenantId, tenantId), eq(itemGroups.code, data.code)) });
  if (existing) {
    return NextResponse.json({ error: `An item group with code "${data.code}" already exists for this tenant` }, { status: 409 });
  }

  const id = genId();
  await db.insert(itemGroups).values({ id, tenantId, code: data.code, name: data.name, description: data.description, status: data.status ?? "ACTIVE" });

  const created = await db.query.itemGroups.findFirst({ where: eq(itemGroups.id, id) });
  return NextResponse.json(created, { status: 201 });
}
