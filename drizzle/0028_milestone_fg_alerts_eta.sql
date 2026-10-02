-- ============================================================
-- Migration 0028 — Milestone F+G: Operational Alerts & Live ETA
-- Production-safe, forward-only, additive only.
-- PostgreSQL 18 compatible.
-- ============================================================

-- ── 1. Extend notifications table ────────────────────────────────────────────
-- Add user-targeting, type/severity, entity deep-link, and alert linkage.
-- The notifications table previously had: id, tenant_id, order_id, message, read, created_at.
-- All additions are nullable or have safe defaults so existing rows are unaffected.
ALTER TABLE "notifications"
  ADD COLUMN IF NOT EXISTS "user_id"      text,           -- NULL = tenant-wide broadcast
  ADD COLUMN IF NOT EXISTS "type"         text NOT NULL DEFAULT 'INFO',
  ADD COLUMN IF NOT EXISTS "severity"     text NOT NULL DEFAULT 'INFO',  -- INFO | WARNING | CRITICAL
  ADD COLUMN IF NOT EXISTS "entity_type"  text,           -- TRIP | VEHICLE | DRIVER | DEVICE | GEOFENCE
  ADD COLUMN IF NOT EXISTS "entity_id"    text,           -- FK ID of the affected entity
  ADD COLUMN IF NOT EXISTS "entity_route" text,           -- front-end route for deep link
  ADD COLUMN IF NOT EXISTS "alert_id"     text;           -- FK to telemetry_events.id for deduplication

-- Index: per-user unread notifications (primary bell query):
CREATE INDEX IF NOT EXISTS "notif_user_unread_idx"
  ON "notifications" ("user_id", "read")
  WHERE ("user_id" IS NOT NULL AND "read" = false);

-- Index: tenant-wide broadcast unread:
CREATE INDEX IF NOT EXISTS "notif_tenant_unread_idx"
  ON "notifications" ("tenant_id", "read", "created_at" DESC)
  WHERE ("read" = false);

-- Index: link from notification → alert (for deduplication queries):
CREATE INDEX IF NOT EXISTS "notif_alert_idx"
  ON "notifications" ("alert_id")
  WHERE ("alert_id" IS NOT NULL);

-- ── 2. Extend trips table for Live ETA ───────────────────────────────────────
-- Cached ETA values written by the /api/trips/[id]/eta endpoint.
-- Avoids calling Google Routes API on every request.
-- etaCalculatedAt: timestamp of last successful ETA calculation
-- etaDistanceMeters: remaining distance at time of calculation
-- etaDurationSeconds: remaining duration at time of calculation
-- etaArrivalAt: projected arrival timestamp at time of calculation
-- baselineEtaAt: set ONCE at dispatch using estimatedDurationMinutes; never overwritten
ALTER TABLE "trips"
  ADD COLUMN IF NOT EXISTS "eta_calculated_at"    timestamp,
  ADD COLUMN IF NOT EXISTS "eta_distance_meters"  integer,
  ADD COLUMN IF NOT EXISTS "eta_duration_seconds" integer,
  ADD COLUMN IF NOT EXISTS "eta_arrival_at"       timestamp,
  ADD COLUMN IF NOT EXISTS "baseline_eta_at"      timestamp;  -- set once at dispatch, never overwritten

-- Index: active trips needing ETA refresh (cron + batch query):
CREATE INDEX IF NOT EXISTS "trips_eta_active_idx"
  ON "trips" ("tenant_id", "eta_calculated_at")
  WHERE ("status" NOT IN ('COMPLETED', 'FAILED', 'PLANNED', 'TRIP_PLANNED'));

-- ── 3. telemetry_events: add resolved_by/resolved_at ────────────────────────
-- Milestone D added acknowledgedBy/acknowledgedAt.
-- Add resolvedBy/resolvedAt for full OPEN → ACKNOWLEDGED → RESOLVED lifecycle.
ALTER TABLE "telemetry_events"
  ADD COLUMN IF NOT EXISTS "resolved_by"  text,
  ADD COLUMN IF NOT EXISTS "resolved_at"  timestamp;

-- Index: open alerts per entity (deduplication check — most critical query):
CREATE INDEX IF NOT EXISTS "te_open_vehicle_type_idx"
  ON "telemetry_events" ("tenant_id", "vehicle_id", "event_type", "status")
  WHERE ("status" = 'OPEN' AND "vehicle_id" IS NOT NULL);

CREATE INDEX IF NOT EXISTS "te_open_device_type_idx"
  ON "telemetry_events" ("tenant_id", "device_id", "event_type", "status")
  WHERE ("status" = 'OPEN' AND "device_id" IS NOT NULL);

CREATE INDEX IF NOT EXISTS "te_open_trip_type_idx"
  ON "telemetry_events" ("tenant_id", "trip_id", "event_type", "status")
  WHERE ("status" = 'OPEN' AND "trip_id" IS NOT NULL);
