export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { erpConnections } from "@/lib/db/schema";
import { genId } from "@/lib/helpers";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq } from "drizzle-orm";
import { z } from "zod";

const saveSchema = z.object({
  provider: z.literal("ODOO").default("ODOO"),
  baseUrl: z.string().url(),
  database: z.string().min(1),
  username: z.string().min(1),
  apiKey: z.string().min(1),
  defaultTaxId: z.string().optional(),
  enabled: z.boolean().default(true),
});

function maskConnection<T extends { apiKey: string }>(connection: T) {
  const { apiKey, ...rest } = connection;
  return { ...rest, apiKeyConfigured: true, apiKeyPreview: `••••${apiKey.slice(-4)}` };
}

// ERP credentials are financial-system access — ADMIN only, never
// DISPATCHER, unlike most tenant-scoped routes in this app.
export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;

  const connection = await db.query.erpConnections.findFirst({ where: eq(erpConnections.tenantId, tenantId) });
  if (!connection) return NextResponse.json(null);
  return NextResponse.json(maskConnection(connection));
}

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;

  const body = await req.json();
  const parsed = saveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const existing = await db.query.erpConnections.findFirst({ where: eq(erpConnections.tenantId, tenantId) });

  if (existing) {
    await db
      .update(erpConnections)
      .set({ ...parsed.data, lastTestedAt: null, lastTestStatus: null, lastTestError: null })
      .where(eq(erpConnections.id, existing.id));
  } else {
    await db.insert(erpConnections).values({ id: genId(), tenantId, ...parsed.data });
  }

  const saved = await db.query.erpConnections.findFirst({ where: eq(erpConnections.tenantId, tenantId) });
  return NextResponse.json(maskConnection(saved!), { status: existing ? 200 : 201 });
}
