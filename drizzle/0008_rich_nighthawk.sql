CREATE TABLE "expense_claims" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"driver_id" text NOT NULL,
	"vehicle_id" text NOT NULL,
	"trip_id" text,
	"reason" text,
	"category" text NOT NULL,
	"amount" real NOT NULL,
	"description" text,
	"receipt_description" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"reviewed_by_user_id" text,
	"reviewed_at" timestamp,
	"review_notes" text,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"driver_id" text NOT NULL,
	"vehicle_id" text,
	"trip_id" text,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"notes" text,
	"status" text DEFAULT 'ASSIGNED' NOT NULL,
	"assigned_by_user_id" text NOT NULL,
	"due_at" timestamp,
	"started_at" timestamp,
	"completed_at" timestamp,
	"completion_notes" text,
	"created_at" timestamp NOT NULL
);
