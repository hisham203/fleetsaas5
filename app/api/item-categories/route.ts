export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { itemCategories, itemGroups } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { genId } from "@/lib/helpers";
import { eq, and } from "drizzle-orm";
import { resolveEntityCode, linkLedgerToRecord } from "@/lib/businessCodes";
import { z } from "zod";
import { checkPermission, PERMISSIONS } from "@/lib/requirePermission";

const createSchema = z.object({
  itemGroupId: z.string().nullable().optional(),
  code: z.string().min(1).optional(), // AF: blank → auto-generate
  name: z.string().min(1),
  description: z.string().optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
});

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = getSessionTenantId(session)!;
  const _permDeny1 = await checkPermission(session, tenantId, PERMISSIONS.INVENTORY_VIEW); if (_permDeny1) return _permDeny1;
  const status = req.nextUrl.searchParams.get("status");

  const conditions = [eq(itemCategories.tenantId, tenantId), status ? eq(itemCategories.status, status) : undefined].filter(Boolean) as any[];
  const rows = await db.query.itemCategories.findMany({ where: and(...conditions) });
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
      const _d = await checkPermission(session, _cpTenantId, PERMISSIONS.INVENTORY_RECEIVE);
      if (_d) return _d;
    }
  }
  const tenantId = getSessionTenantId(session)!;

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  if (data.itemGroupId) {
    const group = await db.query.itemGroups.findFirst({ where: and(eq(itemGroups.id, data.itemGroupId), eq(itemGroups.tenantId, tenantId)) });
    if (!group) {
      return NextResponse.json({ error: "itemGroupId does not belong to this tenant" }, { status: 400 });
    }
  }

  // Milestone AF, Part 6 — shared manual-validate / blank-allocate.
  const resolved = await resolveEntityCode({
    tenantId,
    entityType: "ITEM_CATEGORY",
    entityLabel: "item category",
    codeLabel: "Category code",
    provided: data.code,
    isDuplicate: async (code) => !!(await db.query.itemCategories.findFirst({ where: and(eq(itemCategories.tenantId, tenantId), eq(itemCategories.code, code)) })),
  });
  if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  const codeValue = resolved.code;

  const id = genId();
  await db.insert(itemCategories).values({
    id, tenantId, itemGroupId: data.itemGroupId ?? undefined, code: codeValue, name: data.name, description: data.description, status: data.status ?? "ACTIVE",
  });

  if (resolved.allocated) {
    await linkLedgerToRecord({ tenantId, seriesId: resolved.seriesId, generatedNumber: codeValue, referenceTable: "item_categories", referenceId: id });
  }

  const created = await db.query.itemCategories.findFirst({ where: eq(itemCategories.id, id) });
  return NextResponse.json(created, { status: 201 });
}
