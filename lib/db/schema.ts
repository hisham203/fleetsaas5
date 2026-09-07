// Phase 1 core schema — Enterprise Fleet, Logistics & Delivery Operations Platform
// Sector shape: Water Delivery (subscriptions, refills, empty-bottle collection)
// Postgres via node-postgres (pg) + drizzle-orm/pg-core. Originally built on
// SQLite for zero-setup local dev; migrated to Postgres once the automated
// test suite existed to validate the migration didn't change behavior —
// see README's "Database: Postgres" section for setup.

import { pgTable, text, integer, real, boolean, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

const createdAt = () =>
  timestamp("created_at", { mode: "date" }).notNull().$defaultFn(() => new Date());

// ---------- BR-01: Multi-Tenant ----------
export const tenants = pgTable("tenants", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  sector: text("sector").notNull().default("WATER_DELIVERY"),
  createdAt: createdAt(),
});

// ---------- Users & Roles ----------
// role: ADMIN | DISPATCHER | DRIVER
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(), // this user's home tenant — always their tenant for ordinary operations
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash"), // nullable only for legacy/demo rows created before auth existed
  role: text("role").notNull(),
  // Company Switcher / platform-level access: false for every ordinary
  // tenant user, including tenant Admins — an ordinary Admin can NEVER see
  // or act on another company's data, full stop. Only a user with this
  // flag set (a small, explicitly-provisioned set of platform staff) can
  // even attempt to switch tenant context, and only into tenants they
  // have an explicit grant for (see platformAdminTenantGrants below) —
  // there is no "access everything" mode. See lib/auth.ts for where this
  // is enforced and README's "Company Switcher" section for the full
  // security model.
  isPlatformAdmin: boolean("is_platform_admin").notNull().default(false),
  createdAt: createdAt(),
});

// Explicit, least-privilege allowlist of which tenants a platform admin
// may switch into. A platform admin's own home tenant (users.tenantId) is
// always implicitly allowed and never needs a row here. Granting access to
// tenant B for a platform admin whose home is tenant A requires a row
// here — there is no row that grants "all tenants" implicitly; provisioning
// a genuinely tenant-agnostic platform admin means inserting one grant row
// per tenant they should reach.
export const platformAdminTenantGrants = pgTable("platform_admin_tenant_grants", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  tenantId: text("tenant_id").notNull(),
  grantedByUserId: text("granted_by_user_id"), // audit trail — nullable since seed-provisioned grants have no granting user
  createdAt: createdAt(),
});

// ---------- Authentication ----------
// subjectType: USER | CUSTOMER — a session belongs to either an internal
// user (Admin/Dispatcher/Driver) or a B2B customer portal login. Kept as
// one polymorphic table rather than two so login/logout/me logic doesn't
// need to branch on session storage, only on what the subject resolves to.
export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  subjectType: text("subject_type").notNull(),
  subjectId: text("subject_id").notNull(),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
  createdAt: createdAt(),
});

// ---------- BR-02: Fleet Management ----------
// status: AVAILABLE | IN_TRIP | MAINTENANCE | OUT_OF_SERVICE
export const vehicles = pgTable("vehicles", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  plateNumber: text("plate_number").notNull(),
  vehicleType: text("vehicle_type").notNull(),
  capacityLiters: integer("capacity_liters"),
  capacityUnits: integer("capacity_units"),
  status: text("status").notNull().default("AVAILABLE"),
  homeWarehouseId: text("home_warehouse_id"), // BR-09: default warehouse suggested at trip creation
  licenseExpiry: timestamp("license_expiry", { mode: "date" }),
  insuranceExpiry: timestamp("insurance_expiry", { mode: "date" }),
  createdAt: createdAt(),
});

// ---------- BR-03: Driver Management ----------
// status: AVAILABLE | ON_TRIP | OFF_DUTY
export const drivers = pgTable("drivers", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  userId: text("user_id").notNull().unique(),
  licenseNumber: text("license_number").notNull(),
  licenseExpiry: timestamp("license_expiry", { mode: "date" }),
  phone: text("phone"),
  status: text("status").notNull().default("AVAILABLE"),
  createdAt: createdAt(),
});

// ---------- BR-04: Customer Management ----------
// type: B2C | B2B
export const customers = pgTable("customers", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull().default("B2C"),
  phone: text("phone"),
  address: text("address").notNull(),
  lat: real("lat"),
  lng: real("lng"),
  creditLimit: real("credit_limit"),
  // BR-18: a B2B customer's negotiated contract rate, per bottle. When set,
  // order creation always uses this rate — a client-supplied price is
  // silently overridden, not just validated against it — so a contract
  // rate can never be bypassed by whatever a dispatcher happens to type
  // into the order form. Null means "no contract, use the standard/
  // per-order price" (B2C default behavior, unchanged).
  contractPricePerBottle: real("contract_price_per_bottle"),
  loginEmail: text("login_email").unique(), // APP-06: B2B portal login (nullable — B2C customers don't log in)
  passwordHash: text("password_hash"),
  erpExternalId: text("erp_external_id"), // BR-19: Odoo res.partner id, once synced
  createdAt: createdAt(),
});

export const subscriptions = pgTable("subscriptions", {
  id: text("id").primaryKey(),
  customerId: text("customer_id").notNull(),
  bottleSizeLtr: integer("bottle_size_ltr").notNull().default(19),
  qtyPerDelivery: integer("qty_per_delivery").notNull().default(1),
  frequencyDays: integer("frequency_days").notNull().default(7),
  pricePerBottle: real("price_per_bottle").notNull().default(8.0),
  active: boolean("active").notNull().default(true),
  nextDueDate: timestamp("next_due_date", { mode: "date" }),
  createdAt: createdAt(),
});

// APP-06 B2B Portal — B2B accounts can have multiple delivery locations
// (branches, warehouses, sites). B2C customers use their single Customer
// address directly and don't need rows here.
export const customerLocations = pgTable("customer_locations", {
  id: text("id").primaryKey(),
  customerId: text("customer_id").notNull(),
  label: text("label").notNull(), // e.g. "Main Warehouse", "Branch - Olaya"
  address: text("address").notNull(),
  lat: real("lat"),
  lng: real("lng"),
  contactName: text("contact_name"),
  contactPhone: text("contact_phone"),
  // Contract Management A1 (schema foundation only — see contract_pricing_rules
  // below): structured, tenant-governed codes a site is assigned once, used
  // by the future pricing engine to match a contract rate. Deliberately not
  // free text and not computed live from lat/lng — see the Contract
  // Management Schema Design docs for why. All nullable: assigning these is
  // out of scope for A1, and every existing site has none of them today.
  cityCode: text("city_code"),
  zoneCode: text("zone_code"),
  distanceBandCode: text("distance_band_code"),
  createdAt: createdAt(),
});

// ---------- BR-05: Order Management ----------
// type: ONE_TIME | SUBSCRIPTION
// status: PENDING | VALIDATED | QUEUED | ASSIGNED | IN_TRANSIT | DELIVERED
//         | PARTIALLY_DELIVERED | FAILED | CANCELLED
// paymentMethod: CASH | CARD | ONLINE | ACCOUNT_CREDIT
export const orders = pgTable("orders", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  orderNumber: text("order_number").notNull().unique(),
  customerId: text("customer_id").notNull(),
  locationId: text("location_id"), // BR-04/APP-06: which B2B site this order is for (null for B2C)
  type: text("type").notNull().default("ONE_TIME"),
  bottleSizeLtr: integer("bottle_size_ltr").notNull().default(19),
  qtyOrdered: integer("qty_ordered").notNull().default(1),
  emptyBottlesToCollect: integer("empty_bottles_to_collect").notNull().default(0),
  deliveryAddress: text("delivery_address").notNull(),
  lat: real("lat"),
  lng: real("lng"),
  requestedTime: timestamp("requested_time", { mode: "date" }),
  slaMinutes: integer("sla_minutes").notNull().default(180), // BR-20: target minutes from creation to delivery
  status: text("status").notNull().default("PENDING"),
  paymentMethod: text("payment_method").notNull().default("CASH"),
  pricePerBottle: real("price_per_bottle").notNull().default(8.0),
  discountAmount: real("discount_amount").notNull().default(0), // BR-18: flat SAR discount, applied to the subtotal before VAT
  failureReason: text("failure_reason"),
  previousOrderId: text("previous_order_id"), // BR-11: set when this order is a reschedule/reassign follow-up
  // Contract Management A1 (schema foundation only): which contract this
  // order draws against, if any. Nullable — null means an individual/
  // fixed-tariff order or a non-contract order, which is every order that
  // exists today and remains fully valid and unaffected. Order creation
  // does NOT yet validate, default, or act on this field in any way — that
  // is a later task (order/contract attachment), explicitly out of scope
  // for A1. This column exists so it can be migrated once, safely, ahead
  // of that logic being built.
  contractId: text("contract_id"),
  // A1.5: a denormalized convenience pointer for a future fast "which
  // invoice covers this order" lookup — mirrors the existing pattern of
  // invoices.customerId already being stored directly rather than always
  // derived through a join, for the same query-ergonomics reason.
  // Deliberately NOT populated by anything yet: invoices.orderId remains
  // the sole source of truth for today's one-order-one-invoice behavior
  // until A2. Left null everywhere, including in tests, unless a later
  // task proves it's needed and safe to start setting.
  invoiceId: text("invoice_id"),
  completedAt: timestamp("completed_at", { mode: "date" }), // BR-20: when delivered/failed, for SLA MET/MISSED calc
  createdAt: createdAt(),
});

// ---------- BR-06/07/08: Dispatch & Trip Management ----------
// status: PLANNED | DISPATCHED | IN_PROGRESS | COMPLETED
export const trips = pgTable("trips", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  tripNumber: text("trip_number").notNull().unique(),
  driverId: text("driver_id").notNull(),
  vehicleId: text("vehicle_id").notNull(),
  warehouseId: text("warehouse_id").notNull(), // BR-09: which depot this trip loads from
  status: text("status").notNull().default("PLANNED"),
  loadingConfirmed: boolean("loading_confirmed").notNull().default(false),
  loadingConfirmedAt: timestamp("loading_confirmed_at", { mode: "date" }),
  estimatedDurationMinutes: integer("estimated_duration_minutes"), // BR-06: from Google Directions, when available
  currentLat: real("current_lat"), // BR-12 Live Location Tracking (simulated GPS for this prototype)
  currentLng: real("current_lng"),
  lastPingAt: timestamp("last_ping_at", { mode: "date" }),
  startedAt: timestamp("started_at", { mode: "date" }),
  completedAt: timestamp("completed_at", { mode: "date" }),
  createdAt: createdAt(),
});

// status: PENDING | ARRIVED | DELIVERED | PARTIALLY_DELIVERED | FAILED
export const tripStops = pgTable("trip_stops", {
  id: text("id").primaryKey(),
  tripId: text("trip_id").notNull(),
  orderId: text("order_id").notNull().unique(),
  sequence: integer("sequence").notNull(),
  status: text("status").notNull().default("PENDING"),
  arrivedAt: timestamp("arrived_at", { mode: "date" }),
  completedAt: timestamp("completed_at", { mode: "date" }),
});

// ---------- BR-10: Electronic Proof of Delivery ----------
export const epods = pgTable("epods", {
  id: text("id").primaryKey(),
  tripStopId: text("trip_stop_id").notNull().unique(),
  deliveredQty: integer("delivered_qty").notNull(),
  emptiesCollected: integer("empties_collected").notNull().default(0),
  recipientName: text("recipient_name"),
  signatureNote: text("signature_note"),
  lat: real("lat"),
  lng: real("lng"),
  notes: text("notes"),
  deliveredAt: timestamp("delivered_at", { mode: "date" }).notNull().$defaultFn(() => new Date()),
});

// ---------- BR-18: Billing & Collections (basic) ----------
// status: PENDING | PAID
export const invoices = pgTable("invoices", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  invoiceNumber: text("invoice_number").notNull().unique(),
  // Task E: orderId is now nullable — a monthly consolidated invoice
  // (MONTHLY_ACCUMULATED contracts, covering many orders via
  // invoice_line_items) has no single order to put here. The `.unique()`
  // constraint is deliberately KEPT, not dropped: verified empirically
  // that PostgreSQL treats multiple NULL values as distinct under a
  // UNIQUE constraint (ANSI SQL standard behavior — NULL is never equal
  // to another NULL), so any number of monthly invoices can coexist with
  // orderId = NULL without ever violating this constraint. This is a
  // narrower, safer migration than "drop the unique constraint" — every
  // existing single-order invoice keeps working completely unchanged,
  // still with a real, unique, non-null orderId exactly as before.
  orderId: text("order_id").unique(),
  // Task E: which billing period this invoice covers, for the monthly
  // consolidated case. Nullable — a normal single-order invoice has no
  // period at all. This is the correct single owner of the
  // invoice<->period relationship, per the A1.5 architecture decision
  // (contract_periods.invoiceId was deliberately removed there — see its
  // own schema comment — specifically so this side would own it instead).
  contractPeriodId: text("contract_period_id"),
  customerId: text("customer_id").notNull(),
  subtotal: real("subtotal").notNull(),
  discountAmount: real("discount_amount").notNull().default(0), // BR-18: copied from the order at invoice time, for record-keeping
  vatRate: real("vat_rate").notNull().default(0.15),
  vatAmount: real("vat_amount").notNull(),
  total: real("total").notNull(),
  status: text("status").notNull().default("PENDING"),
  // BR-18 rule: "cash collection must be linked to driver and trip" — these
  // fields are the reconciliation step (cash settlement with driver): an
  // Admin confirms the driver has physically handed over cash collected on
  // a CASH-payment order. Only meaningful for CASH orders; other payment
  // methods don't need this handoff step.
  cashSettled: boolean("cash_settled").notNull().default(false),
  cashSettledAt: timestamp("cash_settled_at", { mode: "date" }),
  cashSettledByUserId: text("cash_settled_by_user_id"),
  erpExternalId: text("erp_external_id"), // BR-19: Odoo account.move id, once synced
  erpSyncedAt: timestamp("erp_synced_at", { mode: "date" }),
  erpSyncError: text("erp_sync_error"), // last sync failure message, cleared on success
  createdAt: createdAt(),
}, (table) => ({
  // Task E: the "find the invoice for this period" lookup (e.g. checking
  // whether a period has already been invoiced) is a real, expected query
  // once monthly billing exists.
  contractPeriodIdx: index("invoices_contract_period_idx").on(table.contractPeriodId),
}));

// ---------- BR-18: Credit Notes ----------
// A credit note is an adjustment against an already-issued invoice — a
// partial or full refund/write-off, not a correction of the invoice
// itself (the original invoice record never changes). "Net amount due" for
// an invoice is always total - sum(creditNotes for that invoice), computed
// on read rather than stored, the same pattern used for SLA status
// elsewhere in this build.
export const creditNotes = pgTable("credit_notes", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  invoiceId: text("invoice_id").notNull(),
  customerId: text("customer_id").notNull(),
  creditNoteNumber: text("credit_note_number").notNull().unique(),
  amount: real("amount").notNull(),
  reason: text("reason").notNull(),
  createdByUserId: text("created_by_user_id").notNull(),
  createdAt: createdAt(),
});

// ---------- Contract Management — Schema Foundation (A1 + A1.5) ----------
// SCOPE NOTE: this section adds tables/columns only. No API route, UI,
// pricing-matching logic, order/contract attachment behavior, or monthly
// invoice generation exists yet — those are separate, later tasks (B
// through G in the Contract Management Schema Design docs). Every table
// below is purely additive: nothing existing reads from or depends on
// them, so their presence has zero effect on any current behavior.
//
// Deliberately NOT touched by this section: the `invoices` table above.
// `invoices.orderId` remains NOT NULL and UNIQUE, exactly as it is today —
// that change (task "A2") is a separate, not-yet-approved step requiring
// its own audit first, since it's the one change in this whole design
// that touches something already working correctly in production. Every
// order continues to get exactly one invoice at delivery time, unchanged.
//
// A1.5 revision note: an independent architecture review of A1 found
// three real structural issues, corrected here before any Contract
// Management API/UI/pricing-engine work builds on top of them (cheaper to
// fix now, while every one of these tables is still empty in every real
// database, than after real data exists in the wrong shape):
//   1. `invoice_orders` (A1) was a many-to-many join table for a
//      relationship that's actually one-to-many (one invoice, many
//      orders; each order belongs to at most one invoice) — the wrong
//      tool, and it had no room for a non-order invoice line (an
//      adjustment, a minimum-billing fee) without an awkward bolt-on
//      later. Replaced by `invoice_line_items` below, with `orderId`
//      nullable from day one.
//   2. A1 gave both `contract_periods.invoiceId` and a (not-yet-added)
//      `invoices.contractPeriodId` a way to reference each other — a
//      classic dual-ownership anti-pattern where the two references can
//      drift out of sync. Only one side should own this relationship.
//      `contract_periods.invoiceId` is removed here. The other side
//      (`invoices.contractPeriodId`) is intentionally NOT added in this
//      task either — that's part of A2, not yet approved. Until then,
//      `contract_periods.status` (OPEN | INVOICED) is sufficient to know
//      whether a period has been invoiced, without needing a redundant
//      pointer on either side.
//   3. `contract_sites` is renamed to `contract_site_scope` — a cheap,
//      zero-risk rename (confirmed: zero application code referenced the
//      old name outside this schema file) that signals this is *one*
//      contract-scoping mechanism, not the only one a future vertical
//      (e.g. an asset-scoped Fleet Services contract) might need. This is
//      deliberately NOT a generic polymorphic `contract_scope` table — a
//      guess at a shape for a requirement that doesn't exist yet would be
//      worse than the specific table it replaces. Build the next scope
//      mechanism, if one is ever needed, as its own concrete table then.

// A company customer's commercial agreement. Individual/home customers
// never have a row here — they use a tenant-default fixed tariff via
// contract_pricing_rules with pricingScope = TENANT_DEFAULT instead.
// type: ONE_TIME_TRIP_COUNT | MONTHLY_ACCUMULATED
// status: DRAFT | ACTIVE | SUSPENDED | EXPIRED | COMPLETED | CANCELLED
export const contracts = pgTable("contracts", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  customerId: text("customer_id").notNull(), // must be a COMPANY-type customer
  contractNumber: text("contract_number").notNull().unique(),
  type: text("type").notNull(),
  status: text("status").notNull().default("DRAFT"),
  // true (default): covers every current AND future site of this customer,
  // with zero rows needed in contract_site_scope. false: scope is
  // restricted to whatever's listed there.
  appliesToAllSites: boolean("applies_to_all_sites").notNull().default(true),
  totalTripsPurchased: integer("total_trips_purchased"), // ONE_TIME_TRIP_COUNT only
  tripsUsed: integer("trips_used").notNull().default(0), // ONE_TIME_TRIP_COUNT only; incremented on genuine delivery only, never on failed/cancelled (future task, not enforced by this schema alone)
  startDate: timestamp("start_date", { mode: "date" }).notNull(),
  endDate: timestamp("end_date", { mode: "date" }),
  billingCadence: text("billing_cadence"), // MONTHLY_ACCUMULATED only, e.g. "MONTHLY"
  notes: text("notes"),
  createdByUserId: text("created_by_user_id"),
  createdAt: createdAt(),
});

// Restricts a contract's scope to specific sites, only populated when
// contracts.appliesToAllSites = false. Named `contract_site_scope` (A1.5),
// not `contract_sites` — see the section-level note above for why.
export const contractSiteScope = pgTable(
  "contract_site_scope",
  {
    id: text("id").primaryKey(),
    contractId: text("contract_id").notNull(),
    customerLocationId: text("customer_location_id").notNull(),
    createdAt: createdAt(),
  },
  (table) => ({
    // Nothing stops the same site being added to a contract's scope
    // twice without this — a real, easy-to-hit data-entry mistake with
    // no functional consequence but real confusion in a contract's
    // detail view.
    uniqueContractSite: uniqueIndex("contract_site_scope_contract_site_unique").on(
      table.contractId,
      table.customerLocationId
    ),
  })
);

// One billing-cycle accumulation bucket for a MONTHLY_ACCUMULATED contract.
// Not used by ONE_TIME_TRIP_COUNT contracts at all.
// status: OPEN | INVOICED
export const contractPeriods = pgTable(
  "contract_periods",
  {
    id: text("id").primaryKey(),
    // Added in A1.5: this table lacked a direct tenantId in A1, relying on
    // contractId -> contracts.tenantId instead. Added directly here for
    // the same reason contracts/distanceBands/contractPricingRules
    // already have it — this is financial data, and a flat, un-forgettable
    // tenantId filter is worth the small redundancy. Safe to add as
    // NOT NULL: this table is empty in every real database today (A1
    // shipped with no code that writes to it yet).
    tenantId: text("tenant_id").notNull(),
    contractId: text("contract_id").notNull(),
    periodStart: timestamp("period_start", { mode: "date" }).notNull(),
    periodEnd: timestamp("period_end", { mode: "date" }).notNull(),
    status: text("status").notNull().default("OPEN"),
    periodTrips: integer("period_trips").notNull().default(0), // denormalized running total, updated as deliveries complete (future task)
    periodLiters: real("period_liters").notNull().default(0),
    periodRevenue: real("period_revenue").notNull().default(0), // pre-VAT
    // A1.5: invoiceId removed. See the section-level note above — only one
    // side of the contract_periods <-> invoice relationship should own the
    // pointer, and it should be invoices.contractPeriodId (added later, as
    // part of A2, not here). `status` already answers "has this period
    // been invoiced" without a redundant pointer on this side.
    invoicedAt: timestamp("invoiced_at", { mode: "date" }),
    invoicedByUserId: text("invoiced_by_user_id"),
    createdAt: createdAt(),
  },
  (table) => ({
    // Prevents two overlapping/duplicate periods for the same contract —
    // a real bug class once "open a new period" logic exists (e.g. a
    // double-triggered month-end rollover).
    uniquePeriod: uniqueIndex("contract_periods_contract_period_unique").on(
      table.contractId,
      table.periodStart,
      table.periodEnd
    ),
  })
);

// A tenant-defined reference table for distance-based pricing bands (e.g.
// "0-10km — Central Riyadh"). Defined once per tenant, then referenced by
// code from customerLocations and contract_pricing_rules — deliberately
// not free text on either of those, to avoid drift/typo mismatches between
// a site's assigned band and a pricing rule's band.
//
// IMMUTABILITY RULE (A1.5, documentation + minimal schema support only —
// no UI/API enforcement yet): once a band's code is referenced by any
// site or pricing rule, its fromKm/toKm/label must never be edited again.
// Editing a live band would silently rewrite the historical meaning of
// every rule and site that reference its code — a quiet financial/
// reporting integrity problem. To change a band's range, create a NEW
// code and stop assigning the old one to new sites/rules; retire the old
// one via isActive/retiredAt instead of altering it in place.
export const distanceBands = pgTable(
  "distance_bands",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    code: text("code").notNull(), // e.g. "BAND_A" — unique per tenant, enforced below at the DB level (an intentional exception to this schema's usual app-level-only uniqueness convention, given the financial correctness riding on unambiguous code resolution)
    fromKm: real("from_km").notNull(),
    toKm: real("to_km"), // null = open-ended upper bound
    label: text("label").notNull(),
    // A1.5 additions supporting the immutability rule above — retire a
    // band instead of editing it.
    isActive: boolean("is_active").notNull().default(true),
    retiredAt: timestamp("retired_at", { mode: "date" }),
    replacedByDistanceBandId: text("replaced_by_distance_band_id"), // points at the new band's id, if this one was retired in favor of a replacement
    createdAt: createdAt(),
  },
  (table) => ({
    uniqueTenantCode: uniqueIndex("distance_bands_tenant_code_unique").on(table.tenantId, table.code),
  })
);

// The core rating table. A row with pricingScope = TENANT_DEFAULT and
// contractId = null is a tenant-wide individual/fixed-tariff rate,
// matched by tankerCapacityLtr alone. A row with pricingScope = CONTRACT
// belongs to exactly one contract and may additionally match on
// cityCode/zoneCode/distanceBandCode. None of this is queried or enforced
// by any code yet — the future pricing engine (a separate task) is
// responsible for the actual matching/specificity/tie-detection logic
// described in the Contract Management Schema Design docs; this table
// only defines where that logic's inputs will live.
// pricingScope: TENANT_DEFAULT | CONTRACT
// rateType: STANDARD | OVERAGE
//
// tankerCapacityLtr stays liter-specific for now (A1.5 decision): the
// first pilot is bulk water tanker delivery, and generalizing this to a
// vertical-agnostic capacityValue/capacityUnit pair is a real, identified
// future need (see the Architecture Review) but not one that blocks any
// currently-approved task — doing it now would mean redesigning this
// table a second time before it's ever been used once. Revisit this
// specifically before a second, non-liter-based vertical is actually
// built, not before.
export const contractPricingRules = pgTable(
  "contract_pricing_rules",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    pricingScope: text("pricing_scope").notNull(),
    contractId: text("contract_id"), // required (app-validated) when pricingScope = CONTRACT; must be null when pricingScope = TENANT_DEFAULT
    rateType: text("rate_type").notNull(),
    cityCode: text("city_code"), // null = wildcard, matches any city
    zoneCode: text("zone_code"), // null = wildcard within city
    distanceBandCode: text("distance_band_code"), // null = wildcard
    tankerCapacityLtr: integer("tanker_capacity_ltr"), // null = wildcard; otherwise expected to be 18000/21000/28000
    // A1.5 addition: an optional, explicit tiebreaker for the future
    // pricing engine's specificity-matching algorithm. Two rules can tie
    // in "how many dimensions are specified" while specifying *different*
    // dimensions (e.g. one on city+capacity, another on zone+distance-
    // band) — a real ambiguity the engine's design correctly hard-fails
    // on rather than guessing. `priority` gives whoever manages pricing an
    // explicit way to break such a tie deliberately, instead of always
    // requiring a config fix. Unused by anything today; nullable so
    // existing rule-creation (once the API exists) isn't forced to set it.
    priority: integer("priority"),
    pricePerTrip: real("price_per_trip"), // at most one of pricePerTrip/pricePerLiter set (app-enforced)
    pricePerLiter: real("price_per_liter"),
    vatRate: real("vat_rate").notNull().default(0.15),
    effectiveStartDate: timestamp("effective_start_date", { mode: "date" }),
    effectiveEndDate: timestamp("effective_end_date", { mode: "date" }),
    createdAt: createdAt(),
  },
  (table) => ({
    // The pricing engine's hot lookup path: for a given tenant/scope/rate
    // type/contract, find candidate rules to match against. Not a unique
    // constraint — many rules legitimately share these four values,
    // differing only in city/zone/band/capacity — just a performance
    // index for what will be a per-order query once the engine exists.
    lookupIndex: index("contract_pricing_rules_lookup_idx").on(
      table.tenantId,
      table.pricingScope,
      table.rateType,
      table.contractId
    ),
  })
);

// ---------- Milestone V.1: Contract Delivery Schedule & Planned Demand ----------
// Schema-only foundation from the Milestone V design proposal (Option B:
// a contract's recurring/fixed delivery rules generate reviewable planned
// demand FIRST — never a real order directly — which a dispatcher later
// approves and converts into an actual order via the existing, unmodified
// POST /api/orders. Nothing in this migration creates, generates, or
// converts anything: both tables start and remain empty until a later
// milestone (V.2+) builds the UI/generation/conversion code against them.
// No dispatch, billing, or pricing-engine behavior changes with this
// migration — orders.requestedTime and everything else these two tables
// eventually feed into stay exactly as they are today.
//
// Recurring rules attached to a contract. `scheduleType` and `status` are
// plain text, matching this schema's own established convention
// throughout (no pg enum type is used anywhere in this file) — validated
// at the application layer once schedule-creation code exists, the same
// way contracts.status/contractPricingRules.rateType already are.
// scheduleType: FIXED_DATE | WEEKLY | MONTHLY | DAILY | EVERY_N_DAYS | AD_HOC_WINDOW
// status: DRAFT | ACTIVE | PAUSED | ENDED | CANCELLED
export const contractDeliverySchedules = pgTable(
  "contract_delivery_schedules",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    contractId: text("contract_id").notNull(),
    // Nullable: null means "no specific site yet" — valid for an
    // all-sites contract's schedule, where the site is resolved later,
    // at planned-demand generation or conversion time, not here.
    locationId: text("location_id"),
    scheduleName: text("schedule_name").notNull(),
    scheduleType: text("schedule_type").notNull(),
    status: text("status").notNull().default("DRAFT"),
    startDate: timestamp("start_date", { mode: "date" }).notNull(),
    endDate: timestamp("end_date", { mode: "date" }), // nullable — open-ended, matching contracts.endDate's own nullability
    preferredStartTime: text("preferred_start_time"), // "HH:MM" text, matching this schema's plain-text-over-structured-type convention (e.g. distanceBands.label, contracts.notes)
    preferredEndTime: text("preferred_end_time"),
    timezone: text("timezone"),
    // WEEKLY only: comma-joined weekday abbreviations, e.g. "MON,WED,FRI" —
    // plain text rather than a JSON/array column, matching this schema's
    // own established convention of storing simple structured lists as
    // delimited text (see distanceBands' own comment for the same
    // reasoning applied to other fields in this file).
    weekdays: text("weekdays"),
    monthDay: integer("month_day"), // MONTHLY only: 1-31
    intervalEveryDays: integer("interval_every_days"), // EVERY_N_DAYS only
    quantityLiters: real("quantity_liters"), // informational/capacity-matching only — never a pricing input; real pricing always uses the assigned vehicle's real capacityLiters at delivery time (Task P.2, unaffected by this table)
    preferredTankerCapacityLiters: integer("preferred_tanker_capacity_liters"),
    loadingPointId: text("loading_point_id"), // app-level reference to warehouses.id
    notes: text("notes"),
    createdByUserId: text("created_by_user_id"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { mode: "date" }),
  },
  (table) => ({
    tenantIdx: index("contract_delivery_schedules_tenant_idx").on(table.tenantId),
    // The generation job's own query shape: "every ACTIVE schedule for
    // this contract" and, tenant-wide, "every ACTIVE schedule due to run
    // today" — both need contractId and status available together.
    contractStatusIdx: index("contract_delivery_schedules_contract_status_idx").on(
      table.tenantId,
      table.contractId,
      table.status
    ),
    statusIdx: index("contract_delivery_schedules_status_idx").on(table.tenantId, table.status),
  })
);

// Generated, reviewable planned demand — the staging layer between a
// contract's schedule and a real, dispatchable order. A row here is
// NEVER visible in Dispatch Queue or Live Trips; only after explicit
// approval and conversion (a future milestone) does a real `orders` row
// exist, at which point `convertedOrderId` links back to it here.
// status: GENERATED | REVIEWED | APPROVED | CONVERTED_TO_ORDER | CANCELLED | SKIPPED | EXPIRED
// readinessStatus: READY | BLOCKED | WARNING
// capacityMatchStatus: MATCHED | PARTIAL | UNMATCHED | NOT_CHECKED
export const plannedContractDemands = pgTable(
  "planned_contract_demands",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    contractId: text("contract_id").notNull(),
    // Nullable: a manually-created/ad hoc planned demand row has no
    // originating schedule.
    contractDeliveryScheduleId: text("contract_delivery_schedule_id"),
    // Denormalized, matching orders.customerId's own established
    // precedent in this schema (a direct pointer alongside the derivable
    // contractId -> contracts.customerId join, for the same
    // query-ergonomics reason contracts/invoices already do this).
    customerId: text("customer_id").notNull(),
    locationId: text("location_id"),
    plannedDate: timestamp("planned_date", { mode: "date" }).notNull(),
    plannedStartTime: text("planned_start_time"),
    plannedEndTime: text("planned_end_time"),
    timezone: text("timezone"),
    quantityLiters: real("quantity_liters"),
    preferredTankerCapacityLiters: integer("preferred_tanker_capacity_liters"),
    loadingPointId: text("loading_point_id"),
    status: text("status").notNull().default("GENERATED"),
    readinessStatus: text("readiness_status"),
    blockedReasons: text("blocked_reasons"), // comma-joined, matching contractDeliverySchedules.weekdays' own plain-text-list convention
    capacityMatchStatus: text("capacity_match_status").default("NOT_CHECKED"),
    generatedAt: timestamp("generated_at", { mode: "date" }),
    approvedAt: timestamp("approved_at", { mode: "date" }),
    approvedByUserId: text("approved_by_user_id"),
    convertedOrderId: text("converted_order_id"), // app-level reference to orders.id
    convertedAt: timestamp("converted_at", { mode: "date" }),
    cancelledAt: timestamp("cancelled_at", { mode: "date" }),
    cancelledByUserId: text("cancelled_by_user_id"),
    cancellationReason: text("cancellation_reason"),
    // The idempotency key a future generation job checks before inserting
    // a new row — deliberately a plain nullable column with a unique
    // index below, not a NOT NULL constraint, since this table's schema
    // itself is generation-method-agnostic (a manually-created planned
    // demand row legitimately has no generation key at all).
    generationKey: text("generation_key"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { mode: "date" }),
  },
  (table) => ({
    tenantIdx: index("planned_contract_demands_tenant_idx").on(table.tenantId),
    // The Planner's own primary query: "what's pending across all
    // contracts this week" — status + date together, tenant-scoped.
    statusDateIdx: index("planned_contract_demands_status_date_idx").on(
      table.tenantId,
      table.status,
      table.plannedDate
    ),
    // Contract detail's own "operational activity" query shape.
    contractDateIdx: index("planned_contract_demands_contract_date_idx").on(
      table.tenantId,
      table.contractId,
      table.plannedDate
    ),
    // Customer hub's own "planned demand for this customer" query shape.
    customerDateIdx: index("planned_contract_demands_customer_date_idx").on(
      table.tenantId,
      table.customerId,
      table.plannedDate
    ),
    // Reverse lookup once an order exists: "which planned demand did
    // this order come from" — and the actual duplicate-conversion guard,
    // since a nullable column can still be declared unique (multiple
    // NULLs are allowed, matching invoiceLineItems' own established use
    // of exactly this NULL-safe uniqueness pattern elsewhere in this
    // schema).
    convertedOrderUnique: uniqueIndex("planned_contract_demands_converted_order_unique").on(table.convertedOrderId),
    // The generation job's own idempotency check on rerun — same
    // NULL-safe reasoning as convertedOrderId above.
    generationKeyUnique: uniqueIndex("planned_contract_demands_generation_key_unique").on(table.generationKey),
  })
);

// ========== Milestone Z.1: Fleet Maintenance ERP Schema Foundation ==========
// Schema-only foundation, matching this schema's own established
// conventions exactly (confirmed by direct audit before writing a
// single line): zero DB-level foreign key constraints anywhere in this
// file — every relationship below is a plain text() app-level
// reference, exactly like V.1's contractDeliverySchedules/
// plannedContractDemands tables; text status/type fields, never a pg
// enum type; real() for quantities matching contractPricingRules'
// pricePerLiter precedent. Every table starts and remains empty — this
// milestone adds no create/update/delete route, no stock-posting logic,
// no PR/PO approval workflow, no fake data of any kind. These are
// genuinely NEW tables, deliberately never reusing the existing
// `warehouses` table (dispatch loading points) or `inventoryItems`
// table (legacy bottle-delivery stock) — both remain completely
// untouched, exactly as Milestone Z/AA's own audits concluded they
// must.

// ---------- Master Items ----------
// Owns item definitions only — never a stock quantity (that's
// maintenanceInventoryBalances' job), never a procurement action.
export const itemGroups = pgTable(
  "item_groups",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    status: text("status").notNull().default("ACTIVE"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { mode: "date" }),
  },
  (table) => ({
    tenantIdx: index("item_groups_tenant_idx").on(table.tenantId),
    codeUnique: uniqueIndex("item_groups_tenant_code_unique").on(table.tenantId, table.code),
    statusIdx: index("item_groups_tenant_status_idx").on(table.tenantId, table.status),
  })
);

export const itemCategories = pgTable(
  "item_categories",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    itemGroupId: text("item_group_id"), // nullable — a category need not belong to a group
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    status: text("status").notNull().default("ACTIVE"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { mode: "date" }),
  },
  (table) => ({
    tenantIdx: index("item_categories_tenant_idx").on(table.tenantId),
    codeUnique: uniqueIndex("item_categories_tenant_code_unique").on(table.tenantId, table.code),
    groupIdx: index("item_categories_tenant_group_idx").on(table.tenantId, table.itemGroupId),
    statusIdx: index("item_categories_tenant_status_idx").on(table.tenantId, table.status),
  })
);

export const itemSubcategories = pgTable(
  "item_subcategories",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    categoryId: text("category_id").notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    status: text("status").notNull().default("ACTIVE"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { mode: "date" }),
  },
  (table) => ({
    tenantIdx: index("item_subcategories_tenant_idx").on(table.tenantId),
    categoryIdx: index("item_subcategories_tenant_category_idx").on(table.tenantId, table.categoryId),
    codeUnique: uniqueIndex("item_subcategories_tenant_code_unique").on(table.tenantId, table.code),
    statusIdx: index("item_subcategories_tenant_status_idx").on(table.tenantId, table.status),
  })
);

// itemType: SPARE_PART | TIRE | LUBRICANT | CONSUMABLE | TOOL | SAFETY | OTHER
// unitOfMeasure: EA | PCS | LITER | SET | KG | METER
export const items = pgTable(
  "items",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    itemCode: text("item_code").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    itemGroupId: text("item_group_id"),
    categoryId: text("category_id").notNull(),
    subCategoryId: text("sub_category_id"),
    itemType: text("item_type").notNull(),
    unitOfMeasure: text("unit_of_measure").notNull(),
    isStocked: boolean("is_stocked").notNull().default(true),
    isSerialized: boolean("is_serialized").notNull().default(false),
    isTire: boolean("is_tire").notNull().default(false),
    brand: text("brand"),
    model: text("model"),
    partNumber: text("part_number"),
    imageUrl: text("image_url"),
    compatibleVehicleType: text("compatible_vehicle_type"),
    minimumStockLevel: real("minimum_stock_level"),
    reorderPoint: real("reorder_point"),
    status: text("status").notNull().default("ACTIVE"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { mode: "date" }),
  },
  (table) => ({
    tenantIdx: index("items_tenant_idx").on(table.tenantId),
    itemCodeUnique: uniqueIndex("items_tenant_item_code_unique").on(table.tenantId, table.itemCode),
    categoryIdx: index("items_tenant_category_idx").on(table.tenantId, table.categoryId),
    subCategoryIdx: index("items_tenant_subcategory_idx").on(table.tenantId, table.subCategoryId),
    typeIdx: index("items_tenant_type_idx").on(table.tenantId, table.itemType),
    statusIdx: index("items_tenant_status_idx").on(table.tenantId, table.status),
  })
);

// ---------- Workshops & Maintenance Warehouses ----------
// workshopType: INTERNAL | EXTERNAL | MOBILE_SERVICE
export const workshops = pgTable(
  "workshops",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    workshopCode: text("workshop_code").notNull(),
    name: text("name").notNull(),
    workshopType: text("workshop_type").notNull().default("INTERNAL"),
    status: text("status").notNull().default("ACTIVE"),
    address: text("address"),
    city: text("city"),
    district: text("district"),
    lat: real("lat"),
    lng: real("lng"),
    contactName: text("contact_name"),
    contactPhone: text("contact_phone"),
    contactEmail: text("contact_email"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { mode: "date" }),
  },
  (table) => ({
    tenantIdx: index("workshops_tenant_idx").on(table.tenantId),
    codeUnique: uniqueIndex("workshops_tenant_code_unique").on(table.tenantId, table.workshopCode),
    statusIdx: index("workshops_tenant_status_idx").on(table.tenantId, table.status),
    cityIdx: index("workshops_tenant_city_idx").on(table.tenantId, table.city),
  })
);

// Deliberately NOT the existing `warehouses` table (dispatch loading
// points) — a genuinely separate physical-location concept, per
// Milestone Z/AA/AB's own repeated, explicit conclusion.
// warehouseType: WORKSHOP_STORE | CENTRAL_SPARES | TYRE_STORE | MOBILE_VAN | OTHER
export const maintenanceWarehouses = pgTable(
  "maintenance_warehouses",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    warehouseCode: text("warehouse_code").notNull(),
    name: text("name").notNull(),
    warehouseType: text("warehouse_type").notNull().default("WORKSHOP_STORE"),
    workshopId: text("workshop_id"), // nullable — a central warehouse may have no workshop
    status: text("status").notNull().default("ACTIVE"),
    address: text("address"),
    city: text("city"),
    district: text("district"),
    lat: real("lat"),
    lng: real("lng"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { mode: "date" }),
  },
  (table) => ({
    tenantIdx: index("maintenance_warehouses_tenant_idx").on(table.tenantId),
    codeUnique: uniqueIndex("maintenance_warehouses_tenant_code_unique").on(table.tenantId, table.warehouseCode),
    workshopIdx: index("maintenance_warehouses_tenant_workshop_idx").on(table.tenantId, table.workshopId),
    statusIdx: index("maintenance_warehouses_tenant_status_idx").on(table.tenantId, table.status),
    cityIdx: index("maintenance_warehouses_tenant_city_idx").on(table.tenantId, table.city),
  })
);

// ---------- Maintenance Inventory ----------
export const maintenanceInventoryBalances = pgTable(
  "maintenance_inventory_balances",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    warehouseId: text("warehouse_id").notNull(),
    itemId: text("item_id").notNull(),
    quantityOnHand: real("quantity_on_hand").notNull().default(0),
    quantityReserved: real("quantity_reserved").notNull().default(0),
    quantityAvailable: real("quantity_available").notNull().default(0),
    lastMovementAt: timestamp("last_movement_at", { mode: "date" }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { mode: "date" }),
  },
  (table) => ({
    tenantIdx: index("maintenance_inventory_balances_tenant_idx").on(table.tenantId),
    warehouseIdx: index("maintenance_inventory_balances_tenant_warehouse_idx").on(table.tenantId, table.warehouseId),
    itemIdx: index("maintenance_inventory_balances_tenant_item_idx").on(table.tenantId, table.itemId),
    // The actual "one balance row per item per warehouse" guarantee —
    // future receipt/issue logic will upsert against this, never insert
    // a duplicate.
    warehouseItemUnique: uniqueIndex("maintenance_inventory_balances_warehouse_item_unique").on(table.tenantId, table.warehouseId, table.itemId),
  })
);

// movementType: RECEIPT | ISSUE_TO_MAINTENANCE | ADJUSTMENT_IN | ADJUSTMENT_OUT | TRANSFER_OUT | TRANSFER_IN | RETURN
// referenceType: PURCHASE_RECEIPT | MAINTENANCE_WORK_ORDER | STOCK_ADJUSTMENT | TRANSFER | RETURN
export const maintenanceInventoryMovements = pgTable(
  "maintenance_inventory_movements",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    warehouseId: text("warehouse_id").notNull(),
    itemId: text("item_id").notNull(),
    movementType: text("movement_type").notNull(),
    quantity: real("quantity").notNull(),
    unitOfMeasure: text("unit_of_measure").notNull(),
    referenceType: text("reference_type"),
    referenceId: text("reference_id"),
    vehicleId: text("vehicle_id"),
    maintenanceRecordId: text("maintenance_record_id"),
    purchaseOrderId: text("purchase_order_id"),
    goodsReceiptId: text("goods_receipt_id"),
    notes: text("notes"),
    createdByUserId: text("created_by_user_id"),
    createdAt: createdAt(),
  },
  (table) => ({
    tenantIdx: index("maintenance_inventory_movements_tenant_idx").on(table.tenantId),
    warehouseIdx: index("maintenance_inventory_movements_tenant_warehouse_idx").on(table.tenantId, table.warehouseId),
    itemIdx: index("maintenance_inventory_movements_tenant_item_idx").on(table.tenantId, table.itemId),
    typeIdx: index("maintenance_inventory_movements_tenant_type_idx").on(table.tenantId, table.movementType),
    createdAtIdx: index("maintenance_inventory_movements_tenant_created_idx").on(table.tenantId, table.createdAt),
    vehicleIdx: index("maintenance_inventory_movements_tenant_vehicle_idx").on(table.tenantId, table.vehicleId),
    referenceIdx: index("maintenance_inventory_movements_tenant_reference_idx").on(table.tenantId, table.referenceType, table.referenceId),
  })
);

// ---------- Procurement ----------
export const suppliers = pgTable(
  "suppliers",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    supplierCode: text("supplier_code").notNull(),
    name: text("name").notNull(),
    contactName: text("contact_name"),
    phone: text("phone"),
    email: text("email"),
    address: text("address"),
    taxNumber: text("tax_number"),
    status: text("status").notNull().default("ACTIVE"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { mode: "date" }),
  },
  (table) => ({
    tenantIdx: index("suppliers_tenant_idx").on(table.tenantId),
    codeUnique: uniqueIndex("suppliers_tenant_code_unique").on(table.tenantId, table.supplierCode),
    statusIdx: index("suppliers_tenant_status_idx").on(table.tenantId, table.status),
  })
);

// status: DRAFT | SUBMITTED | APPROVED | REJECTED | CANCELLED | CONVERTED_TO_PO
// priority: LOW | NORMAL | HIGH | URGENT
export const purchaseRequisitions = pgTable(
  "purchase_requisitions",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    prNumber: text("pr_number").notNull(),
    requestedByUserId: text("requested_by_user_id").notNull(),
    workshopId: text("workshop_id"),
    warehouseId: text("warehouse_id"),
    vehicleId: text("vehicle_id"),
    maintenanceRecordId: text("maintenance_record_id"),
    status: text("status").notNull().default("DRAFT"),
    priority: text("priority").notNull().default("NORMAL"),
    requiredByDate: timestamp("required_by_date", { mode: "date" }),
    justification: text("justification"),
    approvedByUserId: text("approved_by_user_id"),
    approvedAt: timestamp("approved_at", { mode: "date" }),
    rejectedByUserId: text("rejected_by_user_id"),
    rejectedAt: timestamp("rejected_at", { mode: "date" }),
    rejectionReason: text("rejection_reason"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { mode: "date" }),
  },
  (table) => ({
    tenantIdx: index("purchase_requisitions_tenant_idx").on(table.tenantId),
    prNumberUnique: uniqueIndex("purchase_requisitions_tenant_pr_number_unique").on(table.tenantId, table.prNumber),
    statusIdx: index("purchase_requisitions_tenant_status_idx").on(table.tenantId, table.status),
    requestedByIdx: index("purchase_requisitions_tenant_requested_by_idx").on(table.tenantId, table.requestedByUserId),
    workshopIdx: index("purchase_requisitions_tenant_workshop_idx").on(table.tenantId, table.workshopId),
    warehouseIdx: index("purchase_requisitions_tenant_warehouse_idx").on(table.tenantId, table.warehouseId),
    vehicleIdx: index("purchase_requisitions_tenant_vehicle_idx").on(table.tenantId, table.vehicleId),
  })
);

export const purchaseRequisitionLines = pgTable(
  "purchase_requisition_lines",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    purchaseRequisitionId: text("purchase_requisition_id").notNull(),
    itemId: text("item_id").notNull(),
    description: text("description"),
    quantity: real("quantity").notNull(),
    unitOfMeasure: text("unit_of_measure").notNull(),
    estimatedUnitCost: real("estimated_unit_cost"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { mode: "date" }),
  },
  (table) => ({
    tenantIdx: index("purchase_requisition_lines_tenant_idx").on(table.tenantId),
    prIdx: index("purchase_requisition_lines_tenant_pr_idx").on(table.tenantId, table.purchaseRequisitionId),
    itemIdx: index("purchase_requisition_lines_tenant_item_idx").on(table.tenantId, table.itemId),
  })
);

// status: DRAFT | ISSUED | PARTIALLY_RECEIVED | RECEIVED | CANCELLED | CLOSED
export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    poNumber: text("po_number").notNull(),
    supplierId: text("supplier_id").notNull(),
    sourcePurchaseRequisitionId: text("source_purchase_requisition_id"),
    status: text("status").notNull().default("DRAFT"),
    orderDate: timestamp("order_date", { mode: "date" }).notNull().$defaultFn(() => new Date()),
    expectedDeliveryDate: timestamp("expected_delivery_date", { mode: "date" }),
    subtotal: real("subtotal").notNull().default(0),
    taxAmount: real("tax_amount").notNull().default(0),
    totalAmount: real("total_amount").notNull().default(0),
    notes: text("notes"),
    issuedByUserId: text("issued_by_user_id"),
    issuedAt: timestamp("issued_at", { mode: "date" }),
    closedAt: timestamp("closed_at", { mode: "date" }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { mode: "date" }),
  },
  (table) => ({
    tenantIdx: index("purchase_orders_tenant_idx").on(table.tenantId),
    poNumberUnique: uniqueIndex("purchase_orders_tenant_po_number_unique").on(table.tenantId, table.poNumber),
    supplierIdx: index("purchase_orders_tenant_supplier_idx").on(table.tenantId, table.supplierId),
    statusIdx: index("purchase_orders_tenant_status_idx").on(table.tenantId, table.status),
    sourcePrIdx: index("purchase_orders_tenant_source_pr_idx").on(table.tenantId, table.sourcePurchaseRequisitionId),
  })
);

export const purchaseOrderLines = pgTable(
  "purchase_order_lines",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    purchaseOrderId: text("purchase_order_id").notNull(),
    itemId: text("item_id").notNull(),
    description: text("description"),
    orderedQuantity: real("ordered_quantity").notNull(),
    receivedQuantity: real("received_quantity").notNull().default(0),
    unitOfMeasure: text("unit_of_measure").notNull(),
    unitPrice: real("unit_price").notNull().default(0),
    taxRate: real("tax_rate").notNull().default(0),
    lineTotal: real("line_total").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { mode: "date" }),
  },
  (table) => ({
    tenantIdx: index("purchase_order_lines_tenant_idx").on(table.tenantId),
    poIdx: index("purchase_order_lines_tenant_po_idx").on(table.tenantId, table.purchaseOrderId),
    itemIdx: index("purchase_order_lines_tenant_item_idx").on(table.tenantId, table.itemId),
  })
);

// status: DRAFT | POSTED | CANCELLED
export const goodsReceipts = pgTable(
  "goods_receipts",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    receiptNumber: text("receipt_number").notNull(),
    purchaseOrderId: text("purchase_order_id").notNull(),
    warehouseId: text("warehouse_id").notNull(),
    receivedByUserId: text("received_by_user_id").notNull(),
    receivedAt: timestamp("received_at", { mode: "date" }).notNull().$defaultFn(() => new Date()),
    status: text("status").notNull().default("DRAFT"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { mode: "date" }),
  },
  (table) => ({
    tenantIdx: index("goods_receipts_tenant_idx").on(table.tenantId),
    receiptNumberUnique: uniqueIndex("goods_receipts_tenant_receipt_number_unique").on(table.tenantId, table.receiptNumber),
    poIdx: index("goods_receipts_tenant_po_idx").on(table.tenantId, table.purchaseOrderId),
    warehouseIdx: index("goods_receipts_tenant_warehouse_idx").on(table.tenantId, table.warehouseId),
    statusIdx: index("goods_receipts_tenant_status_idx").on(table.tenantId, table.status),
  })
);

export const goodsReceiptLines = pgTable(
  "goods_receipt_lines",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    goodsReceiptId: text("goods_receipt_id").notNull(),
    purchaseOrderLineId: text("purchase_order_line_id").notNull(),
    itemId: text("item_id").notNull(),
    receivedQuantity: real("received_quantity").notNull(),
    acceptedQuantity: real("accepted_quantity").notNull().default(0),
    rejectedQuantity: real("rejected_quantity").notNull().default(0),
    unitOfMeasure: text("unit_of_measure").notNull(),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (table) => ({
    tenantIdx: index("goods_receipt_lines_tenant_idx").on(table.tenantId),
    receiptIdx: index("goods_receipt_lines_tenant_receipt_idx").on(table.tenantId, table.goodsReceiptId),
    poLineIdx: index("goods_receipt_lines_tenant_po_line_idx").on(table.tenantId, table.purchaseOrderLineId),
    itemIdx: index("goods_receipt_lines_tenant_item_idx").on(table.tenantId, table.itemId),
  })
);

// Line items on an invoice — replaces A1's `invoice_orders` (see the
// section-level note above for why: the real relationship is one-to-many,
// not many-to-many, and a join table had no room for a non-order line).
// NOT used by any invoice generation logic today. Every invoice created by
// the current system continues to go through the existing
// one-order-one-invoice path (invoices.orderId) entirely unchanged; this
// table exists now, empty, so it's already in the right shape once a
// later task (month-end consolidated invoice generation) is built,
// without needing another migration at that point.
export const invoiceLineItems = pgTable(
  "invoice_line_items",
  {
    id: text("id").primaryKey(),
    // Added directly in A1.5, matching the existing creditNotes precedent
    // (creditNotes.tenantId already exists directly, despite being
    // logically "child of an invoice" the same way this table is) —
    // consistent with the rest of this financial-table family, and safe
    // to add as NOT NULL since this table is empty everywhere today.
    tenantId: text("tenant_id").notNull(),
    invoiceId: text("invoice_id").notNull(),
    // Nullable from day one (A1.5 correction) — an order-derived line sets
    // this; a future non-order line (an adjustment, a minimum-billing
    // fee) leaves it null. This is the specific gap that made the A1
    // shape (invoice_orders, orderId NOT NULL) the wrong long-term
    // choice.
    orderId: text("order_id"),
    description: text("description"), // free text for non-order lines; null is fine for an order-derived line where the order itself is the description
    quantity: real("quantity"),
    unitPrice: real("unit_price"),
    // Frozen at generation time — deliberately not re-computed from
    // contract_pricing_rules on read, so a historical invoice's amount can
    // never silently change if a pricing rule is edited later. Same
    // principle already used by invoices.discountAmount above (copied from
    // the order at invoice time, per its own comment, for exactly this
    // reason).
    lineAmount: real("line_amount").notNull(),
    lineVatAmount: real("line_vat_amount").notNull(),
    createdAt: createdAt(),
  },
  (table) => ({
    // Prevents the same real order being double-billed onto one invoice.
    // Note: multiple NULL orderId rows for the same invoiceId do NOT
    // violate this constraint under standard SQL NULL semantics — exactly
    // what's needed to allow many non-order lines per invoice.
    uniqueInvoiceOrder: uniqueIndex("invoice_line_items_invoice_order_unique").on(table.invoiceId, table.orderId),
    invoiceIdx: index("invoice_line_items_invoice_idx").on(table.invoiceId),
    orderIdx: index("invoice_line_items_order_idx").on(table.orderId),
  })
);

// ---------- BR-09: Warehouse & Depot Management ----------
// A tenant can have multiple warehouses (depots) — each with its own stock
// ledger and its own coordinates used as the BR-06 route-optimization
// origin/destination for trips loading out of it.
export const warehouses = pgTable("warehouses", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  name: text("name").notNull(),
  address: text("address").notNull(),
  lat: real("lat").notNull(),
  lng: real("lng").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: createdAt(),
});

// ---------- BR-09: Warehouse & Loading / Inventory ----------
export const inventoryItems = pgTable("inventory_items", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  warehouseId: text("warehouse_id").notNull(),
  itemName: text("item_name").notNull(), // e.g. "19L Bottle - Full", "19L Bottle - Empty"
  quantity: integer("quantity").notNull().default(0),
  unit: text("unit").notNull().default("bottle"),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull().$defaultFn(() => new Date()),
});

// ---------- BR-15: Maintenance Management ----------
// type: PREVENTIVE | CORRECTIVE | EMERGENCY
// status: OPEN | COMPLETED
export const maintenanceRecords = pgTable("maintenance_records", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  vehicleId: text("vehicle_id").notNull(),
  type: text("type").notNull().default("PREVENTIVE"),
  description: text("description").notNull(),
  odometerReading: integer("odometer_reading"),
  cost: real("cost"),
  status: text("status").notNull().default("OPEN"),
  openedAt: timestamp("opened_at", { mode: "date" }).notNull().$defaultFn(() => new Date()),
  completedAt: timestamp("completed_at", { mode: "date" }),
});

// ---------- BR-13: Fuel Monitoring ----------
export const fuelLogs = pgTable("fuel_logs", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  vehicleId: text("vehicle_id").notNull(),
  tripId: text("trip_id"),
  litersFilled: real("liters_filled").notNull(),
  costSar: real("cost_sar").notNull(),
  odometerReading: integer("odometer_reading"),
  filledAt: timestamp("filled_at", { mode: "date" }).notNull().$defaultFn(() => new Date()),
});

// ---------- BR-14: Tyre & Inventory Management ----------
// status: ACTIVE | RETIRED
export const tyreRecords = pgTable("tyre_records", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  vehicleId: text("vehicle_id").notNull(),
  position: text("position").notNull(), // e.g. "Front-Left", "Rear-Right-Outer"
  serialNumber: text("serial_number"),
  costSar: real("cost_sar"),
  installOdometer: integer("install_odometer"),
  status: text("status").notNull().default("ACTIVE"),
  installedAt: timestamp("installed_at", { mode: "date" }).notNull().$defaultFn(() => new Date()),
  retiredAt: timestamp("retired_at", { mode: "date" }),
});

// ---------- BR-11: Delivery Exceptions & Returns ----------
// Auto-created whenever a stop is marked FAILED or PARTIALLY_DELIVERED (see
// the stop-action route) — every exception starts OPEN and stays that way
// until a dispatcher applies one of the four closing actions
// (RESCHEDULE/RETURN/REASSIGN/CANCEL). Escalating is a separate flag, not a
// closing action, since escalating asks for help rather than resolving the
// case — you can escalate an exception and still resolve it afterward.
//
// customerNotified is a simulated flag, not a real SMS/email send — there's
// no messaging provider wired into this build (same category of honest
// simplification as the GPS simulation elsewhere in this project).
export const exceptions = pgTable("exceptions", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  orderId: text("order_id").notNull(),
  tripStopId: text("trip_stop_id").notNull(),
  type: text("type").notNull(), // FAILED | PARTIALLY_DELIVERED — mirrors the stop outcome that triggered this
  reason: text("reason"),
  status: text("status").notNull().default("OPEN"), // OPEN | RESOLVED
  escalated: boolean("escalated").notNull().default(false),
  escalatedToUserId: text("escalated_to_user_id"),
  escalatedAt: timestamp("escalated_at", { mode: "date" }),
  resolutionAction: text("resolution_action"), // RESCHEDULE | RETURN | REASSIGN | CANCEL
  resolutionNotes: text("resolution_notes"),
  returnNoteNumber: text("return_note_number"), // set for RETURN/CANCEL actions that return stock
  quantityReturned: integer("quantity_returned"), // bottles returned to warehouse stock, if any
  followUpOrderId: text("follow_up_order_id"), // set for RESCHEDULE/REASSIGN — the new order created
  customerNotified: boolean("customer_notified").notNull().default(false),
  customerNotifiedAt: timestamp("customer_notified_at", { mode: "date" }),
  createdAt: createdAt(),
  resolvedAt: timestamp("resolved_at", { mode: "date" }),
});

// ---------- BR-20: SLA & Escalation Management ----------
// SLA *status* is still computed on read (see lib/sla.ts) — no background
// job runner exists in this build. But an actual escalation is a real,
// persisted event with an audit trail, not just a badge that disappears
// once you stop looking. checkAndCreateEscalations() (see
// lib/escalations.ts) is called as a side effect of the existing SLA
// polling endpoints, so an order crossing into AT_RISK or BREACHED gets a
// row here within one poll cycle (a few seconds) — genuinely automatic in
// effect, even without a real cron scheduler behind it. Documented plainly
// as an honest simplification, same category as the GPS simulation
// elsewhere in this build.
//
// notifiedAt is a simulated notification timestamp — no real messaging
// provider is wired into this build (same caveat as exceptions.customerNotified).
export const escalations = pgTable("escalations", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  orderId: text("order_id").notNull(),
  severity: text("severity").notNull(), // MEDIUM | HIGH
  // AT_RISK | BREACHED for SLA-triggered escalations (lib/escalations.ts);
  // RULE_TRIGGERED for ones created by a custom automation rule (BR-22,
  // lib/automation.ts) — same table, same acknowledge/resolve workflow,
  // regardless of what caused it.
  slaStatusAtEscalation: text("sla_status_at_escalation").notNull(),
  status: text("status").notNull().default("OPEN"), // OPEN | ACKNOWLEDGED | RESOLVED
  escalatedToUserId: text("escalated_to_user_id"), // an ADMIN in the tenant, chosen automatically
  notifiedAt: timestamp("notified_at", { mode: "date" }).notNull().$defaultFn(() => new Date()),
  acknowledgedAt: timestamp("acknowledged_at", { mode: "date" }),
  acknowledgedByUserId: text("acknowledged_by_user_id"),
  resolvedAt: timestamp("resolved_at", { mode: "date" }),
  resolutionNotes: text("resolution_notes"),
  createdAt: createdAt(),
});

// ---------- BR-22: Workflow Automation Engine ----------
// A genuine rule engine, not more hardcoded automations: an Admin defines
// rules (event type + optional conditions + an action) through the UI, and
// the same rule-matching code path runs for every tenant — nobody's rules
// are special-cased in application logic.
//
// There's no event bus in this build. Each event type is fired by calling
// runAutomationRules() directly from the exact route handler where that
// state transition already happens (order creation, delivery outcome,
// trip dispatch, invoice creation) — see lib/automation.ts for the full
// list and the honest framing on why this is a deliberate simplification,
// not a real pub/sub system.
export const automationRules = pgTable("automation_rules", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  name: text("name").notNull(),
  eventType: text("event_type").notNull(), // see EVENT_TYPES in lib/automation.ts
  conditions: text("conditions").notNull(), // JSON-encoded AutomationCondition[] — empty array matches every event
  action: text("action").notNull(), // NOTIFY | ESCALATE
  actionConfig: text("action_config").notNull(), // JSON — see lib/automation.ts for the shape per action
  enabled: boolean("enabled").notNull().default(true),
  createdAt: createdAt(),
});

// One row per rule *firing* (not per rule) — the audit trail BR-22
// explicitly asks for ("Workflow Logs"). A SKIPPED_DUPLICATE row still gets
// logged (rather than silently doing nothing) so the anti-spam behavior
// itself is visible and verifiable, not just assumed.
export const automationLogs = pgTable("automation_logs", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  ruleId: text("rule_id").notNull(),
  eventType: text("event_type").notNull(),
  orderId: text("order_id"),
  status: text("status").notNull(), // FIRED | SKIPPED_DUPLICATE
  actionTaken: text("action_taken"), // NOTIFY | ESCALATE — null if skipped
  details: text("details"), // the notification message sent, or the escalation id created
  createdAt: createdAt(),
});

// A lightweight in-app notification log — simulated, same honesty caveat
// as exceptions.customerNotified and escalations.notifiedAt elsewhere in
// this build: no real email/SMS/push provider is wired in here.
export const notifications = pgTable("notifications", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  orderId: text("order_id"),
  message: text("message").notNull(),
  read: boolean("read").notNull().default(false),
  createdAt: createdAt(),
});

// ---------- BR-23: Task, Expense & Field Activity Management ----------
// Tasks are deliberately separate from Orders/Trips — a driver can be
// assigned an inspection, a collection, a site visit, a refuel, or
// exception-handling work that isn't a delivery at all. dueAt/startedAt/
// completedAt track the lifecycle; completionNotes is the "uploads photos
// or notes" step from the BRD's cycle — text only, since there's no blob
// storage in this build (same honest simplification as ePOD elsewhere:
// structured data is real, photo capture is not).
export const tasks = pgTable("tasks", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  driverId: text("driver_id").notNull(),
  vehicleId: text("vehicle_id"),
  tripId: text("trip_id"),
  type: text("type").notNull(), // INSPECTION | COLLECTION | VISIT | REFUEL | EXCEPTION_HANDLING | OTHER
  title: text("title").notNull(),
  notes: text("notes"),
  status: text("status").notNull().default("ASSIGNED"), // ASSIGNED | IN_PROGRESS | COMPLETED | CANCELLED
  assignedByUserId: text("assigned_by_user_id").notNull(),
  dueAt: timestamp("due_at", { mode: "date" }),
  startedAt: timestamp("started_at", { mode: "date" }),
  completedAt: timestamp("completed_at", { mode: "date" }),
  completionNotes: text("completion_notes"),
  createdAt: createdAt(),
});

// BR-23 rule: "every expense must be linked to a driver, vehicle, and a
// trip or a reason" — enforced at the API layer (vehicleId is required by
// the schema; either tripId or reason must be present, checked in the
// route since that's a cross-field rule Postgres's column constraints
// can't express cleanly here). receiptDescription is a text field, not a
// real file upload — same honest caveat as tasks.completionNotes above.
export const expenseClaims = pgTable("expense_claims", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  driverId: text("driver_id").notNull(),
  vehicleId: text("vehicle_id").notNull(),
  tripId: text("trip_id"),
  reason: text("reason"), // required when tripId is absent
  category: text("category").notNull(), // FUEL | TOLL | MAINTENANCE | OTHER
  amount: real("amount").notNull(),
  description: text("description"),
  receiptDescription: text("receipt_description"),
  status: text("status").notNull().default("PENDING"), // PENDING | APPROVED | REJECTED
  reviewedByUserId: text("reviewed_by_user_id"),
  reviewedAt: timestamp("reviewed_at", { mode: "date" }),
  reviewNotes: text("review_notes"),
  createdAt: createdAt(),
});

// ---------- BR-17: Configurable Driver Scorecard Weights ----------
// One row per tenant. Weights don't need to sum to 100 — the score
// computation in lib/scorecards.ts normalizes whatever's here, so an admin
// entering e.g. 5/3/2 gets the same result as 50/30/20. Missing a row
// entirely (a tenant that's never saved custom weights) falls back to
// DEFAULT_SCORECARD_WEIGHTS in lib/scorecards.ts, not an error.
export const scorecardConfigs = pgTable("scorecard_configs", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().unique(),
  onTimeWeight: real("on_time_weight").notNull().default(50),
  deliverySuccessWeight: real("delivery_success_weight").notNull().default(30),
  tripVolumeWeight: real("trip_volume_weight").notNull().default(20),
  tripVolumeCap: integer("trip_volume_cap").notNull().default(20),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull().$defaultFn(() => new Date()),
});

// ---------- BR-19: ERP/Accounting Sync ----------
// One connection per tenant (for now — see README's ERP sync section for
// the "not verified against a live server" caveat). apiKey is stored as
// plain text here, which is fine for this dev/demo scope; a production
// deployment should encrypt it at rest (e.g. via a KMS-backed field) before
// this ever touches real Odoo credentials.
export const erpConnections = pgTable("erp_connections", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().unique(),
  provider: text("provider").notNull().default("ODOO"),
  baseUrl: text("base_url").notNull(), // e.g. https://mycompany.odoo.com
  database: text("database").notNull(),
  username: text("username").notNull(),
  apiKey: text("api_key").notNull(),
  defaultTaxId: text("default_tax_id"), // Odoo account.tax id for 15% KSA VAT, once known
  enabled: boolean("enabled").notNull().default(true),
  lastTestedAt: timestamp("last_tested_at", { mode: "date" }),
  lastTestStatus: text("last_test_status"), // SUCCESS | FAILED | null (never tested)
  lastTestError: text("last_test_error"),
  createdAt: createdAt(),
});

// ---------- BR-21: Custom Report Builder ----------
// A saved report is just a dataset key + a JSON config (which fields,
// filters, sort) — see lib/reportDatasets.ts for the whitelist of datasets
// and columns this can reference. Storing the config as JSON rather than
// normalized tables keeps this flexible without needing a schema change
// every time a new filter type is added.
export const savedReports = pgTable("saved_reports", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  createdByUserId: text("created_by_user_id").notNull(),
  name: text("name").notNull(),
  datasetKey: text("dataset_key").notNull(),
  config: text("config").notNull(), // JSON-encoded ReportConfig — see lib/reportDatasets.ts
  createdAt: createdAt(),
});

// ---------- Relations (enables nested `with: {...}` queries) ----------
export const tenantsRelations = relations(tenants, ({ many }) => ({
  users: many(users),
  customers: many(customers),
  vehicles: many(vehicles),
  drivers: many(drivers),
  orders: many(orders),
  trips: many(trips),
  invoices: many(invoices),
  warehouses: many(warehouses),
}));

export const warehousesRelations = relations(warehouses, ({ one, many }) => ({
  tenant: one(tenants, { fields: [warehouses.tenantId], references: [tenants.id] }),
  inventoryItems: many(inventoryItems),
  trips: many(trips),
}));

export const inventoryItemsRelations = relations(inventoryItems, ({ one }) => ({
  tenant: one(tenants, { fields: [inventoryItems.tenantId], references: [tenants.id] }),
  warehouse: one(warehouses, { fields: [inventoryItems.warehouseId], references: [warehouses.id] }),
}));

export const usersRelations = relations(users, ({ one }) => ({
  tenant: one(tenants, { fields: [users.tenantId], references: [tenants.id] }),
  driverProfile: one(drivers, { fields: [users.id], references: [drivers.userId] }),
}));

export const platformAdminTenantGrantsRelations = relations(platformAdminTenantGrants, ({ one }) => ({
  user: one(users, { fields: [platformAdminTenantGrants.userId], references: [users.id] }),
  tenant: one(tenants, { fields: [platformAdminTenantGrants.tenantId], references: [tenants.id] }),
}));

export const customersRelations = relations(customers, ({ one, many }) => ({
  tenant: one(tenants, { fields: [customers.tenantId], references: [tenants.id] }),
  subscriptions: many(subscriptions),
  orders: many(orders),
  invoices: many(invoices),
  locations: many(customerLocations),
}));

export const customerLocationsRelations = relations(customerLocations, ({ one }) => ({
  customer: one(customers, { fields: [customerLocations.customerId], references: [customers.id] }),
}));

export const subscriptionsRelations = relations(subscriptions, ({ one }) => ({
  customer: one(customers, { fields: [subscriptions.customerId], references: [customers.id] }),
}));

export const driversRelations = relations(drivers, ({ one, many }) => ({
  tenant: one(tenants, { fields: [drivers.tenantId], references: [tenants.id] }),
  user: one(users, { fields: [drivers.userId], references: [users.id] }),
  trips: many(trips),
}));

export const vehiclesRelations = relations(vehicles, ({ one, many }) => ({
  tenant: one(tenants, { fields: [vehicles.tenantId], references: [tenants.id] }),
  trips: many(trips),
  maintenanceRecords: many(maintenanceRecords),
  fuelLogs: many(fuelLogs),
  tyreRecords: many(tyreRecords),
}));

export const maintenanceRecordsRelations = relations(maintenanceRecords, ({ one }) => ({
  vehicle: one(vehicles, { fields: [maintenanceRecords.vehicleId], references: [vehicles.id] }),
}));

export const fuelLogsRelations = relations(fuelLogs, ({ one }) => ({
  vehicle: one(vehicles, { fields: [fuelLogs.vehicleId], references: [vehicles.id] }),
  trip: one(trips, { fields: [fuelLogs.tripId], references: [trips.id] }),
}));

export const tyreRecordsRelations = relations(tyreRecords, ({ one }) => ({
  vehicle: one(vehicles, { fields: [tyreRecords.vehicleId], references: [vehicles.id] }),
}));

export const ordersRelations = relations(orders, ({ one }) => ({
  tenant: one(tenants, { fields: [orders.tenantId], references: [tenants.id] }),
  customer: one(customers, { fields: [orders.customerId], references: [customers.id] }),
  location: one(customerLocations, { fields: [orders.locationId], references: [customerLocations.id] }),
  // Contract Management A1: schema relation only — no order-creation code
  // reads or writes this yet (a later task, "order/contract attachment").
  contract: one(contracts, { fields: [orders.contractId], references: [contracts.id] }),
  tripStop: one(tripStops, { fields: [orders.id], references: [tripStops.orderId] }),
  invoice: one(invoices, { fields: [orders.id], references: [invoices.orderId] }),
}));

export const tripsRelations = relations(trips, ({ one, many }) => ({
  tenant: one(tenants, { fields: [trips.tenantId], references: [tenants.id] }),
  driver: one(drivers, { fields: [trips.driverId], references: [drivers.id] }),
  vehicle: one(vehicles, { fields: [trips.vehicleId], references: [vehicles.id] }),
  warehouse: one(warehouses, { fields: [trips.warehouseId], references: [warehouses.id] }),
  stops: many(tripStops),
}));

export const tripStopsRelations = relations(tripStops, ({ one }) => ({
  trip: one(trips, { fields: [tripStops.tripId], references: [trips.id] }),
  order: one(orders, { fields: [tripStops.orderId], references: [orders.id] }),
  epod: one(epods, { fields: [tripStops.id], references: [epods.tripStopId] }),
}));

// BR-11: lets the Exception Center pull the order/customer and
// trip/driver/vehicle context in one query rather than the API route
// stitching it together manually.
export const exceptionsRelations = relations(exceptions, ({ one }) => ({
  order: one(orders, { fields: [exceptions.orderId], references: [orders.id] }),
  tripStop: one(tripStops, { fields: [exceptions.tripStopId], references: [tripStops.id] }),
}));

// BR-20: lets the Escalations panel pull order/customer context in one query.
export const escalationsRelations = relations(escalations, ({ one }) => ({
  order: one(orders, { fields: [escalations.orderId], references: [orders.id] }),
}));

export const automationLogsRelations = relations(automationLogs, ({ one }) => ({
  order: one(orders, { fields: [automationLogs.orderId], references: [orders.id] }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  order: one(orders, { fields: [notifications.orderId], references: [orders.id] }),
}));

export const tasksRelations = relations(tasks, ({ one }) => ({
  driver: one(drivers, { fields: [tasks.driverId], references: [drivers.id] }),
  vehicle: one(vehicles, { fields: [tasks.vehicleId], references: [vehicles.id] }),
  trip: one(trips, { fields: [tasks.tripId], references: [trips.id] }),
}));

export const expenseClaimsRelations = relations(expenseClaims, ({ one }) => ({
  driver: one(drivers, { fields: [expenseClaims.driverId], references: [drivers.id] }),
  vehicle: one(vehicles, { fields: [expenseClaims.vehicleId], references: [vehicles.id] }),
  trip: one(trips, { fields: [expenseClaims.tripId], references: [trips.id] }),
}));

export const epodsRelations = relations(epods, ({ one }) => ({
  tripStop: one(tripStops, { fields: [epods.tripStopId], references: [tripStops.id] }),
}));

export const invoicesRelations = relations(invoices, ({ one, many }) => ({
  tenant: one(tenants, { fields: [invoices.tenantId], references: [tenants.id] }),
  order: one(orders, { fields: [invoices.orderId], references: [orders.id] }),
  customer: one(customers, { fields: [invoices.customerId], references: [customers.id] }),
  creditNotes: many(creditNotes),
  // Task E: the monthly-billing side of the relationship this invoice
  // covers, if any (null for a normal single-order invoice).
  contractPeriod: one(contractPeriods, { fields: [invoices.contractPeriodId], references: [contractPeriods.id] }),
  lineItems: many(invoiceLineItems),
}));

export const creditNotesRelations = relations(creditNotes, ({ one }) => ({
  invoice: one(invoices, { fields: [creditNotes.invoiceId], references: [invoices.id] }),
  customer: one(customers, { fields: [creditNotes.customerId], references: [customers.id] }),
}));

// ---------- Contract Management — Schema Foundation (A1) relations ----------
// Purely descriptive schema relations for Drizzle's query builder — no
// application code queries through these yet.

export const contractsRelations = relations(contracts, ({ one, many }) => ({
  tenant: one(tenants, { fields: [contracts.tenantId], references: [tenants.id] }),
  customer: one(customers, { fields: [contracts.customerId], references: [customers.id] }),
  siteScope: many(contractSiteScope),
  periods: many(contractPeriods),
  pricingRules: many(contractPricingRules),
  deliverySchedules: many(contractDeliverySchedules),
  plannedDemands: many(plannedContractDemands),
}));

export const contractSiteScopeRelations = relations(contractSiteScope, ({ one }) => ({
  contract: one(contracts, { fields: [contractSiteScope.contractId], references: [contracts.id] }),
  customerLocation: one(customerLocations, { fields: [contractSiteScope.customerLocationId], references: [customerLocations.id] }),
}));

export const contractPeriodsRelations = relations(contractPeriods, ({ one }) => ({
  tenant: one(tenants, { fields: [contractPeriods.tenantId], references: [tenants.id] }),
  contract: one(contracts, { fields: [contractPeriods.contractId], references: [contracts.id] }),
}));

export const distanceBandsRelations = relations(distanceBands, ({ one }) => ({
  tenant: one(tenants, { fields: [distanceBands.tenantId], references: [tenants.id] }),
  replacedByDistanceBand: one(distanceBands, { fields: [distanceBands.replacedByDistanceBandId], references: [distanceBands.id] }),
}));

export const contractPricingRulesRelations = relations(contractPricingRules, ({ one }) => ({
  tenant: one(tenants, { fields: [contractPricingRules.tenantId], references: [tenants.id] }),
  contract: one(contracts, { fields: [contractPricingRules.contractId], references: [contracts.id] }),
}));

export const contractDeliverySchedulesRelations = relations(contractDeliverySchedules, ({ one, many }) => ({
  tenant: one(tenants, { fields: [contractDeliverySchedules.tenantId], references: [tenants.id] }),
  contract: one(contracts, { fields: [contractDeliverySchedules.contractId], references: [contracts.id] }),
  location: one(customerLocations, { fields: [contractDeliverySchedules.locationId], references: [customerLocations.id] }),
  plannedDemands: many(plannedContractDemands),
}));

export const plannedContractDemandsRelations = relations(plannedContractDemands, ({ one }) => ({
  tenant: one(tenants, { fields: [plannedContractDemands.tenantId], references: [tenants.id] }),
  contract: one(contracts, { fields: [plannedContractDemands.contractId], references: [contracts.id] }),
  schedule: one(contractDeliverySchedules, {
    fields: [plannedContractDemands.contractDeliveryScheduleId],
    references: [contractDeliverySchedules.id],
  }),
  customer: one(customers, { fields: [plannedContractDemands.customerId], references: [customers.id] }),
  location: one(customerLocations, { fields: [plannedContractDemands.locationId], references: [customerLocations.id] }),
}));

// ---------- Milestone Z.1 relations ----------
export const itemGroupsRelations = relations(itemGroups, ({ many }) => ({
  categories: many(itemCategories),
}));

export const itemCategoriesRelations = relations(itemCategories, ({ one, many }) => ({
  itemGroup: one(itemGroups, { fields: [itemCategories.itemGroupId], references: [itemGroups.id] }),
  subcategories: many(itemSubcategories),
  items: many(items),
}));

export const itemSubcategoriesRelations = relations(itemSubcategories, ({ one, many }) => ({
  category: one(itemCategories, { fields: [itemSubcategories.categoryId], references: [itemCategories.id] }),
  items: many(items),
}));

export const itemsRelations = relations(items, ({ one, many }) => ({
  itemGroup: one(itemGroups, { fields: [items.itemGroupId], references: [itemGroups.id] }),
  category: one(itemCategories, { fields: [items.categoryId], references: [itemCategories.id] }),
  subCategory: one(itemSubcategories, { fields: [items.subCategoryId], references: [itemSubcategories.id] }),
  balances: many(maintenanceInventoryBalances),
  movements: many(maintenanceInventoryMovements),
}));

export const workshopsRelations = relations(workshops, ({ many }) => ({
  maintenanceWarehouses: many(maintenanceWarehouses),
}));

export const maintenanceWarehousesRelations = relations(maintenanceWarehouses, ({ one, many }) => ({
  workshop: one(workshops, { fields: [maintenanceWarehouses.workshopId], references: [workshops.id] }),
  balances: many(maintenanceInventoryBalances),
  movements: many(maintenanceInventoryMovements),
}));

export const maintenanceInventoryBalancesRelations = relations(maintenanceInventoryBalances, ({ one }) => ({
  warehouse: one(maintenanceWarehouses, { fields: [maintenanceInventoryBalances.warehouseId], references: [maintenanceWarehouses.id] }),
  item: one(items, { fields: [maintenanceInventoryBalances.itemId], references: [items.id] }),
}));

export const maintenanceInventoryMovementsRelations = relations(maintenanceInventoryMovements, ({ one }) => ({
  warehouse: one(maintenanceWarehouses, { fields: [maintenanceInventoryMovements.warehouseId], references: [maintenanceWarehouses.id] }),
  item: one(items, { fields: [maintenanceInventoryMovements.itemId], references: [items.id] }),
}));

export const suppliersRelations = relations(suppliers, ({ many }) => ({
  purchaseOrders: many(purchaseOrders),
}));

export const purchaseRequisitionsRelations = relations(purchaseRequisitions, ({ many }) => ({
  lines: many(purchaseRequisitionLines),
  purchaseOrders: many(purchaseOrders),
}));

export const purchaseRequisitionLinesRelations = relations(purchaseRequisitionLines, ({ one }) => ({
  requisition: one(purchaseRequisitions, { fields: [purchaseRequisitionLines.purchaseRequisitionId], references: [purchaseRequisitions.id] }),
  item: one(items, { fields: [purchaseRequisitionLines.itemId], references: [items.id] }),
}));

export const purchaseOrdersRelations = relations(purchaseOrders, ({ one, many }) => ({
  supplier: one(suppliers, { fields: [purchaseOrders.supplierId], references: [suppliers.id] }),
  sourceRequisition: one(purchaseRequisitions, { fields: [purchaseOrders.sourcePurchaseRequisitionId], references: [purchaseRequisitions.id] }),
  lines: many(purchaseOrderLines),
  goodsReceipts: many(goodsReceipts),
}));

export const purchaseOrderLinesRelations = relations(purchaseOrderLines, ({ one }) => ({
  purchaseOrder: one(purchaseOrders, { fields: [purchaseOrderLines.purchaseOrderId], references: [purchaseOrders.id] }),
  item: one(items, { fields: [purchaseOrderLines.itemId], references: [items.id] }),
}));

export const goodsReceiptsRelations = relations(goodsReceipts, ({ one, many }) => ({
  purchaseOrder: one(purchaseOrders, { fields: [goodsReceipts.purchaseOrderId], references: [purchaseOrders.id] }),
  warehouse: one(maintenanceWarehouses, { fields: [goodsReceipts.warehouseId], references: [maintenanceWarehouses.id] }),
  lines: many(goodsReceiptLines),
}));

export const goodsReceiptLinesRelations = relations(goodsReceiptLines, ({ one }) => ({
  goodsReceipt: one(goodsReceipts, { fields: [goodsReceiptLines.goodsReceiptId], references: [goodsReceipts.id] }),
  purchaseOrderLine: one(purchaseOrderLines, { fields: [goodsReceiptLines.purchaseOrderLineId], references: [purchaseOrderLines.id] }),
  item: one(items, { fields: [goodsReceiptLines.itemId], references: [items.id] }),
}));

export const invoiceLineItemsRelations = relations(invoiceLineItems, ({ one }) => ({
  tenant: one(tenants, { fields: [invoiceLineItems.tenantId], references: [tenants.id] }),
  invoice: one(invoices, { fields: [invoiceLineItems.invoiceId], references: [invoices.id] }),
  order: one(orders, { fields: [invoiceLineItems.orderId], references: [orders.id] }),
}));
