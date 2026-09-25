-- P2-02: Unassigned trip planning.
--
-- The approved P2-02 workflow is:
--   Coordinator plans a trip WITHOUT resources  (status = PLANNED, driver_id = NULL, vehicle_id = NULL)
--   Supervisor assigns driver + tanker           (trip stays PLANNED)
--   Supervisor dispatches separately             (status = DISPATCHED)
--
-- trips.driver_id and trips.vehicle_id were created NOT NULL in 0000, which
-- made an unassigned PLANNED trip impossible to persist.
--
-- This migration ONLY relaxes the two NOT NULL constraints.
-- It does not update, null, delete or rebuild any existing row: every
-- historical trip keeps its current driver_id / vehicle_id exactly as-is.
-- DROP NOT NULL is a catalog-only change in PostgreSQL (no table rewrite)
-- and is idempotent (re-running it on an already-nullable column is a no-op).
ALTER TABLE "trips" ALTER COLUMN "driver_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "trips" ALTER COLUMN "vehicle_id" DROP NOT NULL;
