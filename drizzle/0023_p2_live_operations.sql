-- P2-01: Live Operations — GPS history table + geofence radius columns
-- Additive only. No DROP, no TRUNCATE, no destructive changes.

-- GPS tracking history per vehicle/trip (one row per position update):
CREATE TABLE IF NOT EXISTS "vehicle_gps_history" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "trip_id" text NOT NULL,
  "vehicle_id" text NOT NULL,
  "driver_id" text NOT NULL,
  "lat" real NOT NULL,
  "lng" real NOT NULL,
  "accuracy" real,
  "speed" real,
  "heading" real,
  "recorded_at" timestamp DEFAULT now() NOT NULL
);

-- Indexes for efficient latest-position and history queries:
CREATE INDEX IF NOT EXISTS "vgh_trip_idx" ON "vehicle_gps_history" ("trip_id");
CREATE INDEX IF NOT EXISTS "vgh_vehicle_idx" ON "vehicle_gps_history" ("vehicle_id");
CREATE INDEX IF NOT EXISTS "vgh_tenant_time_idx" ON "vehicle_gps_history" ("tenant_id", "recorded_at" DESC);

-- Geofence radius for loading points (warehouses table):
ALTER TABLE "warehouses" ADD COLUMN IF NOT EXISTS "geofence_radius_meters" integer DEFAULT 200;

-- Geofence radius for customer delivery sites:
ALTER TABLE "customer_locations" ADD COLUMN IF NOT EXISTS "geofence_radius_meters" integer DEFAULT 150;

-- Operational event feed (geofence arrivals, GPS stale, late trips, etc.):
CREATE TABLE IF NOT EXISTS "operational_events" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "event_type" text NOT NULL,
  "trip_id" text,
  "vehicle_id" text,
  "driver_id" text,
  "order_id" text,
  "message" text NOT NULL,
  "severity" text NOT NULL DEFAULT 'INFO',
  "read" boolean NOT NULL DEFAULT false,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "opev_tenant_idx" ON "operational_events" ("tenant_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "opev_unread_idx" ON "operational_events" ("tenant_id", "read") WHERE "read" = false;
