/**
 * P2-01 Workstream D/G: Geofence awareness + operational event creation.
 * Called from the GPS ping endpoint when a vehicle enters a geofence zone.
 * Creates operational SUGGESTIONS only — does NOT automatically advance lifecycle stages.
 */
import { db } from "@/lib/db/client";
import { operationalEvents, trips, warehouses, customerLocations, tripStops } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { genId } from "@/lib/helpers";
import { checkGeofence } from "@/lib/geofence";

export type OperationalEventType =
  | "GPS_STALE"
  | "TRIP_LATE"
  | "GEOFENCE_LOADING_ARRIVAL"
  | "GEOFENCE_CUSTOMER_ARRIVAL"
  | "LOADING_OVERRUN"
  | "DELIVERY_FAILED"
  | "POD_PENDING"
  | "EXCEPTION_OPEN"
  | "DRIVER_NOT_STARTED";

export async function createOperationalEvent(params: {
  tenantId: string;
  eventType: OperationalEventType;
  tripId?: string;
  vehicleId?: string;
  driverId?: string;
  orderId?: string;
  message: string;
  severity?: "INFO" | "WARNING" | "CRITICAL";
}) {
  await db.insert(operationalEvents).values({
    id: genId(),
    tenantId: params.tenantId,
    eventType: params.eventType,
    tripId: params.tripId ?? null,
    vehicleId: params.vehicleId ?? null,
    driverId: params.driverId ?? null,
    orderId: params.orderId ?? null,
    message: params.message,
    severity: params.severity ?? "INFO",
    read: false,
  });
}

/**
 * After a GPS ping, check if the vehicle has entered a relevant geofence:
 * - Loading point (warehouse) if trip status is STARTED (en route to loading)
 * - Customer site if trip status has loading confirmed (en route to customer)
 *
 * Creates an operational suggestion event — does NOT auto-advance lifecycle.
 * Deduplicates: only one event per (trip + geofence) per hour.
 */
export async function checkAndEmitGeofenceEvents(params: {
  tenantId: string;
  tripId: string;
  vehicleId: string;
  driverId: string;
  lat: number;
  lng: number;
}) {
  const { tenantId, tripId, vehicleId, driverId, lat, lng } = params;

  const trip = await db.query.trips.findFirst({
    where: and(eq(trips.id, tripId), eq(trips.tenantId, tenantId)),
    with: { warehouse: true },
  });
  if (!trip) return;

  // --- Check loading point geofence (warehouse) ---
  if (trip.status === "STARTED" && !trip.loadingConfirmed && trip.warehouse?.lat && trip.warehouse?.lng) {
    const radius = trip.warehouse.geofenceRadiusMeters ?? 200;
    const check = checkGeofence(lat, lng, trip.warehouse.lat, trip.warehouse.lng, radius);
    if (check.inside) {
      // Deduplication: only create one loading-arrival event per trip.
      // Subsequent GPS pings while inside the geofence must not generate spam.
      const { inArray: _inArray, gt: _gt } = await import("drizzle-orm");
      const recentHour = new Date(Date.now() - 60 * 60 * 1000);
      const existing = await db.query.operationalEvents.findFirst({
        where: (evt, { and: a, eq: e, gte: g }) =>
          a(e(evt.tripId, tripId), e(evt.eventType, "GEOFENCE_LOADING_ARRIVAL"), g(evt.createdAt, recentHour)),
      });
      if (!existing) {
        await createOperationalEvent({
          tenantId, tripId, vehicleId, driverId,
          eventType: "GEOFENCE_LOADING_ARRIVAL",
          message: `Vehicle detected at ${trip.warehouse.name} (${Math.round(check.distanceMeters)}m). Confirm arrival to begin loading.`,
          severity: "INFO",
        });
      }
    }
  }

  // --- Check customer site geofence (active stop's location) ---
  if (trip.loadingConfirmed) {
    const stop = await db.query.tripStops.findFirst({
      where: eq(tripStops.tripId, tripId),
      with: { order: { with: { location: true } } },
    });
    const loc = stop?.order?.location;
    if (loc?.lat && loc?.lng) {
      const radius = loc.geofenceRadiusMeters ?? 150;
      const check = checkGeofence(lat, lng, loc.lat, loc.lng, radius);
      if (check.inside) {
        // Deduplication: only one customer-arrival event per trip.
        const recentHour2 = new Date(Date.now() - 60 * 60 * 1000);
        const existingCustomer = await db.query.operationalEvents.findFirst({
          where: (evt, { and: a, eq: e, gte: g }) =>
            a(e(evt.tripId, tripId), e(evt.eventType, "GEOFENCE_CUSTOMER_ARRIVAL"), g(evt.createdAt, recentHour2)),
        });
        if (!existingCustomer) {
          await createOperationalEvent({
            tenantId, tripId, vehicleId, driverId,
            orderId: stop?.orderId,
            eventType: "GEOFENCE_CUSTOMER_ARRIVAL",
            message: `Vehicle detected at ${loc.label ?? "customer site"} (${Math.round(check.distanceMeters)}m). Confirm arrival to begin delivery.`,
            severity: "INFO",
          });
        }
      }
    }
  }
}
