# SMARTY1 P2-02: Real Golden Path (Implementation Record)

Baseline: `4765eed` (hisham203/fleetsaas5). This document records what was changed to make the
approved P2-02 workflow executable through the real browser → API → database contract.

## Canonical workflow

```
COORDINATOR  New Order: Order Type → Customer → Site → (B2B) Eligible ACTIVE Contract → Tanker Capacity → Create Order
             Order Queue: Plan Trip → Loading Point → POST /api/trips { orderIds, warehouseId }
             ⇒ trip PLANNED, driver_id NULL, vehicle_id NULL
SUPERVISOR   /dispatch/assign: review eligibility → Assign Tanker + Driver (trip stays PLANNED)
             → Dispatch Trip (separate action) ⇒ DISPATCHED
DRIVER       Arrived Loading Point → Confirm Loading → Arrived Customer Site → Delivered (ePOD) ⇒ COMPLETED
             alternative: Mark Failed ⇒ stop FAILED, exception opened, trip COMPLETED
```

## Database

`drizzle/0025_p2_02_unassigned_trip_planning.sql` makes two changes. Neither touches existing rows:

```sql
ALTER TABLE "trips" ALTER COLUMN "driver_id" DROP NOT NULL;
ALTER TABLE "trips" ALTER COLUMN "vehicle_id" DROP NOT NULL;
```

`lib/db/schema.ts`: `trips.driverId` and `trips.vehicleId` are nullable.

Migration numbering: 0024 = P2-02 RBAC/dispatch, 0025 = P2-02 unassigned planning. **P2-03 starts at 0026.**

## API contracts

| Endpoint | Contract |
|---|---|
| `POST /api/trips` | Canonical `{ orderIds: string[≥1], warehouseId }` creates an UNASSIGNED PLANNED trip. It does not assign resources, change their status, dispatch, create a POD or create an invoice. The deprecated legacy mode `{ …, driverId, vehicleId }` requires both together and behaves as before; only pre-P2-02 integration fixtures use it. |
| `GET /api/trips` | Returns a plain array. `?status=A,B` is honoured. `?view=operational` returns `OperationalTripDto[]` (`lib/tripDto.ts`). |
| `GET /api/trips/[id]` | Returns one `OperationalTripDto`. It is tenant-scoped, and a driver can read only their own trip. |
| `PATCH /api/trips/[id]/assign` | Takes `{ vehicleId?, driverId? }`. It re-validates everything server-side and locks rows in the order trip → driver → vehicle (`FOR UPDATE`). The trip stays PLANNED. |
| `POST /api/trips/[id]/dispatch` | Requires the trip to be PLANNED with both resources assigned. It re-checks maintenance/off-duty status and strict capacity. Conflicts are decided inside the lock (409). It sets `DISPATCHED` with `dispatchedAt`/`dispatchedBy` and a lifecycle event. |
| `GET /api/fleet/eligible-vehicles?tripId=` | Returns `{ results: [{ candidate{id,plateNumber,vehicleCode,capacityLiters,status}, eligible, availability: AVAILABLE|BUSY|INELIGIBLE, reason }], eligibleCount, requiredTankerCapacityLtr }`. |
| `GET /api/fleet/eligible-drivers?tripId=` | Returns `{ results: [{ candidate{id,name,driverCode,status}, eligible, availability, reason }], eligibleCount }`. |
| `GET /api/loading-points` | Requires `trips.view` and returns `[{ id, name, code, address, isDefault }]`. It is backed by `warehouses`. |
| `GET /api/orders/tanker-capacities` | Requires `orders.create` and returns `{ capacities: [{ capacityLiters, tankers, available }] }`: the fleet sizes a B2C direct order can request. |
| `POST /api/orders` / `POST /api/orders/bulk` | Require **`orders.create`** (previously `orders.view`). `GET /api/orders` requires `orders.view`. |

`OperationalTripDto` derives commercial facts from trip → stop → order: customer, site, contract, order type and
`requiredTankerCapacityLtr`. It also carries the driver name, the vehicle `plateNumber`, the loading point,
`scheduledAt`, `dispatchedAt` and the stops. No commercial column was added to `trips`.

## Resource status semantics

| Event | Driver | Tanker |
|---|---|---|
| Plan (unassigned) | unchanged | unchanged |
| Assign | unchanged (a driver may be pre-assigned to several PLANNED trips) | unchanged (a tanker serves at most one open trip) |
| Dispatch | `ON_TRIP` | `IN_TRIP` |
| Delivered / Mark Failed (all stops resolved → auto-close) or manual close | `AVAILABLE` | `AVAILABLE` |

Legacy mode (`driverId` + `vehicleId` sent to `POST /api/trips`) still sets `ON_TRIP`/`IN_TRIP` at creation, unchanged.

## Bulk-water compatibility mapping (database ⇄ operator)

The bulk-water UI never shows or asks for any of these legacy fields:

| Legacy field | Bulk-water meaning / value sent by the P2-02 UI |
|---|---|
| `orders.qtyOrdered` | Number of tanker loads. The UI always sends `1` (one order = one tanker load). |
| `orders.bottleSizeLtr` | Not sent, so the API default (19) is stored and unused by bulk water. |
| `orders.emptyBottlesToCollect` | Not sent (0). The driver ePOD hides "Empties" when it is 0. |
| `orders.pricePerBottle` | Not sent. The existing Phase 1 direct-order price source (`customer.contractPricePerBottle ?? default`) is unchanged. B2C billing remains `deliveredQty × pricePerBottle − discount + VAT` (stop route). B2B contract billing is unchanged (pricing engine / monthly consolidation). |
| `orders.requiredTankerCapacityLtr` | B2B: derived from a single-capacity contract, or the explicit choice among a multi-capacity contract's sizes. B2C: the selected fleet tanker size (new; validated against the tenant fleet). |
| `warehouses` | Shown to operators as "Loading Point". |

**Known commercial gap (not changed):** a B2C bulk-water tariff per tanker size is not defined by the approved
commercial logic. B2C direct orders therefore bill through the existing per-unit direct-order path. A business decision is
needed; one option is to price B2C direct orders from the tenant's existing `TENANT_DEFAULT` per-capacity pricing rules.

## Driver lifecycle

`DISPATCHED → ARRIVED_LOADING → LOADING_COMPLETE → ARRIVED_SITE → (ePOD) UNLOADING_COMPLETE → CLOSED`.
`STARTED` is optional. The ePOD records `UNLOADING_COMPLETE`/`CLOSED` server-side (`lib/lifecycleHelper.ts`).
Lifecycle POST now enforces driver identity, and stage events require a dispatched trip. The stage sequence is
evaluated by furthest stage reached rather than by row order (event ids are random UUIDs). The stop route refuses a
driver acting on a PLANNED trip.
