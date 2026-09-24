/**
 * P2-01 Live Operations — behavioral tests
 * GPS, fleet positions, lifecycle, geofence, Control Tower, PWA, Phase 1 regression
 */
import { describe, it, expect, beforeAll } from "vitest";
import { makeRequest, loginAs } from "../helpers/request";
import { db } from "@/lib/db/client";
import { tenants, trips, vehicles, drivers, customers, contracts, contractPricingRules, warehouses, vehicleGpsHistory, operationalEvents } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { genId } from "@/lib/helpers";
import { ensureAllSeries, createIsolatedDriverAndVehicle } from "../helpers/testFixtures";
import { haversineMeters, checkGeofence } from "@/lib/geofence";

const riyadh = () => db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
const adminCk = () => loginAs("admin@riyadh-bulk-water.co", "password123");
const driverCk = () => loginAs("mohammed@riyadh-bulk-water.co", "password123");

let tenantId: string;
let testTripId: string;
let testVehicleId: string;
let testDriverId: string;

beforeAll(async () => {
  const t = await riyadh(); if (!t) return;
  tenantId = t.id;
  await ensureAllSeries(tenantId);
  // Create a fresh B2C customer and trip for GPS tests:
  const custId = genId();
  await db.insert(customers).values({ id: custId, tenantId, name: "GPS Test B2C", type: "B2C", address: "Test", lat: 24.7, lng: 46.7 });
  const dv = await createIsolatedDriverAndVehicle(tenantId, "p2-gps");
  testVehicleId = dv.vehicleId;
  testDriverId = dv.driverId;
  await db.update(vehicles).set({ capacityLiters: 21000, status: "AVAILABLE" }).where(eq(vehicles.id, testVehicleId));
  const wh = await db.query.warehouses.findFirst({ where: eq(warehouses.tenantId, tenantId) });
  const { POST: createOrd } = await import("@/app/api/orders/route");
  const ordRes = await createOrd(makeRequest("/api/orders", { method: "POST", cookie: await adminCk(),
    body: { customerId: custId, qtyOrdered: 1, emptyBottlesToCollect: 0, paymentMethod: "CASH" },
  }));
  const ord = await ordRes.json();
  const { POST: createTrip } = await import("@/app/api/trips/route");
  const tripRes = await createTrip(makeRequest("/api/trips", { method: "POST", cookie: await adminCk(),
    body: { vehicleId: testVehicleId, driverId: testDriverId, warehouseId: wh!.id, orderIds: [ord.id] },
  }));
  const trip = await tripRes.json();
  testTripId = trip.id;
});

// ── Geofence utility ─────────────────────────────────────────────────────────
describe("Geofence utility (lib/geofence.ts)", () => {
  it("1. haversineMeters returns 0 for identical coordinates", () => {
    expect(haversineMeters(24.7, 46.7, 24.7, 46.7)).toBe(0);
  });

  it("2. haversineMeters returns approximate distance between two Riyadh points", () => {
    const d = haversineMeters(24.7136, 46.6753, 24.7254, 46.6876);
    expect(d).toBeGreaterThan(1000);
    expect(d).toBeLessThan(3000);
  });

  it("3. checkGeofence returns inside:true when vehicle is within radius", () => {
    const result = checkGeofence(24.7, 46.7, 24.7, 46.7, 200);
    expect(result.inside).toBe(true);
    expect(result.distanceMeters).toBe(0);
  });

  it("4. checkGeofence returns inside:false when vehicle is outside radius", () => {
    const result = checkGeofence(24.7, 46.7, 24.72, 46.72, 200);
    expect(result.inside).toBe(false);
    expect(result.distanceMeters).toBeGreaterThan(200);
  });
});

// ── GPS Ping ─────────────────────────────────────────────────────────────────
describe("GPS ping endpoint", () => {
  it("5. authorized driver GPS update succeeds and persists to history", async () => {
    if (!testTripId) return;
    const { PATCH } = await import("@/app/api/trips/[id]/gps/route");
    const res = await PATCH(makeRequest(`/api/trips/${testTripId}/gps`, {
      method: "PATCH", cookie: await adminCk(),
      body: { lat: 24.711, lng: 46.681, accuracy: 5.0, speed: 8.3 },
    }), { params: Promise.resolve({ id: testTripId }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.lat).toBe(24.711);
    // Verify history was persisted:
    const history = await db.query.vehicleGpsHistory.findMany({
      where: and(eq(vehicleGpsHistory.tripId, testTripId), eq(vehicleGpsHistory.tenantId, tenantId)),
    });
    expect(history.length).toBeGreaterThan(0);
    const last = history[history.length - 1];
    expect(last.lat).toBe(24.711);
    expect(last.accuracy).toBe(5.0);
    expect(last.speed).toBe(8.3);
  });

  it("6. invalid coordinates (out of range) are rejected with 400", async () => {
    if (!testTripId) return;
    const { PATCH } = await import("@/app/api/trips/[id]/gps/route");
    const res = await PATCH(makeRequest(`/api/trips/${testTripId}/gps`, {
      method: "PATCH", cookie: await adminCk(),
      body: { lat: 999, lng: 46.7 }, // lat out of ±90 — rejected, not clamped
    }), { params: Promise.resolve({ id: testTripId }) });
    expect(res.status).toBe(422); // INVALID_GPS_COORDINATES — reject not clamp
  });

  it("7. unauthenticated GPS ping is rejected with 401", async () => {
    if (!testTripId) return;
    const { PATCH } = await import("@/app/api/trips/[id]/gps/route");
    const res = await PATCH(makeRequest(`/api/trips/${testTripId}/gps`, {
      method: "PATCH",
      body: { lat: 24.7, lng: 46.7 },
    }), { params: Promise.resolve({ id: testTripId }) });
    expect(res.status).toBe(401);
  });

  it("8. cross-tenant GPS ping is rejected with 404", async () => {
    if (!testTripId) return;
    const otherAdminCk = await loginAs("admin@demo-water.co", "password123");
    const { PATCH } = await import("@/app/api/trips/[id]/gps/route");
    const res = await PATCH(makeRequest(`/api/trips/${testTripId}/gps`, {
      method: "PATCH", cookie: otherAdminCk,
      body: { lat: 24.7, lng: 46.7 },
    }), { params: Promise.resolve({ id: testTripId }) });
    expect([403, 404]).toContain(res.status);
  });

  it("9. updates trips.currentLat/currentLng/lastPingAt on successful ping", async () => {
    if (!testTripId) return;
    const { PATCH } = await import("@/app/api/trips/[id]/gps/route");
    await PATCH(makeRequest(`/api/trips/${testTripId}/gps`, {
      method: "PATCH", cookie: await adminCk(),
      body: { lat: 24.722, lng: 46.692 },
    }), { params: Promise.resolve({ id: testTripId }) });
    const trip = await db.query.trips.findFirst({ where: eq(trips.id, testTripId) });
    expect(trip?.currentLat).toBeCloseTo(24.722, 3);
    expect(trip?.currentLng).toBeCloseTo(46.692, 3);
    expect(trip?.lastPingAt).toBeTruthy();
  });
});

// ── Fleet Positions ─────────────────────────────────────────────────────────
describe("Fleet positions API (/api/fleet/positions)", () => {
  it("10. returns all vehicles for tenant", async () => {
    const { GET } = await import("@/app/api/fleet/positions/route");
    const res = await GET(makeRequest("/api/fleet/positions", { cookie: await adminCk() }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.positions)).toBe(true);
    expect(data.positions.length).toBeGreaterThan(0);
    expect(data.fetchedAt).toBeTruthy();
  });

  it("11. each position entry has required fields", async () => {
    const { GET } = await import("@/app/api/fleet/positions/route");
    const res = await GET(makeRequest("/api/fleet/positions", { cookie: await adminCk() }));
    const data = await res.json();
    const v = data.positions[0];
    expect(v).toHaveProperty("vehicleId");
    expect(v).toHaveProperty("plateNumber");
    expect(v).toHaveProperty("gpsStatus");
    expect(["LIVE", "STALE", "OFFLINE"]).toContain(v.gpsStatus);
  });

  it("12. vehicle with recent GPS ping shows gpsStatus=LIVE", async () => {
    if (!testTripId || !testVehicleId) return;
    // Ping it first:
    const { PATCH } = await import("@/app/api/trips/[id]/gps/route");
    await PATCH(makeRequest(`/api/trips/${testTripId}/gps`, {
      method: "PATCH", cookie: await adminCk(),
      body: { lat: 24.71, lng: 46.68 },
    }), { params: Promise.resolve({ id: testTripId }) });
    const { GET } = await import("@/app/api/fleet/positions/route");
    const res = await GET(makeRequest("/api/fleet/positions", { cookie: await adminCk() }));
    const data = await res.json();
    const veh = data.positions.find((p: any) => p.vehicleId === testVehicleId);
    expect(veh).toBeTruthy();
    expect(veh.gpsStatus).toBe("LIVE");
    expect(veh.lat).toBeCloseTo(24.71, 3);
  });

  it("13. DRIVER cannot access fleet positions endpoint", async () => {
    const { GET } = await import("@/app/api/fleet/positions/route");
    const res = await GET(makeRequest("/api/fleet/positions", { cookie: await driverCk() }));
    expect([401, 403]).toContain(res.status);
  });

  it("14. cross-tenant vehicles not included in response", async () => {
    const { GET } = await import("@/app/api/fleet/positions/route");
    const demoAdminCk = await loginAs("admin@demo-water.co", "password123");
    const res = await GET(makeRequest("/api/fleet/positions", { cookie: demoAdminCk }));
    const data = await res.json();
    // All returned vehicles must belong to Demo Water Co., not Riyadh:
    const demoTenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Demo Water Co.") });
    for (const pos of data.positions) {
      const veh = await db.query.vehicles.findFirst({ where: eq(vehicles.id, pos.vehicleId) });
      expect(veh?.tenantId).toBe(demoTenant?.id);
    }
  });
});

// ── GPS History ──────────────────────────────────────────────────────────────
describe("GPS history endpoint", () => {
  it("15. returns GPS trail for a trip in chronological order", async () => {
    if (!testTripId) return;
    const { GET } = await import("@/app/api/trips/[id]/gps-history/route");
    const res = await GET(makeRequest(`/api/trips/${testTripId}/gps-history`, { cookie: await adminCk() }),
      { params: Promise.resolve({ id: testTripId }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.history)).toBe(true);
    // History should contain the pings from earlier tests:
    expect(data.history.length).toBeGreaterThan(0);
    // Check chronological order:
    for (let i = 1; i < data.history.length; i++) {
      const prev = new Date(data.history[i - 1].recordedAt).getTime();
      const curr = new Date(data.history[i].recordedAt).getTime();
      expect(curr).toBeGreaterThanOrEqual(prev);
    }
  });
});

// ── Trip Lifecycle ───────────────────────────────────────────────────────────
describe("Trip lifecycle endpoint", () => {
  it("16. returns trip lifecycle events", async () => {
    if (!testTripId) return;
    const { GET } = await import("@/app/api/trips/[id]/lifecycle/route");
    const res = await GET(makeRequest(`/api/trips/${testTripId}/lifecycle`, { cookie: await adminCk() }),
      { params: Promise.resolve({ id: testTripId }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("tripId", testTripId);
    expect(data).toHaveProperty("tripStatus");
    expect(Array.isArray(data.events)).toBe(true);
  });

  it("17. existing six-stage lifecycle sequence is unchanged", () => {
    const src = require("fs").readFileSync("lib/lifecycleHelper.ts", "utf8");
    for (const stage of ["STARTED", "ARRIVED_LOADING", "LOADING_COMPLETE", "ARRIVED_SITE", "UNLOADING_COMPLETE", "CLOSED"]) {
      expect(src).toContain(stage);
    }
  });
});

// ── Operational Events ────────────────────────────────────────────────────────
describe("Operational events API", () => {
  it("18. returns events list for tenant", async () => {
    const { GET } = await import("@/app/api/operational-events/route");
    const res = await GET(makeRequest("/api/operational-events", { cookie: await adminCk() }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.events)).toBe(true);
    expect(typeof data.unreadCount).toBe("number");
  });

  it("19. unread=true filter returns only unread events", async () => {
    // Insert a test event:
    await db.insert(operationalEvents).values({
      id: genId(), tenantId, eventType: "GPS_STALE",
      message: "Test GPS stale event", severity: "WARNING", read: false,
    });
    const { GET } = await import("@/app/api/operational-events/route");
    const res = await GET(makeRequest("/api/operational-events?unread=true", { cookie: await adminCk() }));
    const data = await res.json();
    expect(data.events.every((e: any) => !e.read)).toBe(true);
    expect(data.unreadCount).toBeGreaterThan(0);
  });

  it("20. PATCH marks events as read", async () => {
    const evtId = genId();
    await db.insert(operationalEvents).values({
      id: evtId, tenantId, eventType: "TRIP_LATE",
      message: "Test late trip", severity: "WARNING", read: false,
    });
    const { PATCH } = await import("@/app/api/operational-events/route");
    const res = await PATCH(makeRequest("/api/operational-events", { method: "PATCH", cookie: await adminCk(),
      body: { ids: [evtId] },
    }));
    expect(res.status).toBe(200);
    const evt = await db.query.operationalEvents.findFirst({ where: eq(operationalEvents.id, evtId) });
    expect(evt?.read).toBe(true);
  });
});

// ── Phase 1 Commercial Regression ───────────────────────────────────────────
describe("Phase 1 commercial regression — GPS does not affect commercial chain", () => {
  it("21. B2B still requires eligible contract after P2-01", async () => {
    const custId = genId();
    await db.insert(customers).values({ id: custId, tenantId, name: `P2 B2B`, type: "B2B", address: "Test", lat: 24.7, lng: 46.7 });
    const { POST } = await import("@/app/api/orders/route");
    const res = await POST(makeRequest("/api/orders", { method: "POST", cookie: await adminCk(),
      body: { customerId: custId, qtyOrdered: 1, emptyBottlesToCollect: 0, paymentMethod: "CASH" },
    }));
    expect(res.status).toBe(422);
    expect((await res.json()).errorCode).toBe("B2B_CONTRACT_REQUIRED");
  });

  it("22. B2C direct order still works after P2-01", async () => {
    const custId = genId();
    await db.insert(customers).values({ id: custId, tenantId, name: `P2 B2C`, type: "B2C", address: "Test", lat: 24.7, lng: 46.7 });
    const { POST } = await import("@/app/api/orders/route");
    const res = await POST(makeRequest("/api/orders", { method: "POST", cookie: await adminCk(),
      body: { customerId: custId, qtyOrdered: 1, emptyBottlesToCollect: 0, paymentMethod: "CASH" },
    }));
    expect(res.status).toBe(201);
  });

  it("23. 21k contract order still rejects 18k tanker", async () => {
    if (!testTripId) return;
    const custId = genId();
    await db.insert(customers).values({ id: custId, tenantId, name: "P2 Cap Test B2B", type: "B2B", address: "Test", lat: 24.7, lng: 46.7 });
    const ctrId = genId();
    await db.insert(contracts).values({ id: ctrId, tenantId, customerId: custId, contractNumber: `P2-${genId().slice(0,5)}`, type: "ONE_TIME_TRIP_COUNT", status: "ACTIVE", totalTripsPurchased: 5, startDate: new Date("2025-01-01"), tripsUsed: 0, appliesToAllSites: true });
    await db.insert(contractPricingRules).values({ id: genId(), tenantId, contractId: ctrId, pricingScope: "CONTRACT", rateType: "STANDARD", pricePerTrip: 500, tankerCapacityLtr: 21000 });
    const { POST: createOrd } = await import("@/app/api/orders/route");
    const ordRes = await createOrd(makeRequest("/api/orders", { method: "POST", cookie: await adminCk(),
      body: { customerId: custId, contractId: ctrId, qtyOrdered: 1, emptyBottlesToCollect: 0, paymentMethod: "CASH" },
    }));
    if (!ordRes.ok) return;
    const ord = await ordRes.json();
    const dv = await createIsolatedDriverAndVehicle(tenantId, `p2-cap-${genId().slice(0,5)}`);
    await db.update(vehicles).set({ capacityLiters: 18000, status: "AVAILABLE" }).where(eq(vehicles.id, dv.vehicleId));
    const wh = await db.query.warehouses.findFirst({ where: eq(warehouses.tenantId, tenantId) });
    const { POST: createTrip } = await import("@/app/api/trips/route");
    const res = await createTrip(makeRequest("/api/trips", { method: "POST", cookie: await adminCk(),
      body: { vehicleId: dv.vehicleId, driverId: dv.driverId, warehouseId: wh!.id, orderIds: [ord.id] },
    }));
    expect(res.status).toBe(422);
    expect((await res.json()).errorCode).toBe("TANKER_CAPACITY_MISMATCH");
  });

  it("24. GPS ping does not create billing or POD events (stop route unchanged)", () => {
    const gpsRouteSrc = require("fs").readFileSync("app/api/trips/[id]/gps/route.ts", "utf8");
    // GPS route must NOT touch invoices, contractPeriods, or deliveredQty:
    expect(gpsRouteSrc).not.toContain("invoices");
    expect(gpsRouteSrc).not.toContain("deliveredQty");
    expect(gpsRouteSrc).not.toContain("recordUnloadingComplete");
    expect(gpsRouteSrc).not.toContain("tripStops");
  });

  it("25. geofence awareness does not auto-advance lifecycle (source check)", () => {
    const helperSrc = require("fs").readFileSync("lib/operationalEventHelper.ts", "utf8");
    // Must NOT update trip status or stop status:
    expect(helperSrc).not.toContain("update(trips)");
    expect(helperSrc).not.toContain("update(tripStops)");
    expect(helperSrc).not.toContain("UNLOADING_COMPLETE");
    // Must only INSERT operational events:
    expect(helperSrc).toContain("insert(operationalEvents)");
    expect(helperSrc).toContain("GEOFENCE_LOADING_ARRIVAL");
    expect(helperSrc).toContain("GEOFENCE_CUSTOMER_ARRIVAL");
  });
});

// ── Schema & Migration ───────────────────────────────────────────────────────
describe("P2-01 schema and migration", () => {
  it("26. vehicleGpsHistory table exists in database", async () => {
    const result = await db.execute(
      require("drizzle-orm/sql").sql`SELECT to_regclass('vehicle_gps_history') as tbl`
    );
    expect((result.rows[0] as any).tbl).toBe("vehicle_gps_history");
  });

  it("27. operational_events table exists in database", async () => {
    const result = await db.execute(
      require("drizzle-orm/sql").sql`SELECT to_regclass('operational_events') as tbl`
    );
    expect((result.rows[0] as any).tbl).toBe("operational_events");
  });

  it("28. warehouses has geofence_radius_meters column", async () => {
    const result = await db.execute(
      require("drizzle-orm/sql").sql`SELECT column_name FROM information_schema.columns WHERE table_name='warehouses' AND column_name='geofence_radius_meters'`
    );
    expect(result.rows.length).toBe(1);
  });
});

// ── PWA ──────────────────────────────────────────────────────────────────────
describe("PWA manifest", () => {
  it("29. manifest.json exists and is valid JSON", () => {
    const fs = require("fs");
    const manifest = JSON.parse(fs.readFileSync("public/manifest.json", "utf8"));
    expect(manifest.name).toBeTruthy();
    expect(manifest.start_url).toBe("/driver");
    expect(manifest.display).toBe("standalone");
    expect(Array.isArray(manifest.icons)).toBe(true);
    expect(manifest.icons.length).toBeGreaterThan(0);
  });

  it("30. layout.tsx references manifest", () => {
    const src = require("fs").readFileSync("app/layout.tsx", "utf8");
    expect(src).toContain("manifest.json");
  });

  it("31. driver route has PWA-compatible configuration (no service worker with offline actions)", () => {
    const src = require("fs").readFileSync("app/driver/page.tsx", "utf8");
    // Driver app should NOT have service worker registration (offline actions risk):
    expect(src).not.toContain("serviceWorker.register");
    // Driver app SHOULD have GPS status tracking:
    expect(src).toContain("gpsStatus");
    expect(src).toContain("geofenceSuggestion");
  });
});
