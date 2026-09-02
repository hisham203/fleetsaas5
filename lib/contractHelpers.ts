// Security fix, scoped to the Contract API only (not a broad refactor):
// db.query.contracts.findFirst({ with: { customer: true } }) returns every
// column on the customer row, including passwordHash. The same pattern
// already exists in several older routes across this codebase, but it's
// not acceptable for this Contract API surface — every route in
// app/api/contracts/** that embeds a customer uses this explicit column
// selection instead of `customer: true`, so there's exactly one place
// that defines what "safe" means here, rather than each route deciding
// independently and risking drift.
//
// Deliberately excludes: passwordHash (the specific finding this fixes),
// creditLimit and contractPricePerBottle (commercially sensitive, and not
// needed to display which customer a contract belongs to), erpExternalId
// (an internal integration identifier), and address/lat/lng (not needed
// for this API's own purpose). Extend this list only if a genuine,
// specific need for another field arises — the point is a deliberately
// narrow surface, not "everything except passwordHash".
export const SAFE_CUSTOMER_COLUMNS = {
  id: true,
  tenantId: true,
  name: true,
  type: true,
  phone: true,
  loginEmail: true,
  createdAt: true,
} as const;
