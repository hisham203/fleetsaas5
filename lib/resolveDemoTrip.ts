/**
 * Canonical trip resolver for the GPS Demo endpoint.
 *
 * Resolves a user-supplied identifier (either the internal trips.id UUID
 * or the business-facing trips.tripNumber like "TRIP-MU69IH00-697") to a
 * full trip record, ALWAYS tenant-scoped.
 *
 * Security contract:
 *   - A tenant A identifier never matches a tenant B trip, regardless of form.
 *   - An unrecognised identifier returns null (caller maps to 404).
 *   - No bare unscoped lookup is performed first.
 */

import { db } from "@/lib/db/client";
import { trips } from "@/lib/db/schema";
import { eq, and, or } from "drizzle-orm";

export type ResolvedDemoTrip = Awaited<ReturnType<typeof resolveDemoTrip>>;

export async function resolveDemoTrip(identifier: string, tenantId: string) {
  return db.query.trips.findFirst({
    where: and(
      eq(trips.tenantId, tenantId),
      or(
        eq(trips.id, identifier),
        eq(trips.tripNumber, identifier)
      )
    ),
    with: {
      warehouse: { columns: { id: true, name: true, lat: true, lng: true, geofenceRadiusMeters: true } },
      stops: {
        limit: 1,
        with: {
          order: {
            with: {
              location: { columns: { id: true, label: true, lat: true, lng: true, geofenceRadiusMeters: true } },
            },
          },
        },
      },
    },
    columns: {
      id: true, tripNumber: true, vehicleId: true, driverId: true,
      status: true, loadingConfirmed: true,
    },
  });
}
