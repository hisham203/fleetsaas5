CREATE TABLE "erp_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"provider" text DEFAULT 'ODOO' NOT NULL,
	"base_url" text NOT NULL,
	"database" text NOT NULL,
	"username" text NOT NULL,
	"api_key" text NOT NULL,
	"default_tax_id" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_tested_at" timestamp,
	"last_test_status" text,
	"last_test_error" text,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "erp_connections_tenant_id_unique" UNIQUE("tenant_id")
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "erp_external_id" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "erp_external_id" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "erp_synced_at" timestamp;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "erp_sync_error" text;