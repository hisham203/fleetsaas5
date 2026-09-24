-- P2-02: Enterprise RBAC, Dispatch Governance & Resource Assignment
-- Additive only. No DROP, no TRUNCATE. No destructive changes.
--
-- Changes:
-- 1. roles: add is_active (soft deactivation), updated_at
-- 2. permissions: add code (stable machine-readable key), category, is_sensitive
-- 3. role_permissions: add granted_at, granted_by for audit
-- 4. user_roles: add assigned_at, assigned_by for audit
-- 5. role_audit_log: new table for authorization change audit trail
-- 6. trips: add dispatched_at, dispatched_by for dispatch governance

-- ── 1. roles: deactivation support ─────────────────────────────────────────────
ALTER TABLE "roles"
  ADD COLUMN IF NOT EXISTS "is_active" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp DEFAULT now();

-- ── 2. permissions: stable code, category, sensitivity flag ────────────────────
ALTER TABLE "permissions"
  ADD COLUMN IF NOT EXISTS "code" text,
  ADD COLUMN IF NOT EXISTS "category" text,
  ADD COLUMN IF NOT EXISTS "is_sensitive" boolean NOT NULL DEFAULT false;

-- Unique code constraint (code is the stable machine-readable key):
CREATE UNIQUE INDEX IF NOT EXISTS "permissions_code_unique" ON "permissions" ("code") WHERE "code" IS NOT NULL;

-- ── 3. role_permissions: audit fields ──────────────────────────────────────────
ALTER TABLE "role_permissions"
  ADD COLUMN IF NOT EXISTS "granted_at" timestamp DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "granted_by" text;

-- ── 4. user_roles: audit fields ─────────────────────────────────────────────────
ALTER TABLE "user_roles"
  ADD COLUMN IF NOT EXISTS "assigned_at" timestamp DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "assigned_by" text;

-- ── 5. role_audit_log: immutable authorization change trail ────────────────────
CREATE TABLE IF NOT EXISTS "role_audit_log" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text,
  "actor_id" text NOT NULL,
  "action" text NOT NULL,
  "target_type" text NOT NULL,
  "target_id" text NOT NULL,
  "target_label" text,
  "detail" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "role_audit_tenant_idx" ON "role_audit_log" ("tenant_id", "created_at" DESC);

-- ── 6. trips: dispatch governance ──────────────────────────────────────────────
ALTER TABLE "trips"
  ADD COLUMN IF NOT EXISTS "dispatched_at" timestamp,
  ADD COLUMN IF NOT EXISTS "dispatched_by" text;
-- Also add DISPATCHED to supported statuses (enforced at application layer).
-- Current values: PLANNED, STARTED, ARRIVED_LOADING, LOADING_COMPLETE, ARRIVED_SITE, COMPLETED
-- New value: DISPATCHED (between PLANNED and STARTED)
-- No schema change required — status is a text column.
