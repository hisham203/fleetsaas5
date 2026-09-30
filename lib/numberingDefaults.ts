/**
 * lib/numberingDefaults.ts — Canonical Smarty1 Numbering Defaults
 *
 * Single source of truth for the recommended numbering series that every
 * Smarty1 tenant should have. Consumed by:
 *
 *   - app/api/auth/signup/route.ts       (tenant bootstrap — atomic)
 *   - app/api/settings/numbering-apply-recommended/route.ts  (Settings UI)
 *   - tests/helpers/testFixtures.ts      (ensureAllSeries / SERIES_PREFIX)
 *
 * EXP-001 architecture: having three independent copies of this list was
 * the structural condition that allowed the CONFIGURE_NUMBERING defect.
 * Any future entity type that requires a numbering series must be added
 * HERE ONLY. Both signup and Settings automatically pick it up.
 *
 * This module is server-safe (no browser/client code) and has no DB
 * imports — it is pure configuration data.
 */

export interface NumberingDefault {
  /** Drizzle entity type key stored in numberingSeries.entityType */
  entityType: string;
  /** Unique, stable series code for this tenant+entityType combination */
  seriesCode: string;
  /** Human-readable label shown in the Settings UI */
  displayName: string;
  /** Number prefix (e.g. "EXP" → "EXP06001") */
  prefix: string;
}

/**
 * RECOMMENDED_NUMBERING_DEFAULTS — canonical list.
 *
 * Shared standard configuration values for all entries:
 *   seriesSegment : "06"
 *   separator     : ""       → "EXP06001" not "EXP-06-001"
 *   paddingLength : 3
 *   nextNumber    : 1
 *   resetPolicy   : "NEVER"
 *   includeYear   : false
 *   includeMonth  : false
 *   status        : "ACTIVE"
 *
 * These can be overridden by a tenant via Settings → Numbering after
 * initial bootstrap; this list only governs the initial configuration.
 */
export const RECOMMENDED_NUMBERING_DEFAULTS: readonly NumberingDefault[] = [
  // Master data entities
  { entityType: "CUSTOMER",              seriesCode: "CUSTOMER_MAIN",         displayName: "Customer",               prefix: "C"   },
  { entityType: "CUSTOMER_SITE",         seriesCode: "CUSTOMER_SITE_MAIN",    displayName: "Customer Site",          prefix: "S"   },
  { entityType: "SUPPLIER",              seriesCode: "SUPPLIER_MAIN",         displayName: "Supplier",               prefix: "V"   },
  { entityType: "VEHICLE",               seriesCode: "VEHICLE_MAIN",          displayName: "Vehicle",                prefix: "VH"  },
  { entityType: "DRIVER",                seriesCode: "DRIVER_MAIN",           displayName: "Driver",                 prefix: "D"   },
  { entityType: "LOADING_POINT",         seriesCode: "LOADING_POINT_MAIN",    displayName: "Loading Point",          prefix: "LP"  },
  { entityType: "ITEM_GROUP",            seriesCode: "ITEM_GROUP_MAIN",       displayName: "Item Group",             prefix: "IG"  },
  { entityType: "ITEM_CATEGORY",         seriesCode: "ITEM_CATEGORY_MAIN",    displayName: "Item Category",          prefix: "IC"  },
  { entityType: "ITEM_SUBCATEGORY",      seriesCode: "ITEM_SUBCATEGORY_MAIN", displayName: "Item Subcategory",       prefix: "ISC" },
  { entityType: "ITEM",                  seriesCode: "ITEM_MAIN",             displayName: "Item",                   prefix: "I"   },
  { entityType: "WORKSHOP",              seriesCode: "WORKSHOP_MAIN",         displayName: "Workshop",               prefix: "W"   },
  { entityType: "MAINTENANCE_WAREHOUSE", seriesCode: "MAINT_WAREHOUSE_MAIN",  displayName: "Maintenance Warehouse",  prefix: "WH"  },
  // Operational documents
  { entityType: "CONTRACT",              seriesCode: "CONTRACT_MAIN",         displayName: "Contract",               prefix: "CNT" },
  { entityType: "EXPENSE",               seriesCode: "EXPENSE_MAIN",          displayName: "Expense Claim",          prefix: "EXP" },
  { entityType: "PURCHASE_REQUISITION",  seriesCode: "PR_MAIN",               displayName: "Purchase Requisition",   prefix: "PR"  },
  { entityType: "PURCHASE_ORDER",        seriesCode: "PO_MAIN",               displayName: "Purchase Order",         prefix: "PO"  },
  { entityType: "GOODS_RECEIPT",         seriesCode: "GR_MAIN",               displayName: "Goods Receipt",          prefix: "GRN" },
] as const;

/**
 * SERIES_PREFIX_MAP — a convenience projection for test fixtures and
 * any code that only needs (entityType → prefix).
 *
 * Derived from RECOMMENDED_NUMBERING_DEFAULTS — never maintained
 * independently.
 */
export const SERIES_PREFIX_MAP: Record<string, string> = Object.fromEntries(
  RECOMMENDED_NUMBERING_DEFAULTS.map((d) => [d.entityType, d.prefix])
);
