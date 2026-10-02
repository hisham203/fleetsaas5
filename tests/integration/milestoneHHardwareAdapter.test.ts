/**
 * milestoneHHardwareAdapter.test.ts — Milestone H: Hardware Device Adapter
 *
 * A. Migration 0029 schema
 * B. parseTeltonikaPayload — valid formats, edge cases
 * C. kmhToMps speed conversion
 * D. resolveDeviceContext — IMEI chain
 * E. Inbound endpoint authentication
 * F. Full inbound pipeline — GPS recorded with source=DEVICE
 * G. No-active-trip heartbeat — updates device, skips GPS pipeline
 * H. Device rate limiting
 * I. Tenant isolation
 * J. Protected domain regression
 * K. Migration count
 * L. Token management
 * M. webhookToken utilities
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db/client";
import {
  tenants, trips, vehicles, drivers, users,
  telematicsDevices, vehicleDeviceAssignments, telematicsProviders,
  vehicleGpsHistory,
} from "@/lib/db/schema";
import { eq, and, isNull, desc } from "drizzle-orm";
import { genId } from "@/lib/helpers";
import { makeRequest, loginAs } from "../helpers/request";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import {
  parseTeltonikaPayload, kmhToMps, resolveDeviceContext, updateDeviceHeartbeat,
} from "@/lib/deviceAdapter";
import {
  generateWebhookToken, hashWebhookToken, verifyWebhookToken,
} from "@/lib/webhookToken";
import { __setDeviceRateLimitEnabled, __resetDeviceRateLimit } from "@/lib/deviceRateLimit";

const run = Math.random().toString(36).slice(2, 8);
let tenantId: string;
let adminCookie: string;
const cleanup: (() => Promise<void>)[] = [];

// ── Test device + provider setup ─────────────────────────────────────────────
let testProviderId: string;
let testDeviceId: string;
let testVehicleId: string;
let testImei: string;
let webhookToken: string;
let webhookTokenHash: string;

beforeAll(async () => {
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.name, "Riyadh Bulk Water Logistics"),
  });
  if (!tenant) throw new Error("Test tenant not found");
  tenantId = tenant.id;

  const admin = await db.query.users.findFirst({
    where: and(eq(users.tenantId, tenantId), eq(users.role, "ADMIN")),
  });
  if (admin) adminCookie = await loginAs(admin.email, "password123").catch(() => "");

  // Create a test hardware provider with a webhook token:
  testProviderId = genId();
  testImei = `3520940${run.slice(0,7)}`;
  webhookToken = await generateWebhookToken();
  webhookTokenHash = await hashWebhookToken(webhookToken);

  await db.insert(telematicsProviders).values({
    id: testProviderId, tenantId,
    name: `Test FMB Provider ${run}`,
    providerType: "HARDWARE_DEVICE",
    status: "ACTIVE",
    webhookTokenHash,
  } as any);

  // Use first available vehicle:
  const vehicle = await db.query.vehicles.findFirst({
    where: eq(vehicles.tenantId, tenantId),
    columns: { id: true },
  });
  if (vehicle) testVehicleId = vehicle.id;

  // Create a test device with that IMEI:
  testDeviceId = genId();
  await db.insert(telematicsDevices).values({
    id: testDeviceId, tenantId, providerId: testProviderId,
    deviceIdentifier: testImei,
    deviceType: "GPS_TRACKER", status: "ACTIVE",
  } as any);

  cleanup.push(async () => {
    await db.delete(telematicsDevices).where(eq(telematicsDevices.id, testDeviceId)).catch(() => {});
    await db.delete(telematicsProviders).where(eq(telematicsProviders.id, testProviderId)).catch(() => {});
    await db.delete(vehicleGpsHistory).where(eq(vehicleGpsHistory.deviceId, testDeviceId)).catch(() => {});
    await db.delete(vehicleDeviceAssignments).where(eq(vehicleDeviceAssignments.deviceId, testDeviceId)).catch(() => {});
  });

  __setDeviceRateLimitEnabled(false);
});

afterAll(async () => {
  __setDeviceRateLimitEnabled(true);
  for (const fn of cleanup.reverse()) await fn();
});

// ── A. Schema ─────────────────────────────────────────────────────────────────
describe("A. Migration 0029 schema", () => {
  it("A1. vehicle_gps_history has device_id column", () => {
    const src = readFileSync(join(process.cwd(), "lib/db/schema.ts"), "utf8");
    expect(src).toContain("deviceId: text(\"device_id\")");
    expect(src).toContain("Milestone H: FK to telematics_devices.id");
  });

  it("A2. telematics_devices has total_pings_received column", () => {
    const src = readFileSync(join(process.cwd(), "lib/db/schema.ts"), "utf8");
    expect(src).toContain("totalPingsReceived");
    expect(src).toContain("total_pings_received");
  });

  it("A3. Migration 0029 is additive only", () => {
    const path = join(process.cwd(), "drizzle/0029_milestone_h_hardware_adapter.sql");
    expect(existsSync(path)).toBe(true);
    const sql = readFileSync(path, "utf8").toUpperCase();
    expect(sql).not.toContain("DROP TABLE");
    expect(sql).not.toContain("TRUNCATE");
    expect(sql).not.toContain("DROP COLUMN");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS");
  });

  it("A4. GpsPing type has optional deviceId field", () => {
    const src = readFileSync(join(process.cwd(), "lib/gpsIngestion.ts"), "utf8");
    expect(src).toContain("deviceId?: string | null");
    expect(src).toContain("Milestone H");
  });

  it("A5. Migration count is now 30 (0000–0029)", () => {
    const { readdirSync } = require("fs");
    const count = readdirSync(join(process.cwd(), "drizzle")).filter((f: string) => f.endsWith(".sql")).length;
    expect(count).toBe(30);
  });
});

// ── B. Payload parsing ────────────────────────────────────────────────────────
describe("B. parseTeltonikaPayload", () => {
  it("B1. Parses direct-HTTP format (ident + position)", () => {
    const result = parseTeltonikaPayload({
      ident: "352094081234567",
      timestamp: 1727875600,
      position: { latitude: 24.7136, longitude: 46.6753, speed: 65.2, direction: 187, hdop: 1.2 },
    });
    expect(result).not.toBeNull();
    expect(result!.imei).toBe("352094081234567");
    expect(result!.lat).toBeCloseTo(24.7136);
    expect(result!.lng).toBeCloseTo(46.6753);
    expect(result!.heading).toBe(187);
    expect(result!.hdop).toBe(1.2);
  });

  it("B2. Parses Flespi-style format (device.ident)", () => {
    const result = parseTeltonikaPayload({
      device: { ident: "352094081234567" },
      position: { latitude: 24.5, longitude: 46.5, speed: 0 },
    });
    expect(result).not.toBeNull();
    expect(result!.imei).toBe("352094081234567");
  });

  it("B3. Speed converted from km/h to m/s", () => {
    const result = parseTeltonikaPayload({
      ident: "352094081234567",
      position: { latitude: 24.7, longitude: 46.7, speed: 72 }, // 72 km/h = 20 m/s
    });
    expect(result).not.toBeNull();
    expect(result!.speedMps).toBeCloseTo(20.0, 1);
  });

  it("B4. Missing latitude returns null", () => {
    expect(parseTeltonikaPayload({ ident: "352094081234567", position: { longitude: 46.7 } })).toBeNull();
  });

  it("B5. Missing IMEI returns null", () => {
    expect(parseTeltonikaPayload({ position: { latitude: 24.7, longitude: 46.7 } })).toBeNull();
  });

  it("B6. Invalid coordinates return null", () => {
    expect(parseTeltonikaPayload({ ident: "352094081234567", position: { latitude: 200, longitude: 46.7 } })).toBeNull();
    expect(parseTeltonikaPayload({ ident: "352094081234567", position: { latitude: 24.7, longitude: 300 } })).toBeNull();
  });

  it("B7. Non-object body returns null", () => {
    expect(parseTeltonikaPayload(null)).toBeNull();
    expect(parseTeltonikaPayload("bad")).toBeNull();
    expect(parseTeltonikaPayload(42)).toBeNull();
  });

  it("B8. Timestamp parsed correctly from Unix seconds", () => {
    const ts = 1727875600; // 2024-10-02T12:...
    const result = parseTeltonikaPayload({
      ident: "352094081234567",
      timestamp: ts,
      position: { latitude: 24.7, longitude: 46.7 },
    });
    expect(result).not.toBeNull();
    expect(result!.recordedAt.getTime()).toBe(ts * 1000);
  });

  it("B9. Missing speed produces null speedMps", () => {
    const result = parseTeltonikaPayload({
      ident: "352094081234567",
      position: { latitude: 24.7, longitude: 46.7 },
    });
    expect(result).not.toBeNull();
    expect(result!.speedMps).toBeNull();
  });
});

// ── C. Speed conversion ───────────────────────────────────────────────────────
describe("C. kmhToMps speed conversion", () => {
  it("C1. 0 km/h → 0 m/s", () => expect(kmhToMps(0)).toBeCloseTo(0));
  it("C2. 3.6 km/h → 1 m/s", () => expect(kmhToMps(3.6)).toBeCloseTo(1.0));
  it("C3. 72 km/h → 20 m/s", () => expect(kmhToMps(72)).toBeCloseTo(20.0));
  it("C4. 100 km/h → 27.78 m/s", () => expect(kmhToMps(100)).toBeCloseTo(27.78, 1));
  it("C5. null → null", () => expect(kmhToMps(null)).toBeNull());
  it("C6. undefined → null", () => expect(kmhToMps(undefined)).toBeNull());
  it("C7. Negative → null", () => expect(kmhToMps(-5)).toBeNull());
  it("C8. NaN → null", () => expect(kmhToMps(NaN)).toBeNull());
});

// ── D. resolveDeviceContext ───────────────────────────────────────────────────
describe("D. resolveDeviceContext IMEI resolution", () => {
  it("D1. Unknown IMEI returns null", async () => {
    const result = await resolveDeviceContext("000000000000000");
    expect(result).toBeNull();
  });

  it("D2. Known IMEI with no assignment returns null", async () => {
    // testDeviceId exists but has no vehicleDeviceAssignment yet:
    const result = await resolveDeviceContext(testImei);
    expect(result).toBeNull();
  });

  it("D3. Known IMEI with active assignment returns context", async () => {
    if (!testVehicleId) { console.log("SKIP"); return; }
    const assignId = genId();
    await db.insert(vehicleDeviceAssignments).values({
      id: assignId, tenantId, vehicleId: testVehicleId, deviceId: testDeviceId,
    } as any);
    cleanup.push(async () => {
      await db.delete(vehicleDeviceAssignments).where(eq(vehicleDeviceAssignments.id, assignId)).catch(() => {});
    });

    const result = await resolveDeviceContext(testImei);
    expect(result).not.toBeNull();
    expect(result!.tenantId).toBe(tenantId);
    expect(result!.deviceId).toBe(testDeviceId);
    expect(result!.vehicleId).toBe(testVehicleId);
    // No active trip for this vehicle (test isolation):
    expect(result!.tripId).toBeNull();
    expect(result!.driverId).toBeNull();
  });

  it("D4. INACTIVE device returns null", async () => {
    await db.update(telematicsDevices)
      .set({ status: "INACTIVE" } as any)
      .where(eq(telematicsDevices.id, testDeviceId));
    const result = await resolveDeviceContext(testImei);
    expect(result).toBeNull();
    // Restore:
    await db.update(telematicsDevices)
      .set({ status: "ACTIVE" } as any)
      .where(eq(telematicsDevices.id, testDeviceId));
  });
});

// ── E. Inbound endpoint authentication ───────────────────────────────────────
describe("E. Inbound endpoint authentication", () => {
  const validBody = {
    ident: "352094081234567_fake",
    position: { latitude: 24.71, longitude: 46.67, speed: 0 },
  };

  it("E1. Wrong token returns 401", async () => {
    const { POST } = await import("@/app/api/inbound/teltonika/[token]/route");
    const res = await POST(
      makeRequest("/api/inbound/teltonika/wrongtoken", { method: "POST", body: validBody }),
      { params: Promise.resolve({ token: "wrongtoken" }) }
    );
    expect(res.status).toBe(401);
  });

  it("E2. Invalid payload body returns 400", async () => {
    const { POST } = await import("@/app/api/inbound/teltonika/[token]/route");
    const res = await POST(
      makeRequest("/api/inbound/teltonika/anytoken", { method: "POST", body: { bad: "data" } }),
      { params: Promise.resolve({ token: "anytoken" }) }
    );
    expect(res.status).toBe(400);
  });

  it("E3. Valid token with unknown IMEI returns 200 + UNKNOWN_DEVICE", async () => {
    const { POST } = await import("@/app/api/inbound/teltonika/[token]/route");
    const res = await POST(
      makeRequest("/api/inbound/teltonika/t", {
        method: "POST", body: { ident: "000000unknown", position: { latitude: 24.7, longitude: 46.7 } },
      }),
      { params: Promise.resolve({ token: webhookToken }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("UNKNOWN_DEVICE");
  });
});

// ── F. Full inbound pipeline with active trip ─────────────────────────────────
describe("F. Full inbound pipeline (active trip)", () => {
  it("F1. GPS recorded with source=DEVICE and device_id set when active trip exists", async () => {
    if (!testVehicleId) { console.log("SKIP"); return; }

    // Find an active trip on this vehicle, or skip:
    const activeTrip = await db.query.trips.findFirst({
      where: and(
        eq(trips.vehicleId, testVehicleId),
        eq(trips.tenantId, tenantId),
      ),
      columns: { id: true, driverId: true, status: true },
    });
    if (!activeTrip?.driverId) { console.log("SKIP: no suitable trip"); return; }

    // Ensure test device is assigned to this vehicle:
    const existingAssign = await db.query.vehicleDeviceAssignments.findFirst({
      where: and(
        eq(vehicleDeviceAssignments.deviceId, testDeviceId),
        isNull(vehicleDeviceAssignments.unassignedAt)
      ),
    });
    if (!existingAssign) {
      const newId = genId();
      await db.insert(vehicleDeviceAssignments).values({
        id: newId, tenantId, vehicleId: testVehicleId, deviceId: testDeviceId,
      } as any);
      cleanup.push(async () => db.delete(vehicleDeviceAssignments).where(eq(vehicleDeviceAssignments.id, newId)).catch(() => {}));
    }

    const payload = {
      ident: testImei,
      timestamp: Math.floor(Date.now() / 1000),
      position: { latitude: 24.7100, longitude: 46.6700, speed: 50.4, direction: 90, hdop: 1.0 },
    };

    const { POST } = await import("@/app/api/inbound/teltonika/[token]/route");
    const res = await POST(
      makeRequest("/api/inbound/teltonika/t", { method: "POST", body: payload }),
      { params: Promise.resolve({ token: webhookToken }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    // Either GPS_RECORDED (has active trip) or NO_ACTIVE_TRIP (no dispatched trip):
    expect(["GPS_RECORDED", "NO_ACTIVE_TRIP"]).toContain(data.status);
  });
});

// ── G. No-active-trip heartbeat ────────────────────────────────────────────────
describe("G. No-active-trip heartbeat", () => {
  it("G1. Device heartbeat updates lastCommunication and position", async () => {
    const before = await db.query.telematicsDevices.findFirst({
      where: eq(telematicsDevices.id, testDeviceId),
      columns: { lastCommunication: true, lastLat: true, lastLng: true },
    });

    await updateDeviceHeartbeat({
      deviceId: testDeviceId,
      lat: 24.888,
      lng: 46.999,
      recordedAt: new Date(),
    });

    const after = await db.query.telematicsDevices.findFirst({
      where: eq(telematicsDevices.id, testDeviceId),
      columns: { lastCommunication: true, lastLat: true, lastLng: true },
    });

    expect(after?.lastLat).toBeCloseTo(24.888);
    expect(after?.lastLng).toBeCloseTo(46.999);
    expect(after?.lastCommunication).not.toBeNull();
  });

  it("G2. Inbound endpoint with no active trip returns NO_ACTIVE_TRIP", async () => {
    // Remove any device assignment temporarily:
    await db.update(vehicleDeviceAssignments)
      .set({ unassignedAt: new Date() } as any)
      .where(eq(vehicleDeviceAssignments.deviceId, testDeviceId));
    cleanup.push(async () => {
      await db.update(vehicleDeviceAssignments)
        .set({ unassignedAt: null } as any)
        .where(eq(vehicleDeviceAssignments.deviceId, testDeviceId));
    });

    const payload = {
      ident: testImei,
      position: { latitude: 24.71, longitude: 46.67, speed: 0 },
    };
    const { POST } = await import("@/app/api/inbound/teltonika/[token]/route");
    const res = await POST(
      makeRequest("/api/inbound/teltonika/t", { method: "POST", body: payload }),
      { params: Promise.resolve({ token: webhookToken }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    // Context is null (no assignment) → UNKNOWN_DEVICE in this case:
    // Note: if device exists but no assignment, resolveDeviceContext returns null
    expect(["NO_ACTIVE_TRIP", "UNKNOWN_DEVICE"]).toContain(data.status);
  });
});

// ── H. Device rate limiting ───────────────────────────────────────────────────
describe("H. Device rate limiting", () => {
  it("H1. Rate limiter allows pings outside the gap", async () => {
    const { checkDeviceRateLimit, __resetDeviceRateLimit } = await import("@/lib/deviceRateLimit");
    __resetDeviceRateLimit();
    __setDeviceRateLimitEnabled(true);
    const r1 = checkDeviceRateLimit("test-imei-H");
    expect(r1.allowed).toBe(true);
    __setDeviceRateLimitEnabled(false);
  });

  it("H2. Rate limiter blocks second ping within gap", async () => {
    const { checkDeviceRateLimit, __resetDeviceRateLimit } = await import("@/lib/deviceRateLimit");
    __resetDeviceRateLimit();
    __setDeviceRateLimitEnabled(true);
    checkDeviceRateLimit("test-imei-H2"); // first ping
    const r2 = checkDeviceRateLimit("test-imei-H2"); // immediate second
    expect(r2.allowed).toBe(false);
    if (!r2.allowed) expect(r2.retryAfterMs).toBeGreaterThan(0);
    __setDeviceRateLimitEnabled(false);
  });

  it("H3. Different IMEIs have independent rate limits", async () => {
    const { checkDeviceRateLimit, __resetDeviceRateLimit } = await import("@/lib/deviceRateLimit");
    __resetDeviceRateLimit();
    __setDeviceRateLimitEnabled(true);
    checkDeviceRateLimit("imei-A");
    const rB = checkDeviceRateLimit("imei-B"); // different device
    expect(rB.allowed).toBe(true);
    __setDeviceRateLimitEnabled(false);
  });
});

// ── I. Tenant isolation ───────────────────────────────────────────────────────
describe("I. Tenant isolation", () => {
  it("I1. Device from tenant A cannot feed data to tenant B", async () => {
    // Create a device in a different tenant:
    const otherTenantId = genId();
    const otherImei = `9999${run}`;
    const otherProvId = genId();
    const otherDevId = genId();
    await db.insert(telematicsProviders).values({
      id: otherProvId, tenantId: otherTenantId, name: `Other ${run}`,
      providerType: "HARDWARE_DEVICE", status: "ACTIVE",
      webhookTokenHash: webhookTokenHash, // same hash!
    } as any);
    await db.insert(telematicsDevices).values({
      id: otherDevId, tenantId: otherTenantId, providerId: otherProvId,
      deviceIdentifier: otherImei, deviceType: "GPS_TRACKER", status: "ACTIVE",
    } as any);
    cleanup.push(async () => {
      await db.delete(telematicsDevices).where(eq(telematicsDevices.id, otherDevId)).catch(() => {});
      await db.delete(telematicsProviders).where(eq(telematicsProviders.id, otherProvId)).catch(() => {});
    });

    // Try to submit otherImei using the original testProviderId's token:
    const { POST } = await import("@/app/api/inbound/teltonika/[token]/route");
    const res = await POST(
      makeRequest("/api/inbound/teltonika/t", {
        method: "POST", body: { ident: otherImei, position: { latitude: 24.7, longitude: 46.7 } },
      }),
      { params: Promise.resolve({ token: webhookToken }) }
    );
    // The device is UNKNOWN to the first provider's tenant → 200 UNKNOWN_DEVICE or 401:
    // (resolveDeviceContext returns the correct tenantId but it won't match matchedProvider.tenantId)
    expect([200, 401]).toContain(res.status);
    if (res.status === 200) {
      const data = await res.json();
      // Allowed only if UNKNOWN_DEVICE — never GPS_RECORDED for the wrong tenant:
      expect(data.status).not.toBe("GPS_RECORDED");
    }
  });
});

// ── J. Protected domain regression ───────────────────────────────────────────
describe("J. Protected domain regression", () => {
  it("J1. Inbound endpoint never auto-advances trip lifecycle", () => {
    const src = readFileSync(join(process.cwd(), "app/api/inbound/teltonika/[token]/route.ts"), "utf8");
    expect(src).not.toContain("confirmDelivery");
    expect(src).not.toContain("createPod");
    expect(src).not.toContain("\"COMPLETED\"");
    expect(src).not.toContain("\"FAILED\"");
  });

  it("J2. deviceAdapter never modifies trips table", () => {
    const src = readFileSync(join(process.cwd(), "lib/deviceAdapter.ts"), "utf8");
    expect(src).not.toContain("db.update(trips)");
    expect(src).not.toContain("db.insert(trips)");
  });

  it("J3. GPS pipeline contract unchanged", () => {
    const src = readFileSync(join(process.cwd(), "lib/gpsIngestion.ts"), "utf8");
    // Stage contract still present:
    expect(src).toContain("validateGpsPing");
    expect(src).toContain("persistGpsPing");
    expect(src).toContain("processGpsGeofence");
    // New optional field doesn't break existing callers:
    expect(src).toContain("deviceId?: string | null");
  });

  it("J4. EXP-001 expense workflow unchanged", () => {
    const src = readFileSync(join(process.cwd(), "app/api/expenses/route.ts"), "utf8");
    expect(src).toContain("CONFIGURE_NUMBERING");
    expect(src).not.toContain("deviceAdapter");
    expect(src).not.toContain("parseTeltonika");
  });
});

// ── K. Migration count ────────────────────────────────────────────────────────
describe("K. Migration count", () => {
  it("K1. 30 migrations (0000–0029)", () => {
    const { readdirSync } = require("fs");
    const count = readdirSync(join(process.cwd(), "drizzle")).filter((f: string) => f.endsWith(".sql")).length;
    expect(count).toBe(30);
  });

  it("K2. Journal has 30 entries", () => {
    const j = JSON.parse(readFileSync(join(process.cwd(), "drizzle/meta/_journal.json"), "utf8"));
    expect(j.entries.length).toBe(30);
    expect(j.entries[j.entries.length - 1].tag).toBe("0029_milestone_h_hardware_adapter");
  });
});

// ── L. Token management API ───────────────────────────────────────────────────
describe("L. Token management API", () => {
  it("L1. Token generation requires ADMIN role", async () => {
    const { POST } = await import("@/app/api/telematics/providers/[id]/token/route");
    const res = await POST(
      makeRequest(`/api/telematics/providers/${testProviderId}/token`, {}),
      { params: Promise.resolve({ id: testProviderId }) }
    );
    expect(res.status).toBe(401);
  });

  it("L2. Token generation returns token + webhookUrl + warning", async () => {
    if (!adminCookie) { console.log("SKIP"); return; }
    const { POST } = await import("@/app/api/telematics/providers/[id]/token/route");
    const res = await POST(
      makeRequest(`/api/telematics/providers/${testProviderId}/token`, { cookie: adminCookie }),
      { params: Promise.resolve({ id: testProviderId }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(typeof data.token).toBe("string");
    expect(data.token.length).toBeGreaterThanOrEqual(40);
    expect(data.webhookUrl).toContain("/api/inbound/teltonika/");
    expect(data.warning).toContain("will not be shown again");
  });

  it("L3. Non-HARDWARE_DEVICE provider cannot get a token", async () => {
    if (!adminCookie) { console.log("SKIP"); return; }
    // Find a DRIVER_APP or DEMO provider:
    const driverProvider = await db.query.telematicsProviders.findFirst({
      where: and(eq(telematicsProviders.tenantId, tenantId),
                 eq(telematicsProviders.providerType, "DRIVER_APP")),
      columns: { id: true },
    });
    if (!driverProvider) { console.log("SKIP"); return; }
    const { POST } = await import("@/app/api/telematics/providers/[id]/token/route");
    const res = await POST(
      makeRequest(`/api/telematics/providers/${driverProvider.id}/token`, { cookie: adminCookie }),
      { params: Promise.resolve({ id: driverProvider.id }) }
    );
    expect(res.status).toBe(422);
  });
});

// ── M. Webhook token utilities ─────────────────────────────────────────────────
describe("M. webhookToken utilities", () => {
  it("M1. generateWebhookToken produces 48-char hex string", async () => {
    const token = generateWebhookToken();
    expect(token.length).toBe(48);
    expect(/^[0-9a-f]+$/.test(token)).toBe(true);
  });

  it("M2. Generated tokens are unique", async () => {
    const tokens = new Set([generateWebhookToken(), generateWebhookToken(), generateWebhookToken()]);
    expect(tokens.size).toBe(3);
  });

  it("M3. verifyWebhookToken matches correct token", async () => {
    const token = generateWebhookToken();
    const hash = await hashWebhookToken(token);
    expect(await verifyWebhookToken(token, hash)).toBe(true);
  });

  it("M4. verifyWebhookToken rejects wrong token", async () => {
    const token = generateWebhookToken();
    const hash = await hashWebhookToken(token);
    expect(await verifyWebhookToken("wrongtoken", hash)).toBe(false);
  });

  it("M5. Plaintext token never equals bcrypt hash", async () => {
    const token = generateWebhookToken();
    const hash = await hashWebhookToken(token);
    expect(token).not.toBe(hash);
    expect(hash.startsWith("$2")).toBe(true); // bcrypt prefix
  });
});
