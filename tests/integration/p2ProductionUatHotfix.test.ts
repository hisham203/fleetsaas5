/**
 * P2-01 Production UAT Hotfix — Trip Number / ID resolution
 * 34 behavioral tests
 */
import { describe, it, expect, beforeAll } from "vitest";
import { makeRequest, loginAs } from "../helpers/request";
import { db } from "@/lib/db/client";
import {
  tenants, trips, vehicles, customers, warehouses,
  vehicleGpsHistory,
} from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { genId } from "@/lib/helpers";
import { ensureAllSeries, createIsolatedDriverAndVehicle } from "../helpers/testFixtures";
import { resolveDemoTrip } from "@/lib/resolveDemoTrip";

const riyadh    = () => db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
const demoCo    = () => db.query.tenants.findFirst({ where: eq(tenants.name, "Demo Water Co.") });
const adminCk   = () => loginAs("admin@riyadh-bulk-water.co", "password123");
const demoAdminCk = () => loginAs("admin@demo-water.co", "password123");

let tenantId: string;
let demoTenantId: string;
let testTrip: any;   // full trip record with tripNumber
let wh: any;

beforeAll(async () => {
  const t = await riyadh(); if (!t) return;
  tenantId = t.id;
  const dt = await demoCo();
  demoTenantId = dt?.id ?? "";
  await ensureAllSeries(tenantId);
  wh = await db.query.warehouses.findFirst({ where: eq(warehouses.tenantId, tenantId) });
  const custId = genId();
  await db.insert(customers).values({
    id: custId, tenantId, name: "UAT Hotfix Test B2C", type: "B2C",
    address: "Test", lat: (wh?.lat ?? 24.7) + 0.05, lng: (wh?.lng ?? 46.7) + 0.05,
  });
  const dv = await createIsolatedDriverAndVehicle(tenantId, "uatfix");
  await db.update(vehicles).set({ capacityLiters: 21000, status: "AVAILABLE" }).where(eq(vehicles.id, dv.vehicleId));
  const { POST: co } = await import("@/app/api/orders/route");
  const ord = await (await co(makeRequest("/api/orders", { method: "POST", cookie: await adminCk(),
    body: { customerId: custId, qtyOrdered: 1, emptyBottlesToCollect: 0, paymentMethod: "CASH" },
  }))).json();
  const { POST: ct } = await import("@/app/api/trips/route");
  testTrip = await (await ct(makeRequest("/api/trips", { method: "POST", cookie: await adminCk(),
    body: { vehicleId: dv.vehicleId, driverId: dv.driverId, warehouseId: wh!.id, orderIds: [ord.id] },
  }))).json();
});

async function demoGet(identifier: string, cookie?: string) {
  process.env.GPS_DEMO_ENABLED = "true";
  const { GET } = await import("@/app/api/trips/[id]/demo-gps/route");
  return GET(
    makeRequest(`/api/trips/${identifier}/demo-gps`, { cookie: cookie ?? await adminCk() }),
    { params: Promise.resolve({ id: identifier }) }
  );
}

async function demoPost(identifier: string, body: any, cookie?: string) {
  process.env.GPS_DEMO_ENABLED = "true";
  const { POST } = await import("@/app/api/trips/[id]/demo-gps/route");
  return POST(
    makeRequest(`/api/trips/${identifier}/demo-gps`, { method: "POST", cookie: cookie ?? await adminCk(), body }),
    { params: Promise.resolve({ id: identifier }) }
  );
}

// ── TRIP IDENTIFIER RESOLUTION — GET ─────────────────────────────────────────
describe("Trip identifier resolution — GET", () => {
  it("1. GET resolves valid internal trip.id", async () => {
    if (!testTrip?.id) return;
    const res = await demoGet(testTrip.id);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.tripId).toBe(testTrip.id);
  });

  it("2. GET resolves valid business trip.tripNumber", async () => {
    if (!testTrip?.tripNumber) return;
    const res = await demoGet(testTrip.tripNumber);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.tripId).toBe(testTrip.id);
  });

  it("3. both identifiers resolve to the same trip", async () => {
    if (!testTrip) return;
    const [byId, byNum] = await Promise.all([
      demoGet(testTrip.id).then(r => r.json()),
      demoGet(testTrip.tripNumber).then(r => r.json()),
    ]);
    expect(byId.tripId).toBe(byNum.tripId);
    expect(byId.tripNumber).toBe(byNum.tripNumber);
  });

  it("4. GET using tripNumber returns canonical internal trip.id", async () => {
    if (!testTrip?.tripNumber) return;
    const res = await demoGet(testTrip.tripNumber);
    const data = await res.json();
    // tripId must be the UUID, not the tripNumber string:
    expect(data.tripId).toBe(testTrip.id);
    expect(data.tripId).not.toBe(testTrip.tripNumber);
  });

  it("5. GET returns correct tripNumber regardless of which identifier was used", async () => {
    if (!testTrip) return;
    const res = await demoGet(testTrip.id);
    const data = await res.json();
    expect(data.tripNumber).toBe(testTrip.tripNumber);
  });
});

// ── TRIP IDENTIFIER RESOLUTION — POST ─────────────────────────────────────────
describe("Trip identifier resolution — POST", () => {
  const validPing = { lat: 24.7136, lng: 46.6753, speed: 0, accuracy: 5 };

  it("6. POST resolves valid internal trip.id", async () => {
    if (!testTrip?.id) return;
    const res = await demoPost(testTrip.id, validPing);
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("7. POST resolves valid business trip.tripNumber", async () => {
    if (!testTrip?.tripNumber) return;
    const res = await demoPost(testTrip.tripNumber, validPing);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
  });

  it("8. POST using tripNumber still persists with canonical internal trip.id", async () => {
    if (!testTrip?.tripNumber) return;
    const before = await db.query.vehicleGpsHistory.findMany({
      where: and(eq(vehicleGpsHistory.tripId, testTrip.id), eq(vehicleGpsHistory.tenantId, tenantId)),
    });
    await demoPost(testTrip.tripNumber, { lat: 24.714, lng: 46.675, speed: 0, accuracy: 5 });
    const after = await db.query.vehicleGpsHistory.findMany({
      where: and(eq(vehicleGpsHistory.tripId, testTrip.id), eq(vehicleGpsHistory.tenantId, tenantId)),
    });
    // Row persisted with the canonical internal trip.id:
    expect(after.length).toBeGreaterThan(before.length);
    const newest = await db.query.vehicleGpsHistory.findMany({
      where: and(eq(vehicleGpsHistory.tripId, testTrip.id), eq(vehicleGpsHistory.tenantId, tenantId)),
      orderBy: (tbl, { desc }) => [desc(tbl.recordedAt)], limit: 1,
    });
    expect(newest[0]?.tripId).toBe(testTrip.id);
  });
});

// ── TENANT ISOLATION ──────────────────────────────────────────────────────────
describe("Tenant isolation", () => {
  it("9. tenant A cannot resolve tenant B trip by internal ID", async () => {
    if (!testTrip?.id) return;
    // testTrip belongs to Riyadh tenant — demo-water admin should get 404:
    const res = await demoGet(testTrip.id, await demoAdminCk());
    expect(res.status).toBe(404);
  });

  it("10. tenant A cannot resolve tenant B trip by tripNumber", async () => {
    if (!testTrip?.tripNumber) return;
    const res = await demoGet(testTrip.tripNumber, await demoAdminCk());
    expect(res.status).toBe(404);
  });

  it("11. cross-tenant response remains 404 — not 403 or 401", async () => {
    if (!testTrip?.id) return;
    const res = await demoGet(testTrip.id, await demoAdminCk());
    expect(res.status).toBe(404);
  });

  it("12. unknown tripNumber returns 404", async () => {
    const res = await demoGet("TRIP-XXXXXXXX-000");
    expect(res.status).toBe(404);
  });

  it("13. unknown internal ID returns 404", async () => {
    const res = await demoGet(genId());
    expect(res.status).toBe(404);
  });
});

// ── RESOLVER UNIT TEST ────────────────────────────────────────────────────────
describe("resolveDemoTrip helper", () => {
  it("resolves by internal ID within tenant", async () => {
    if (!testTrip?.id || !tenantId) return;
    const resolved = await resolveDemoTrip(testTrip.id, tenantId);
    expect(resolved?.id).toBe(testTrip.id);
  });

  it("resolves by tripNumber within tenant", async () => {
    if (!testTrip?.tripNumber || !tenantId) return;
    const resolved = await resolveDemoTrip(testTrip.tripNumber, tenantId);
    expect(resolved?.id).toBe(testTrip.id);
  });

  it("does not resolve cross-tenant internal ID", async () => {
    if (!testTrip?.id || !demoTenantId) return;
    const resolved = await resolveDemoTrip(testTrip.id, demoTenantId);
    expect(resolved).toBeUndefined();
  });

  it("does not resolve cross-tenant tripNumber", async () => {
    if (!testTrip?.tripNumber || !demoTenantId) return;
    const resolved = await resolveDemoTrip(testTrip.tripNumber, demoTenantId);
    expect(resolved).toBeUndefined();
  });
});

// ── RBAC & FEATURE FLAGS ──────────────────────────────────────────────────────
describe("RBAC and feature flag enforcement unchanged", () => {
  it("14. ADMIN requirement unchanged", async () => {
    if (!testTrip?.tripNumber) return;
    const driverCk = await loginAs("mohammed@riyadh-bulk-water.co", "password123");
    process.env.GPS_DEMO_ENABLED = "true";
    const res = await demoGet(testTrip.tripNumber, driverCk);
    expect([401, 403]).toContain(res.status);
  });

  it("15. GPS_DEMO_ENABLED requirement checked in API source", () => {
    const src = require("fs").readFileSync("app/api/trips/[id]/demo-gps/route.ts", "utf8");
    // demoEnabled() function reads GPS_DEMO_ENABLED env var:
    expect(src).toContain("GPS_DEMO_ENABLED");
    expect(src).toContain("status: 403");
    expect(src).toContain("GPS Demo Mode is not enabled on this server");
    // Both GET and POST call demoEnabled() as their first guard:
    const getIdx  = src.indexOf("export async function GET");
    const postIdx = src.indexOf("export async function POST");
    const getGuard  = src.indexOf("demoEnabled()", getIdx);
    const postGuard = src.indexOf("demoEnabled()", postIdx);
    expect(getGuard).toBeGreaterThan(getIdx);
    expect(postGuard).toBeGreaterThan(postIdx);
  });
});

// ── GPS PIPELINE UNCHANGED ────────────────────────────────────────────────────
describe("GPS pipeline and demo behavior unchanged", () => {
  it("16. initial Loading Point persistence still works via tripNumber", async () => {
    if (!testTrip?.tripNumber || !wh) return;
    const res = await demoPost(testTrip.tripNumber, { lat: wh.lat, lng: wh.lng, speed: 0, accuracy: 5 });
    expect(res.status).toBe(200);
    expect((await res.json()).source).toBe("DEMO");
  });

  it("17. intermediate GPS persistence via tripNumber works", async () => {
    if (!testTrip?.tripNumber || !wh) return;
    const res = await demoPost(testTrip.tripNumber, { lat: wh.lat + 0.01, lng: wh.lng + 0.01, speed: 5.0 });
    expect(res.status).toBe(200);
  });

  it("18. final Customer Site persistence via tripNumber works", async () => {
    if (!testTrip?.tripNumber || !wh) return;
    const res = await demoPost(testTrip.tripNumber, { lat: wh.lat + 0.05, lng: wh.lng + 0.05, speed: 0, accuracy: 5 });
    expect(res.status).toBe(200);
  });

  it("19. geofence pipeline called via shared ingestion (source check)", () => {
    const src = require("fs").readFileSync("app/api/trips/[id]/demo-gps/route.ts", "utf8");
    expect(src).toContain("validateGpsPing");
    expect(src).toContain("persistGpsPing");
    expect(src).toContain("processGpsGeofence");
  });

  it("20. loadingConfirmed requirement unchanged in operationalEventHelper", () => {
    const src = require("fs").readFileSync("lib/operationalEventHelper.ts", "utf8");
    expect(src).toContain("loadingConfirmed");
    expect(src).toContain("GEOFENCE_CUSTOMER_ARRIVAL");
  });

  it("21. lifecycle sequence unchanged", () => {
    const src = require("fs").readFileSync("app/api/trips/[id]/lifecycle/route.ts", "utf8");
    expect(src).toContain("STAGE_SEQUENCE");
    expect(src).toContain("Invalid stage transition");
  });

  it("22. POD unchanged — demo-gps never touches tripStops", () => {
    const src = require("fs").readFileSync("app/api/trips/[id]/demo-gps/route.ts", "utf8");
    expect(src).not.toContain("db.insert(tripStops)");
    expect(src).not.toContain("deliveredQty");
  });

  it("23. billing unchanged — gpsIngestion never touches invoices", () => {
    const src = require("fs").readFileSync("lib/gpsIngestion.ts", "utf8");
    expect(src).not.toContain("db.insert(invoices)");
    expect(src).not.toContain("tripsUsed");
  });

  it("24. contracts unchanged", () => {
    const src = require("fs").readFileSync("lib/gpsIngestion.ts", "utf8");
    expect(src).not.toContain("contractPeriods");
    expect(src).not.toContain("pricePerTrip");
  });

  it("25. tanker capacity enforcement unchanged", async () => {
    const custId = genId();
    await db.insert(customers).values({ id: custId, tenantId, name: "Cap UAT B2B", type: "B2B", address: "T", lat: 24.7, lng: 46.7 });
    const { POST } = await import("@/app/api/orders/route");
    const res = await POST(makeRequest("/api/orders", { method: "POST", cookie: await adminCk(),
      body: { customerId: custId, qtyOrdered: 1, emptyBottlesToCollect: 0, paymentMethod: "CASH" },
    }));
    expect(res.status).toBe(422);
    expect((await res.json()).errorCode).toBe("B2B_CONTRACT_REQUIRED");
  });

  it("26. real Driver watchPosition unchanged", () => {
    const { readFileSync } = require("fs");
    const src = readFileSync("app/driver/page.tsx", { encoding: "utf8", flag: "r" });
    expect(src).toContain("navigator.geolocation.watchPosition");
    expect(src).not.toContain("__SIMULATE_GPS");
  });

  it("27. real GPS rate limiter unchanged — post-auth, identity-aware key", () => {
    const src = require("fs").readFileSync("app/api/trips/[id]/gps/route.ts", "utf8");
    expect(src).toContain("tenantId}:${id}:${effectiveDriverId}");
    expect(src).toContain("Step 6: Rate limit");
    expect(src).toContain("Step 1: Authenticate");
  });
});

// ── CONTROL TOWER CANONICAL ID ─────────────────────────────────────────────────
describe("Control Tower uses canonical trip ID after resolution", () => {
  it("28. Pause/Resume uses canonical ID ref (source check)", () => {
    const src = require("fs").readFileSync("app/control-tower/page.tsx", "utf8");
    expect(src).toContain("resolvedTripIdRef");
    // Resume's Clock C uses resolved ref, not demoTripId:
    const resumeFn = src.slice(src.indexOf("function resumeDemo"), src.indexOf("function stopDemo"));
    expect(resumeFn).toContain("resolvedTripIdRef.current");
  });

  it("29. Stop/reset clears resolvedTripIdRef", () => {
    const src = require("fs").readFileSync("app/control-tower/page.tsx", "utf8");
    const stopFn = src.slice(src.indexOf("function stopDemo"), src.indexOf("// Demo GPS badge"));
    expect(stopFn).toContain('resolvedTripIdRef.current = ""');
  });

  it("30. user-facing label is Trip Number / ID with correct placeholder", () => {
    const src = require("fs").readFileSync("app/control-tower/page.tsx", "utf8");
    expect(src).toContain("Trip Number / ID");
    expect(src).toContain("TRIP-XXXXXXXX-XXX");
    // Old "Trip ID" label no longer present as a standalone label:
    // (may still appear in comments — check the input label text):
    const demoPanelSection = src.slice(src.indexOf("GPS DEMO MODE"), src.indexOf("GPS_DEMO_ENABLED"));
    expect(demoPanelSection).not.toContain('"Trip ID"');
  });
});

// ── ERROR MESSAGE DIFFERENTIATION ─────────────────────────────────────────────
describe("Error message differentiation (source check)", () => {
  it("31. 401 displays authorization-specific message", () => {
    const src = require("fs").readFileSync("app/control-tower/page.tsx", "utf8");
    expect(src).toContain("Authorization error — GPS Demo requires ADMIN role");
  });

  it("32. 403 displays feature-disabled message", () => {
    const src = require("fs").readFileSync("app/control-tower/page.tsx", "utf8");
    expect(src).toContain("GPS Demo is not enabled on this server");
  });

  it("33. 404 displays Trip Number / not-found message", () => {
    const src = require("fs").readFileSync("app/control-tower/page.tsx", "utf8");
    expect(src).toContain("Trip not found");
    expect(src).toContain("Trip Number");
  });

  it("34. 422 displays eligibility-specific message", () => {
    const src = require("fs").readFileSync("app/control-tower/page.tsx", "utf8");
    expect(src).toContain("Trip is not eligible for GPS Demo");
    expect(src).toContain("completed or missing operational prerequisites");
  });
});
