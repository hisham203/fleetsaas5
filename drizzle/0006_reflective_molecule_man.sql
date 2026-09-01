CREATE TABLE "escalations" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"order_id" text NOT NULL,
	"severity" text NOT NULL,
	"sla_status_at_escalation" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"escalated_to_user_id" text,
	"notified_at" timestamp NOT NULL,
	"acknowledged_at" timestamp,
	"acknowledged_by_user_id" text,
	"resolved_at" timestamp,
	"resolution_notes" text,
	"created_at" timestamp NOT NULL
);
