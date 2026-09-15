/**
 * lib/relationshipValidators.ts — UAT closure.
 *
 * All cross-entity business-relationship guards live here. API routes import
 * these instead of reimplementing the same checks independently. Every guard
 * is server-side; UI filtering is defence-in-depth only.
 */

import { db } from "@/lib/db/client";
import {
  vehicles, drivers, warehouses, maintenanceWarehouses,
  customers, customerLocations, contracts, orders,
  contractPricingRules, purchaseOrders, purchaseOrderLines,
  goodsReceiptLines,
} from "@/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";

// ── Structured error codes ───────────────────────────────────────────────────
export const ERR = {
  TANKER_CAPACITY_MISMATCH:    "TANKER_CAPACITY_MISMATCH",
  TANKER_CAPACITY_REQUIRED:    "TANKER_CAPACITY_REQUIRED",
  VEHICLE_NOT_AVAILABLE:       "VEHICLE_NOT_AVAILABLE",
  DRIVER_NOT_AVAILABLE:        "DRIVER_NOT_AVAILABLE",
  TENANT_MISMATCH:             "TENANT_MISMATCH",
  CUSTOMER_SITE_MISMATCH:      "CUSTOMER_SITE_MISMATCH",
  CONTRACT_CUSTOMER_MISMATCH:  "CONTRACT_CUSTOMER_MISMATCH",
  CONTRACT_SITE_MISMATCH:      "CONTRACT_SITE_MISMATCH",
  INVALID_PRICING_RULE:        "INVALID_PRICING_RULE",
  INVALID_LOADING_POINT:       "INVALID_LOADING_POINT",
  INVALID_MAINTENANCE_WAREHOUSE: "INVALID_MAINTENANCE_WAREHOUSE",
  INVALID_PO_LINE:             "INVALID_PO_LINE",
  CONFIGURE_NUMBERING:         "CONFIGURE_NUMBERING",
} as const;

export class RelationshipError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "RelationshipError";
  }
}

// ── 1. Tanker-capacity: assert vehicle matches order's contract capacity ─────
/**
 * For a vehicle and a set of already-fetched order rows, check that the
 * vehicle capacity matches every order's required tanker capacity.
 *
 * Required capacity is derived from the order's contract pricing rules:
 * - No contract: skip (non-contract orders have no capacity constraint).
 * - Contract with a single non-wildcard capacity: that capacity is required.
 * - Contract with multiple non-wildcard capacities: the order must have
 *   already selected one and stored it in a schema field (future migration).
 *   Until that field exists, this case passes (the TANKER_CAPACITY_REQUIRED
 *   guard at order-creation time handles it upstream).
 * - Wildcard-only contract: no capacity constraint → skip.
 *
 * Throws RelationshipError on mismatch.
 */
export function assertTankerCapacity(
  vehicle: { id: string; plateNumber: string; capacityLiters: number | null },
  orderRows: Array<{ orderNumber: string; preferredTankerCapacityLiters: number | null }>
) {
  // This version is used when preferredTankerCapacityLiters is populated (after migration).
  // Currently the orders table has no such column, so this is effectively always a no-op.
  // The main enforcement lives in the inline loop in trips/route.ts.
  const vehicleCap = vehicle.capacityLiters;
  if (vehicleCap == null) return;
  for (const order of orderRows) {
    const required = order.preferredTankerCapacityLiters;
    if (required == null) continue;
    if (vehicleCap !== required) {
      throw new RelationshipError(
        ERR.TANKER_CAPACITY_MISMATCH,
        `Order ${order.orderNumber} is priced for a ${required.toLocaleString()} L tanker. ` +
        `Selected vehicle ${vehicle.plateNumber} has a capacity of ${vehicleCap.toLocaleString()} L. ` +
        `Assign a ${required.toLocaleString()} L tanker or reprice the order first.`
      );
    }
  }
}

// ── 2. Loading point: must be operational warehouse, not maintenance ──────────
/**
 * Verifies the warehouseId is in the operational warehouses table.
 * A maintenanceWarehouse ID fails this check (different table, not found).
 */
export async function assertOperationalWarehouse(params: {
  tenantId: string;
  warehouseId: string;
}) {
  const wh = await db.query.warehouses.findFirst({
    where: and(eq(warehouses.id, params.warehouseId), eq(warehouses.tenantId, params.tenantId)),
    columns: { id: true, name: true },
  });
  if (!wh) {
    throw new RelationshipError(
      ERR.INVALID_LOADING_POINT,
      "The selected loading point is not a valid operational warehouse. " +
      "Maintenance Warehouses cannot be used as trip loading points."
    );
  }
}

// ── 3. Maintenance warehouse: must be in maintenanceWarehouses table ─────────
/**
 * Verifies the warehouseId is a genuine Maintenance Warehouse (not a
 * trip loading point). Used by GR inventory posting.
 */
export async function assertMaintenanceWarehouse(params: {
  tenantId: string;
  warehouseId: string;
}) {
  const wh = await db.query.maintenanceWarehouses.findFirst({
    where: and(
      eq(maintenanceWarehouses.id, params.warehouseId),
      eq(maintenanceWarehouses.tenantId, params.tenantId)
    ),
    columns: { id: true, name: true },
  });
  if (!wh) {
    throw new RelationshipError(
      ERR.INVALID_MAINTENANCE_WAREHOUSE,
      "The receiving warehouse must be a Maintenance Warehouse. " +
      "Operational Loading Points cannot receive procurement stock."
    );
  }
}

// ── 4. Customer → site cross-ownership ───────────────────────────────────────
export async function assertCustomerSite(params: {
  customerId: string;
  locationId: string;
}) {
  const loc = await db.query.customerLocations.findFirst({
    where: eq(customerLocations.id, params.locationId),
    columns: { id: true, customerId: true },
  });
  if (!loc) throw new RelationshipError(ERR.CUSTOMER_SITE_MISMATCH, "Customer site not found");
  if (loc.customerId !== params.customerId) {
    throw new RelationshipError(
      ERR.CUSTOMER_SITE_MISMATCH,
      "The selected site does not belong to the specified customer"
    );
  }
}

// ── 5. PO → GR line validation ────────────────────────────────────────────────
/**
 * Verifies each GR line references a valid PO line on the specified PO.
 */
export async function assertGrLinesMatchPo(params: {
  tenantId: string;
  purchaseOrderId: string;
  lineItemIds: string[];
}) {
  if (!params.lineItemIds.length) return;
  const poLines = await db.query.purchaseOrderLines.findMany({
    where: and(
      eq(purchaseOrderLines.purchaseOrderId, params.purchaseOrderId),
      eq(purchaseOrderLines.tenantId, params.tenantId)
    ),
    columns: { id: true },
  });
  const validIds = new Set(poLines.map(l => l.id));
  for (const lineId of params.lineItemIds) {
    if (lineId && !validIds.has(lineId)) {
      throw new RelationshipError(
        ERR.INVALID_PO_LINE,
        `Line item ${lineId} does not belong to purchase order ${params.purchaseOrderId}`
      );
    }
  }
}
