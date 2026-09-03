export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { trips, tripStops, orders, vehicles, drivers, warehouses } from "@/lib/db/schema";
import { genId, genNumber } from "@/lib/helpers";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { optimizeRoute } from "@/lib/googleMaps";
import { eq, and, inArray, desc } from "drizzle-orm";
import { z } from "zod";
import { buildPricingPreviewForOrder } from "@/lib/contractEligibility";
import { SAFE_CUSTOMER_COLUMNS, SAFE_USER_COLUMNS } from "@/lib/contractHelpers";

const createSchema = z.object({
  driverId: z.string(),
  vehicleId: z.string(),
  warehouseId: z.string(),
  orderIds: z.array(z.string()).min(1),
});

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN", "DISPATCHER", "DRIVER"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;

  const rows = await db.query.trips.findMany({
    where: eq(trips.tenantId, tenantId),
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
  if (!hasRole(session, ["ADMIN", "DISPATCHER"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { driverId, vehicleId, warehouseId, orderIds } = parsed.data;

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

  // BR-02 capacity rule: total bottle units must not exceed vehicle capacity.
  const totalUnits = selectedOrders.reduce((sum, o) => sum + o.qtyOrdered, 0);
  if (vehicle.capacityUnits != null && totalUnits > vehicle.capacityUnits) {
    return NextResponse.json(
      { error: `Load (${totalUnits} bottles) exceeds vehicle capacity (${vehicle.capacityUnits})` },
      { status: 422 }
    );
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
        tankerCapacityLtr: vehicle.capacityLiters,
      });
      if (preview) stop.pricingPreview = preview;
    }
  }

  return NextResponse.json(full, { status: 201 });
}
