export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { expenseClaims, drivers, vehicles, trips } from "@/lib/db/schema";
import { genId } from "@/lib/helpers";
import { getSessionFromRequest, hasRole, getSessionTenantId } from "@/lib/auth";
import { runAutomationRules } from "@/lib/automation";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";

const createSchema = z
  .object({
    driverId: z.string(),
    vehicleId: z.string(),
    tripId: z.string().optional(),
    reason: z.string().optional(),
    category: z.enum(["FUEL", "TOLL", "MAINTENANCE", "OTHER"]),
    amount: z.number().positive(),
    description: z.string().optional(),
    receiptDescription: z.string().optional(),
  })
  // BR-23 rule: every expense must be linked to a driver, vehicle, and
  // either a trip or a stated reason.
  .refine((data) => data.tripId || data.reason, {
    message: "Either tripId or reason is required",
    path: ["reason"],
  });

// A DRIVER session only ever sees/creates their own expense claims; ADMIN
// and DISPATCHER see everyone's (DISPATCHER can view, but only ADMIN can
// approve/reject — see the approve/reject routes).
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
    eq(expenseClaims.tenantId, tenantId),
    status ? eq(expenseClaims.status, status) : undefined,
    driverId ? eq(expenseClaims.driverId, driverId) : undefined,
  ].filter(Boolean) as any[];

  const rows = await db.query.expenseClaims.findMany({
    where: and(...conditions),
    with: { driver: { with: { user: true } }, vehicle: true, trip: true },
    orderBy: desc(expenseClaims.createdAt),
  });
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = getSessionTenantId(session)!;

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  // A driver may only file a claim under their own driver profile; internal
  // staff may file on behalf of any driver in their tenant.
  if (session.type === "USER" && session.user.role === "DRIVER") {
    const driverProfile = await db.query.drivers.findFirst({ where: eq(drivers.userId, session.user.id) });
    if (!driverProfile || driverProfile.id !== data.driverId) {
      return NextResponse.json({ error: "You can only submit expenses under your own driver profile" }, { status: 403 });
    }
  } else if (!hasRole(session, ["ADMIN", "DISPATCHER"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const driver = await db.query.drivers.findFirst({ where: and(eq(drivers.id, data.driverId), eq(drivers.tenantId, tenantId)) });
  if (!driver) return NextResponse.json({ error: "Driver not found" }, { status: 404 });
  const vehicle = await db.query.vehicles.findFirst({ where: and(eq(vehicles.id, data.vehicleId), eq(vehicles.tenantId, tenantId)) });
  if (!vehicle) return NextResponse.json({ error: "Vehicle not found" }, { status: 404 });
  if (data.tripId) {
    const trip = await db.query.trips.findFirst({ where: and(eq(trips.id, data.tripId), eq(trips.tenantId, tenantId)) });
    if (!trip) return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }

  const id = genId();
  await db.insert(expenseClaims).values({ id, tenantId, ...data });

  // BR-22 hook: lets a tenant define a rule like "notify Admin when an
  // expense over X SAR is submitted" — the automation engine doesn't know
  // or care that this event came from BR-23's code, same as any other event.
  await runAutomationRules(tenantId, "EXPENSE_SUBMITTED", {
    orderId: undefined,
    amount: data.amount,
    category: data.category,
  }).catch(() => {});

  const created = await db.query.expenseClaims.findFirst({
    where: eq(expenseClaims.id, id),
    with: { driver: { with: { user: true } }, vehicle: true },
  });
  return NextResponse.json(created, { status: 201 });
}
