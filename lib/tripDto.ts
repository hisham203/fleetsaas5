/**
 * P2-02: Operational trip DTO — the ONE response contract used by every
 * operational trip view (Dispatch, Assignment Workspace, trip detail).
 *
 * Commercial facts are NOT duplicated onto the trips table. They are
 * derived through the canonical relations:
 *
 *   trip → stops → order → requiredTankerCapacityLtr / customer / site / contract
 *   trip → warehouse (operationally: "Loading Point")
 *   trip → driver → user.name
 *   trip → vehicle (plateNumber, capacityLiters)
 *
 * Pages must consume this shape and never guess raw Drizzle object shapes.
 */
import { db } from "@/lib/db/client";
import { trips } from "@/lib/db/schema";
import { and, desc, eq, inArray, type SQL } from "drizzle-orm";

/** Statuses a trip moves through after dispatch until it is closed. */
export const ACTIVE_TRIP_STATUSES = [
  "DISPATCHED", "IN_PROGRESS", "STARTED", "ARRIVED_LOADING", "LOADING_COMPLETE", "ARRIVED_SITE",
] as const;

/** Terminal trip statuses — resources are released, nothing is actionable. */
export const TERMINAL_TRIP_STATUSES = ["COMPLETED", "CANCELLED", "FAILED"] as const;

export type OrderType = "B2B_CONTRACT" | "B2C_DIRECT";

export type OperationalTripDto = {
  id: string;
  tripNumber: string;
  status: string;
  loadingConfirmed: boolean;
  isAssigned: boolean;
  customer: { id: string; name: string; type: string } | null;
  site: { id: string; label: string; address: string; siteCode: string | null } | null;
  deliveryAddress: string | null;
  order: {
    id: string;
    orderNumber: string;
    orderType: OrderType;
    status: string;
    createdAt: string | null;
    failureReason: string | null;
    lat: number | null;
    lng: number | null;
    contract: { id: string; contractNumber: string; type: string } | null;
  } | null;
  orderCount: number;
  /** Derived from the trip's orders. null = no capacity constraint on any order. */
  requiredTankerCapacityLtr: number | null;
  /** true when the trip's orders disagree on capacity (never produced by planning). */
  hasMixedCapacities: boolean;
  driver: { id: string; name: string | null; status: string; driverCode: string | null } | null;
  vehicle: { id: string; plateNumber: string; capacityLiters: number | null; status: string; vehicleCode: string | null } | null;
  loadingPoint: { id: string; name: string; loadingPointCode: string | null } | null;
  scheduledAt: string | null;
  createdAt: string | null;
  loadingConfirmedAt: string | null;
  startedAt: string | null;
  dispatchedAt: string | null;
  completedAt: string | null;
  /** Last GPS position (null until the first ping). */
  currentLat: number | null;
  currentLng: number | null;
  stops: {
    id: string; sequence: number; status: string; orderId: string; orderNumber: string | null;
    arrivedAt: string | null; completedAt: string | null;
    epod: { deliveredQty: number; recipientName: string | null; deliveredAt: string | null } | null;
  }[];
};

const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);

/** Distinct non-null tanker capacities required by a set of orders. */
export function requiredCapacitiesOf(orders: { requiredTankerCapacityLtr: number | null }[]): number[] {
  return [...new Set(orders.map((o) => o.requiredTankerCapacityLtr).filter((c): c is number => c != null))];
}

export function orderTypeOf(order: { contractId: string | null }): OrderType {
  return order.contractId ? "B2B_CONTRACT" : "B2C_DIRECT";
}

const TRIP_WITH = {
  driver: { columns: { id: true, status: true, driverCode: true }, with: { user: { columns: { name: true } } } },
  vehicle: { columns: { id: true, plateNumber: true, capacityLiters: true, status: true, vehicleCode: true } },
  warehouse: { columns: { id: true, name: true, loadingPointCode: true } },
  stops: {
    columns: { id: true, sequence: true, status: true, orderId: true, arrivedAt: true, completedAt: true },
    with: {
      epod: { columns: { deliveredQty: true, recipientName: true, deliveredAt: true } },
      order: {
        columns: {
          id: true, orderNumber: true, status: true, contractId: true, requiredTankerCapacityLtr: true,
          requestedTime: true, deliveryAddress: true, createdAt: true, failureReason: true, lat: true, lng: true,
        },
        with: {
          customer: { columns: { id: true, name: true, type: true } },
          location: { columns: { id: true, label: true, address: true, siteCode: true } },
          contract: { columns: { id: true, contractNumber: true, type: true } },
        },
      },
    },
  },
} as const;

export function toOperationalTripDto(t: any): OperationalTripDto {
  const stops = [...(t.stops ?? [])].sort((a: any, b: any) => a.sequence - b.sequence);
  const orders = stops.map((s: any) => s.order).filter(Boolean);
  const first = orders[0] ?? null;
  const caps = requiredCapacitiesOf(orders);
  const scheduled = orders
    .map((o: any) => (o.requestedTime ? new Date(o.requestedTime).getTime() : null))
    .filter((x: number | null): x is number => x != null);
  return {
    id: t.id,
    tripNumber: t.tripNumber,
    status: t.status,
    loadingConfirmed: !!t.loadingConfirmed,
    isAssigned: !!(t.driverId && t.vehicleId),
    customer: first?.customer ? { id: first.customer.id, name: first.customer.name, type: first.customer.type } : null,
    site: first?.location
      ? { id: first.location.id, label: first.location.label, address: first.location.address, siteCode: first.location.siteCode ?? null }
      : null,
    deliveryAddress: first?.deliveryAddress ?? null,
    order: first
      ? {
          id: first.id,
          orderNumber: first.orderNumber,
          orderType: orderTypeOf(first),
          status: first.status,
          createdAt: iso(first.createdAt),
          failureReason: first.failureReason ?? null,
          lat: first.lat ?? null,
          lng: first.lng ?? null,
          contract: first.contract ? { id: first.contract.id, contractNumber: first.contract.contractNumber, type: first.contract.type } : null,
        }
      : null,
    orderCount: orders.length,
    requiredTankerCapacityLtr: caps.length === 1 ? caps[0] : null,
    hasMixedCapacities: caps.length > 1,
    driver: t.driver
      ? { id: t.driver.id, name: t.driver.user?.name ?? null, status: t.driver.status, driverCode: t.driver.driverCode ?? null }
      : null,
    vehicle: t.vehicle
      ? { id: t.vehicle.id, plateNumber: t.vehicle.plateNumber, capacityLiters: t.vehicle.capacityLiters ?? null, status: t.vehicle.status, vehicleCode: t.vehicle.vehicleCode ?? null }
      : null,
    loadingPoint: t.warehouse ? { id: t.warehouse.id, name: t.warehouse.name, loadingPointCode: t.warehouse.loadingPointCode ?? null } : null,
    scheduledAt: scheduled.length ? new Date(Math.min(...scheduled)).toISOString() : null,
    createdAt: iso(t.createdAt),
    loadingConfirmedAt: iso(t.loadingConfirmedAt),
    startedAt: iso(t.startedAt),
    dispatchedAt: iso(t.dispatchedAt),
    completedAt: iso(t.completedAt),
    currentLat: t.currentLat ?? null,
    currentLng: t.currentLng ?? null,
    stops: stops.map((s: any) => ({
      id: s.id, sequence: s.sequence, status: s.status, orderId: s.orderId, orderNumber: s.order?.orderNumber ?? null,
      arrivedAt: iso(s.arrivedAt), completedAt: iso(s.completedAt),
      epod: s.epod ? { deliveredQty: s.epod.deliveredQty, recipientName: s.epod.recipientName ?? null, deliveredAt: iso(s.epod.deliveredAt) } : null,
    })),
  };
}

/** Operational trip list for a tenant, optionally filtered by status. */
export async function listOperationalTrips(tenantId: string, statuses?: string[]): Promise<OperationalTripDto[]> {
  const conds: SQL[] = [eq(trips.tenantId, tenantId)];
  if (statuses && statuses.length > 0) conds.push(inArray(trips.status, statuses));
  const rows = await db.query.trips.findMany({ where: and(...conds), with: TRIP_WITH as any, orderBy: desc(trips.createdAt) });
  return rows.map(toOperationalTripDto);
}

/** One operational trip, tenant-scoped. */
export async function getOperationalTrip(tenantId: string, tripId: string): Promise<OperationalTripDto | null> {
  const row = await db.query.trips.findFirst({ where: and(eq(trips.id, tripId), eq(trips.tenantId, tenantId)), with: TRIP_WITH as any });
  return row ? toOperationalTripDto(row) : null;
}

/** Parses `?status=A,B` (or repeated `?status=`) into a clean list; empty = no filter. */
export function parseStatusFilter(searchParams: URLSearchParams): string[] {
  return searchParams
    .getAll("status")
    .flatMap((v) => v.split(","))
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}
