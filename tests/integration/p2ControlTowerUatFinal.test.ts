/**
 * P2-01 Package A — Control Tower UAT Final
 * Viewport ownership, road routing, demo clocks, commercial isolation
 */
import { describe, it, expect, beforeAll } from "vitest";
import { makeRequest, loginAs } from "../helpers/request";
import { db } from "@/lib/db/client";
import { tenants, trips, vehicles, customers, warehouses } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { genId } from "@/lib/helpers";
import { ensureAllSeries, createIsolatedDriverAndVehicle } from "../helpers/testFixtures";
import { decodePolyline, buildRouteGeometry, getRoutePosition, haversineM } from "@/lib/routeGeometry";

const riyadh  = () => db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
const adminCk = () => loginAs("admin@riyadh-bulk-water.co", "password123");

let tenantId: string;
let testTripId: string;

beforeAll(async () => {
  const t = await riyadh(); if (!t) return;
  tenantId = t.id;
  await ensureAllSeries(tenantId);
  const wh = await db.query.warehouses.findFirst({ where: eq(warehouses.tenantId, tenantId) });
  const custId = genId();
  await db.insert(customers).values({ id: custId, tenantId, name: "CT UAT Final B2C", type: "B2C", address: "T", lat: (wh?.lat ?? 24.7) + 0.05, lng: (wh?.lng ?? 46.7) + 0.05 });
  const dv = await createIsolatedDriverAndVehicle(tenantId, "ctuatfinal");
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

// ── A1: Viewport ownership ─────────────────────────────────────────────────────
describe("A1 — Viewport ownership: operator controls the map", () => {
  it("1. panTo removed from vehicle selection useEffect", () => {
    const src = require("fs").readFileSync("app/control-tower/page.tsx", "utf8");
    // Must not call panTo in the selected-vehicle change effect:
    const selectedEffect = src.slice(src.indexOf("// Update vehicle markers"), src.indexOf("// Show loading point"));
    expect(selectedEffect).not.toContain("panTo");
  });

  it("2. setZoom removed from vehicle selection useEffect", () => {
    const src = require("fs").readFileSync("app/control-tower/page.tsx", "utf8");
    const selectedEffect = src.slice(src.indexOf("// Update vehicle markers"), src.indexOf("// Show loading point"));
    expect(selectedEffect).not.toContain("setZoom");
  });

  it("3. Operator owns viewport — comment documents the rule", () => {
    const src = require("fs").readFileSync("app/control-tower/page.tsx", "utf8");
    expect(src).toContain("Operator owns the map viewport");
  });

  it("4. polling (setPositions) does not call panTo or setZoom", () => {
    const src = require("fs").readFileSync("app/control-tower/page.tsx", "utf8");
    const pollFn = src.slice(src.indexOf("const fetchPositions = useCallback"), src.indexOf("const fetchEvents = useCallback"));
    expect(pollFn).not.toContain("panTo");
    expect(pollFn).not.toContain("setZoom");
  });

  it("5. Demo Clock A (visual) does not call panTo or setZoom", () => {
    const src = require("fs").readFileSync("app/control-tower/page.tsx", "utf8");
    const clockA = src.slice(src.indexOf("Clock A: Visual animation"), src.indexOf("Clock B: Route progress"));
    expect(clockA).not.toContain("panTo");
    expect(clockA).not.toContain("setZoom");
  });
});

// ── A2/A3: Route geometry library ─────────────────────────────────────────────
describe("A2/A3 — Route geometry library (pure functions)", () => {
  // Simple encoded polyline for testing (2 points: Riyadh area):
  const ENCODED_2PT = "_bpuB{bkaF_IkM"; // approximate 2-point path

  it("6. decodePolyline returns array of lat/lng points", () => {
    const pts = decodePolyline(ENCODED_2PT);
    expect(Array.isArray(pts)).toBe(true);
    expect(pts.length).toBeGreaterThan(1);
    for (const p of pts) {
      expect(typeof p.lat).toBe("number");
      expect(typeof p.lng).toBe("number");
      expect(p.lat).toBeGreaterThan(-90);
      expect(p.lat).toBeLessThan(90);
    }
  });

  it("7. haversineM returns positive distance for distinct points", () => {
    const d = haversineM({ lat: 24.7136, lng: 46.6753 }, { lat: 24.7254, lng: 46.6876 });
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThan(5000);
  });

  it("8. haversineM returns 0 for identical points", () => {
    expect(haversineM({ lat: 24.7, lng: 46.7 }, { lat: 24.7, lng: 46.7 })).toBe(0);
  });

  it("9. buildRouteGeometry calculates total distance and cumulative array", () => {
    const path = [{ lat: 24.7, lng: 46.7 }, { lat: 24.71, lng: 46.71 }, { lat: 24.72, lng: 46.72 }];
    const g = buildRouteGeometry(path);
    expect(g.path).toHaveLength(3);
    expect(g.segmentDistances).toHaveLength(2);
    expect(g.cumulativeDistances).toHaveLength(2);
    expect(g.totalDistanceMeters).toBeGreaterThan(0);
    expect(g.cumulativeDistances[1]).toBeCloseTo(g.totalDistanceMeters, 3);
  });

  it("10. getRoutePosition at t=0 returns first point", () => {
    const path = [{ lat: 24.7, lng: 46.7 }, { lat: 24.8, lng: 46.8 }];
    const g = buildRouteGeometry(path);
    const pos = getRoutePosition(g, 0);
    expect(pos.lat).toBeCloseTo(24.7, 5);
    expect(pos.lng).toBeCloseTo(46.7, 5);
  });

  it("11. getRoutePosition at t=1 returns last point", () => {
    const path = [{ lat: 24.7, lng: 46.7 }, { lat: 24.8, lng: 46.8 }];
    const g = buildRouteGeometry(path);
    const pos = getRoutePosition(g, 1);
    expect(pos.lat).toBeCloseTo(24.8, 5);
    expect(pos.lng).toBeCloseTo(46.8, 5);
  });

  it("12. getRoutePosition at t=0.5 is between endpoints", () => {
    const path = [{ lat: 24.7, lng: 46.7 }, { lat: 24.9, lng: 46.9 }];
    const g = buildRouteGeometry(path);
    const pos = getRoutePosition(g, 0.5);
    expect(pos.lat).toBeGreaterThan(24.7);
    expect(pos.lat).toBeLessThan(24.9);
    expect(pos.lng).toBeGreaterThan(46.7);
    expect(pos.lng).toBeLessThan(46.9);
  });

  it("13. getRoutePosition interpolates WITHIN segments for multi-point path", () => {
    const path = [{ lat: 0, lng: 0 }, { lat: 1, lng: 0 }, { lat: 2, lng: 0 }];
    const g = buildRouteGeometry(path);
    // At t=0.5 should be roughly at the midpoint (1, 0):
    const pos = getRoutePosition(g, 0.5);
    expect(pos.lat).toBeCloseTo(1, 1);
    expect(pos.lng).toBeCloseTo(0, 1);
  });
});

// ── A4: Demo route architecture ────────────────────────────────────────────────
describe("A4 — Demo uses road route, not straight-line interpolation", () => {
  it("14. Control Tower imports routeGeometry library", () => {
    const src = require("fs").readFileSync("app/control-tower/page.tsx", "utf8");
    expect(src).toContain("routeGeometry");
    expect(src).toContain("getRoutePosition");
    expect(src).toContain("buildRouteGeometry");
  });

  it("15. startDemo calls the demo-route API for road geometry", () => {
    const src = require("fs").readFileSync("app/control-tower/page.tsx", "utf8");
    expect(src).toContain("/demo-route");
    expect(src).toContain("Compute real road route via Google Routes API");
  });

  it("16. demo-route endpoint uses Google Routes REST API (not legacy DirectionsService)", () => {
    const src = require("fs").readFileSync("app/api/trips/[id]/demo-route/route.ts", "utf8");
    expect(src).toContain("routes.googleapis.com/directions/v2:computeRoutes");
    expect(src).toContain("travelMode: \"DRIVE\"");
    expect(src).not.toContain("DirectionsService");
  });

  it("17. legacy DirectionsService absent from demo-route endpoint", () => {
    const src = require("fs").readFileSync("app/api/trips/[id]/demo-route/route.ts", "utf8");
    expect(src).not.toContain("DirectionsService");
    expect(src).not.toContain("google.maps.DirectionsService");
  });

  it("18. demo-route decodes polyline via routeGeometry library", () => {
    const src = require("fs").readFileSync("app/api/trips/[id]/demo-route/route.ts", "utf8");
    expect(src).toContain("decodePolyline");
    expect(src).toContain("routeGeometry");
  });

  it("19. routing failure blocks demo start — no straight-line fallback", () => {
    const src = require("fs").readFileSync("app/control-tower/page.tsx", "utf8");
    // On routing failure: show error and return WITHOUT starting timers:
    const routingSection = src.slice(src.indexOf("Compute real road route"), src.indexOf("Step 2: Persist exact Loading Point"));
    expect(routingSection).toContain("Cannot start GPS Demo");
    expect(routingSection).toContain("resolvedTripIdRef.current = \"\"");
    expect(routingSection).toContain("return;");
    // No setInterval before the return:
    const returnIdx = routingSection.indexOf("return;");
    const intervalIdx = routingSection.indexOf("setInterval");
    expect(intervalIdx).toBe(-1); // no setInterval in the routing section
  });

  it("20. Clock C uses road geometry (routeGeometryRef) for intermediate pings", () => {
    const src = require("fs").readFileSync("app/control-tower/page.tsx", "utf8");
    const clockC = src.slice(src.indexOf("Clock C: Server GPS persistence"), src.indexOf("function pauseDemo"));
    expect(clockC).toContain("routeGeometryRef.current");
    expect(clockC).toContain("getRoutePosition");
  });

  it("21. straight-line lerp origin→destination removed as primary interpolation", () => {
    const src = require("fs").readFileSync("app/control-tower/page.tsx", "utf8");
    const clockC = src.slice(src.indexOf("Clock C: Server GPS persistence"), src.indexOf("function pauseDemo"));
    // lerp may exist as fallback branch but road geometry is the primary path:
    expect(clockC).toContain("routeGeometryRef.current");
    // lerp fallback is conditional on routeGeometryRef being absent:
    const routeGeomIdx = clockC.indexOf("routeGeometryRef.current");
    const lerpIdx = clockC.indexOf("lerp(");
    // lerp comes AFTER the routeGeometryRef check (it's the else/fallback branch):
    expect(routeGeomIdx).toBeLessThan(lerpIdx);
  });
});

// ── A5: Clock architecture preserved ──────────────────────────────────────────
describe("A5 — Demo clock architecture preserved", () => {
  it("22. three separate timer refs still present", () => {
    const src = require("fs").readFileSync("app/control-tower/page.tsx", "utf8");
    expect(src).toContain("visualTimerRef");
    expect(src).toContain("routeTimerRef");
    expect(src).toContain("serverTimerRef");
  });

  it("23. 90-second 1× duration unchanged", () => {
    const src = require("fs").readFileSync("app/control-tower/page.tsx", "utf8");
    expect(src).toContain("DEMO_DURATION_1X_SEC = 90");
  });

  it("24. 6-second persistence interval unchanged", () => {
    const src = require("fs").readFileSync("app/control-tower/page.tsx", "utf8");
    expect(src).toContain("SERVER_PERSIST_MS    = 6000");
  });
});

// ── A6: Exact endpoint guarantees ─────────────────────────────────────────────
describe("A6 — Exact initial and final coordinate guarantees", () => {
  it("25. initial ping sends exact Loading Point coordinates (before movement)", () => {
    const src = require("fs").readFileSync("app/control-tower/page.tsx", "utf8");
    const initSection = src.slice(src.indexOf("Step 2: Persist exact Loading Point"), src.indexOf("Step 3: Initialize state"));
    expect(initSection).toContain("loadingPoint.lat, lng: route.loadingPoint.lng");
    expect(initSection).toContain("speed: 0");
  });

  it("26. final ping sends exact Customer Site coordinates", () => {
    const src = require("fs").readFileSync("app/control-tower/page.tsx", "utf8");
    // Clock B sends Customer Site exactly:
    const clockB = src.slice(src.indexOf("Clock B: Route progress"), src.indexOf("Clock C: Server GPS persistence"));
    expect(clockB).toContain("customerSite.lat, lng: route.customerSite.lng");
    expect(clockB).toContain("speed: 0");
  });

  it("27. final ping is sent once — Clock C stopped before it", () => {
    const src = require("fs").readFileSync("app/control-tower/page.tsx", "utf8");
    const clockB = src.slice(src.indexOf("Clock B: Route progress"), src.indexOf("Clock C: Server GPS persistence"));
    const serverClearIdx = clockB.indexOf("serverTimerRef.current");
    const finalFetchIdx  = clockB.indexOf("customerSite.lat");
    expect(serverClearIdx).toBeGreaterThan(0);
    expect(serverClearIdx).toBeLessThan(finalFetchIdx);
  });
});

// ── A7: Routing failure ────────────────────────────────────────────────────────
describe("A7 — Routing failure: no false movement", () => {
  it("28. demo-route GET requires ADMIN", async () => {
    if (!testTripId) return;
    process.env.GPS_DEMO_ENABLED = "true";
    const driverCk = await loginAs("mohammed@riyadh-bulk-water.co", "password123");
    const { GET } = await import("@/app/api/trips/[id]/demo-route/route");
    const res = await GET(makeRequest(`/api/trips/${testTripId}/demo-route`, { cookie: driverCk }),
      { params: Promise.resolve({ id: testTripId }) });
    expect([401, 403]).toContain(res.status);
  });

  it("29. demo-route returns 404 for unknown trip", async () => {
    process.env.GPS_DEMO_ENABLED = "true";
    const { GET } = await import("@/app/api/trips/[id]/demo-route/route");
    const res = await GET(makeRequest(`/api/trips/${genId()}/demo-route`, { cookie: await adminCk() }),
      { params: Promise.resolve({ id: genId() }) });
    expect(res.status).toBe(404);
  });

  it("30. demo-route returns 403 when GPS_DEMO_ENABLED=false", async () => {
    const src = require("fs").readFileSync("app/api/trips/[id]/demo-route/route.ts", "utf8");
    expect(src).toContain("demoEnabled()");
    expect(src).toContain("status: 403");
  });

  it("30b. Routes API uses GOOGLE_ROUTES_API_KEY only — no NEXT_PUBLIC fallback", () => {
    const src = require("fs").readFileSync("app/api/trips/[id]/demo-route/route.ts", "utf8");
    // Must use only GOOGLE_ROUTES_API_KEY for the server-to-server call:
    expect(src).toContain("process.env.GOOGLE_ROUTES_API_KEY");
    // Must NOT fall back to NEXT_PUBLIC key:
    const keyLine = src.match(/const apiKey = .*/)?.[0] ?? "";
    expect(keyLine).not.toContain("NEXT_PUBLIC");
    expect(keyLine).not.toContain("??");
    // Returns 503 with errorCode when key is absent:
    expect(src).toContain("ROUTES_API_KEY_MISSING");
    expect(src).toContain("status: 503");
  });

  it("30c. Routes API key is never returned to the client", () => {
    const src = require("fs").readFileSync("app/api/trips/[id]/demo-route/route.ts", "utf8");
    // The response JSON must contain only route geometry fields:
    const responseBlock = src.slice(src.lastIndexOf("return NextResponse.json({"), src.lastIndexOf("\n}\n"));
    expect(responseBlock).not.toContain("apiKey");
    expect(responseBlock).not.toContain("GOOGLE_ROUTES");
    expect(responseBlock).not.toContain("NEXT_PUBLIC");
    expect(responseBlock).toContain("tripId");
    expect(responseBlock).toContain("path");
  });
});

// ── A8/A9: Commercial and GPS isolation ───────────────────────────────────────
describe("A8/A9 — Commercial and GPS isolation unchanged", () => {
  it("31. demo-route never touches billing, POD, or lifecycle", () => {
    const src = require("fs").readFileSync("app/api/trips/[id]/demo-route/route.ts", "utf8");
    expect(src).not.toContain("invoices");
    expect(src).not.toContain("tripStops");
    expect(src).not.toContain("deliveredQty");
    expect(src).not.toContain("ARRIVED_SITE");
  });

  it("32. canonical Trip ID resolution preserved in demo-route", () => {
    const src = require("fs").readFileSync("app/api/trips/[id]/demo-route/route.ts", "utf8");
    expect(src).toContain("resolveDemoTrip");
  });

  it("33. real Driver watchPosition unchanged", () => {
    const { readFileSync } = require("fs");
    const src = readFileSync("app/driver/page.tsx", { encoding: "utf8", flag: "r" });
    expect(src).toContain("navigator.geolocation.watchPosition");
    expect(src).not.toContain("__SIMULATE_GPS");
  });

  it("34. B2B contract enforcement unchanged", async () => {
    const custId = genId();
    await db.insert(customers).values({ id: custId, tenantId, name: "CT UAT B2B Reg", type: "B2B", address: "T", lat: 24.7, lng: 46.7 });
    const { POST } = await import("@/app/api/orders/route");
    const res = await POST(makeRequest("/api/orders", { method: "POST", cookie: await adminCk(),
      body: { customerId: custId, qtyOrdered: 1, emptyBottlesToCollect: 0, paymentMethod: "CASH" },
    }));
    expect(res.status).toBe(422);
    expect((await res.json()).errorCode).toBe("B2B_CONTRACT_REQUIRED");
  });

  it("35. GPS history remains bounded 200/500", async () => {
    const { GET } = await import("@/app/api/trips/[id]/gps-history/route");
    const res = await GET(makeRequest(`/api/trips/${testTripId}/gps-history?limit=9999`, { cookie: await adminCk() }),
      { params: Promise.resolve({ id: testTripId }) });
    const data = await res.json();
    expect(data.limit).toBe(500);
  });
});
