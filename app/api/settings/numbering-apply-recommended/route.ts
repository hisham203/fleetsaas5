export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { numberingSeries } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { genId } from "@/lib/helpers";
import { eq, and } from "drizzle-orm";
import { checkPermission, PERMISSIONS } from "@/lib/requirePermission";
import { RECOMMENDED_NUMBERING_DEFAULTS } from "@/lib/numberingDefaults";

// RC1 — Apply recommended Smarty1 numbering series. Requires explicit
// ADMIN confirmation (preview=true shows what would be created; POST
// with confirm=true actually creates them). Never overwrites existing
// series. Never runs automatically.
//
// The canonical list lives in lib/numberingDefaults.ts — both this route
// and tenant signup consume the same RECOMMENDED_NUMBERING_DEFAULTS so
// they can never diverge (EXP-001 architecture closure).
const RECOMMENDED = RECOMMENDED_NUMBERING_DEFAULTS;

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !hasRole(session, ["ADMIN"])) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = getSessionTenantId(session)!;
  const _permDeny1 = await checkPermission(session, tenantId, PERMISSIONS.ROLES_VIEW); if (_permDeny1) return _permDeny1;
  const existing = await db.query.numberingSeries.findMany({ where: eq(numberingSeries.tenantId, tenantId) });
  const existingTypes = new Set(existing.map(s => s.entityType));
  const toCreate = RECOMMENDED.filter(r => !existingTypes.has(r.entityType));
  const alreadyConfigured = RECOMMENDED.filter(r => existingTypes.has(r.entityType));
  return NextResponse.json({ toCreate, alreadyConfigured, total: RECOMMENDED.length });
}

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !hasRole(session, ["ADMIN"])) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = getSessionTenantId(session)!;
  const body = await req.json().catch(() => ({}));
  if (!body.confirm) return NextResponse.json({ error: "Explicit confirmation required" }, { status: 400 });
  const existing = await db.query.numberingSeries.findMany({ where: eq(numberingSeries.tenantId, tenantId) });
  const existingTypes = new Set(existing.map(s => s.entityType));
  const toCreate = RECOMMENDED.filter(r => !existingTypes.has(r.entityType));
  for (const s of toCreate) {
    await db.insert(numberingSeries).values({ id: genId(), tenantId, ...s, separator: "", nextNumber: 1, resetPolicy: "NEVER", includeYear: false, includeMonth: false, status: "ACTIVE" });
  }
  return NextResponse.json({ created: toCreate.length, skipped: existing.length });
}
