/**
 * milestoneFGAlertsEta.test.ts — Milestone F+G: Operational Alerts + Live ETA
 *
 * A. Schema integrity (migration 0028)
 * B. Alert engine — creation and deduplication
 * C. Alert engine — resolution
 * D. Device health cron logic
 * E. ETA engine — pure function tests
 * F. ETA engine — unavailable cases
 * G. Notifications API
 * H. Alerts API (RBAC, filters)
 * I. Trip 360 Live Execution tab
 * J. Migration 0028 safety
 * K. Protected domain regression
 * L. Tenant isolation
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db/client";
import {
  tenants, trips, vehicles, telematicsDevices, vehicleDeviceAssignments,
  telematicsProviders, notifications, telemetryEvents,
} from "@/lib/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { genId } from "@/lib/helpers";
import { makeRequest, loginAs } from "../helpers/request";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import {
  createAlertIfNotOpen, resolveOpenAlerts,
} from "@/lib/alertEngine";
import {
  etaNeedsRefresh, deriveEtaStatus,
  ETA_CACHE_TTL_SECONDS, ETA_MOVEMENT_THRESHOLD_METERS,
  ETA_DELAY_AT_RISK_MINUTES, ETA_DELAY_DELAYED_MINUTES,
} from "@/lib/etaEngine";

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
describe("A. Migration 0028 schema integrity", () => {
  it("A1. notifications has user_id, entity_type, entity_route, alert_id", async () => {
    const src = readFileSync(join(process.cwd(), "lib/db/schema.ts"), "utf8");
    expect(src).toContain("userId:");
    expect(src).toContain("entityType:");
    expect(src).toContain("entityRoute:");
    expect(src).toContain("alertId:");
  });

  it("A2. trips has ETA columns", async () => {
    const src = readFileSync(join(process.cwd(), "lib/db/schema.ts"), "utf8");
    expect(src).toContain("etaCalculatedAt");
    expect(src).toContain("etaArrivalAt");
    expect(src).toContain("baselineEtaAt");
    expect(src).toContain("etaDistanceMeters");
    expect(src).toContain("etaDurationSeconds");
  });

  it("A3. telemetry_events has resolved_by, resolved_at", async () => {
    const src = readFileSync(join(process.cwd(), "lib/db/schema.ts"), "utf8");
    expect(src).toContain("resolvedBy");
    expect(src).toContain("resolvedAt");
  });

  it("A4. Migration 0028 file exists and is additive", () => {
    const path = join(process.cwd(), "drizzle/0028_milestone_fg_alerts_eta.sql");
    expect(existsSync(path)).toBe(true);
    const sql = readFileSync(path, "utf8");
    expect(sql.toUpperCase()).not.toContain("DROP TABLE");
    expect(sql.toUpperCase()).not.toContain("TRUNCATE");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS");
    // ETA columns on trips:
    expect(sql).toContain("eta_arrival_at");
    expect(sql).toContain("baseline_eta_at");
    // Extended lifecycle on telemetry_events:
    expect(sql).toContain("resolved_by");
    // Deduplication indexes:
    expect(sql).toContain("te_open_vehicle_type_idx");
    expect(sql).toContain("te_open_device_type_idx");
  });

  it("A5. Migration count is now 29", () => {
    const { readdirSync } = require("fs");
    const count = readdirSync(join(process.cwd(), "drizzle")).filter((f: string) => f.endsWith(".sql")).length;
    expect(count).toBe(29); // 0000–0028
  });
});

// ── B. Alert engine — deduplication ──────────────────────────────────────────
describe("B. Alert engine creation and deduplication", () => {
  it("B1. createAlertIfNotOpen creates an alert and returns its ID", async () => {
    if (!vehicleId) { console.log("SKIP"); return; }
    const deviceId = genId();
    // Create a test device to reference:
    const providerId = genId();
    await db.insert(telematicsProviders).values({
      id: providerId, tenantId, name: `FG Provider ${run}`,
      providerType: "HARDWARE_DEVICE", status: "ACTIVE",
    } as any);
    await db.insert(telematicsDevices).values({
      id: deviceId, tenantId, providerId, deviceIdentifier: `FG-DEV-${run}`,
      deviceType: "GPS_TRACKER", status: "OFFLINE",
    } as any);
    cleanup.push(async () => {
      await db.delete(telematicsDevices).where(eq(telematicsDevices.id, deviceId)).catch(() => {});
      await db.delete(telematicsProviders).where(eq(telematicsProviders.id, providerId)).catch(() => {});
      await db.delete(telemetryEvents).where(eq(telemetryEvents.deviceId, deviceId)).catch(() => {});
      await db.delete(notifications).where(eq(notifications.tenantId, tenantId)).catch(() => {});
    });

    const alertId = await createAlertIfNotOpen({
      tenantId,
      eventType: "DEVICE_OFFLINE",
      severity: "WARNING",
      deviceId,
      message: `Test device offline ${run}`,
      entityType: "DEVICE",
      entityId: deviceId,
      entityRoute: "/telematics/devices",
    });
    expect(alertId).not.toBeNull();
    expect(typeof alertId).toBe("string");

    // Verify alert exists in DB:
    const alert = await db.query.telemetryEvents.findFirst({
      where: eq(telemetryEvents.id, alertId!),
    });
    expect(alert?.status).toBe("OPEN");
    expect(alert?.eventType).toBe("DEVICE_OFFLINE");
  });

  it("B2. Duplicate createAlertIfNotOpen returns null (no duplicate)", async () => {
    if (!vehicleId) { console.log("SKIP"); return; }
    const deviceId2 = genId();
    const providerId2 = genId();
    await db.insert(telematicsProviders).values({
      id: providerId2, tenantId, name: `FG Provider2 ${run}`,
      providerType: "HARDWARE_DEVICE", status: "ACTIVE",
    } as any);
    await db.insert(telematicsDevices).values({
      id: deviceId2, tenantId, providerId: providerId2, deviceIdentifier: `FG-DEV2-${run}`,
      deviceType: "GPS_TRACKER", status: "OFFLINE",
    } as any);
    cleanup.push(async () => {
      await db.delete(telematicsDevices).where(eq(telematicsDevices.id, deviceId2)).catch(() => {});
      await db.delete(telematicsProviders).where(eq(telematicsProviders.id, providerId2)).catch(() => {});
      await db.delete(telemetryEvents).where(eq(telemetryEvents.deviceId, deviceId2)).catch(() => {});
    });

    // First call — creates alert:
    const first = await createAlertIfNotOpen({
      tenantId, eventType: "DEVICE_OFFLINE", severity: "WARNING",
      deviceId: deviceId2, message: `Dedup test ${run}`,
    });
    expect(first).not.toBeNull();

    // Second call — should be deduplicated:
    const second = await createAlertIfNotOpen({
      tenantId, eventType: "DEVICE_OFFLINE", severity: "WARNING",
      deviceId: deviceId2, message: `Dedup test ${run}`,
    });
    expect(second).toBeNull(); // ← deduplication

    // Verify only one OPEN alert exists:
    const openAlerts = await db.query.telemetryEvents.findMany({
      where: and(
        eq(telemetryEvents.deviceId, deviceId2),
        eq(telemetryEvents.eventType, "DEVICE_OFFLINE"),
        eq(telemetryEvents.status, "OPEN")
      ),
    });
    expect(openAlerts.length).toBe(1); // exactly one, not two
  });
});

// ── C. Alert resolution ───────────────────────────────────────────────────────
describe("C. Alert resolution", () => {
  it("C1. resolveOpenAlerts resolves OPEN alerts for a device", async () => {
    const deviceId3 = genId();
    const providerId3 = genId();
    await db.insert(telematicsProviders).values({
      id: providerId3, tenantId, name: `FG Prov3 ${run}`,
      providerType: "HARDWARE_DEVICE", status: "ACTIVE",
    } as any);
    await db.insert(telematicsDevices).values({
      id: deviceId3, tenantId, providerId: providerId3,
      deviceIdentifier: `FG-DEV3-${run}`, deviceType: "GPS_TRACKER", status: "ACTIVE",
    } as any);
    cleanup.push(async () => {
      await db.delete(telematicsDevices).where(eq(telematicsDevices.id, deviceId3)).catch(() => {});
      await db.delete(telematicsProviders).where(eq(telematicsProviders.id, providerId3)).catch(() => {});
      await db.delete(telemetryEvents).where(eq(telemetryEvents.deviceId, deviceId3)).catch(() => {});
    });

    // Create an alert:
    await createAlertIfNotOpen({
      tenantId, eventType: "DEVICE_OFFLINE", severity: "WARNING",
      deviceId: deviceId3, message: `Resolution test ${run}`,
    });

    // Resolve it:
    const count = await resolveOpenAlerts({
      tenantId, eventType: "DEVICE_OFFLINE", deviceId: deviceId3,
    });
    expect(count).toBeGreaterThanOrEqual(1);

    // Verify it's RESOLVED now:
    const resolved = await db.query.telemetryEvents.findMany({
      where: and(
        eq(telemetryEvents.deviceId, deviceId3),
        eq(telemetryEvents.status, "RESOLVED")
      ),
    });
    expect(resolved.length).toBeGreaterThanOrEqual(1);
  });
});

// ── D. Device health cron logic (integration test) ────────────────────────────
describe("D. Device health cron logic", () => {
  it("D1. Cron endpoint requires CRON_SECRET header", async () => {
    const { GET } = await import("@/app/api/cron/device-health/route");
    const res = await GET(makeRequest("/api/cron/device-health", {}));
    // Without CRON_SECRET env set it returns 503 (not configured):
    // OR returns 401 if CRON_SECRET is set but header not provided:
    expect([401, 503]).toContain(res.status);
  });

  it("D2. Cron endpoint not accessible without correct secret", async () => {
    const { GET } = await import("@/app/api/cron/device-health/route");
    const wrongHeader = new Headers({ "x-cron-secret": "wrong-secret" });
    const mockReq = { headers: { get: (h: string) => wrongHeader.get(h) } } as any;
    const res = await GET(mockReq);
    expect([401, 503]).toContain(res.status);
  });
});

// ── E. ETA engine — pure functions ────────────────────────────────────────────
describe("E. ETA engine pure functions", () => {
  it("E1. deriveEtaStatus returns ON_TIME for small delay", () => {
    expect(deriveEtaStatus(0)).toBe("ON_TIME");
    expect(deriveEtaStatus(ETA_DELAY_AT_RISK_MINUTES - 1)).toBe("ON_TIME");
  });

  it("E2. deriveEtaStatus returns AT_RISK for threshold delay", () => {
    expect(deriveEtaStatus(ETA_DELAY_AT_RISK_MINUTES)).toBe("AT_RISK");
    expect(deriveEtaStatus(ETA_DELAY_DELAYED_MINUTES - 1)).toBe("AT_RISK");
  });

  it("E3. deriveEtaStatus returns DELAYED for high delay", () => {
    expect(deriveEtaStatus(ETA_DELAY_DELAYED_MINUTES)).toBe("DELAYED");
    expect(deriveEtaStatus(60)).toBe("DELAYED");
  });

  it("E4. etaNeedsRefresh returns true when no cache", () => {
    expect(etaNeedsRefresh({ etaCalculatedAt: null, lastPingAt: null, currentLat: null, currentLng: null })).toBe(true);
  });

  it("E5. etaNeedsRefresh returns false for fresh cache with no movement", () => {
    const freshCalc = new Date(Date.now() - 60_000); // 1 min ago
    const result = etaNeedsRefresh({
      etaCalculatedAt: freshCalc,
      lastPingAt: new Date(),
      currentLat: 24.7, currentLng: 46.7,
      prevLat: 24.7, prevLng: 46.7, // same position
    });
    expect(result).toBe(false);
  });

  it("E6. etaNeedsRefresh returns true when cache is expired", () => {
    const oldCalc = new Date(Date.now() - (ETA_CACHE_TTL_SECONDS + 60) * 1000);
    expect(etaNeedsRefresh({ etaCalculatedAt: oldCalc, lastPingAt: new Date(), currentLat: 24.7, currentLng: 46.7 })).toBe(true);
  });

  it("E7. etaNeedsRefresh returns true when vehicle has moved significantly", () => {
    const freshCalc = new Date(Date.now() - 60_000);
    // 1 degree of latitude ≈ 111 km >> ETA_MOVEMENT_THRESHOLD_METERS (500m)
    const result = etaNeedsRefresh({
      etaCalculatedAt: freshCalc,
      lastPingAt: new Date(),
      currentLat: 25.7, currentLng: 46.7,  // significantly moved
      prevLat: 24.7, prevLng: 46.7,
    });
    expect(result).toBe(true);
  });

  it("E8. ETA thresholds are centralized and documented", () => {
    const src = readFileSync(join(process.cwd(), "lib/etaEngine.ts"), "utf8");
    expect(src).toContain("ETA_CACHE_TTL_SECONDS");
    expect(src).toContain("ETA_MOVEMENT_THRESHOLD_METERS");
    expect(src).toContain("ETA_DELAY_AT_RISK_MINUTES");
    expect(src).toContain("ETA_DELAY_DELAYED_MINUTES");
    // API key NEVER exposed:
    expect(src).not.toContain("NEXT_PUBLIC");
  });
});

// ── F. ETA API — unavailable cases ────────────────────────────────────────────
describe("F. ETA API unavailable cases", () => {
  it("F1. ETA unavailable for non-active trip", async () => {
    if (!adminCookie) { console.log("SKIP"); return; }
    // Find a PLANNED trip:
    const plannedTrip = await db.query.trips.findFirst({
      where: and(eq(trips.tenantId, tenantId), eq(trips.status, "PLANNED")),
      columns: { id: true },
    });
    if (!plannedTrip) { console.log("SKIP: no planned trip"); return; }
    const { GET } = await import("@/app/api/trips/[id]/eta/route");
    const res = await GET(
      makeRequest(`/api/trips/${plannedTrip.id}/eta`, { cookie: adminCookie }),
      { params: Promise.resolve({ id: plannedTrip.id }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.available).toBe(false);
    expect(data.reason).toBe("TRIP_NOT_ACTIVE");
  });

  it("F2. ETA unavailable returns quality=UNAVAILABLE", async () => {
    if (!adminCookie) { console.log("SKIP"); return; }
    const plannedTrip = await db.query.trips.findFirst({
      where: and(eq(trips.tenantId, tenantId), eq(trips.status, "PLANNED")),
      columns: { id: true },
    });
    if (!plannedTrip) { console.log("SKIP"); return; }
    const { GET } = await import("@/app/api/trips/[id]/eta/route");
    const res = await GET(
      makeRequest(`/api/trips/${plannedTrip.id}/eta`, { cookie: adminCookie }),
      { params: Promise.resolve({ id: plannedTrip.id }) }
    );
    const data = await res.json();
    expect(data.quality).toBe("UNAVAILABLE");
  });

  it("F3. ETA returns 401 when unauthenticated", async () => {
    const { GET } = await import("@/app/api/trips/[id]/eta/route");
    const res = await GET(
      makeRequest("/api/trips/fake-id/eta", {}),
      { params: Promise.resolve({ id: "fake-id" }) }
    );
    expect(res.status).toBe(401);
  });
});

// ── G. Notifications API ──────────────────────────────────────────────────────
describe("G. Notifications API", () => {
  it("G1. GET /api/notifications returns notifications list", async () => {
    if (!adminCookie) { console.log("SKIP"); return; }
    const { GET } = await import("@/app/api/notifications/route");
    const res = await GET(makeRequest("/api/notifications", { cookie: adminCookie }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.notifications)).toBe(true);
    expect(typeof data.unreadCount).toBe("number");
  });

  it("G2. Unauthenticated returns 401", async () => {
    const { GET } = await import("@/app/api/notifications/route");
    const res = await GET(makeRequest("/api/notifications", {}));
    expect(res.status).toBe(401);
  });

  it("G3. Tenant isolation: notification only returns own-tenant items", async () => {
    // Create notification for this tenant then verify:
    const notifId = genId();
    await db.insert(notifications).values({
      id: notifId, tenantId, message: `Test notif ${run}`,
      type: "DEVICE_OFFLINE", severity: "WARNING", read: false,
    } as any);
    cleanup.push(async () => db.delete(notifications).where(eq(notifications.id, notifId)).catch(() => {}));

    if (!adminCookie) return;
    const { GET } = await import("@/app/api/notifications/route");
    const res = await GET(makeRequest("/api/notifications", { cookie: adminCookie }));
    const data = await res.json();
    for (const n of data.notifications) {
      expect(n.tenantId).toBe(tenantId);
    }
  });
});

// ── H. Alerts API ─────────────────────────────────────────────────────────────
describe("H. Alerts API", () => {
  it("H1. GET /api/alerts returns alert list", async () => {
    if (!adminCookie) { console.log("SKIP"); return; }
    const { GET } = await import("@/app/api/alerts/route");
    const res = await GET(makeRequest("/api/alerts?status=OPEN", { cookie: adminCookie }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.alerts)).toBe(true);
    expect(typeof data.openCount).toBe("number");
  });

  it("H2. Unauthenticated /api/alerts returns 401", async () => {
    const { GET } = await import("@/app/api/alerts/route");
    const res = await GET(makeRequest("/api/alerts", {}));
    expect(res.status).toBe(401);
  });
});

// ── I. Trip 360 has Live Execution tab ────────────────────────────────────────
describe("I. Trip 360 Live Execution tab", () => {
  it("I1. Trip 360 includes live tab", () => {
    const src = readFileSync(join(process.cwd(), "app/operations/trips/[id]/page.tsx"), "utf8");
    expect(src).toContain('"live"');
    expect(src).toContain("Live Execution");
    expect(src).toContain("loadEta");
  });

  it("I2. Trip 360 ETA section shows baseline and live distinction", () => {
    const src = readFileSync(join(process.cwd(), "app/operations/trips/[id]/page.tsx"), "utf8");
    expect(src).toContain("baselineEtaAt");
    expect(src).toContain("estimatedArrivalAt");
    expect(src).toContain("delayMinutes");
    expect(src).toContain("etaStatus");
  });

  it("I3. ETA section never fabricates — shows unavailable when no data", () => {
    const src = readFileSync(join(process.cwd(), "app/operations/trips/[id]/page.tsx"), "utf8");
    // JSX uses !etaData.available (negation) not available: false literal:
    expect(src).toContain("!etaData.available");
    expect(src).toContain("ETA unavailable");
    expect(src).toContain("etaData.reason?.replace");
  });
});

// ── J. Migration 0028 additive safety ─────────────────────────────────────────
describe("J. Migration 0028 additive safety", () => {
  it("J1. No destructive DDL in migration 0028", () => {
    const sql = readFileSync(join(process.cwd(), "drizzle/0028_milestone_fg_alerts_eta.sql"), "utf8");
    const upper = sql.toUpperCase();
    expect(upper).not.toContain("DROP TABLE");
    expect(upper).not.toContain("TRUNCATE");
    expect(upper).not.toContain("ALTER COLUMN TYPE");
    expect(upper).not.toContain("DROP COLUMN");
  });

  it("J2. Trip dispatch route sets baselineEtaAt", () => {
    const src = readFileSync(join(process.cwd(), "app/api/trips/[id]/dispatch/route.ts"), "utf8");
    expect(src).toContain("baselineEtaAt");
    expect(src).toContain("estimatedDurationMinutes");
    // Must not overwrite existing:
    expect(src).toContain("Set baselineEtaAt once at dispatch");
  });
});

// ── K. Protected domain regression ────────────────────────────────────────────
describe("K. Protected domain regression", () => {
  it("K1. Trip lifecycle not auto-advanced by ETA alerts", () => {
    const etaSrc = readFileSync(join(process.cwd(), "lib/etaEngine.ts"), "utf8");
    expect(etaSrc).not.toContain("confirmDelivery");
    expect(etaSrc).not.toContain("createPod");
    expect(etaSrc).not.toContain("COMPLETED");
    const alertSrc = readFileSync(join(process.cwd(), "lib/alertEngine.ts"), "utf8");
    expect(alertSrc).not.toContain("confirmDelivery");
    expect(alertSrc).not.toContain("createPod");
  });

  it("K2. Cron endpoint does not modify trip lifecycle", () => {
    const src = readFileSync(join(process.cwd(), "app/api/cron/device-health/route.ts"), "utf8");
    expect(src).not.toContain("trips");
    expect(src).not.toContain("DISPATCHED");
    expect(src).not.toContain("COMPLETED");
    expect(src).not.toContain("createPod");
  });

  it("K3. EXP-001 expense workflow unchanged", () => {
    const src = readFileSync(join(process.cwd(), "app/api/expenses/route.ts"), "utf8");
    expect(src).toContain("CONFIGURE_NUMBERING");
    expect(src).not.toContain("etaEngine");
    expect(src).not.toContain("alertEngine");
  });

  it("K4. Migration count is 29", () => {
    const { readdirSync } = require("fs");
    const count = readdirSync(join(process.cwd(), "drizzle")).filter((f: string) => f.endsWith(".sql")).length;
    expect(count).toBe(29);
  });
});

// ── L. Tenant isolation ───────────────────────────────────────────────────────
describe("L. Tenant isolation", () => {
  it("L1. Alert engine only creates alerts for specified tenant", async () => {
    const fakeTenantId = genId();
    const alertId = await createAlertIfNotOpen({
      tenantId: fakeTenantId,
      eventType: "DEVICE_OFFLINE",
      severity: "WARNING",
      message: "Cross-tenant test",
    });
    // This inserts with the specified tenantId — verify it doesn't affect real tenant:
    if (alertId) {
      cleanup.push(async () => {
        await db.delete(telemetryEvents).where(eq(telemetryEvents.id, alertId)).catch(() => {});
      });
      const alert = await db.query.telemetryEvents.findFirst({ where: eq(telemetryEvents.id, alertId) });
      expect(alert?.tenantId).toBe(fakeTenantId);
      expect(alert?.tenantId).not.toBe(tenantId);
    }
  });

  it("L2. /api/alerts returns only own-tenant alerts", async () => {
    if (!adminCookie) { console.log("SKIP"); return; }
    const { GET } = await import("@/app/api/alerts/route");
    const res = await GET(makeRequest("/api/alerts", { cookie: adminCookie }));
    const data = await res.json();
    for (const a of data.alerts) {
      expect(a.tenantId).toBe(tenantId);
    }
  });
});
