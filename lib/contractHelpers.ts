// Security fix, originally scoped to the Contract API (Task B), then also
// reused by app/api/orders/route.ts (Task D) and app/api/trips/route.ts
// (Task D.5) since each embeds a customer or user object and each task
// touched those exact lines for another reason anyway. This third
// occurrence (S1 hotfix: app/api/invoices/route.ts, which embeds BOTH a
// customer AND a driver's user via a deep order->tripStop->trip->driver
// chain) is what prompted consolidating a shared SAFE_USER_COLUMNS here
// too, alongside the customer one, rather than letting a third
// independent copy drift from app/api/trips/route.ts's local constant.
// Still not a broad refactor of every other route with the same
// pre-existing pattern elsewhere in this codebase — every fix so far has
// been made exactly where another task was already touching that file.
//
// db.query.X.findFirst({ with: { customer: true } }) (or { user: true })
// returns every column on that row, including passwordHash. Every call
// site that reaches for these constants uses explicit column selection
// instead, so there's exactly one place that defines what "safe" means
// for each, rather than each route deciding independently and risking
// drift.
//
// SAFE_CUSTOMER_COLUMNS deliberately excludes: passwordHash (the specific
// finding this fixes), creditLimit and contractPricePerBottle
// (commercially sensitive, and not needed to display which customer a
// contract/invoice belongs to), erpExternalId (an internal integration
// identifier), and address/lat/lng (not needed for these APIs' own
// purpose — note that app/api/orders/route.ts already carries its own
// deliveryAddress/lat/lng fields directly on the order itself, copied
// from the customer at creation time, so nothing is lost there by this
// narrower embedded-customer view).
export const SAFE_CUSTOMER_COLUMNS = {
  id: true,
  tenantId: true,
  name: true,
  type: true,
  phone: true,
  loginEmail: true,
  createdAt: true,
} as const;

// SAFE_USER_COLUMNS deliberately excludes: passwordHash (the specific
// finding this fixes) and isPlatformAdmin (an internal access-control
// flag with no reason to be exposed in an invoice/trip response). Extend
// either list only if a genuine, specific need for another field arises —
// the point is a deliberately narrow surface, not "everything except
// passwordHash".
export const SAFE_USER_COLUMNS = {
  id: true,
  tenantId: true,
  name: true,
  email: true,
  role: true,
  createdAt: true,
} as const;
