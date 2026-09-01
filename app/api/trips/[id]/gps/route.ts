export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { trips, drivers } from "@/lib/db/schema";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

const pingSchema = z.object({
  lat: z.number(),
  lng: z.number(),
});

// BR-12: Live Location Tracking. No real GPS hardware exists in this
// prototype, so the driver app simulates a device ping by interpolating
// position along the trip's stop sequence client-side and posting here —
// see the simulation loop in app/driver/page.tsx. The shape of this
// endpoint (lat/lng, latest-wins) is exactly what a real GPS/IoT device
// integration would call, so swapping in real hardware later means
// replacing the client-side sender, not this endpoint.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN", "DRIVER"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;

  const body = await req.json();
  const parsed = pingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const trip = await db.query.trips.findFirst({ where: and(eq(trips.id, id), eq(trips.tenantId, tenantId)) });
  if (!trip) return NextResponse.json({ error: "Trip not found" }, { status: 404 });

  // A driver can only ping their own trip.
  if (session!.type === "USER" && session!.user.role === "DRIVER") {
    const driverProfile = await db.query.drivers.findFirst({ where: eq(drivers.userId, session!.user.id) });
    if (!driverProfile || driverProfile.id !== trip.driverId) {
      return NextResponse.json({ error: "Not your trip" }, { status: 403 });
    }
  }

  await db
    .update(trips)
    .set({ currentLat: parsed.data.lat, currentLng: parsed.data.lng, lastPingAt: new Date() })
    .where(eq(trips.id, trip.id));

  return NextResponse.json({ ok: true });
}
