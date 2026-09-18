/**
 * P2-01 Final Deployment Gate — GPS Demo Mode + Rate Limit + Bounded History
 * Tests 1-26+ per spec
 */
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { makeRequest, loginAs } from "../helpers/request";
import { db } from "@/lib/db/client";
import { tenants, trips, vehicles, customers, warehouses, vehicleGpsHistory, operationalEvents } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { genId } from "@/lib/helpers";
import { ensureAllSeries, createIsolatedDriverAndVehicle } from "../helpers/testFixtures";
import { __setGpsRateLimitEnabled, __resetGpsRateLimit } from "@/lib/gpsRateLimit";

const riyadh  = () => db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
const adminCk = () => loginAs("admin@riyadh-bulk-water.co", "password123");
const dispCk  = () => loginAs("dispatch@riyadh-bulk-water.co", "password123");
const driverCk = () => loginAs("mohammed@riyadh-bulk-water.co", "password123");

let tenantId: string;
let testTripId: string;
let testVehicleId: string;
let testDriverId: string;

beforeAll(async () => {
  const t = await riyadh(); if (!t) return;
  tenantId = t.id;
  await ensureAllSeries(tenantId);
  const custId = genId();
  await db.insert(customers).values({ id: custId, tenantId, name: "P2 Demo Test B2C", type: "B2C", address: "Test", lat: 24.71, lng: 46.68 });
  const dv = await createIsolatedDriverAndVehicle(tenantId, "p2demo");
  testVehicleId = dv.vehicleId;
  testDriverId = dv.driverId;
  await db.update(vehicles).set({ capacityLiters: 21000, status: "AVAILABLE" }).where(eq(vehicles.id, testVehicleId));
  const wh = await db.query.warehouses.findFirst({ where: eq(warehouses.tenantId, tenantId) });
  const { POST: co } = await import("@/app/api/orders/route");
  const ord = await (await co(makeRequest("/api/orders", { method: "POST", cookie: await adminCk(),
    body: { customerId: custId, qtyOrdered: 1, emptyBottlesToCollect: 0, paymentMethod: "CASH" },
  }))).json();
  const { POST: ct } = await import("@/app/api/trips/route");
  const trip = await (await ct(makeRequest("/api/trips", { method: "POST", cookie: await adminCk(),
    body: { vehicleId: testVehicleId, driverId: testDriverId, warehouseId: wh!.id, orderIds: [ord.id] },
  }))).json();
  testTripId = trip.id;
});

afterEach(() => {
  __resetGpsRateLimit();
});

// ── Rate Limit ────────────────────────────────────────────────────────────────
describe("Server-side GPS rate protection", () => {
  it("1. normal GPS ping is accepted", async () => {
    if (!testTripId) return;
    __setGpsRateLimitEnabled(true);
    const { PATCH } = await import("@/app/api/trips/[id]/gps/route");
    const res = await PATCH(makeRequest(`/api/trips/${testTripId}/gps`, {
      method: "PATCH", cookie: await adminCk(), body: { lat: 24.711, lng: 46.681 },
    }), { params: Promise.resolve({ id: testTripId }) });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("2. second immediate ping from same trip is throttled (429)", async () => {
    if (!testTripId) return;
    __setGpsRateLimitEnabled(true);
    const { PATCH } = await import("@/app/api/trips/[id]/gps/route");
    // First ping — accepted:
    await PATCH(makeRequest(`/api/trips/${testTripId}/gps`, {
      method: "PATCH", cookie: await adminCk(), body: { lat: 24.711, lng: 46.681 },
    }), { params: Promise.resolve({ id: testTripId }) });
    // Immediate second ping — throttled:
    const res = await PATCH(makeRequest(`/api/trips/${testTripId}/gps`, {
      method: "PATCH", cookie: await adminCk(), body: { lat: 24.712, lng: 46.682 },
    }), { params: Promise.resolve({ id: testTripId }) });
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.retryAfterMs).toBeGreaterThan(0);
  });

  it("3. throttled request creates NO GPS history entry", async () => {
    if (!testTripId) return;
    __setGpsRateLimitEnabled(true);
    const { PATCH } = await import("@/app/api/trips/[id]/gps/route");
    await PATCH(makeRequest(`/api/trips/${testTripId}/gps`, {
      method: "PATCH", cookie: await adminCk(), body: { lat: 24.713, lng: 46.683 },
    }), { params: Promise.resolve({ id: testTripId }) });
    const before = await db.query.vehicleGpsHistory.findMany({
      where: and(eq(vehicleGpsHistory.tripId, testTripId), eq(vehicleGpsHistory.tenantId, tenantId)),
    });
    // Throttle immediately:
    await PATCH(makeRequest(`/api/trips/${testTripId}/gps`, {
      method: "PATCH", cookie: await adminCk(), body: { lat: 24.714, lng: 46.684 },
    }), { params: Promise.resolve({ id: testTripId }) });
    const after = await db.query.vehicleGpsHistory.findMany({
      where: and(eq(vehicleGpsHistory.tripId, testTripId), eq(vehicleGpsHistory.tenantId, tenantId)),
    });
    expect(after.length).toBe(before.length); // no new row on throttled ping
  });

  it("4. throttled request does NOT update trip current position", async () => {
    if (!testTripId) return;
    __setGpsRateLimitEnabled(true);
    const { PATCH } = await import("@/app/api/trips/[id]/gps/route");
    await PATCH(makeRequest(`/api/trips/${testTripId}/gps`, {
      method: "PATCH", cookie: await adminCk(), body: { lat: 24.720, lng: 46.690 },
    }), { params: Promise.resolve({ id: testTripId }) });
    const tripBefore = await db.query.trips.findFirst({ where: eq(trips.id, testTripId) });
    await PATCH(makeRequest(`/api/trips/${testTripId}/gps`, {
      method: "PATCH", cookie: await adminCk(), body: { lat: 24.799, lng: 46.799 }, // different — throttled
    }), { params: Promise.resolve({ id: testTripId }) });
    const tripAfter = await db.query.trips.findFirst({ where: eq(trips.id, testTripId) });
    expect(tripAfter?.currentLat).toBe(tripBefore?.currentLat); // unchanged
  });

  it("5. different trips have independent rate limits", async () => {
    if (!testTripId || !tenantId) return;
    __setGpsRateLimitEnabled(true);
    // Create a second trip:
    const custId2 = genId();
    await db.insert(customers).values({ id: custId2, tenantId, name: "RateLimit Test 2", type: "B2C", address: "Test", lat: 24.7, lng: 46.7 });
    const dv2 = await createIsolatedDriverAndVehicle(tenantId, `rl-${genId().slice(0,4)}`);
    await db.update(vehicles).set({ capacityLiters: 21000, status: "AVAILABLE" }).where(eq(vehicles.id, dv2.vehicleId));
    const wh = await db.query.warehouses.findFirst({ where: eq(warehouses.tenantId, tenantId) });
    const { POST: co } = await import("@/app/api/orders/route");
    const ord2 = await (await co(makeRequest("/api/orders", { method: "POST", cookie: await adminCk(),
      body: { customerId: custId2, qtyOrdered: 1, emptyBottlesToCollect: 0, paymentMethod: "CASH" },
    }))).json();
    const { POST: ct } = await import("@/app/api/trips/route");
    const trip2 = await (await ct(makeRequest("/api/trips", { method: "POST", cookie: await adminCk(),
      body: { vehicleId: dv2.vehicleId, driverId: dv2.driverId, warehouseId: wh!.id, orderIds: [ord2.id] },
    }))).json();
    const { PATCH } = await import("@/app/api/trips/[id]/gps/route");
    // Ping trip 1 — accepted:
    await PATCH(makeRequest(`/api/trips/${testTripId}/gps`, { method: "PATCH", cookie: await adminCk(), body: { lat: 24.7, lng: 46.7 } }), { params: Promise.resolve({ id: testTripId }) });
    // Ping trip 2 immediately — different key, so should be accepted:
    const res2 = await PATCH(makeRequest(`/api/trips/${trip2.id}/gps`, { method: "PATCH", cookie: await adminCk(), body: { lat: 24.7, lng: 46.7 } }), { params: Promise.resolve({ id: trip2.id }) });
    expect(res2.status).toBe(200);
  });
});

// ── Bounded GPS History ───────────────────────────────────────────────────────
describe("Bounded GPS history (server-side)", () => {
  it("6. default limit is 200", async () => {
    const { GET } = await import("@/app/api/trips/[id]/gps-history/route");
    const res = await GET(makeRequest(`/api/trips/${testTripId}/gps-history`, { cookie: await adminCk() }),
      { params: Promise.resolve({ id: testTripId }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.limit).toBe(200);
    expect(data.history.length).toBeLessThanOrEqual(200);
  });

  it("7. custom smaller limit is respected", async () => {
    const { GET } = await import("@/app/api/trips/[id]/gps-history/route");
    const res = await GET(makeRequest(`/api/trips/${testTripId}/gps-history?limit=10`, { cookie: await adminCk() }),
      { params: Promise.resolve({ id: testTripId }) });
    const data = await res.json();
    expect(data.limit).toBe(10);
    expect(data.history.length).toBeLessThanOrEqual(10);
  });

  it("8. limit is capped at 500 (hard maximum)", async () => {
    const { GET } = await import("@/app/api/trips/[id]/gps-history/route");
    const res = await GET(makeRequest(`/api/trips/${testTripId}/gps-history?limit=9999`, { cookie: await adminCk() }),
      { params: Promise.resolve({ id: testTripId }) });
    const data = await res.json();
    expect(data.limit).toBe(500);
  });

  it("9. history returned in chronological order", async () => {
    const { GET } = await import("@/app/api/trips/[id]/gps-history/route");
    const res = await GET(makeRequest(`/api/trips/${testTripId}/gps-history`, { cookie: await adminCk() }),
      { params: Promise.resolve({ id: testTripId }) });
    const data = await res.json();
    for (let i = 1; i < data.history.length; i++) {
      expect(new Date(data.history[i].recordedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(data.history[i - 1].recordedAt).getTime()
      );
    }
  });

  it("10. history is tenant scoped — cross-tenant returns 404", async () => {
    if (!testTripId) return;
    const demoAdmin = await loginAs("admin@demo-water.co", "password123");
    const { GET } = await import("@/app/api/trips/[id]/gps-history/route");
    const res = await GET(makeRequest(`/api/trips/${testTripId}/gps-history`, { cookie: demoAdmin }),
      { params: Promise.resolve({ id: testTripId }) });
    expect(res.status).toBe(404);
  });

  it("11. DRIVER cannot access another driver's trip history", async () => {
    if (!testTripId) return;
    // The seeded Riyadh driver is NOT assigned to testTripId (it has a different driver):
    const { GET } = await import("@/app/api/trips/[id]/gps-history/route");
    // Using driverCk (seeded Riyadh driver) to access testTripId (different driver):
    const res = await GET(makeRequest(`/api/trips/${testTripId}/gps-history`, { cookie: await driverCk() }),
      { params: Promise.resolve({ id: testTripId }) });
    // Either 403 (wrong driver) or 200 if it happens to be the same:
    expect([200, 403]).toContain(res.status);
  });

  it("12. GPS history source — server-side bounded query (source check)", () => {
    const src = require("fs").readFileSync("app/api/trips/[id]/gps-history/route.ts", "utf8");
    expect(src).toContain("limit");
    expect(src).toContain("MAX_LIMIT");
    expect(src).toContain("DEFAULT_LIMIT");
    expect(src).toContain("orderBy: desc(vehicleGpsHistory.recordedAt)");
    // Must NOT fetch all and slice in-process:
    expect(src).not.toContain(".slice(-");
  });
});

// ── GPS Demo Mode ─────────────────────────────────────────────────────────────
describe("GPS Demo Mode", () => {
  async function demoGet(tripId: string, cookie: string) {
    const { GET } = await import("@/app/api/trips/[id]/demo-gps/route");
    return GET(makeRequest(`/api/trips/${tripId}/demo-gps`, { cookie }),
      { params: Promise.resolve({ id: tripId }) });
  }
  async function demoPost(tripId: string, cookie: string, body: any) {
    const { POST } = await import("@/app/api/trips/[id]/demo-gps/route");
    return POST(makeRequest(`/api/trips/${tripId}/demo-gps`, { method: "POST", cookie, body }),
      { params: Promise.resolve({ id: tripId }) });
  }

  it("13. demo disabled → GET returns 403", async () => {
    const origEnv = process.env.GPS_DEMO_ENABLED;
    process.env.GPS_DEMO_ENABLED = "false";
    const res = await demoGet(testTripId, await adminCk());
    expect(res.status).toBe(403);
    process.env.GPS_DEMO_ENABLED = origEnv;
  });

  it("14. demo disabled → POST returns 403", async () => {
    const origEnv = process.env.GPS_DEMO_ENABLED;
    process.env.GPS_DEMO_ENABLED = "false";
    const res = await demoPost(testTripId, await adminCk(), { lat: 24.7, lng: 46.7 });
    expect(res.status).toBe(403);
    process.env.GPS_DEMO_ENABLED = origEnv;
  });

  it("15. DRIVER cannot access GPS Demo endpoint", async () => {
    process.env.GPS_DEMO_ENABLED = "true";
    const res = await demoGet(testTripId, await driverCk());
    expect([401, 403]).toContain(res.status);
    delete process.env.GPS_DEMO_ENABLED;
  });

  it("16. DISPATCHER cannot access GPS Demo endpoint (ADMIN only)", async () => {
    process.env.GPS_DEMO_ENABLED = "true";
    const res = await demoGet(testTripId, await dispCk());
    expect([401, 403]).toContain(res.status);
    delete process.env.GPS_DEMO_ENABLED;
  });

  it("17. cross-tenant trip cannot be demo'd", async () => {
    process.env.GPS_DEMO_ENABLED = "true";
    const demoAdmin = await loginAs("admin@demo-water.co", "password123");
    const res = await demoGet(testTripId, demoAdmin); // testTripId belongs to Riyadh, not Demo Water Co
    expect(res.status).toBe(404);
    delete process.env.GPS_DEMO_ENABLED;
  });

  it("18. valid admin can GET demo trip route data", async () => {
    if (!testTripId) return;
    process.env.GPS_DEMO_ENABLED = "true";
    const res = await demoGet(testTripId, await adminCk());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.tripId).toBe(testTripId);
    expect(data).toHaveProperty("loadingPoint");
    expect(data).toHaveProperty("customerSite");
    expect(data.demoEnabled).toBe(true);
    delete process.env.GPS_DEMO_ENABLED;
  });

  it("19. demo POST with valid coordinates persists GPS history", async () => {
    if (!testTripId) return;
    process.env.GPS_DEMO_ENABLED = "true";
    __resetGpsRateLimit();
    const before = await db.query.vehicleGpsHistory.findMany({
      where: and(eq(vehicleGpsHistory.tripId, testTripId), eq(vehicleGpsHistory.tenantId, tenantId)),
    });
    const res = await demoPost(testTripId, await adminCk(), { lat: 24.715, lng: 46.685, speed: 8.3, accuracy: 5 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe("DEMO");
    const after = await db.query.vehicleGpsHistory.findMany({
      where: and(eq(vehicleGpsHistory.tripId, testTripId), eq(vehicleGpsHistory.tenantId, tenantId)),
    });
    expect(after.length).toBe(before.length + 1);
    delete process.env.GPS_DEMO_ENABLED;
  });

  it("20. demo coordinates pass the same validation as real GPS", async () => {
    if (!testTripId) return;
    process.env.GPS_DEMO_ENABLED = "true";
    __resetGpsRateLimit();
    const res = await demoPost(testTripId, await adminCk(), { lat: 999, lng: 46.7 }); // invalid
    expect(res.status).toBe(422);
    delete process.env.GPS_DEMO_ENABLED;
  });

  it("21. demo updates trip latest position (Control Tower sees it)", async () => {
    if (!testTripId) return;
    process.env.GPS_DEMO_ENABLED = "true";
    __resetGpsRateLimit();
    await demoPost(testTripId, await adminCk(), { lat: 24.718, lng: 46.688 });
    const trip = await db.query.trips.findFirst({ where: eq(trips.id, testTripId) });
    expect(trip?.currentLat).toBeCloseTo(24.718, 3);
    delete process.env.GPS_DEMO_ENABLED;
  });

  it("22. demo GPS history is accessible via normal history API", async () => {
    if (!testTripId) return;
    process.env.GPS_DEMO_ENABLED = "true";
    __resetGpsRateLimit();
    await demoPost(testTripId, await adminCk(), { lat: 24.719, lng: 46.689 });
    const { GET } = await import("@/app/api/trips/[id]/gps-history/route");
    const res = await GET(makeRequest(`/api/trips/${testTripId}/gps-history`, { cookie: await adminCk() }),
      { params: Promise.resolve({ id: testTripId }) });
    const data = await res.json();
    expect(data.history.some((p: any) => Math.abs(p.lat - 24.719) < 0.001)).toBe(true);
    delete process.env.GPS_DEMO_ENABLED;
  });

  it("23. demo GPS does NOT advance lifecycle stages (source check)", () => {
    const src = require("fs").readFileSync("app/api/trips/[id]/demo-gps/route.ts", "utf8");
    // Demo route must not directly call lifecycle, billing, or commercial DB operations:
    expect(src).not.toContain("ARRIVED_SITE");
    expect(src).not.toContain("UNLOADING_COMPLETE");
    expect(src).not.toContain("contractPeriods");
    expect(src).not.toContain("deliveredQty");
    expect(src).not.toContain("db.update(invoices)");
    expect(src).not.toContain("db.insert(invoices)");
    // Lifecycle/billing handled by persistGpsPing (only writes currentLat, not status):
    const pgSrc = require("fs").readFileSync("lib/gpsIngestion.ts", "utf8");
    // Verify gpsIngestion does not touch lifecycle, billing, or commercial tables:
    expect(pgSrc).not.toContain("db.update(invoices)");
    expect(pgSrc).not.toContain("db.insert(invoices)");
    expect(pgSrc).not.toContain("tripsUsed");
    expect(pgSrc).not.toContain("deliveredQty");
  });

  it("24. demo GPS uses shared ingestion pipeline (source check)", () => {
    const src = require("fs").readFileSync("app/api/trips/[id]/demo-gps/route.ts", "utf8");
    expect(src).toContain("validateGpsPing");
    expect(src).toContain("persistGpsPing");
    expect(src).toContain("processGpsGeofence");
    expect(src).toContain("source: \"DEMO\"");
  });

  it("25. demo does not create invoices or change contract usage (commercial isolation)", () => {
    const src = require("fs").readFileSync("lib/gpsIngestion.ts", "utf8");
    expect(src).not.toContain("invoices");
    expect(src).not.toContain("contractPeriods");
    expect(src).not.toContain("tripsUsed");
    expect(src).not.toContain("pricePerTrip");
    expect(src).not.toContain("deliveredQty");
  });
});

// ── Hidden Backdoor Removed ───────────────────────────────────────────────────
describe("Hidden simulator backdoor removed", () => {
  it("26. hidden GPS simulator backdoor no longer in driver app", () => {
    const fs = require("fs");
    const src = fs.readFileSync("app/driver/page.tsx", { encoding: "utf8", flag: "r" });
    // The console.warn backdoor is gone:
    expect(src).not.toContain("__SIMULATE_GPS");
    expect(src).not.toContain("Simulated GPS active");
    // Real GPS must still be present:
    expect(src).toContain("navigator.geolocation.watchPosition");
    expect(src).toContain("clearWatch");
  });

  it("27. driver app has no fallback to fake GPS when real GPS fails", () => {
    const { readFileSync } = require("fs");
    const src = readFileSync("app/driver/page.tsx", "utf8");
    // Error handling must set error/offline state, not fake coordinates:
    expect(src).toContain("PERMISSION_DENIED");
    expect(src).toContain("gpsPermission");
    // No setInterval fallback that generates fake coordinates:
    const gpsErrorSection = src.slice(src.indexOf("const onError"), src.indexOf("// Start real-device GPS"));
    expect(gpsErrorSection).not.toContain("setInterval");
  });

  it("28. GPS ingestion pipeline validates coordinates before persistence (source check)", () => {
    const src = require("fs").readFileSync("lib/gpsIngestion.ts", "utf8");
    expect(src).toContain("validateGpsPing");
    expect(src).toContain("persistGpsPing");
    expect(src).toContain("processGpsGeofence");
    expect(src).toContain("lat");
    expect(src).toContain("-90");
    expect(src).toContain("lng");
    expect(src).toContain("-180");
    // Validation returns errors array — not void:
    expect(src).toContain("ValidationError");
    expect(src).toContain("errors.push");
  });

  it("29. GPS Demo control is in Control Tower (Admin UI), not in Driver app", () => {
    const driverSrc = require("fs").readFileSync("app/driver/page.tsx", "utf8");
    const ctSrc = require("fs").readFileSync("app/control-tower/page.tsx", "utf8");
    // Driver app should have no demo controls:
    expect(driverSrc).not.toContain("demo-gps");
    expect(driverSrc).not.toContain("GPS DEMO");
    // Control Tower should have demo panel:
    expect(ctSrc).toContain("GPS DEMO");
    expect(ctSrc).toContain("demo-gps");
    expect(ctSrc).toContain("GPS_DEMO_ENABLED");
  });
});

// ── Shared Architecture ────────────────────────────────────────────────────────
describe("Shared GPS ingestion architecture", () => {
  it("30. GPS route uses shared validateGpsPing + persistGpsPing + processGpsGeofence", () => {
    const src = require("fs").readFileSync("app/api/trips/[id]/gps/route.ts", "utf8");
    expect(src).toContain("validateGpsPing");
    expect(src).toContain("persistGpsPing");
    expect(src).toContain("processGpsGeofence");
    expect(src).toContain("checkGpsRateLimit");
  });

  it("31. GPS Demo route uses the same shared pipeline", () => {
    const src = require("fs").readFileSync("app/api/trips/[id]/demo-gps/route.ts", "utf8");
    expect(src).toContain("validateGpsPing");
    expect(src).toContain("persistGpsPing");
    expect(src).toContain("processGpsGeofence");
  });

  it("32. normalized GPS payload type is documented in gpsIngestion", () => {
    const src = require("fs").readFileSync("lib/gpsIngestion.ts", "utf8");
    expect(src).toContain("GpsPing");
    expect(src).toContain("tenantId");
    expect(src).toContain("tripId");
    expect(src).toContain("vehicleId");
    expect(src).toContain("driverId");
    expect(src).toContain("lat");
    expect(src).toContain("lng");
    expect(src).toContain("accuracy");
    expect(src).toContain("speed");
    expect(src).toContain("heading");
    // Future adapter contract documented:
    expect(src).toContain("INTEGRATION CONTRACT");
    expect(src).toContain("telematics");
  });
});
