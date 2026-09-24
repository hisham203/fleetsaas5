/**
 * P2-02 Final: Real concurrent dispatch test.
 * Deterministic — uses known-good seed data, no silent fixture skips.
 * Tests SELECT FOR UPDATE serialisation in dispatch route.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db/client";
import { trips, tripLifecycleEvents, users, drivers, vehicles, warehouses } from "@/lib/db/schema";
import { eq, and, ne } from "drizzle-orm";
import { genId } from "@/lib/helpers";
import { makeRequest, loginAs } from "../helpers/request";

// Deterministic IDs so cleanup is safe across runs:
const TRIP_A_ID = "concurrent-dispatch-test-trip-A";
const TRIP_B_ID = "concurrent-dispatch-test-trip-B";

let tenantId: string;
let adminCookie: string;
let sharedDriverId: string;
let sharedVehicleId: string;

async function cleanupTestTrips() {
  for (const id of [TRIP_A_ID, TRIP_B_ID]) {
    await db.delete(tripLifecycleEvents).where(eq(tripLifecycleEvents.tripId, id));
    await db.delete(trips).where(eq(trips.id, id));
  }
}

describe("P2-02 Real Concurrent Dispatch (SELECT FOR UPDATE)", () => {
  beforeAll(async () => {
    // Use Demo Water Co — always seeded:
    const tenant = await db.query.tenants.findFirst({ where: (t, { like }) => like(t.name, "%Water%") });
    if (!tenant) throw new Error("Demo Water tenant not found — seed data missing");
    tenantId = tenant.id;

    // Log in as ADMIN (Platform Admin — bypasses permission checks):
    const adminUser = await db.query.users.findFirst({
      where: and(eq(users.tenantId, tenantId), eq(users.role, "ADMIN")),
    });
    if (!adminUser) throw new Error("Admin user not found for tenant");
    adminCookie = await loginAs(adminUser.email, "password123");
    if (!adminCookie) throw new Error("Admin login failed");

    // Get available vehicle:
    const vehicle = await db.query.vehicles.findFirst({
      where: and(eq(vehicles.tenantId, tenantId), eq(vehicles.status, "AVAILABLE")),
    });
    if (!vehicle) throw new Error("No available vehicle in test tenant");
    sharedVehicleId = vehicle.id;

    // Get active driver:
    const driver = await db.query.drivers.findFirst({
      where: and(eq(drivers.tenantId, tenantId)) /* any driver for this tenant */,
    });
    if (!driver) throw new Error("No driver found in test tenant");
    sharedDriverId = driver.id;

    // Get warehouse:
    const warehouse = await db.query.warehouses.findFirst({
      where: eq(warehouses.tenantId, tenantId),
    });
    if (!warehouse) throw new Error("No warehouse in test tenant");

    // Clean up any leftover test trips:
    await cleanupTestTrips();

    // Create two PLANNED trips sharing the SAME driver and vehicle:
    await db.insert(trips).values([
      {
        id: TRIP_A_ID, tenantId, tripNumber: "CONCURRENT-TEST-A",
        status: "PLANNED", driverId: sharedDriverId, vehicleId: sharedVehicleId,
        warehouseId: warehouse.id,
      },
      {
        id: TRIP_B_ID, tenantId, tripNumber: "CONCURRENT-TEST-B",
        status: "PLANNED", driverId: sharedDriverId, vehicleId: sharedVehicleId,
        warehouseId: warehouse.id,
      },
    ]);
  });

  afterAll(cleanupTestTrips);

  it("dispatch route source uses a database transaction with FOR UPDATE", () => {
    const src = require("fs").readFileSync("app/api/trips/[id]/dispatch/route.ts", "utf8");
    expect(src).toContain("db.transaction");
    expect(src).toContain("FOR UPDATE");
    expect(src).toContain("DRIVER_CONFLICT");
    expect(src).toContain("VEHICLE_CONFLICT");
  });

  it("two simultaneous dispatches of conflicting trips: exactly one wins, one gets 409", async () => {
    // Fire both dispatch requests simultaneously via Promise.all:
    const { POST } = await import("@/app/api/trips/[id]/dispatch/route");

    const [resA, resB] = await Promise.all([
      POST(
        makeRequest(`/api/trips/${TRIP_A_ID}/dispatch`, { method: "POST", cookie: adminCookie, body: {} }),
        { params: Promise.resolve({ id: TRIP_A_ID }) }
      ),
      POST(
        makeRequest(`/api/trips/${TRIP_B_ID}/dispatch`, { method: "POST", cookie: adminCookie, body: {} }),
        { params: Promise.resolve({ id: TRIP_B_ID }) }
      ),
    ]);

    const [statusA, statusB] = [resA.status, resB.status];
    const dataA = await resA.json().catch(() => ({}));
    const dataB = await resB.json().catch(() => ({}));

    console.log(`Trip A: ${statusA}${dataA.errorCode ? ` (${dataA.errorCode})` : ""}`);
    console.log(`Trip B: ${statusB}${dataB.errorCode ? ` (${dataB.errorCode})` : ""}`);

    const statuses = [statusA, statusB].sort();

    // Exactly one must succeed (200) and one must fail (409):
    expect(statuses).toEqual([200, 409]);

    // The 409 must carry a meaningful conflict code:
    const conflictData = statusA === 409 ? dataA : dataB;
    expect(["DRIVER_CONFLICT","VEHICLE_CONFLICT","ASSIGNMENT_CONFLICT"]).toContain(conflictData.errorCode);

    // DB post-check: only one trip should be DISPATCHED:
    const tripA = await db.query.trips.findFirst({ where: eq(trips.id, TRIP_A_ID) });
    const tripB = await db.query.trips.findFirst({ where: eq(trips.id, TRIP_B_ID) });
    const dispatchedCount = [tripA?.status, tripB?.status].filter(s => s === "DISPATCHED").length;
    expect(dispatchedCount).toBe(1);
  });

  it("sequential second dispatch of already-active driver returns 409 DRIVER_CONFLICT", async () => {
    // Reset both trips to PLANNED for a clean sequential test:
    await db.update(trips).set({ status: "PLANNED" }).where(eq(trips.id, TRIP_A_ID));
    await db.update(trips).set({ status: "PLANNED" }).where(eq(trips.id, TRIP_B_ID));
    await db.delete(tripLifecycleEvents).where(and(
      eq(tripLifecycleEvents.tenantId, tenantId),
      eq(tripLifecycleEvents.tripId, TRIP_A_ID)
    ));
    await db.delete(tripLifecycleEvents).where(and(
      eq(tripLifecycleEvents.tenantId, tenantId),
      eq(tripLifecycleEvents.tripId, TRIP_B_ID)
    ));

    const { POST } = await import("@/app/api/trips/[id]/dispatch/route");

    // Dispatch A first — must succeed:
    const resA = await POST(
      makeRequest(`/api/trips/${TRIP_A_ID}/dispatch`, { method: "POST", cookie: adminCookie, body: {} }),
      { params: Promise.resolve({ id: TRIP_A_ID }) }
    );
    expect(resA.status).toBe(200);

    // Now dispatch B with the same driver/vehicle — must fail:
    const resB = await POST(
      makeRequest(`/api/trips/${TRIP_B_ID}/dispatch`, { method: "POST", cookie: adminCookie, body: {} }),
      { params: Promise.resolve({ id: TRIP_B_ID }) }
    );
    expect(resB.status).toBe(409);
    const data = await resB.json();
    expect(["DRIVER_CONFLICT","VEHICLE_CONFLICT"]).toContain(data.errorCode);
  });
});
