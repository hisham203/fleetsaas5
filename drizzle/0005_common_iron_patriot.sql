CREATE TABLE "exceptions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"order_id" text NOT NULL,
	"trip_stop_id" text NOT NULL,
	"type" text NOT NULL,
	"reason" text,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"escalated" boolean DEFAULT false NOT NULL,
	"escalated_to_user_id" text,
	"escalated_at" timestamp,
	"resolution_action" text,
	"resolution_notes" text,
	"return_note_number" text,
	"quantity_returned" integer,
	"follow_up_order_id" text,
	"customer_notified" boolean DEFAULT false NOT NULL,
	"customer_notified_at" timestamp,
	"created_at" timestamp NOT NULL,
	"resolved_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "previous_order_id" text;