export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { automationRules } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

const updateSchema = z.object({
  enabled: z.boolean().optional(),
  name: z.string().min(1).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;

  const rule = await db.query.automationRules.findFirst({ where: and(eq(automationRules.id, id), eq(automationRules.tenantId, tenantId)) });
  if (!rule) return NextResponse.json({ error: "Rule not found" }, { status: 404 });

  const body = await req.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  await db.update(automationRules).set(parsed.data).where(eq(automationRules.id, rule.id));
  const updated = await db.query.automationRules.findFirst({ where: eq(automationRules.id, rule.id) });
  return NextResponse.json(
    updated ? { ...updated, conditions: JSON.parse(updated.conditions), actionConfig: JSON.parse(updated.actionConfig) } : null
  );
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;

  const rule = await db.query.automationRules.findFirst({ where: and(eq(automationRules.id, id), eq(automationRules.tenantId, tenantId)) });
  if (!rule) return NextResponse.json({ error: "Rule not found" }, { status: 404 });

  await db.delete(automationRules).where(eq(automationRules.id, rule.id));
  return NextResponse.json({ ok: true });
}
