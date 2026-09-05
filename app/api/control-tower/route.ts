export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { orders, invoices, exceptions } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { SAFE_CUSTOMER_COLUMNS, SAFE_USER_COLUMNS } from "@/lib/contractHelpers";
import { deriveOperationalStatus, deriveBillingStatus, deriveDemandSource } from "@/lib/controlTowerStatus";
import { eq, and, inArray, desc } from "drizzle-orm";

// Milestone Q, Gate Q4 — Dispatch Control Tower aggregation endpoint.
// Read-only: this reuses the exact same order/trip/stop data every other
// screen already reads and reads from, adding no new write path and no
// new source of truth. Avoids N+1 queries by batching the two dependent
// lookups (invoices, exceptions) into a single `inArray` query each,
// rather than querying per-order — the same pattern
// lib/monthlyBillingEligibility.ts already uses for a similar fan-out.
export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN", "DISPATCHER"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;

  const rows = await db.query.orders.findMany({
    where: eq(orders.tenantId, tenantId),
    with: {
      customer: { columns: SAFE_CUSTOMER_COLUMNS },
      location: true,
      contract: true,
      tripStop: {
        with: {
          trip: {
            with: {
              vehicle: true,
              driver: { with: { user: { columns: SAFE_USER_COLUMNS } } },
              warehouse: true,
            },
          },
        },
      },
    },
    orderBy: desc(orders.createdAt),
    limit: 500, // Milestone Q performance gate — avoid loading entire order history unbounded; a dedicated date/status filter is a natural P.3-style follow-on if the pilot ever needs to look further back than this.
  });

  const orderIds = rows.map((o) => o.id);
  const [invoiceRows, exceptionRows] = orderIds.length
    ? await Promise.all([
        db.query.invoices.findMany({ where: inArray(invoices.orderId, orderIds) }),
        db.query.exceptions.findMany({ where: inArray(exceptions.orderId, orderIds) }),
      ])
    : [[], []];
  const invoiceByOrderId = new Map(invoiceRows.map((i) => [i.orderId, i]));
  // An order can accumulate more than one exception over its life
  // (fail -> reschedule -> fail again); only the most recent OPEN one is
  // operationally relevant to the Control Tower's own EXCEPTION status.
  const openExceptionByOrderId = new Map<string, (typeof exceptionRows)[number]>();
  for (const exc of exceptionRows) {
    if (exc.status === "OPEN") openExceptionByOrderId.set(exc.orderId, exc);
  }

  const result = rows.map((order) => {
    const trip = order.tripStop?.trip ?? null;
    const invoice = invoiceByOrderId.get(order.id) ?? null;
    const exception = openExceptionByOrderId.get(order.id) ?? null;
    const input = {
      order: { status: order.status, contractId: order.contractId },
      customer: order.customer ? { type: order.customer.type } : null,
      trip: trip ? { status: trip.status, loadingConfirmed: trip.loadingConfirmed } : null,
      stop: order.tripStop ? { status: order.tripStop.status } : null,
      exception: exception ? { status: exception.status } : null,
      invoice: invoice ? { status: invoice.status } : null,
      contractType: order.contract?.type ?? null,
    };
    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      customer: order.customer,
      site: order.location ? { label: order.location.label, cityCode: order.location.cityCode, zoneCode: order.location.zoneCode } : null,
      deliveryAddress: order.deliveryAddress,
      contract: order.contract ? { id: order.contract.id, contractNumber: order.contract.contractNumber, type: order.contract.type } : null,
      requestedTime: order.requestedTime,
      qtyOrdered: order.qtyOrdered,
      loadingPoint: trip?.warehouse ? { id: trip.warehouse.id, name: trip.warehouse.name } : null,
      vehicle: trip?.vehicle ? { id: trip.vehicle.id, plateNumber: trip.vehicle.plateNumber, capacityLiters: trip.vehicle.capacityLiters } : null,
      driver: trip?.driver ? { id: trip.driver.id, name: trip.driver.user.name } : null,
      tripId: trip?.id ?? null,
      tripNumber: trip?.tripNumber ?? null,
      operationalStatus: deriveOperationalStatus(input),
      billingStatus: deriveBillingStatus(input),
      source: deriveDemandSource(input),
      createdAt: order.createdAt,
    };
  });

  return NextResponse.json(result);
}
