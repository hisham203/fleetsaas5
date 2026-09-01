export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { automationRules } from "@/lib/db/schema";
import { genId } from "@/lib/helpers";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { getEventType, isValidEventField } from "@/lib/automation";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";

const conditionSchema = z.object({
  field: z.string(),
  operator: z.enum(["eq", "neq", "contains", "gt", "gte", "lt", "lte"]),
  value: z.union([z.string(), z.number()]),
});

const createSchema = z.object({
  name: z.string().min(1),
  eventType: z.string(),
  conditions: z.array(conditionSchema).default([]),
  action: z.enum(["NOTIFY", "ESCALATE"]),
  actionConfig: z.union([
    z.object({ message: z.string().min(1) }),
    z.object({ severity: z.enum(["MEDIUM", "HIGH"]) }),
  ]),
  enabled: z.boolean().default(true),
});

// Rules control what automatically happens across the whole system —
// notifications, escalations — so managing them is ADMIN-only, unlike most
// tenant-scoped resources in this app that DISPATCHER can also touch.
export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;

  const rows = await db.query.automationRules.findMany({
    where: eq(automationRules.tenantId, tenantId),
    orderBy: desc(automationRules.createdAt),
  });
  return NextResponse.json(
    rows.map((r) => ({ ...r, conditions: JSON.parse(r.conditions), actionConfig: JSON.parse(r.actionConfig) }))
  );
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

  const eventType = getEventType(parsed.data.eventType);
  if (!eventType) {
    return NextResponse.json({ error: `Unknown event type: ${parsed.data.eventType}` }, { status: 400 });
  }
  for (const cond of parsed.data.conditions) {
    if (!isValidEventField(eventType, cond.field)) {
      return NextResponse.json({ error: `Unknown field "${cond.field}" for event "${parsed.data.eventType}"` }, { status: 400 });
    }
  }
  if (parsed.data.action === "ESCALATE" && !("severity" in parsed.data.actionConfig)) {
    return NextResponse.json({ error: "ESCALATE action requires a severity" }, { status: 400 });
  }
  if (parsed.data.action === "NOTIFY" && !("message" in parsed.data.actionConfig)) {
    return NextResponse.json({ error: "NOTIFY action requires a message" }, { status: 400 });
  }

  const id = genId();
  await db.insert(automationRules).values({
    id,
    tenantId,
    name: parsed.data.name,
    eventType: parsed.data.eventType,
    conditions: JSON.stringify(parsed.data.conditions),
    action: parsed.data.action,
    actionConfig: JSON.stringify(parsed.data.actionConfig),
    enabled: parsed.data.enabled,
  });

  const created = await db.query.automationRules.findFirst({ where: eq(automationRules.id, id) });
  return NextResponse.json(
    created ? { ...created, conditions: JSON.parse(created.conditions), actionConfig: JSON.parse(created.actionConfig) } : null,
    { status: 201 }
  );
}
