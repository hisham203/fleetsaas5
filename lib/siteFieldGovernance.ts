// Task K.3 — Customer Site Access-Control & Pricing-Critical Field
// Governance.
//
// Audit finding this exists to close: the real B2B portal UI
// (app/b2b/page.tsx's LocationsTab) has never sent cityCode/zoneCode/
// distanceBandCode — a customer using the actual product has never been
// able to set these. But the backend authorization on both the site
// creation and PATCH routes was purely "does this session own this
// customer", with no awareness of which FIELDS were being touched — a
// CUSTOMER session (or a DISPATCHER) calling either API directly, not
// through the UI, could still set or change these pricing-critical
// fields. "Hiding it in the UI" was never a real server-side guarantee.
//
// Governance decision (see the final report for the full audit this is
// based on): only ADMIN may set or change cityCode/zoneCode/
// distanceBandCode, on both creation and edit. DISPATCHER keeps full
// access to every operational field (label, address, contact info,
// coordinates) — unchanged from today — but not these three.
// CUSTOMER keeps exactly what the real UI already does: operational
// fields for their own sites, never these three, matching the fact that
// no legitimate product surface has ever required it. DRIVER retains
// zero access, unchanged (already fully excluded by the existing
// tenant/role check in both routes — this module doesn't touch that).
export const PRICING_CRITICAL_FIELDS = ["cityCode", "zoneCode", "distanceBandCode"] as const;

// True only for an internal ADMIN user session — never true for a
// DISPATCHER, DRIVER, or CUSTOMER-type session, regardless of tenant or
// customer ownership (ownership is a separate, already-enforced check;
// this is purely "is this specific field allowed for this role at all").
export function isAdminSession(session: any): boolean {
  return session?.type === "USER" && session.user?.role === "ADMIN";
}

// Given a raw request body, returns the pricing-critical field names it
// actually attempts to touch (present as a key at all, matching this
// codebase's established "only fields present in the body are touched"
// PATCH convention elsewhere — see e.g. the vehicle and contract
// pricing-rule PATCH routes).
export function pricingFieldsTouchedBy(body: Record<string, unknown>): string[] {
  return PRICING_CRITICAL_FIELDS.filter((f) => f in body);
}
