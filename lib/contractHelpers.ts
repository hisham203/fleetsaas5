// Security fix, originally scoped to the Contract API (Task B), now also
// reused by app/api/orders/route.ts (Task D) since that route embeds a
// customer object too and this task touches those exact lines anyway —
// still not a broad refactor of every other route with the same
// pre-existing pattern elsewhere in this codebase, just every place a
// change was already being made for another reason.
// db.query.contracts.findFirst({ with: { customer: true } }) returns every
// column on the customer row, including passwordHash. The same pattern
// already exists in several older routes across this codebase, but it's
// not acceptable here — every call site that reaches for this constant
// uses this explicit column selection instead of `customer: true`, so
// there's exactly one place that defines what "safe" means, rather than
// each route deciding independently and risking drift.
//
// Deliberately excludes: passwordHash (the specific finding this fixes),
// creditLimit and contractPricePerBottle (commercially sensitive, and not
// needed to display which customer a contract belongs to), erpExternalId
// (an internal integration identifier), and address/lat/lng (not needed
// for this API's own purpose — note that app/api/orders/route.ts already
// carries its own deliveryAddress/lat/lng fields directly on the order
// itself, copied from the customer at creation time, so nothing is lost
// there by this narrower embedded-customer view). Extend this list only
// if a genuine, specific need for another field arises — the point is a
// deliberately narrow surface, not "everything except passwordHash".
export const SAFE_CUSTOMER_COLUMNS = {
  id: true,
  tenantId: true,
  name: true,
  type: true,
  phone: true,
  loginEmail: true,
  createdAt: true,
} as const;
