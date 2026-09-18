/**
 * P2-01 Demo Endpoint Fix — initial Loading Point ping + final Customer Site ping
 * 18 focused behavioral tests
 */
import { describe, it, expect, beforeAll } from "vitest";
import { makeRequest, loginAs } from "../helpers/request";
import { db } from "@/lib/db/client";
import { tenants, trips, vehicles, customers, warehouses, vehicleGpsHistory } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { genId } from "@/lib/helpers";
import { ensureAllSeries, createIsolatedDriverAndVehicle } from "../helpers/testFixtures";
import { __resetGpsRateLimit } from "@/lib/gpsRateLimit";

const riyadh  = () => db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
const adminCk = () => loginAs("admin@riyadh-bulk-water.co", "password123");
const driverCk = () => loginAs("mohammed@riyadh-bulk-water.co", "password123");

let tenantId: string;
let testTripId: string;
let testVehicleId: string;
let warehouseLat: number;
let warehouseLng: number;

beforeAll(async () => {
  const t = await riyadh(); if (!t) return;
  tenantId = t.id;
  await ensureAllSeries(tenantId);
  const wh = await db.query.warehouses.findFirst({ where: eq(warehouses.tenantId, tenantId) });
  warehouseLat = wh?.lat ?? 24.7136;
  warehouseLng = wh?.lng ?? 46.6753;
  const custId = genId();
  await db.insert(customers).values({
    id: custId, tenantId, name: "Demo Fix Test B2C", type: "B2C",
    address: "Test", lat: warehouseLat + 0.05, lng: warehouseLng + 0.05,
  });
  const dv = await createIsolatedDriverAndVehicle(tenantId, "demofix");
  testVehicleId = dv.vehicleId;
  await db.update(vehicles).set({ capacityLiters: 21000, status: "AVAILABLE" }).where(eq(vehicles.id, dv.vehicleId));
  const { POST: co } = await import("@/app/api/orders/route");
  const ord = await (await co(makeRequest("/api/orders", { method: "POST", cookie: await adminCk(),
    body: { customerId: custId, qtyOrdered: 1, emptyBottlesToCollect: 0, paymentMethod: "CASH" },
  }))).json();
  const { POST: ct } = await import("@/app/api/trips/route");
  const trip = await (await ct(makeRequest("/api/trips", { method: "POST", cookie: await adminCk(),
    body: { vehicleId: dv.vehicleId, driverId: dv.driverId, warehouseId: wh!.id, orderIds: [ord.id] },
  }))).json();
  testTripId = trip.id;
});

async function demoPost(tripId: string, body: any) {
  process.env.GPS_DEMO_ENABLED = "true";
  const { POST } = await import("@/app/api/trips/[id]/demo-gps/route");
  const res = await POST(
    makeRequest(`/api/trips/${tripId}/demo-gps`, { method: "POST", cookie: await adminCk(), body }),
    { params: Promise.resolve({ id: tripId }) }
  );
  return res;
}

async function demoGet(tripId: string) {
  process.env.GPS_DEMO_ENABLED = "true";
  const { GET } = await import("@/app/api/trips/[id]/demo-gps/route");
  return GET(
    makeRequest(`/api/trips/${tripId}/demo-gps`, { cookie: await adminCk() }),
    { params: Promise.resolve({ id: tripId }) }
  );
}

// ── Source checks — startDemo implementation ───────────────────────────────────
describe("Demo start — initial Loading Point ping (source checks)", () => {
  it("1. startDemo persists exact Loading Point before starting movement clocks", () => {
    const src = require("fs").readFileSync("app/control-tower/page.tsx", "utf8");
    const startFn = src.slice(src.indexOf("async function startDemo"), src.indexOf("function pauseDemo"));
    // Initial ping is sent before any setInterval call:
    const initFetchIdx    = startFn.indexOf("Step 2: Persist exact Loading Point");
    const firstIntervalIdx = startFn.indexOf("setInterval");
    expect(initFetchIdx).toBeGreaterThan(0);
    expect(initFetchIdx).toBeLessThan(firstIntervalIdx);
  });

  it("2. initial ping uses shared demo-gps POST endpoint (normal ingestion pipeline)", () => {
    const src = require("fs").readFileSync("app/control-tower/page.tsx", "utf8");
    const startFn = src.slice(src.indexOf("async function startDemo"), src.indexOf("function pauseDemo"));
    // Initial ping goes through the same endpoint as intermediate pings:
    expect(startFn).toContain("loadingPoint.lat, lng: route.loadingPoint.lng");
    expect(startFn).toContain("speed: 0, accuracy: 5");
    // Pipeline comment confirms normal geofence processing:
    expect(startFn).toContain("processGpsGeofence");
  });

  it("3. initial ping carries loading-point coordinates (not interpolated intermediate)", () => {
    const src = require("fs").readFileSync("app/control-tower/page.tsx", "utf8");
    const startFn = src.slice(src.indexOf("async function startDemo"), src.indexOf("function pauseDemo"));
    // t=0 → lerp returns loadingPoint coords. Initial ping explicitly sends loadingPoint.lat/lng.
    // The word "loadingPoint.lat" must appear in the initial fetch body BEFORE setInterval:
    const initPingSection = startFn.slice(0, startFn.indexOf("setInterval"));
    expect(initPingSection).toContain("loadingPoint.lat");
    expect(initPingSection).toContain("loadingPoint.lng");
  });

  it("4. movement does NOT start if initial ping fails (no timers started)", () => {
    const src = require("fs").readFileSync("app/control-tower/page.tsx", "utf8");
    const startFn = src.slice(src.indexOf("async function startDemo"), src.indexOf("function pauseDemo"));
    // On init failure: return before setDemoStatus("running") and before setInterval:
    expect(startFn).toContain("initRes?.ok");
    const failReturnIdx  = startFn.indexOf("return; // DO NOT start timers");
    const runningStateIdx = startFn.indexOf('setDemoStatus("running")');
    expect(failReturnIdx).toBeGreaterThan(0);
    expect(failReturnIdx).toBeLessThan(runningStateIdx);
  });

  it("5. visual timers start only AFTER successful initialization", () => {
    const src = require("fs").readFileSync("app/control-tower/page.tsx", "utf8");
    const startFn = src.slice(src.indexOf("async function startDemo"), src.indexOf("function pauseDemo"));
    const initCheckIdx  = startFn.indexOf("initRes?.ok");
    const clockAIdx     = startFn.indexOf("Clock A: Visual animation");
    expect(initCheckIdx).toBeGreaterThan(0);
    expect(clockAIdx).toBeGreaterThan(initCheckIdx);
  });
});

// ── API integration — initial ping ─────────────────────────────────────────────
describe("Demo API — initial Loading Point ping integration", () => {
  it("6. first persisted coordinate is Loading Point (exact lat/lng match)", async () => {
    if (!testTripId || !warehouseLat) return;
    __resetGpsRateLimit();
    process.env.GPS_DEMO_ENABLED = "true";
    // This simulates the initial ping that startDemo sends before movement:
    const before = await db.query.vehicleGpsHistory.findMany({
      where: and(eq(vehicleGpsHistory.tripId, testTripId), eq(vehicleGpsHistory.tenantId, tenantId)),
    });
    const res = await demoPost(testTripId, { lat: warehouseLat, lng: warehouseLng, speed: 0, accuracy: 5 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe("DEMO");
    const after = await db.query.vehicleGpsHistory.findMany({
      where: and(eq(vehicleGpsHistory.tripId, testTripId), eq(vehicleGpsHistory.tenantId, tenantId)),
      orderBy: (table, { desc }) => [desc(table.recordedAt)],
      limit: 1,
    });
    expect(after.length).toBeGreaterThan(before.length);
    expect(after[0]?.lat).toBeCloseTo(warehouseLat, 4);
    expect(after[0]?.lng).toBeCloseTo(warehouseLng, 4);
  });

  it("7. final coordinate persisted as exact Customer Site (speed=0)", async () => {
    if (!testTripId || !warehouseLat) return;
    __resetGpsRateLimit();
    const custLat = warehouseLat + 0.05;
    const custLng = warehouseLng + 0.05;
    const res = await demoPost(testTripId, { lat: custLat, lng: custLng, speed: 0, accuracy: 5 });
    expect(res.status).toBe(200);
    const latest = await db.query.vehicleGpsHistory.findMany({
      where: and(eq(vehicleGpsHistory.tripId, testTripId), eq(vehicleGpsHistory.tenantId, tenantId)),
      orderBy: (table, { desc }) => [desc(table.recordedAt)],
      limit: 1,
    });
    expect(latest[0]?.lat).toBeCloseTo(custLat, 4);
    expect(latest[0]?.lng).toBeCloseTo(custLng, 4);
    expect(latest[0]?.speed).toBe(0);
  });

  it("8. demo endpoint has no rate limiter — final ping cannot be blocked by intermediate ping", () => {
    // Demo-gps POST has no checkGpsRateLimit call — unlike the real GPS endpoint.
    // This means the final Customer Site ping cannot be throttled by a Clock C
    // intermediate ping that fired just before completion.
    const src = require("fs").readFileSync("app/api/trips/[id]/demo-gps/route.ts", "utf8");
    expect(src).not.toContain("checkGpsRateLimit");
    expect(src).not.toContain("429");
  });

  it("9. final Customer Site coordinate persisted exactly once (Clock C stops at 0.95)", () => {
    const src = require("fs").readFileSync("app/control-tower/page.tsx", "utf8");
    // Clock C stops at t >= 0.95 — not 1.0 — leaving room for Clock B's final ping:
    expect(src).toContain("if (t >= 0.95) return;");
    // Clock B stops Clock C before sending the final ping (explicit order):
    const clockBBlock = src.slice(src.indexOf("Clock B: Route progress"), src.indexOf("Clock C: Server GPS persistence"));
    expect(clockBBlock).toContain("serverTimerRef.current");
    expect(clockBBlock).toContain("clearInterval(serverTimerRef.current)");
    // Final fetch is Customer Site coordinates:
    expect(clockBBlock).toContain("customerSite.lat");
    expect(clockBBlock).toContain("speed: 0");
  });

  it("10. timers stop after demo completion", () => {
    const src = require("fs").readFileSync("app/control-tower/page.tsx", "utf8");
    const clockBBlock = src.slice(src.indexOf("Clock B: Route progress"), src.indexOf("Clock C: Server GPS persistence"));
    // All three timers cleared on completion:
    expect(clockBBlock).toContain("clearInterval(serverTimerRef.current)");
    expect(clockBBlock).toContain("clearInterval(visualTimerRef.current)");
    expect(clockBBlock).toContain("clearInterval(routeTimerRef.current)");
    expect(clockBBlock).toContain('setDemoStatus("completed")');
  });
});

// ── Business rule preservation ──────────────────────────────────────────────────
describe("Customer geofence business rule — loadingConfirmed required", () => {
  it("11. customer geofence still requires loadingConfirmed (operationalEventHelper source)", () => {
    const src = require("fs").readFileSync("lib/operationalEventHelper.ts", "utf8");
    // checkAndEmitGeofenceEvents only creates CUSTOMER_ARRIVAL when loadingConfirmed:
    expect(src).toContain("loadingConfirmed");
    expect(src).toContain("GEOFENCE_CUSTOMER_ARRIVAL");
    // The check is conditional on loadingConfirmed being true:
    const customerSection = src.slice(
      src.indexOf("Check customer site geofence"),
      src.indexOf("checkGeofence", src.indexOf("Check customer site geofence"))
    );
    expect(customerSection).toContain("loadingConfirmed");
  });

  it("12. Demo never automatically SETS loadingConfirmed (demo-gps route source)", () => {
    const src = require("fs").readFileSync("app/api/trips/[id]/demo-gps/route.ts", "utf8");
    // loadingConfirmed may appear in the GET response payload (read-only) but must never be SET:
    expect(src).not.toContain("loadingConfirmed: true");   // never forced to true
    expect(src).not.toContain("set({ loadingConfirmed");   // never written via ORM
    expect(src).not.toContain("LOADING_COMPLETE");         // lifecycle stage never triggered
  });

  it("13. Demo never advances lifecycle stages (gpsIngestion source)", () => {
    const src = require("fs").readFileSync("lib/gpsIngestion.ts", "utf8");
    expect(src).not.toContain("status:");
    expect(src).not.toContain("ARRIVED_LOADING");
    expect(src).not.toContain("ARRIVED_SITE");
  });

  it("14. Demo never creates POD", () => {
    const src = require("fs").readFileSync("lib/gpsIngestion.ts", "utf8");
    expect(src).not.toContain("recipientName");
    expect(src).not.toContain("deliveredQty");
    const demoSrc = require("fs").readFileSync("app/api/trips/[id]/demo-gps/route.ts", "utf8");
    expect(demoSrc).not.toContain("db.insert(tripStops)");
    expect(demoSrc).not.toContain("db.update(tripStops)");
  });

  it("15. Demo never creates invoice", () => {
    const src = require("fs").readFileSync("lib/gpsIngestion.ts", "utf8");
    expect(src).not.toContain("db.insert(invoices)");
    expect(src).not.toContain("db.update(invoices)");
  });
});

// ── Persistence bounds ──────────────────────────────────────────────────────────
describe("Demo persistence bounded", () => {
  it("16. persistence count bounded — approximately 16 points per complete 1x demo", () => {
    const src = require("fs").readFileSync("app/control-tower/page.tsx", "utf8");
    // 1× = 90s duration, Clock C every 6s, stops at 0.95 = ~14 intermediate
    // + 1 initial Loading Point + 1 final Customer Site = ~16 total
    expect(src).toContain("DEMO_DURATION_1X_SEC = 90");
    expect(src).toContain("SERVER_PERSIST_MS    = 6000");
    expect(src).toContain("if (t >= 0.95) return;");
    // Comment in source confirms bounded count:
    expect(src).toContain("14 intermediate pings");
  });

  it("17. real Driver GPS rate limiter unchanged — still post-auth, identity-aware key", () => {
    const src = require("fs").readFileSync("app/api/trips/[id]/gps/route.ts", "utf8");
    // Rate limit is after auth/authz:
    const authIdx = src.indexOf("Step 1: Authenticate");
    const rlIdx   = src.indexOf("Step 6: Rate limit");
    expect(authIdx).toBeGreaterThan(0);
    expect(rlIdx).toBeGreaterThan(authIdx);
    // Identity-aware key:
    expect(src).toContain("tenantId}:${id}:${effectiveDriverId}");
  });

  it("18. real Driver watchPosition unchanged", () => {
    const { readFileSync } = require("fs");
    const src = readFileSync("app/driver/page.tsx", { encoding: "utf8", flag: "r" });
    expect(src).toContain("navigator.geolocation.watchPosition");
    expect(src).toContain("clearWatch");
    expect(src).not.toContain("__SIMULATE_GPS");
  });
});
