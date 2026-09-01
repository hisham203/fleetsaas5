CREATE TABLE "scorecard_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"on_time_weight" real DEFAULT 50 NOT NULL,
	"delivery_success_weight" real DEFAULT 30 NOT NULL,
	"trip_volume_weight" real DEFAULT 20 NOT NULL,
	"trip_volume_cap" integer DEFAULT 20 NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "scorecard_configs_tenant_id_unique" UNIQUE("tenant_id")
);
