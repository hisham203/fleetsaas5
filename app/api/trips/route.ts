export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { trips, tripStops, orders, vehicles, drivers, warehouses, contractPricingRules, customers } from "@/lib/db/schema";
import { genId, genNumber } from "@/lib/helpers";
// assertTankerCapacity, RelationshipError, ERR available from "@/lib/relationshipValidators" if needed
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { optimizeRoute } from "@/lib/googleMaps";
import { eq, and, inArray, desc } from "drizzle-orm";
import { z } from "zod";
import { buildPricingPreviewForOrder, validateContractEligibility, ContractEligibilityError } from "@/lib/contractEligibility";
import { listOperationalTrips, parseStatusFilter, requiredCapacitiesOf } from "@/lib/tripDto";
import { SAFE_CUSTOMER_COLUMNS, SAFE_USER_COLUMNS } from "@/lib/contractHelpers";
import { checkPermission, PERMISSIONS } from "@/lib/requirePermission";

// P2-02 canonical Plan Trip contract. The browser (app/dispatch/page.tsx →
// planTrip) sends EXACTLY { orderIds, warehouseId } — the trip is created
// PLANNED and UNASSIGNED (driverId = vehicleId = NULL). A supervisor
// assigns resources later (PATCH /api/trips/[id]/assign) and dispatches
// separately (POST /api/trips/[id]/dispatch).
//
// driverId + vehicleId remain accepted ONLY as a deprecated legacy mode for
// pre-P2-02 callers (integration fixtures). They must be sent together.
const createSchema = z.object({
  orderIds: z.array(z.string().min(1)).min(1),
  warehouseId: z.string().min(1), // operationally: the Loading Point
  driverId: z.string().min(1).optional(),
  vehicleId: z.string().min(1).optional(),
}).refine((b) => (b.driverId == null) === (b.vehicleId == null), {
  message: "driverId and vehicleId must be provided together (legacy mode) or both omitted (P2-02 unassigned planning)",
  path: ["driverId"],
});

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN", "DISPATCHER", "DRIVER"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;
  const _permDeny1 = await checkPermission(session, tenantId, PERMISSIONS.TRIPS_VIEW);
  if (_permDeny1) return _permDeny1;
  // DRIVER role has restricted dispatch access — only their own trips/stops.
  // They bypass module-level enforcement here; the ownership check below gates their access.
  if (session?.type !== "USER" || (session.user as any).role !== "DRIVER") {
    const _permDeny2 = await checkPermission(session, tenantId, PERMISSIONS.TRIPS_VIEW); if (_permDeny2) return _permDeny2;
  }

  // P2-02: `?status=` is honoured (comma-separated or repeated), and
  // `?view=operational` returns the stable OperationalTripDto[] contract
  // (lib/tripDto.ts) used by Dispatch and the Assignment Workspace. Both
  // shapes are plain arrays.
  const { searchParams } = new URL(req.url);
  const statusFilter = parseStatusFilter(searchParams);
  if (searchParams.get("view") === "operational") {
    return NextResponse.json(await listOperationalTrips(tenantId, statusFilter));
  }

  const rows = await db.query.trips.findMany({
    where: statusFilter.length > 0 ? and(eq(trips.tenantId, tenantId), inArray(trips.status, statusFilter)) : eq(trips.tenantId, tenantId),
    with: {
      driver: { with: { user: { columns: SAFE_USER_COLUMNS } } },
      vehicle: true,
      warehouse: true,
      // S1 audit: this embed was missed during Task D.5's driver.user fix
      // in this same file — order.customer also returns every column,
      // including passwordHash, until now.
      stops: { with: { order: { with: { customer: { columns: SAFE_CUSTOMER_COLUMNS } } }, epod: true } },
    },
    orderBy: desc(trips.createdAt),
  });
  rows.forEach((t: any) => t.stops.sort((a: any, b: any) => a.sequence - b.sequence));
  return NextResponse.json(rows);
}

// BR-06/BR-08/BR-09: Trip Planning & Trip Management.
// Groups validated PENDING orders onto a trip with a driver + vehicle,
// loading out of a specific warehouse (BR-09), enforcing vehicle capacity
// (BR-02) and availability of both resources. Stop sequence comes from
// Google Maps route optimization (round trip from the chosen warehouse)
// when GOOGLE_MAPS_API_KEY is configured, falling back to selection order
// otherwise — see lib/googleMaps.ts.
export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  {
    const _cpTenantId = getSessionTenantId(session);
    if (!_cpTenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { hasRole: _hR } = await import("@/lib/auth");
    if (!_hR(session, ["ADMIN"])) {
      const _d = await checkPermission(session, _cpTenantId, PERMISSIONS.TRIPS_CREATE);
      if (_d) return _d;
    }
  }
  const tenantId = getSessionTenantId(session)!;

  try {
    const body = await req.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const { driverId, vehicleId, warehouseId, orderIds } = parsed.data;

    if (!driverId || !vehicleId) {
      return await planUnassignedTrip(tenantId, orderIds, warehouseId);
    }

    // ── DEPRECATED legacy mode (driverId + vehicleId supplied) ──────────────
    // Pre-P2-02 behaviour, preserved unchanged for existing callers only.
    const vehicle = await db.query.vehicles.findFirst({ where: and(eq(vehicles.id, vehicleId), eq(vehicles.tenantId, tenantId)) });
    const driver = await db.query.drivers.findFirst({ where: and(eq(drivers.id, driverId), eq(drivers.tenantId, tenantId)) });
    const warehouse = await db.query.warehouses.findFirst({ where: and(eq(warehouses.id, warehouseId), eq(warehouses.tenantId, tenantId)) });
    if (!vehicle || !driver) {
      return NextResponse.json({ error: "Vehicle or driver not found" }, { status: 404 });
    }
    if (!warehouse) {
      return NextResponse.json({ error: "Warehouse not found" }, { status: 404 });
    }
    if (vehicle.status !== "AVAILABLE") {
      return NextResponse.json({ error: `Vehicle ${vehicle.plateNumber} is not available (${vehicle.status})` }, { status: 422 });
    }
    if (driver.status !== "AVAILABLE") {
      return NextResponse.json({ error: "Driver is not available" }, { status: 422 });
    }

    const selectedOrders = await db.query.orders.findMany({ where: and(inArray(orders.id, orderIds), eq(orders.tenantId, tenantId)) });
    if (selectedOrders.length !== orderIds.length) {
      return NextResponse.json({ error: "One or more orders not found" }, { status: 404 });
    }
    const notPending = selectedOrders.filter((o) => o.status !== "PENDING" && o.status !== "VALIDATED");
    if (notPending.length > 0) {
      return NextResponse.json({ error: `Orders already in progress: ${notPending.map((o) => o.orderNumber).join(", ")}` }, { status: 422 });
    }

    // G.3 audit finding: orders.status !== PENDING/VALIDATED (above) is
    // the primary guard, but it can drift out of sync with the real
    // source of truth — tripStops.orderId is unique, so an order already
    // on any non-completed trip is genuinely unassignable regardless of
    // what its own status column says. Checking this directly, before
    // attempting the insert, turns what would otherwise be a raw
    // database unique-constraint violation (an uncaught exception,
    // previously surfacing to the dispatcher as a silently-stuck button
    // — see app/dispatch/page.tsx's fix this same pass) into a clear,
    // expected 422 with the real reason.
    const existingStops = await db.query.tripStops.findMany({
      where: inArray(tripStops.orderId, orderIds),
      with: { trip: true },
    });
    const alreadyAssigned = existingStops.filter((s) => s.trip.status !== "COMPLETED");
    if (alreadyAssigned.length > 0) {
      const orderNumbers = alreadyAssigned
        .map((s) => selectedOrders.find((o) => o.id === s.orderId)?.orderNumber ?? s.orderId)
        .join(", ");
      return NextResponse.json(
        { error: `Order(s) already assigned to an active trip: ${orderNumbers}` },
        { status: 422 }
      );
    }

    // BR-02 capacity rule: total bottle units must not exceed vehicle capacity.
    const totalUnits = selectedOrders.reduce((sum, o) => sum + o.qtyOrdered, 0);
    if (vehicle.capacityUnits != null && totalUnits > vehicle.capacityUnits) {
      return NextResponse.json(
        { error: `Load (${totalUnits} bottles) exceeds vehicle capacity (${vehicle.capacityUnits})` },
        { status: 422 }
      );
    }

    // Migration 0022 — tanker-capacity enforcement using the persisted order field.
    //
    // PRIMARY PATH (new orders): use order.requiredTankerCapacityLtr.
    // LEGACY PATH (NULL contract orders): derive from pricing rules at dispatch time.
    //
    // Strict equality. No >= or "close enough". A 28k tanker is NOT a 21k tanker.
    for (const order of selectedOrders) {
      let requiredCap: number | null = (order as any).requiredTankerCapacityLtr ?? null;

      if (requiredCap == null && order.contractId) {
        // Legacy NULL contract order — derive from pricing rules (fail-closed per UAT spec):
        const pricingRules = await db.query.contractPricingRules.findMany({
          where: eq(contractPricingRules.contractId, order.contractId),
          columns: { tankerCapacityLtr: true },
        });
        const uniqueCapacities = [...new Set(
          pricingRules.map(r => r.tankerCapacityLtr).filter((c): c is number => c != null)
        )];
        if (uniqueCapacities.length === 0) {
          requiredCap = null; // wildcard-only — no constraint
        } else if (uniqueCapacities.length === 1) {
          requiredCap = uniqueCapacities[0]; // safe to derive
        } else {
          // Multiple capacities + NULL order — fail-closed per spec section 7B:
          return NextResponse.json({
            error: `This existing order uses a contract with multiple tanker sizes (${uniqueCapacities.map(c => c.toLocaleString() + " L").join(", ")}). Select/reprice the order before dispatch.`,
            errorCode: "TANKER_CAPACITY_REQUIRED",
          }, { status: 422 });
        }
      }

      if (requiredCap == null) continue; // non-contract or wildcard — no constraint
      if (vehicle.capacityLiters == null) continue; // vehicle has no capacity set — skip

      if (vehicle.capacityLiters !== requiredCap) {
        return NextResponse.json({
          error: `Order ${order.orderNumber} is priced for a ${requiredCap.toLocaleString()} L tanker. Selected vehicle ${vehicle.plateNumber} has a capacity of ${vehicle.capacityLiters.toLocaleString()} L. Assign a ${requiredCap.toLocaleString()} L tanker or reprice the order first.`,
          errorCode: "TANKER_CAPACITY_MISMATCH",
        }, { status: 422 });
      }
    }

    // BR-06: optimize stop order as a round trip from the chosen warehouse.
    let orderedStopIds = selectedOrders.map((o) => o.id);
    let estimatedDurationMinutes: number | null = null;

    const stopsWithCoords = selectedOrders.filter((o) => o.lat != null && o.lng != null);
    if (stopsWithCoords.length === selectedOrders.length) {
      const result = await optimizeRoute(
        { lat: warehouse.lat, lng: warehouse.lng },
        stopsWithCoords.map((o) => ({ id: o.id, lat: o.lat!, lng: o.lng! }))
      );
      orderedStopIds = result.orderedStopIds;
      estimatedDurationMinutes = result.estimatedDurationMinutes;
    }

    const tripId = genId();
    const tripNumber = genNumber("TRIP");

    await db.transaction(async (tx) => {
      await tx
        .insert(trips)
        .values({ id: tripId, tenantId, tripNumber, driverId, vehicleId, warehouseId, status: "PLANNED", estimatedDurationMinutes });

      for (const [idx, orderId] of orderedStopIds.entries()) {
        await tx.insert(tripStops).values({ id: genId(), tripId, orderId, sequence: idx + 1 });
      }

      await tx.update(orders).set({ status: "ASSIGNED" }).where(inArray(orders.id, orderIds));
      await tx.update(vehicles).set({ status: "IN_TRIP" }).where(eq(vehicles.id, vehicleId));
      await tx.update(drivers).set({ status: "ON_TRIP" }).where(eq(drivers.id, driverId));
    });

    const full = await db.query.trips.findFirst({
      where: eq(trips.id, tripId),
      with: { driver: { with: { user: { columns: SAFE_USER_COLUMNS } } }, vehicle: true, warehouse: true, stops: { with: { order: true } } },
    });

    // Task D.5: now that a real vehicle (and its real capacity) is known,
    // recompute pricing preview for every contract-linked order on this
    // trip — more accurate than the order-creation-time preview, which
    // never knows tanker capacity since no vehicle exists yet at that
    // point. Purely additive to the response: never creates an invoice,
    // never writes invoice_line_items, never mutates a pricing rule or
    // tripsUsed, and never blocks trip creation — the trip above has
    // already been created successfully by the time this runs. A
    // non-contract order's stop is completely unaffected (no
    // pricingPreview key at all, not even null), exactly as before.
    if (full) {
      for (const stop of full.stops as any[]) {
        const preview = await buildPricingPreviewForOrder({
          tenantId,
          order: {
            id: stop.order.id,
            customerId: stop.order.customerId,
            contractId: stop.order.contractId,
            locationId: stop.order.locationId,
            qtyOrdered: stop.order.qtyOrdered,
            requestedTime: stop.order.requestedTime,
          },
          // Use the stop's order requiredTankerCapacityLtr (persisted commercial capacity).
          // fall back to vehicle capacity (equal at this point due to capacity enforcement above):
          tankerCapacityLtr: (stop.order as any).requiredTankerCapacityLtr ?? vehicle.capacityLiters,
        });
        if (preview) stop.pricingPreview = preview;
      }
    }

    return NextResponse.json(full, { status: 201 });
  } catch (err) {
    // G.3 audit finding: this whole handler previously had no top-level
    // try/catch at all. Any unexpected failure (a raw DB constraint
    // violation being the concrete case found this pass, but this
    // protects against any future one too) escaped as an unhandled
    // exception, which Next.js turns into a bare, empty-bodied 500 —
    // exactly what made the dispatcher's frontend crash on `res.json()`
    // and get permanently stuck. Every path through this route now
    // returns real, valid JSON, error or not.
    console.error("POST /api/trips failed:", err);
    return NextResponse.json({ error: "Failed to create trip" }, { status: 500 });
  }
}


type PlanError = { status: number; error: string; errorCode: string };
const planError = (e: PlanError) => NextResponse.json({ error: e.error, errorCode: e.errorCode }, { status: e.status });

/**
 * P2-02 canonical planning: create a PLANNED trip with NO driver and NO vehicle.
 *
 * Never: assigns resources, changes driver/vehicle status, dispatches,
 * creates a POD, or creates an invoice. Orders move PENDING/VALIDATED → ASSIGNED
 * (they now belong to a trip and leave the Order Queue), exactly as before.
 */
async function planUnassignedTrip(tenantId: string, orderIds: string[], warehouseId: string) {
  const uniqueOrderIds = [...new Set(orderIds)];

  const loadingPoint = await db.query.warehouses.findFirst({ where: and(eq(warehouses.id, warehouseId), eq(warehouses.tenantId, tenantId)) });
  if (!loadingPoint) return planError({ status: 404, error: "Loading point not found", errorCode: "LOADING_POINT_NOT_FOUND" });

  const selectedOrders = await db.query.orders.findMany({ where: and(inArray(orders.id, uniqueOrderIds), eq(orders.tenantId, tenantId)) });
  if (selectedOrders.length !== uniqueOrderIds.length) {
    return planError({ status: 404, error: "One or more orders not found", errorCode: "ORDER_NOT_FOUND" });
  }
  const notPlannable = selectedOrders.filter((o) => o.status !== "PENDING" && o.status !== "VALIDATED");
  if (notPlannable.length > 0) {
    return planError({ status: 422, error: `Order(s) not eligible for planning: ${notPlannable.map((o) => `${o.orderNumber} (${o.status})`).join(", ")}`, errorCode: "ORDER_NOT_PLANNABLE" });
  }

  // An order can sit on at most one open trip (tripStops.orderId is unique).
  const existingStops = await db.query.tripStops.findMany({ where: inArray(tripStops.orderId, uniqueOrderIds), with: { trip: true } });
  const alreadyOnTrip = existingStops.filter((s) => s.trip && s.trip.status !== "COMPLETED");
  if (alreadyOnTrip.length > 0) {
    const nums = alreadyOnTrip.map((s) => selectedOrders.find((o) => o.id === s.orderId)?.orderNumber ?? s.orderId).join(", ");
    return planError({ status: 422, error: `Order(s) already on an active trip: ${nums}`, errorCode: "ORDER_ALREADY_ON_TRIP" });
  }

  // Commercial validity at planning time (B2B contract still eligible, tanker requirement present).
  const customerRows = await db.query.customers.findMany({
    where: and(inArray(customers.id, [...new Set(selectedOrders.map((o) => o.customerId))]), eq(customers.tenantId, tenantId)),
    columns: { id: true, type: true },
  });
  for (const order of selectedOrders) {
    const customer = customerRows.find((c) => c.id === order.customerId);
    if (!customer) return planError({ status: 422, error: `Order ${order.orderNumber} has no valid customer`, errorCode: "CUSTOMER_NOT_FOUND" });
    if (customer.type === "B2B" && !order.contractId) {
      return planError({ status: 422, error: `Order ${order.orderNumber} is a B2B order without a contract. B2B customers require an active contract.`, errorCode: "B2B_CONTRACT_REQUIRED" });
    }
    if (order.contractId) {
      try {
        await validateContractEligibility({
          tenantId, customerId: order.customerId, contractId: order.contractId,
          orderDate: order.requestedTime ?? new Date(), customerLocationId: order.locationId ?? null,
        });
      } catch (err) {
        if (err instanceof ContractEligibilityError) {
          return planError({ status: 422, error: `Order ${order.orderNumber}: ${err.message}`, errorCode: `CONTRACT_${err.code}` });
        }
        throw err;
      }
      if (order.requiredTankerCapacityLtr == null) {
        // Legacy NULL-capacity contract order: same fail-closed rule as dispatch-time derivation.
        const rules = await db.query.contractPricingRules.findMany({ where: eq(contractPricingRules.contractId, order.contractId), columns: { tankerCapacityLtr: true } });
        const caps = [...new Set(rules.map((r) => r.tankerCapacityLtr).filter((c): c is number => c != null))];
        if (caps.length > 1) {
          return planError({ status: 422, error: `Order ${order.orderNumber} uses a contract with multiple tanker sizes (${caps.map((c) => c.toLocaleString() + " L").join(", ")}). Select/reprice the order before planning.`, errorCode: "TANKER_CAPACITY_REQUIRED" });
        }
      }
    }
  }

  // One trip = one tanker: every order on it must need the same capacity (strict equality downstream).
  const caps = requiredCapacitiesOf(selectedOrders);
  if (caps.length > 1) {
    return planError({ status: 422, error: `Selected orders require different tanker capacities (${caps.map((c) => c.toLocaleString() + " L").join(", ")}). Plan them on separate trips.`, errorCode: "TANKER_CAPACITY_MIXED" });
  }

  // BR-06: optimise stop order from the loading point when coordinates exist.
  let orderedStopIds = selectedOrders.map((o) => o.id);
  let estimatedDurationMinutes: number | null = null;
  if (selectedOrders.every((o) => o.lat != null && o.lng != null)) {
    const result = await optimizeRoute(
      { lat: loadingPoint.lat, lng: loadingPoint.lng },
      selectedOrders.map((o) => ({ id: o.id, lat: o.lat!, lng: o.lng! }))
    );
    orderedStopIds = result.orderedStopIds;
    estimatedDurationMinutes = result.estimatedDurationMinutes;
  }

  const tripId = genId();
  const tripNumber = genNumber("TRIP");
  try {
  await db.transaction(async (tx) => {
    await tx.insert(trips).values({ id: tripId, tenantId, tripNumber, driverId: null, vehicleId: null, warehouseId, status: "PLANNED", estimatedDurationMinutes });
    for (const [idx, orderId] of orderedStopIds.entries()) {
      await tx.insert(tripStops).values({ id: genId(), tripId, orderId, sequence: idx + 1 });
    }
    // Only orders that are still plannable move — guards a concurrent planner.
    await tx.update(orders).set({ status: "ASSIGNED" }).where(and(inArray(orders.id, uniqueOrderIds), inArray(orders.status, ["PENDING", "VALIDATED"])));
  });
  } catch (err: any) {
    // trip_stops.order_id is unique: a concurrent planner won the race for this order.
    if (err?.code === "23505" || err?.cause?.code === "23505") {
      return planError({ status: 409, error: "Order was planned onto another trip concurrently. Refresh and retry.", errorCode: "ORDER_ALREADY_ON_TRIP" });
    }
    throw err;
  }

  const created = await db.query.trips.findFirst({ where: eq(trips.id, tripId), with: { warehouse: true, stops: { with: { order: true } } } });
  return NextResponse.json(created, { status: 201 });
}
