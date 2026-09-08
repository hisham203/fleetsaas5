export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { itemSubcategories, itemCategories } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { genId } from "@/lib/helpers";
import { eq, and } from "drizzle-orm";
import { resolveEntityCode, linkLedgerToRecord } from "@/lib/businessCodes";
import { z } from "zod";

const createSchema = z.object({
  categoryId: z.string().min(1),
  code: z.string().min(1).optional(), // AF: blank → auto-generate
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
  const categoryId = req.nextUrl.searchParams.get("categoryId");

  const conditions = [eq(itemSubcategories.tenantId, tenantId), categoryId ? eq(itemSubcategories.categoryId, categoryId) : undefined].filter(Boolean) as any[];
  const rows = await db.query.itemSubcategories.findMany({ where: and(...conditions) });
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

  const category = await db.query.itemCategories.findFirst({ where: and(eq(itemCategories.id, data.categoryId), eq(itemCategories.tenantId, tenantId)) });
  if (!category) {
    return NextResponse.json({ error: "categoryId does not belong to this tenant" }, { status: 400 });
  }

  // Milestone AF, Part 6 — shared manual-validate / blank-allocate.
  const resolved = await resolveEntityCode({
    tenantId,
    entityType: "ITEM_SUBCATEGORY",
    entityLabel: "item sub-category",
    codeLabel: "Sub-category code",
    provided: data.code,
    isDuplicate: async (code) => !!(await db.query.itemSubcategories.findFirst({ where: and(eq(itemSubcategories.tenantId, tenantId), eq(itemSubcategories.code, code)) })),
  });
  if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  const codeValue = resolved.code;

  const id = genId();
  await db.insert(itemSubcategories).values({
    id, tenantId, categoryId: data.categoryId, code: codeValue, name: data.name, description: data.description, status: data.status ?? "ACTIVE",
  });

  if (resolved.allocated) {
    await linkLedgerToRecord({ tenantId, seriesId: resolved.seriesId, generatedNumber: codeValue, referenceTable: "item_subcategories", referenceId: id });
  }

  const created = await db.query.itemSubcategories.findFirst({ where: eq(itemSubcategories.id, id) });
  return NextResponse.json(created, { status: 201 });
}
