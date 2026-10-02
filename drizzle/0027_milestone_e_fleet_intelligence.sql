-- ============================================================
-- Migration 0027 — Milestone E: Fleet Intelligence V2
-- Production-safe, forward-only, additive only.
-- PostgreSQL 18 compatible.
-- ============================================================

-- ── 1. Vehicle Geofence State ─────────────────────────────────────────────────
-- Tracks current INSIDE/OUTSIDE state per (vehicle, geofence) pair.
-- Purpose: deduplication — prevents generating repeated ENTER events
-- when a vehicle remains inside a geofence across multiple GPS pings.
-- The ENTER event fires only when transitioning OUTSIDE → INSIDE,
-- and EXIT fires only on INSIDE → OUTSIDE.
-- One row per (vehicle_id, geofence_id) — upserted on every GPS ping.
CREATE TABLE IF NOT EXISTS "vehicle_geofence_state" (
  "id"             text PRIMARY KEY NOT NULL,
  "tenant_id"      text NOT NULL,
  "vehicle_id"     text NOT NULL,
  "geofence_id"    text NOT NULL REFERENCES "geofence_definitions"("id"),
  "current_state"  text NOT NULL DEFAULT 'OUTSIDE',  -- INSIDE | OUTSIDE
  "last_entered_at" timestamp,
  "last_exited_at"  timestamp,
  "updated_at"     timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "vgs_vehicle_geofence_unique" UNIQUE ("vehicle_id", "geofence_id"),
  CONSTRAINT "vgs_state_values" CHECK ("current_state" IN ('INSIDE', 'OUTSIDE'))
);

CREATE INDEX IF NOT EXISTS "vgs_tenant_idx"   ON "vehicle_geofence_state" ("tenant_id");
CREATE INDEX IF NOT EXISTS "vgs_vehicle_idx"  ON "vehicle_geofence_state" ("vehicle_id");
CREATE INDEX IF NOT EXISTS "vgs_inside_idx"   ON "vehicle_geofence_state" ("tenant_id", "geofence_id")
  WHERE ("current_state" = 'INSIDE');

-- ── 2. Fleet Operational State on trips ──────────────────────────────────────
-- Adds derived operational state column to trips for efficient map queries.
-- Possible values: MOVING | IDLE | STOPPED | UNKNOWN
-- Derived from speed field when available; otherwise from GPS ping recency.
-- Updated by the GPS ingestion pipeline. Nullable — NULL means no data yet.
ALTER TABLE "trips"
  ADD COLUMN IF NOT EXISTS "operational_state" text;
