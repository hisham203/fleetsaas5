CREATE TABLE "trip_lifecycle_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"trip_id" text NOT NULL,
	"event_type" text NOT NULL,
	"actor_user_id" text,
	"driver_id" text,
	"lat" real,
	"lng" real,
	"notes" text,
	"loaded_liters" real,
	"delivered_liters" real,
	"stop_id" text,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE INDEX "trip_lifecycle_events_tenant_idx" ON "trip_lifecycle_events" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "trip_lifecycle_events_trip_idx" ON "trip_lifecycle_events" USING btree ("tenant_id","trip_id");--> statement-breakpoint
CREATE INDEX "trip_lifecycle_events_type_idx" ON "trip_lifecycle_events" USING btree ("tenant_id","event_type");