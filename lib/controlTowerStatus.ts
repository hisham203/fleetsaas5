// Milestone Q, Gate Q2/Q29-Q31 — Control Tower status normalization.
//
// This is a pure, read-only presentation layer over existing Order/Trip/
// TripStop/Invoice/Exception records. It changes NOTHING about the
// underlying data model or any status enum — every status column in this
// schema is an unconstrained text field already (confirmed by direct
// inspection of lib/db/schema.ts), so deriving a normalized view here
// requires no migration. This module is the single source of truth for
// "what does this piece of operational demand look like right now" —
// the Control Tower, and only the Control Tower, should ever call it;
// nothing here replaces or overrides the real status fields dispatch,
// loading, delivery, and billing already rely on.

export type OperationalStatus =
  | "NEW"
  | "READY_FOR_PLANNING"
  | "WAITING_ASSIGNMENT"
  | "ASSIGNED_WAITING_LOADING"
  | "LOADED"
  | "IN_TRANSIT"
  | "DELIVERED"
  | "EXCEPTION"
  | "CANCELLED";

export type BillingStatus = "NOT_APPLICABLE" | "PENDING_BILLING" | "INVOICED_PENDING" | "INVOICED_PAID" | "DEFERRED_MONTHLY";

export type DemandSource = "B2B_CONTRACT" | "B2B_CASH" | "B2C_CASH" | "UNKNOWN";

interface DeriveInput {
  order: { status: string; contractId: string | null };
  customer: { type: string } | null;
  trip: { status: string; loadingConfirmed: boolean } | null;
  stop: { status: string } | null;
  exception: { status: string } | null;
  invoice: { status: string } | null;
  contractType: string | null; // "ONE_TIME_TRIP_COUNT" | "MONTHLY_ACCUMULATED" | null
}

// Q29: operational status. Cancellation and open exceptions always take
// priority over whatever the underlying order/trip status says — an
// order marked FAILED with an open exception is never shown as simply
// "IN_TRANSIT" just because its trip row hasn't been touched since.
export function deriveOperationalStatus(input: DeriveInput): OperationalStatus {
  const { order, trip, exception } = input;

  if (order.status === "CANCELLED") return "CANCELLED";
  if (exception && exception.status === "OPEN") return "EXCEPTION";
  if (order.status === "FAILED") return "EXCEPTION";

  if (!trip) {
    // No trip created yet — this is the pre-dispatch portion of the
    // lifecycle. PENDING is freshly-created demand; VALIDATED/QUEUED (not
    // currently set by any code path, but a real value the order.status
    // column supports) is treated as one step further along, matching
    // this task's own "READY_FOR_PLANNING" concept.
    if (order.status === "VALIDATED" || order.status === "QUEUED") return "READY_FOR_PLANNING";
    return "NEW";
  }

  // A trip exists — order.status becomes ASSIGNED at trip creation.
  if (trip.status === "PLANNED") {
    return trip.loadingConfirmed ? "LOADED" : "ASSIGNED_WAITING_LOADING";
  }
  if (trip.status === "DISPATCHED") {
    // The Riyadh pilot is one-trip-one-stop; a dispatched trip is "in
    // transit" for its whole active window. A completed stop with the
    // trip not yet closed out by the dispatcher still reads as
    // DELIVERED below, via order.status, not via trip.status — this
    // branch only covers the stop still being pending/arrived.
    if (order.status === "DELIVERED" || order.status === "PARTIALLY_DELIVERED") return "DELIVERED";
    return "IN_TRANSIT";
  }
  if (trip.status === "COMPLETED") {
    return "DELIVERED";
  }

  return "WAITING_ASSIGNMENT"; // defensive fallback; not reachable with today's trip.status vocabulary
}

// Q30: billing status is deliberately independent of operational status —
// a DELIVERED order can be NOT_APPLICABLE (still mid-flight to invoicing),
// PENDING_BILLING (delivered, no invoice yet — the billingError case Task
// P.2 introduced), INVOICED_PENDING/INVOICED_PAID (a real invoice exists),
// or DEFERRED_MONTHLY (a MONTHLY_ACCUMULATED order, which never gets a
// per-delivery invoice by design — Task E.1/P.2). No fake status is
// invented for a case the data can't support.
export function deriveBillingStatus(input: DeriveInput): BillingStatus {
  const { order, invoice, contractType } = input;
  const isDelivered = order.status === "DELIVERED" || order.status === "PARTIALLY_DELIVERED";
  if (!isDelivered) return "NOT_APPLICABLE";
  if (contractType === "MONTHLY_ACCUMULATED") return "DEFERRED_MONTHLY";
  if (!invoice) return "PENDING_BILLING";
  return invoice.status === "PAID" ? "INVOICED_PAID" : "INVOICED_PENDING";
}

// Q31: demand source. Derived only from fields that already exist and are
// already reliable — never inferred from anything softer. Any combination
// that doesn't cleanly match one of the three real categories reports
// UNKNOWN rather than guessing, per this task's own explicit instruction.
export function deriveDemandSource(input: DeriveInput): DemandSource {
  const { order, customer } = input;
  if (order.contractId) return "B2B_CONTRACT";
  if (customer?.type === "B2B") return "B2B_CASH";
  if (customer?.type === "B2C") return "B2C_CASH";
  return "UNKNOWN";
}
