CREATE TABLE "saved_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"name" text NOT NULL,
	"dataset_key" text NOT NULL,
	"config" text NOT NULL,
	"created_at" timestamp NOT NULL
);
