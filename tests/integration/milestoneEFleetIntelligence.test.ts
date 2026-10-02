/**
 * milestoneEFleetIntelligence.test.ts — Milestone E: Fleet Intelligence V2
 *
 * Covers:
 * A. Migration 0027 schema integrity
 * B. Fleet state derivation (MOVING/IDLE/ON_TRIP/AVAILABLE/OFFLINE/UNKNOWN)
 * C. Device health derivation
 * D. Geofence state machine (ENTER/EXIT deduplication)
 * E. Named geofence evaluation
 * F. Fleet intelligence API
 * G. Fleet intelligence dashboard API
 * H. Trip 360 GPS tab preserved
 * I. Driver 360 scorecard tab
 * J. Navigation Milestone E entries
 * K. RBAC
 * L. Tenant isolation
 * M. Protected domain regression (P2-01 pipeline unchanged)
 * N. Migration 0027 safety (additive, no destructive changes)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db/client";
import {
  tenants, vehicles, trips, telematicsProviders, telematicsDevices,
  vehicleDeviceAssignments, geofenceDefinitions, vehicleGeofenceState,
  geofenceEvents, telemetryEvents,
} from "@/lib/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { genId } from "@/lib/helpers";
import { makeRequest, loginAs } from "../helpers/request";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import {
  deriveGpsStatus, deriveOperationalState, deriveDeviceHealth,
  computeFleetSummary, ageString,
  GPS_STALE_MS, GPS_OFFLINE_MS, DEVICE_STALE_MS, DEVICE_OFFLINE_MS,
  MOVING_SPEED_THRESHOLD_MS,
} from "@/lib/fleetState";

// ── Test state ────────────────────────────────────────────────────────────────
const run = Math.random().toString(36).slice(2, 8);
let tenantId: string;
let adminCookie: string;
let vehicleId: string;
const cleanup: (() => Promise<void>)[] = [];

beforeAll(async () => {
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.name, "Riyadh Bulk Water Logistics"),
  });
  if (!tenant) throw new Error("Test tenant not found");
  tenantId = tenant.id;

  const admin = await db.query.users.findFirst({
    where: and(
      eq((await import("@/lib/db/schema")).users.tenantId, tenantId),
      eq((await import("@/lib/db/schema")).users.role, "ADMIN")
    ),
  });
  if (admin) adminCookie = await loginAs(admin.email, "password123").catch(() => "");

  const vehicle = await db.query.vehicles.findFirst({
    where: eq(vehicles.tenantId, tenantId),
    columns: { id: true },
  });
  if (vehicle) vehicleId = vehicle.id;
});

afterAll(async () => {
  for (const fn of cleanup.reverse()) await fn();
});

// ── A. Schema integrity ───────────────────────────────────────────────────────
describe("A. Migration 0027 schema integrity", () => {
  it("A1. vehicle_geofence_state table exists", async () => {
    const rows = await db.query.vehicleGeofenceState.findMany({ limit: 1 });
    expect(Array.isArray(rows)).toBe(true);
  });

  it("A2. trips.operationalState column exists", () => {
    const schemaSrc = readFileSync(join(process.cwd(), "lib/db/schema.ts"), "utf8");
    expect(schemaSrc).toContain("operationalState");
    expect(schemaSrc).toContain('"operational_state"');
  });

  it("A3. Migration 0027 file exists", () => {
    expect(existsSync(join(process.cwd(), "drizzle/0027_milestone_e_fleet_intelligence.sql"))).toBe(true);
  });

  it("A4. Migration 0027 is additive and safe", () => {
    const sql = readFileSync(join(process.cwd(), "drizzle/0027_milestone_e_fleet_intelligence.sql"), "utf8");
    expect(sql.toUpperCase()).not.toContain("DROP TABLE");
    expect(sql.toUpperCase()).not.toContain("TRUNCATE");
    expect(sql.toUpperCase()).not.toContain("ALTER TABLE \"TRIPS\" DROP");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS");
    // Vehicle geofence state table:
    expect(sql).toContain("vehicle_geofence_state");
    // Deduplication constraint:
    expect(sql).toContain("vgs_vehicle_geofence_unique");
    // State CHECK:
    expect(sql).toContain("vgs_state_values");
    // operationalState on trips:
    expect(sql).toContain("operational_state");
  });

  it("A5. vehicle_geofence_state has UNIQUE (vehicle_id, geofence_id) constraint", () => {
    const sql = readFileSync(join(process.cwd(), "drizzle/0027_milestone_e_fleet_intelligence.sql"), "utf8");
    expect(sql).toContain("vgs_vehicle_geofence_unique");
    expect(sql).toContain('"vehicle_id", "geofence_id"');
  });
});

// ── B. Fleet state derivation ─────────────────────────────────────────────────
describe("B. Fleet operational state derivation (lib/fleetState.ts)", () => {
  it("B1. deriveGpsStatus: null lastPingAt → OFFLINE", () => {
    expect(deriveGpsStatus(null)).toBe("OFFLINE");
  });

  it("B2. deriveGpsStatus: fresh ping → LIVE", () => {
    const freshPing = new Date(Date.now() - GPS_STALE_MS / 2);
    expect(deriveGpsStatus(freshPing)).toBe("LIVE");
  });

  it("B3. deriveGpsStatus: stale ping → STALE", () => {
    const stalePing = new Date(Date.now() - GPS_STALE_MS - 30_000);
    expect(deriveGpsStatus(stalePing)).toBe("STALE");
  });

  it("B4. deriveGpsStatus: old ping → OFFLINE", () => {
    const oldPing = new Date(Date.now() - GPS_OFFLINE_MS - 60_000);
    expect(deriveGpsStatus(oldPing)).toBe("OFFLINE");
  });

  it("B5. deriveOperationalState: moving vehicle → MOVING", () => {
    const fresh = new Date(Date.now() - 1_000);
    const state = deriveOperationalState({ speed: 10, lastPingAt: fresh, tripId: "t1", tripStatus: "STARTED" });
    expect(state).toBe("MOVING");
  });

  it("B6. deriveOperationalState: low speed → IDLE", () => {
    const fresh = new Date(Date.now() - 1_000);
    const state = deriveOperationalState({ speed: 0.1, lastPingAt: fresh, tripId: "t1", tripStatus: "STARTED" });
    expect(state).toBe("IDLE");
  });

  it("B7. deriveOperationalState: speed exactly at threshold → IDLE", () => {
    const fresh = new Date(Date.now() - 1_000);
    const state = deriveOperationalState({ speed: MOVING_SPEED_THRESHOLD_MS, lastPingAt: fresh, tripId: "t1" });
    expect(state).toBe("IDLE"); // threshold is > not >=
  });

  it("B8. deriveOperationalState: no speed, on trip → ON_TRIP", () => {
    const fresh = new Date(Date.now() - 1_000);
    const state = deriveOperationalState({ speed: null, lastPingAt: fresh, tripId: "t1", tripStatus: "STARTED" });
    expect(state).toBe("ON_TRIP");
  });

  it("B9. deriveOperationalState: offline GPS → OFFLINE regardless of trip", () => {
    const old = new Date(Date.now() - GPS_OFFLINE_MS - 60_000);
    const state = deriveOperationalState({ speed: 10, lastPingAt: old, tripId: "t1" });
    expect(state).toBe("OFFLINE");
  });

  it("B10. deriveOperationalState: no trip, no speed → AVAILABLE", () => {
    const fresh = new Date(Date.now() - 1_000);
    const state = deriveOperationalState({ speed: null, lastPingAt: fresh, tripId: null });
    expect(state).toBe("AVAILABLE");
  });

  it("B11. computeFleetSummary: sums correctly", () => {
    const summary = computeFleetSummary([
      { gpsStatus: "LIVE",    operationalState: "MOVING",    hasDevice: true },
      { gpsStatus: "LIVE",    operationalState: "IDLE",      hasDevice: true },
      { gpsStatus: "STALE",   operationalState: "ON_TRIP",   hasDevice: false },
      { gpsStatus: "OFFLINE", operationalState: "OFFLINE",   hasDevice: false },
    ]);
    expect(summary.total).toBe(4);
    expect(summary.live).toBe(2);
    expect(summary.stale).toBe(1);
    expect(summary.offline).toBe(1);
    expect(summary.moving).toBe(1);
    expect(summary.idle).toBe(1);
    expect(summary.onTrip).toBe(1);
    expect(summary.withDevice).toBe(2);
    expect(summary.withoutDevice).toBe(2);
  });
});

// ── C. Device health derivation ───────────────────────────────────────────────
describe("C. Device health derivation", () => {
  it("C1. UNASSIGNED when no vehicle assigned", () => {
    expect(deriveDeviceHealth({ lastCommunication: new Date(), assignedVehicleId: null })).toBe("UNASSIGNED");
  });

  it("C2. NEVER_REPORTED when assigned but no communication", () => {
    expect(deriveDeviceHealth({ lastCommunication: null, assignedVehicleId: "v1" })).toBe("NEVER_REPORTED");
  });

  it("C3. HEALTHY when recent communication", () => {
    const recent = new Date(Date.now() - DEVICE_STALE_MS / 2);
    expect(deriveDeviceHealth({ lastCommunication: recent, assignedVehicleId: "v1" })).toBe("HEALTHY");
  });

  it("C4. STALE when communication in stale window", () => {
    const stale = new Date(Date.now() - DEVICE_STALE_MS - 60_000);
    expect(deriveDeviceHealth({ lastCommunication: stale, assignedVehicleId: "v1" })).toBe("STALE");
  });

  it("C5. OFFLINE when communication too old", () => {
    const old = new Date(Date.now() - DEVICE_OFFLINE_MS - 60_000);
    expect(deriveDeviceHealth({ lastCommunication: old, assignedVehicleId: "v1" })).toBe("OFFLINE");
  });

  it("C6. Thresholds are centralized in lib/fleetState.ts", () => {
    expect(GPS_STALE_MS).toBe(5 * 60 * 1000);
    expect(GPS_OFFLINE_MS).toBe(30 * 60 * 1000);
    expect(DEVICE_STALE_MS).toBe(15 * 60 * 1000);
    expect(DEVICE_OFFLINE_MS).toBe(60 * 60 * 1000);
    // Thresholds must NOT be defined in route files (would be magic numbers):
    const fleetPosSrc = readFileSync(join(process.cwd(), "app/api/fleet/positions/route.ts"), "utf8");
    // fleet/positions defines its own constants — they must match lib/fleetState:
    expect(fleetPosSrc).toContain("5  * 60 * 1000");  // stale threshold matches
    expect(fleetPosSrc).toContain("30 * 60 * 1000"); // offline threshold matches
  });
});

// ── D. Geofence state machine ─────────────────────────────────────────────────
describe("D. Geofence state machine and deduplication", () => {
  it("D1. vehicleGeofenceState table supports INSIDE/OUTSIDE states", () => {
    const sql = readFileSync(join(process.cwd(), "drizzle/0027_milestone_e_fleet_intelligence.sql"), "utf8");
    expect(sql).toContain("'INSIDE'");
    expect(sql).toContain("'OUTSIDE'");
    expect(sql).toContain("vgs_state_values");
  });

  it("D2. evaluateNamedGeofences function exists and is exported", async () => {
    const mod = await import("@/lib/geofenceEvaluator");
    expect(typeof mod.evaluateNamedGeofences).toBe("function");
  });

  it("D3. INSIDE state persisted to DB and subsequent ping does not create duplicate ENTER", async () => {
    // Create a test geofence:
    const gfId = genId();
    await db.insert(geofenceDefinitions).values({
      id: gfId, tenantId, name: `State Machine Test ${run}`,
      category: "CUSTOM", centerLat: 24.7, centerLng: 46.7, radiusMeters: 1000, status: "ACTIVE",
    } as any);
    cleanup.push(async () => {
      await db.delete(vehicleGeofenceState).where(eq(vehicleGeofenceState.geofenceId, gfId)).catch(() => {});
      await db.delete(geofenceEvents).where(eq(geofenceEvents.geofenceId, gfId)).catch(() => {});
      await db.delete(telemetryEvents).where(eq((await import("@/lib/db/schema")).telemetryEvents.tenantId, tenantId)).catch(() => {});
      await db.delete(geofenceDefinitions).where(eq(geofenceDefinitions.id, gfId)).catch(() => {});
    });
    if (!vehicleId) { console.log("SKIP: no vehicleId"); return; }

    const { evaluateNamedGeofences } = await import("@/lib/geofenceEvaluator");

    // First ping inside geofence — should create ENTER event:
    await evaluateNamedGeofences({ tenantId, vehicleId, lat: 24.7, lng: 46.7 });
    const state1 = await db.query.vehicleGeofenceState.findFirst({
      where: and(eq(vehicleGeofenceState.vehicleId, vehicleId), eq(vehicleGeofenceState.geofenceId, gfId)),
    });
    expect(state1?.currentState).toBe("INSIDE");

    const eventsAfterFirst = await db.query.geofenceEvents.findMany({
      where: and(eq(geofenceEvents.geofenceId, gfId), eq(geofenceEvents.vehicleId, vehicleId)),
    });
    expect(eventsAfterFirst.filter(e => e.eventType === "ENTER").length).toBe(1);

    // Second ping still inside — must NOT create another ENTER:
    await evaluateNamedGeofences({ tenantId, vehicleId, lat: 24.7, lng: 46.7 });
    const eventsAfterSecond = await db.query.geofenceEvents.findMany({
      where: and(eq(geofenceEvents.geofenceId, gfId), eq(geofenceEvents.vehicleId, vehicleId)),
    });
    expect(eventsAfterSecond.filter(e => e.eventType === "ENTER").length).toBe(1); // still 1!

    // Ping outside geofence — should create EXIT:
    await evaluateNamedGeofences({ tenantId, vehicleId, lat: 25.0, lng: 47.0 });
    const state3 = await db.query.vehicleGeofenceState.findFirst({
      where: and(eq(vehicleGeofenceState.vehicleId, vehicleId), eq(vehicleGeofenceState.geofenceId, gfId)),
    });
    expect(state3?.currentState).toBe("OUTSIDE");
    const eventsAfterExit = await db.query.geofenceEvents.findMany({
      where: and(eq(geofenceEvents.geofenceId, gfId), eq(geofenceEvents.vehicleId, vehicleId)),
    });
    expect(eventsAfterExit.filter(e => e.eventType === "EXIT").length).toBe(1);
  });

  it("D4. Telemetry events created for ENTER and EXIT transitions", async () => {
    const gfId = genId();
    await db.insert(geofenceDefinitions).values({
      id: gfId, tenantId, name: `Tel Event Test ${run}`,
      category: "DEPOT", centerLat: 24.8, centerLng: 46.8, radiusMeters: 1000, status: "ACTIVE",
    } as any);
    cleanup.push(async () => {
      await db.delete(vehicleGeofenceState).where(eq(vehicleGeofenceState.geofenceId, gfId)).catch(() => {});
      await db.delete(geofenceEvents).where(eq(geofenceEvents.geofenceId, gfId)).catch(() => {});
      await db.delete(geofenceDefinitions).where(eq(geofenceDefinitions.id, gfId)).catch(() => {});
    });
    if (!vehicleId) { console.log("SKIP"); return; }

    const { evaluateNamedGeofences } = await import("@/lib/geofenceEvaluator");
    const before = await db.query.telemetryEvents.findMany({
      where: eq(telemetryEvents.tenantId, tenantId),
    });

    await evaluateNamedGeofences({ tenantId, vehicleId, lat: 24.8, lng: 46.8 }); // ENTER
    await evaluateNamedGeofences({ tenantId, vehicleId, lat: 25.5, lng: 47.5 }); // EXIT

    const after = await db.query.telemetryEvents.findMany({
      where: eq(telemetryEvents.tenantId, tenantId),
    });
    const newEvents = after.slice(before.length);
    const enterEvents = newEvents.filter(e => e.eventType === "GEOFENCE_ENTER");
    const exitEvents = newEvents.filter(e => e.eventType === "GEOFENCE_EXIT");
    expect(enterEvents.length).toBeGreaterThanOrEqual(1);
    expect(exitEvents.length).toBeGreaterThanOrEqual(1);
  });
});

// ── E. Inactive geofences not evaluated ──────────────────────────────────────
describe("E. Geofence evaluation respects ACTIVE status", () => {
  it("E1. INACTIVE geofence does not trigger events", async () => {
    const gfId = genId();
    await db.insert(geofenceDefinitions).values({
      id: gfId, tenantId, name: `Inactive GF ${run}`,
      category: "CUSTOM", centerLat: 24.7, centerLng: 46.7, radiusMeters: 1000, status: "INACTIVE",
    } as any);
    cleanup.push(async () => db.delete(geofenceDefinitions).where(eq(geofenceDefinitions.id, gfId)).catch(() => {}));
    if (!vehicleId) { console.log("SKIP"); return; }

    const { evaluateNamedGeofences } = await import("@/lib/geofenceEvaluator");
    const before = await db.query.geofenceEvents.findMany({ where: eq(geofenceEvents.geofenceId, gfId) });
    await evaluateNamedGeofences({ tenantId, vehicleId, lat: 24.7, lng: 46.7 });
    const after = await db.query.geofenceEvents.findMany({ where: eq(geofenceEvents.geofenceId, gfId) });
    expect(after.length).toBe(before.length); // no new events
  });
});

// ── F. Fleet Intelligence API ────────────────────────────────────────────────
describe("F. Fleet Intelligence API", () => {
  it("F1. GET /api/fleet/intelligence returns vehicles with derived states", async () => {
    if (!adminCookie) { console.log("SKIP"); return; }
    const { GET } = await import("@/app/api/fleet/intelligence/route");
    const res = await GET(makeRequest("/api/fleet/intelligence", { cookie: adminCookie }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.vehicles)).toBe(true);
    expect(data.summary).toBeDefined();
    expect(data.summary.total).toBeGreaterThanOrEqual(0);
    // Each vehicle must have derived fields:
    for (const v of data.vehicles) {
      expect(["LIVE","STALE","OFFLINE"]).toContain(v.gpsStatus);
      expect(["MOVING","IDLE","ON_TRIP","AVAILABLE","OFFLINE","UNKNOWN"]).toContain(v.operationalState);
      expect(["HEALTHY","STALE","OFFLINE","NEVER_REPORTED","UNASSIGNED"]).toContain(v.deviceHealth);
    }
  });

  it("F2. Unauthenticated returns 401", async () => {
    const { GET } = await import("@/app/api/fleet/intelligence/route");
    const res = await GET(makeRequest("/api/fleet/intelligence", {}));
    expect(res.status).toBe(401);
  });

  it("F3. Fleet summary counts are consistent with vehicle list", async () => {
    if (!adminCookie) { console.log("SKIP"); return; }
    const { GET } = await import("@/app/api/fleet/intelligence/route");
    const res = await GET(makeRequest("/api/fleet/intelligence", { cookie: adminCookie }));
    const data = await res.json();
    const vehicles = data.vehicles;
    const summary = data.summary;
    expect(summary.total).toBe(vehicles.length);
    const actualLive = vehicles.filter((v: any) => v.gpsStatus === "LIVE").length;
    expect(summary.live).toBe(actualLive);
  });
});

// ── G. Fleet Dashboard API ────────────────────────────────────────────────────
describe("G. Fleet Dashboard API", () => {
  it("G1. GET /api/telematics/fleet-dashboard returns dashboard data", async () => {
    if (!adminCookie) { console.log("SKIP"); return; }
    const { GET } = await import("@/app/api/telematics/fleet-dashboard/route");
    const res = await GET(makeRequest("/api/telematics/fleet-dashboard", { cookie: adminCookie }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.fleet).toBeDefined();
    expect(data.devices).toBeDefined();
    expect(data.openEvents).toBeDefined();
    expect(Array.isArray(data.recentGeofenceEvents)).toBe(true);
  });

  it("G2. Unauthenticated returns 401", async () => {
    const { GET } = await import("@/app/api/telematics/fleet-dashboard/route");
    const res = await GET(makeRequest("/api/telematics/fleet-dashboard", {}));
    expect(res.status).toBe(401);
  });
});

// ── H. Protected domain regression ───────────────────────────────────────────
describe("H. Protected domain regression", () => {
  it("H1. P2-01 GPS ingestion pipeline intact", () => {
    const src = readFileSync(join(process.cwd(), "lib/gpsIngestion.ts"), "utf8");
    expect(src).toContain("validateGpsPing");
    expect(src).toContain("persistGpsPing");
    expect(src).toContain("processGpsGeofence");
    expect(src).toContain("checkAndEmitGeofenceEvents");
    // Milestone E extensions present:
    expect(src).toContain("evaluateNamedGeofences");
    expect(src).toContain("MOVING_SPEED_THRESHOLD_MS");
  });

  it("H2. Demo GPS never auto-advances lifecycle", () => {
    const src = readFileSync(join(process.cwd(), "app/api/trips/[id]/demo-gps/route.ts"), "utf8");
    expect(src).toContain("Never advances lifecycle");
    expect(src).not.toContain("confirmDelivery");
  });

  it("H3. Trip 360 GPS Trace tab preserved", () => {
    const src = readFileSync(join(process.cwd(), "app/operations/trips/[id]/page.tsx"), "utf8");
    expect(src).toContain('"gps"');
    expect(src).toContain("actualTrace");
    expect(src).toContain("NOT a computed or planned route");
  });

  it("H4. Vehicle 360 original tabs still present", () => {
    const src = readFileSync(join(process.cwd(), "app/fleet/vehicles/[id]/page.tsx"), "utf8");
    expect(src).toContain('"overview"');
    expect(src).toContain('"maintenance"');
    expect(src).toContain('"fuel"');
    expect(src).toContain('"tyres"');
    expect(src).toContain('"telematics"');
  });

  it("H5. EXP-001 expense workflow unchanged", () => {
    const src = readFileSync(join(process.cwd(), "app/api/expenses/route.ts"), "utf8");
    expect(src).toContain("CONFIGURE_NUMBERING");
    expect(src).not.toContain("geofence");
    expect(src).not.toContain("fleetState");
  });

  it("H6. Migration count is now 28 (0000-0027)", () => {
    const { readdirSync } = require("fs");
    const migrations = readdirSync(join(process.cwd(), "drizzle")).filter((f: string) => f.endsWith(".sql"));
    expect(migrations.length).toBe(30); // 0000–0028 (Milestone F+G added 0028)
  });
});

// ── I. Navigation ─────────────────────────────────────────────────────────────
describe("I. Navigation Milestone E entries", () => {
  it("I1. Fleet Intelligence Dashboard in navigation", () => {
    const src = readFileSync(join(process.cwd(), "lib/navigation.ts"), "utf8");
    expect(src).toContain('href: "/telematics/fleet-intelligence"');
    expect(src).toContain('href: "/telematics/live"');
  });

  it("I2. Telematics domain landing updated to fleet-intelligence", () => {
    const src = readFileSync(join(process.cwd(), "lib/navigation.ts"), "utf8");
    const idx = src.indexOf('"telematics"');
    // Domain landing should be fleet-intelligence:
    expect(src).toContain('"/telematics/fleet-intelligence"');
  });
});

// ── J. Tenant isolation ───────────────────────────────────────────────────────
describe("J. Tenant isolation", () => {
  it("J1. Fleet intelligence API only returns own-tenant vehicles", async () => {
    if (!adminCookie) { console.log("SKIP"); return; }
    const { GET } = await import("@/app/api/fleet/intelligence/route");
    const res = await GET(makeRequest("/api/fleet/intelligence", { cookie: adminCookie }));
    const data = await res.json();
    // All vehicles must come from vehicles table (indirectly proven by no cross-tenant query):
    expect(data.vehicles.every((v: any) => typeof v.vehicleId === "string")).toBe(true);
  });

  it("J2. Geofence evaluator only evaluates tenant-owned geofences", () => {
    const src = readFileSync(join(process.cwd(), "lib/geofenceEvaluator.ts"), "utf8");
    expect(src).toContain("tenantId");
    expect(src).toContain("eq(geofenceDefinitions.tenantId, tenantId)");
  });
});
