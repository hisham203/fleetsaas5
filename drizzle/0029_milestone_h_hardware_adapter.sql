-- ============================================================
-- Migration 0029 — Milestone H: Hardware Device Adapter
-- Production-safe, forward-only, additive only.
-- PostgreSQL 18 compatible.
-- ============================================================

-- ── vehicle_gps_history: add device_id FK for hardware traceability ──────────
-- Allows tracing a GPS history row back to the exact device that produced it.
-- DRIVER_APP and DEMO pings have device_id = NULL (correct — they have no device).
-- DEVICE pings (from Teltonika etc.) will have device_id set.
ALTER TABLE "vehicle_gps_history"
  ADD COLUMN IF NOT EXISTS "device_id" text;  -- nullable FK to telematics_devices.id

CREATE INDEX IF NOT EXISTS "vgh_device_idx"
  ON "vehicle_gps_history" ("device_id")
  WHERE ("device_id" IS NOT NULL);

-- ── telematics_devices: add inbound ping count for diagnostics ───────────────
-- Optional operational metric — how many pings a device has sent in its lifetime.
-- Incremented by the adapter on each accepted ping. Used for Device 360 / diagnostics.
ALTER TABLE "telematics_devices"
  ADD COLUMN IF NOT EXISTS "total_pings_received" integer NOT NULL DEFAULT 0;
