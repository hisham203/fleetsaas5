// Phase 1 core schema — Enterprise Fleet, Logistics & Delivery Operations Platform
// Sector shape: Water Delivery (subscriptions, refills, empty-bottle collection)
// Postgres via node-postgres (pg) + drizzle-orm/pg-core. Originally built on
// SQLite for zero-setup local dev; migrated to Postgres once the automated
// test suite existed to validate the migration didn't change behavior —
// see README's "Database: Postgres" section for setup.

import { pgTable, text, integer, real, boolean, timestamp } from "drizzle-orm/pg-core";
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
  orderId: text("order_id").notNull().unique(),
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
});

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
}));

export const creditNotesRelations = relations(creditNotes, ({ one }) => ({
  invoice: one(invoices, { fields: [creditNotes.invoiceId], references: [invoices.id] }),
  customer: one(customers, { fields: [creditNotes.customerId], references: [customers.id] }),
}));
