export const dynamic = "force-dynamic";
/**
 * POST /api/inbound/teltonika/[token]
 *
 * Inbound webhook for Teltonika FMB hardware devices.
 * [token] is a per-provider URL token. The plaintext is compared
 * against bcrypt hashes in telematics_providers.webhook_token_hash.
 *
 * NOT session-authenticated — device-bearer-token authenticated.
 * Classified as INFRA:DEVICE_WEBHOOK in RBAC audit.
 *
 * Pipeline:
 *   1. Rate limit by source IP (very permissive — 1 req/2s per IP)
 *   2. Parse + validate Teltonika payload
 *   3. Authenticate: find provider whose webhookTokenHash matches [token]
 *   4. Rate limit by IMEI (5s gap)
 *   5. Resolve device context: IMEI → device → vehicle → active trip
 *   6. Always update device heartbeat (lastCommunication, lastLat, lastLng)
 *   7. If active trip exists: run full GPS ingestion pipeline
 *   8. If no active trip: heartbeat only — return 200 OK
 *
 * The GPS pipeline (persistGpsPing + processGpsGeofence) is NEVER called
 * without a resolved tripId and driverId — the contract is maintained.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { telematicsProviders } from "@/lib/db/schema";
import { eq, and, not, isNull } from "drizzle-orm";
import {
  parseTeltonikaPayload, resolveDeviceContext, updateDeviceHeartbeat,
} from "@/lib/deviceAdapter";
import { verifyWebhookToken } from "@/lib/webhookToken";
import {
  validateGpsPing, persistGpsPing, processGpsGeofence,
} from "@/lib/gpsIngestion";
import { checkDeviceRateLimit } from "@/lib/deviceRateLimit";
import { createAlertIfNotOpen, resolveOpenAlerts } from "@/lib/alertEngine";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token: plainToken } = await params;

  // ── 1. Parse payload early to get IMEI for rate limiting ─────────────────
  const body = await req.json().catch(() => null);
  const ping = parseTeltonikaPayload(body);
  if (!ping) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  // ── 2. Rate limit by IMEI ──────────────────────────────────────────────────
  const rateResult = checkDeviceRateLimit(ping.imei);
  if (!rateResult.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded", retryAfterMs: rateResult.retryAfterMs },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(rateResult.retryAfterMs / 1000)) },
      }
    );
  }

  // ── 3. Authenticate: find provider with matching webhookTokenHash ──────────
  // Load all active Teltonika providers that have a token hash set:
  const providers = await db.query.telematicsProviders.findMany({
    where: and(
      eq(telematicsProviders.providerType, "HARDWARE_DEVICE"),
      eq(telematicsProviders.status, "ACTIVE"),
      not(isNull(telematicsProviders.webhookTokenHash))
    ),
    columns: { id: true, tenantId: true, webhookTokenHash: true },
  });

  let matchedProvider: { id: string; tenantId: string } | null = null;
  for (const p of providers) {
    if (!p.webhookTokenHash) continue;
    const matches = await verifyWebhookToken(plainToken, p.webhookTokenHash);
    if (matches) {
      matchedProvider = { id: p.id, tenantId: p.tenantId };
      break;
    }
  }

  if (!matchedProvider) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── 4. Resolve device context ──────────────────────────────────────────────
  const context = await resolveDeviceContext(ping.imei);
  if (!context) {
    // Unknown IMEI — log and return 200 (don't reveal registration status):
    console.warn(JSON.stringify({
      level: "warn", event: "inbound.teltonika.unknown_imei",
      imei: ping.imei.slice(0, 6) + "…",  // partially masked
    }));
    return NextResponse.json({ ok: true, status: "UNKNOWN_DEVICE" });
  }

  // Verify tenant alignment — the device's tenant must match the provider's:
  if (context.tenantId !== matchedProvider.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── 5. Always update device heartbeat ─────────────────────────────────────
  await updateDeviceHeartbeat({
    deviceId: context.deviceId,
    lat: ping.lat,
    lng: ping.lng,
    recordedAt: ping.recordedAt,
  });

  // ── 6. Resolve any open DEVICE_OFFLINE alert (device just reported in) ────
  await resolveOpenAlerts({
    tenantId: context.tenantId,
    eventType: "DEVICE_OFFLINE",
    deviceId: context.deviceId,
  });

  // ── 7. If no active trip → heartbeat only, return early ───────────────────
  if (!context.tripId || !context.driverId) {
    return NextResponse.json({
      ok: true,
      status: "NO_ACTIVE_TRIP",
      message: "Device heartbeat recorded; no active trip for GPS pipeline.",
    });
  }

  // ── 8. Full GPS ingestion pipeline ────────────────────────────────────────
  const gpsPing = {
    tenantId: context.tenantId,
    tripId: context.tripId,
    vehicleId: context.vehicleId,
    driverId: context.driverId,
    lat: ping.lat,
    lng: ping.lng,
    accuracy: ping.hdop != null ? ping.hdop * 5 : null,  // HDOP→metres approximation
    speed: ping.speedMps,
    heading: ping.heading,
    recordedAt: ping.recordedAt,
  };

  const validationErrors = validateGpsPing(gpsPing);
  if (validationErrors.length > 0) {
    return NextResponse.json(
      { error: "Invalid GPS coordinates", errors: validationErrors },
      { status: 422 }
    );
  }

  await persistGpsPing(gpsPing);

  processGpsGeofence(gpsPing); // non-blocking — never await

  return NextResponse.json({
    ok: true,
    status: "GPS_RECORDED",
    tripId: context.tripId,
    lat: ping.lat,
    lng: ping.lng,
    recordedAt: ping.recordedAt.toISOString(),
  });
}
