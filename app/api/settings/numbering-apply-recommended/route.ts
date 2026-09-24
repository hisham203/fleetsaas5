export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { numberingSeries } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { genId } from "@/lib/helpers";
import { eq, and } from "drizzle-orm";
import { checkPermission, PERMISSIONS } from "@/lib/requirePermission";

// RC1 — Apply recommended Smarty1 numbering series. Requires explicit
// ADMIN confirmation (preview=true shows what would be created; POST
// with confirm=true actually creates them). Never overwrites existing
// series. Never runs automatically.
const RECOMMENDED = [
  // Core master data
  { entityType: "CUSTOMER", seriesCode: "CUSTOMER_MAIN", displayName: "Customer", prefix: "C", seriesSegment: "06", paddingLength: 3 },
  { entityType: "CUSTOMER_SITE", seriesCode: "CUSTOMER_SITE_MAIN", displayName: "Customer Site", prefix: "S", seriesSegment: "06", paddingLength: 3 },
  { entityType: "SUPPLIER", seriesCode: "SUPPLIER_MAIN", displayName: "Supplier", prefix: "V", seriesSegment: "06", paddingLength: 3 },
  { entityType: "VEHICLE", seriesCode: "VEHICLE_MAIN", displayName: "Vehicle", prefix: "VH", seriesSegment: "06", paddingLength: 3 },
  { entityType: "DRIVER", seriesCode: "DRIVER_MAIN", displayName: "Driver", prefix: "D", seriesSegment: "06", paddingLength: 3 },
  { entityType: "LOADING_POINT", seriesCode: "LOADING_POINT_MAIN", displayName: "Loading Point", prefix: "LP", seriesSegment: "06", paddingLength: 3 },
  { entityType: "ITEM_GROUP", seriesCode: "ITEM_GROUP_MAIN", displayName: "Item Group", prefix: "IG", seriesSegment: "06", paddingLength: 3 },
  { entityType: "ITEM_CATEGORY", seriesCode: "ITEM_CATEGORY_MAIN", displayName: "Item Category", prefix: "IC", seriesSegment: "06", paddingLength: 3 },
  { entityType: "ITEM_SUBCATEGORY", seriesCode: "ITEM_SUBCATEGORY_MAIN", displayName: "Item Subcategory", prefix: "ISC", seriesSegment: "06", paddingLength: 3 },
  { entityType: "ITEM", seriesCode: "ITEM_MAIN", displayName: "Item", prefix: "I", seriesSegment: "06", paddingLength: 3 },
  { entityType: "WORKSHOP", seriesCode: "WORKSHOP_MAIN", displayName: "Workshop", prefix: "W", seriesSegment: "06", paddingLength: 3 },
  { entityType: "MAINTENANCE_WAREHOUSE", seriesCode: "MAINT_WAREHOUSE_MAIN", displayName: "Maintenance Warehouse", prefix: "WH", seriesSegment: "06", paddingLength: 3 },
  // RC1 Phase 1 operational: documents must have ERP numbers — no fallback allowed
  { entityType: "CONTRACT", seriesCode: "CONTRACT_MAIN", displayName: "Contract", prefix: "CNT", seriesSegment: "06", paddingLength: 3 },
  { entityType: "EXPENSE", seriesCode: "EXPENSE_MAIN", displayName: "Expense Claim", prefix: "EXP", seriesSegment: "06", paddingLength: 3 },
  { entityType: "PURCHASE_REQUISITION", seriesCode: "PR_MAIN", displayName: "Purchase Requisition", prefix: "PR", seriesSegment: "06", paddingLength: 3 },
  { entityType: "PURCHASE_ORDER", seriesCode: "PO_MAIN", displayName: "Purchase Order", prefix: "PO", seriesSegment: "06", paddingLength: 3 },
  { entityType: "GOODS_RECEIPT", seriesCode: "GR_MAIN", displayName: "Goods Receipt", prefix: "GRN", seriesSegment: "06", paddingLength: 3 },
];

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
