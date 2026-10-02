-- ============================================================
-- Migration 0026 — Milestone D: Telematics Core
-- Production-safe, forward-only, additive only.
-- No changes to tables 0000–0025.
-- Applies to PostgreSQL 18.
-- ============================================================

-- ── 1. Telematics Providers (provider registry) ──────────────────────────────
-- Industry-neutral provider abstraction. Supports: GPS hardware vendors,
-- fleet platform APIs, mobile/driver app (SMARTY1), demo simulator.
-- Credentials are NEVER stored in this table — they stay in environment/secrets.
CREATE TABLE IF NOT EXISTS "telematics_providers" (
  "id"            text PRIMARY KEY NOT NULL,
  "tenant_id"     text NOT NULL,
  "name"          text NOT NULL,
  "provider_type" text NOT NULL,     -- HARDWARE_DEVICE | PLATFORM_API | DRIVER_APP | DEMO
  "status"        text NOT NULL DEFAULT 'ACTIVE', -- ACTIVE | INACTIVE
  "webhook_token_hash" text,         -- bcrypt hash of inbound webhook token (never plaintext)
  "config"        jsonb,             -- non-secret config: polling interval, region, etc.
  "notes"         text,
  "created_at"    timestamp DEFAULT now() NOT NULL,
  "updated_at"    timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "tp_tenant_name_unique" UNIQUE ("tenant_id", "name")
);

CREATE INDEX IF NOT EXISTS "tp_tenant_idx"  ON "telematics_providers" ("tenant_id");
CREATE INDEX IF NOT EXISTS "tp_type_idx"    ON "telematics_providers" ("tenant_id", "provider_type");

-- ── 2. Telematics Devices (device registry) ───────────────────────────────────
-- One row per physical or logical telemetry source.
-- SIM/IMEI stored as hashed values where present to avoid unnecessary sensitive
-- data retention (provider handles the raw identifiers in their own system).
CREATE TABLE IF NOT EXISTS "telematics_devices" (
  "id"                  text PRIMARY KEY NOT NULL,
  "tenant_id"           text NOT NULL,
  "provider_id"         text NOT NULL REFERENCES "telematics_providers"("id"),
  "device_identifier"   text NOT NULL,          -- our canonical ID for this device
  "external_id"         text,                   -- provider's own device ID
  "device_type"         text NOT NULL DEFAULT 'GPS_TRACKER',  -- GPS_TRACKER | OBD | MOBILE | VIRTUAL
  "status"              text NOT NULL DEFAULT 'UNASSIGNED',   -- ACTIVE | INACTIVE | OFFLINE | FAULT | UNASSIGNED
  "serial_number"       text,
  "firmware_version"    text,
  "last_communication"  timestamp,
  "last_gps_fix"        timestamp,
  "last_lat"            real,
  "last_lng"            real,
  "metadata"            jsonb,                  -- provider-native supplementary data (non-sensitive)
  "notes"               text,
  "created_at"          timestamp DEFAULT now() NOT NULL,
  "updated_at"          timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "td_tenant_identifier_unique" UNIQUE ("tenant_id", "device_identifier")
);

CREATE INDEX IF NOT EXISTS "td_tenant_idx"      ON "telematics_devices" ("tenant_id");
CREATE INDEX IF NOT EXISTS "td_provider_idx"    ON "telematics_devices" ("provider_id");
CREATE INDEX IF NOT EXISTS "td_status_idx"      ON "telematics_devices" ("tenant_id", "status");
CREATE INDEX IF NOT EXISTS "td_last_comm_idx"   ON "telematics_devices" ("tenant_id", "last_communication" DESC);

-- ── 3. Vehicle–Device Assignments (history-preserving) ───────────────────────
-- Supports full assignment history.
-- GUARANTEE: at most ONE *current* active assignment per device and per vehicle
-- (enforced by two partial unique indexes on the unassigned_at IS NULL subset).
-- Historical closed assignments (unassigned_at IS NOT NULL) are NOT deduplicated
-- against each other — this is intentional and correct.
-- Temporal overlap between closed records is not prevented at this milestone.
CREATE TABLE IF NOT EXISTS "vehicle_device_assignments" (
  "id"           text PRIMARY KEY NOT NULL,
  "tenant_id"    text NOT NULL,
  "vehicle_id"   text NOT NULL,
  "device_id"    text NOT NULL REFERENCES "telematics_devices"("id"),
  "assigned_at"  timestamp NOT NULL DEFAULT now(),
  "unassigned_at" timestamp,                    -- NULL = currently active
  "assigned_by"  text,                          -- userId who made the assignment
  "notes"        text,
  "created_at"   timestamp DEFAULT now() NOT NULL,
  -- Closed assignment must end after it started:
  CONSTRAINT "vda_time_order" CHECK (
    "unassigned_at" IS NULL OR "unassigned_at" >= "assigned_at"
  )
);

CREATE INDEX IF NOT EXISTS "vda_tenant_idx"      ON "vehicle_device_assignments" ("tenant_id");
CREATE INDEX IF NOT EXISTS "vda_vehicle_idx"     ON "vehicle_device_assignments" ("vehicle_id");
CREATE INDEX IF NOT EXISTS "vda_device_idx"      ON "vehicle_device_assignments" ("device_id");
-- Prevent overlapping active assignments for the same device:
CREATE UNIQUE INDEX IF NOT EXISTS "vda_device_active_unique"
  ON "vehicle_device_assignments" ("device_id")
  WHERE ("unassigned_at" IS NULL);
-- Prevent overlapping active assignments for the same vehicle:
CREATE UNIQUE INDEX IF NOT EXISTS "vda_vehicle_active_unique"
  ON "vehicle_device_assignments" ("vehicle_id")
  WHERE ("unassigned_at" IS NULL);

-- ── 4. Source column on vehicle_gps_history ───────────────────────────────────
-- Persistent source provenance — previously tracked only at runtime.
-- DEVICE = hardware GPS device | DRIVER_APP = Smarty1 driver PWA | DEMO = simulator
ALTER TABLE "vehicle_gps_history"
  ADD COLUMN IF NOT EXISTS "source" text NOT NULL DEFAULT 'DRIVER_APP';
-- Backfill historical rows with DRIVER_APP (the only real source before Milestone D):
-- (DEFAULT handles all new rows; no explicit UPDATE needed for historical rows
-- as DRIVER_APP is the correct historical attribution for all P2-01 pings)

-- Update index to include source for query filtering:
CREATE INDEX IF NOT EXISTS "vgh_source_idx" ON "vehicle_gps_history" ("tenant_id", "source");

-- ── 5. Geofence Definitions ───────────────────────────────────────────────────
-- General-purpose named geofences beyond the implicit loading-point / customer-site
-- geofences that are embedded on the warehouses and customer_locations tables.
-- Supports circle geometry (center + radius). Polygon support is Milestone E+.
CREATE TABLE IF NOT EXISTS "geofence_definitions" (
  "id"           text PRIMARY KEY NOT NULL,
  "tenant_id"    text NOT NULL,
  "name"         text NOT NULL,
  "category"     text NOT NULL DEFAULT 'CUSTOM',  -- LOADING_POINT | CUSTOMER_SITE | DEPOT | WAREHOUSE | CUSTOM
  "center_lat"   real NOT NULL,
  "center_lng"   real NOT NULL,
  "radius_meters" integer NOT NULL DEFAULT 200,
  "status"       text NOT NULL DEFAULT 'ACTIVE',  -- ACTIVE | INACTIVE
  "metadata"     jsonb,
  "notes"        text,
  "created_at"   timestamp DEFAULT now() NOT NULL,
  "updated_at"   timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "gd_tenant_name_unique" UNIQUE ("tenant_id", "name"),
  -- Permanent configuration: enforce valid geography at DB level:
  CONSTRAINT "gd_lat_range"    CHECK ("center_lat"    BETWEEN -90  AND  90),
  CONSTRAINT "gd_lng_range"    CHECK ("center_lng"    BETWEEN -180 AND 180),
  CONSTRAINT "gd_radius_pos"   CHECK ("radius_meters" > 0)
);

CREATE INDEX IF NOT EXISTS "gd_tenant_idx"    ON "geofence_definitions" ("tenant_id");
CREATE INDEX IF NOT EXISTS "gd_status_idx"    ON "geofence_definitions" ("tenant_id", "status");

-- ── 6. Geofence Events ────────────────────────────────────────────────────────
-- ENTER/EXIT events against geofence_definitions (supplementary to the
-- implicit warehouse/customer-site geofence events in operational_events).
-- Idempotency: (geofence_id, vehicle_id, event_type) within a 60-minute window
-- is deduplicated at the application layer (no DB-level unique index needed
-- as timing windows make a pure unique constraint impractical).
CREATE TABLE IF NOT EXISTS "geofence_events" (
  "id"            text PRIMARY KEY NOT NULL,
  "tenant_id"     text NOT NULL,
  "geofence_id"   text NOT NULL REFERENCES "geofence_definitions"("id"),
  "vehicle_id"    text NOT NULL,
  "device_id"     text,
  "trip_id"       text,
  "driver_id"     text,
  "event_type"    text NOT NULL,   -- ENTER | EXIT
  "lat"           real NOT NULL,
  "lng"           real NOT NULL,
  "speed"         real,
  "event_at"      timestamp NOT NULL,
  "created_at"    timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "ge_tenant_idx"    ON "geofence_events" ("tenant_id");
CREATE INDEX IF NOT EXISTS "ge_geofence_idx"  ON "geofence_events" ("geofence_id");
CREATE INDEX IF NOT EXISTS "ge_vehicle_idx"   ON "geofence_events" ("vehicle_id");
CREATE INDEX IF NOT EXISTS "ge_time_idx"      ON "geofence_events" ("tenant_id", "event_at" DESC);

-- ── 7. Telemetry Events ────────────────────────────────────────────────────────
-- Normalised telemetry event log. Source: driver app geofence events,
-- future hardware device events (speeding, harsh braking, etc.)
-- Distinct from operationalEvents (business operations) and geofenceEvents
-- (pure location geometry). Telemetry events = technical/device-layer signals.
CREATE TABLE IF NOT EXISTS "telemetry_events" (
  "id"             text PRIMARY KEY NOT NULL,
  "tenant_id"      text NOT NULL,
  "event_type"     text NOT NULL,     -- GPS_OFFLINE | GPS_RESTORED | GEOFENCE_ENTER | GEOFENCE_EXIT |
                                      -- SPEEDING | HARSH_BRAKING | HARSH_ACCELERATION | IDLE |
                                      -- DEVICE_FAULT | POWER_LOSS | DEVICE_ONLINE | DEVICE_OFFLINE
  "severity"       text NOT NULL DEFAULT 'INFO',   -- INFO | WARNING | CRITICAL
  "status"         text NOT NULL DEFAULT 'OPEN',   -- OPEN | ACKNOWLEDGED | RESOLVED
  "device_id"      text,
  "vehicle_id"     text,
  "driver_id"      text,
  "trip_id"        text,
  "provider_id"    text,
  "source"         text NOT NULL DEFAULT 'DRIVER_APP',  -- DEVICE | DRIVER_APP | DEMO | PLATFORM
  "lat"            real,
  "lng"            real,
  "event_at"       timestamp NOT NULL,
  "metadata"       jsonb,              -- event-specific payload from provider
  "acknowledged_by" text,
  "acknowledged_at" timestamp,
  "created_at"     timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "te_tenant_idx"    ON "telemetry_events" ("tenant_id");
CREATE INDEX IF NOT EXISTS "te_type_idx"      ON "telemetry_events" ("tenant_id", "event_type");
CREATE INDEX IF NOT EXISTS "te_vehicle_idx"   ON "telemetry_events" ("vehicle_id");
CREATE INDEX IF NOT EXISTS "te_time_idx"      ON "telemetry_events" ("tenant_id", "event_at" DESC);
CREATE INDEX IF NOT EXISTS "te_status_idx"    ON "telemetry_events" ("tenant_id", "status");
