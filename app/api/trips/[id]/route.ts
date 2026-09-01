export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { trips, orders, vehicles, drivers } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { runAutomationRules } from "@/lib/automation";
import { eq, and, inArray } from "drizzle-orm";
import { z } from "zod";

const actionSchema = z.object({
  action: z.enum(["dispatch", "complete"]),
});

// BR-07: Dispatch & Control Tower — sends a PLANNED trip to the driver app,
// or closes out a trip once all stops are resolved (BR-08 Trip Closure rule).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN", "DISPATCHER"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;

  const body = await req.json();
  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const trip = await db.query.trips.findFirst({ where: and(eq(trips.id, id), eq(trips.tenantId, tenantId)), with: { stops: true, vehicle: true } });
  if (!trip) return NextResponse.json({ error: "Trip not found" }, { status: 404 });

  if (parsed.data.action === "dispatch") {
    if (trip.status !== "PLANNED") {
      return NextResponse.json({ error: "Only PLANNED trips can be dispatched" }, { status: 422 });
    }
    if (!trip.loadingConfirmed) {
      return NextResponse.json({ error: "Cannot dispatch — warehouse has not confirmed loading yet" }, { status: 422 });
    }
    const orderIds = trip.stops.map((s) => s.orderId);
    await db.transaction(async (tx) => {
      await tx.update(trips).set({ status: "DISPATCHED", startedAt: new Date() }).where(eq(trips.id, trip.id));
      await tx.update(orders).set({ status: "IN_TRANSIT" }).where(inArray(orders.id, orderIds));
    });
    const updated = await db.query.trips.findFirst({ where: eq(trips.id, trip.id) });

    for (const orderId of orderIds) {
      await runAutomationRules(tenantId, "TRIP_DISPATCHED", {
        orderId,
        vehicleType: trip.vehicle?.vehicleType ?? "",
      }).catch(() => {});
    }

    return NextResponse.json(updated);
  }

  // complete
  const unresolved = trip.stops.filter((s) => s.status === "PENDING" || s.status === "ARRIVED");
  if (unresolved.length > 0) {
    return NextResponse.json(
      { error: `Cannot close trip — ${unresolved.length} stop(s) not yet resolved` },
      { status: 422 }
    );
  }
  await db.transaction(async (tx) => {
    await tx.update(trips).set({ status: "COMPLETED", completedAt: new Date() }).where(eq(trips.id, trip.id));
    await tx.update(vehicles).set({ status: "AVAILABLE" }).where(eq(vehicles.id, trip.vehicleId));
    await tx.update(drivers).set({ status: "AVAILABLE" }).where(eq(drivers.id, trip.driverId));
  });
  const updated = await db.query.trips.findFirst({ where: eq(trips.id, trip.id) });
  return NextResponse.json(updated);
}
