export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { tasks, drivers, vehicles, trips } from "@/lib/db/schema";
import { genId } from "@/lib/helpers";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";
import { SAFE_USER_COLUMNS } from "@/lib/contractHelpers";

const createSchema = z.object({
  driverId: z.string(),
  vehicleId: z.string().optional(),
  tripId: z.string().optional(),
  type: z.enum(["INSPECTION", "COLLECTION", "VISIT", "REFUEL", "EXCEPTION_HANDLING", "OTHER"]),
  title: z.string().min(1),
  notes: z.string().optional(),
  dueAt: z.string().optional(),
});

// BR-23: Task, Expense & Field Activity Management — tasks beyond
// ordinary delivery stops (inspections, collections, site visits,
// refueling, exception follow-up). A DRIVER session only ever sees their
// own tasks, regardless of what driverId a query might ask for — same
// isolation pattern as the B2B customer portal elsewhere in this app.
export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const tenantId = getSessionTenantId(session)!;
  const status = req.nextUrl.searchParams.get("status");
  let driverId = req.nextUrl.searchParams.get("driverId");

  if (session.type === "USER" && session.user.role === "DRIVER") {
    const driverProfile = await db.query.drivers.findFirst({ where: eq(drivers.userId, session.user.id) });
    if (!driverProfile) return NextResponse.json([]);
    driverId = driverProfile.id;
  } else if (!hasRole(session, ["ADMIN", "DISPATCHER", "DRIVER"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const conditions = [
    eq(tasks.tenantId, tenantId),
    status ? eq(tasks.status, status) : undefined,
    driverId ? eq(tasks.driverId, driverId) : undefined,
  ].filter(Boolean) as any[];

  const rows = await db.query.tasks.findMany({
    where: and(...conditions),
    with: { driver: { with: { user: { columns: SAFE_USER_COLUMNS } } }, vehicle: true, trip: true },
    orderBy: desc(tasks.createdAt),
  });
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!hasRole(session, ["ADMIN", "DISPATCHER"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = getSessionTenantId(session)!;
  const assignedByUserId = session!.type === "USER" ? session!.user.id : null;
  if (!assignedByUserId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const driver = await db.query.drivers.findFirst({ where: and(eq(drivers.id, parsed.data.driverId), eq(drivers.tenantId, tenantId)) });
  if (!driver) return NextResponse.json({ error: "Driver not found" }, { status: 404 });

  if (parsed.data.vehicleId) {
    const vehicle = await db.query.vehicles.findFirst({ where: and(eq(vehicles.id, parsed.data.vehicleId), eq(vehicles.tenantId, tenantId)) });
    if (!vehicle) return NextResponse.json({ error: "Vehicle not found" }, { status: 404 });
  }
  if (parsed.data.tripId) {
    const trip = await db.query.trips.findFirst({ where: and(eq(trips.id, parsed.data.tripId), eq(trips.tenantId, tenantId)) });
    if (!trip) return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }

  const id = genId();
  await db.insert(tasks).values({
    id,
    tenantId,
    assignedByUserId,
    driverId: parsed.data.driverId,
    vehicleId: parsed.data.vehicleId,
    tripId: parsed.data.tripId,
    type: parsed.data.type,
    title: parsed.data.title,
    notes: parsed.data.notes,
    dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : undefined,
  });

  const created = await db.query.tasks.findFirst({ where: eq(tasks.id, id), with: { driver: { with: { user: { columns: SAFE_USER_COLUMNS } } }, vehicle: true } });
  return NextResponse.json(created, { status: 201 });
}
