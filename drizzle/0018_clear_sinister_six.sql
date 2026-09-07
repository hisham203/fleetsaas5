CREATE TABLE "numbering_sequence_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"series_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"generated_number" text NOT NULL,
	"sequence_number" integer NOT NULL,
	"period_key" text,
	"reference_table" text,
	"reference_id" text,
	"generated_by_user_id" text,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "numbering_series" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"series_code" text NOT NULL,
	"display_name" text NOT NULL,
	"prefix" text NOT NULL,
	"series_segment" text,
	"suffix" text,
	"separator" text DEFAULT '' NOT NULL,
	"padding_length" integer DEFAULT 3 NOT NULL,
	"next_number" integer DEFAULT 1 NOT NULL,
	"reset_policy" text DEFAULT 'NEVER' NOT NULL,
	"include_year" boolean DEFAULT false NOT NULL,
	"include_month" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"description" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE INDEX "numbering_sequence_ledger_tenant_idx" ON "numbering_sequence_ledger" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "numbering_sequence_ledger_tenant_series_idx" ON "numbering_sequence_ledger" USING btree ("tenant_id","series_id");--> statement-breakpoint
CREATE INDEX "numbering_sequence_ledger_tenant_entity_type_idx" ON "numbering_sequence_ledger" USING btree ("tenant_id","entity_type");--> statement-breakpoint
CREATE UNIQUE INDEX "numbering_sequence_ledger_tenant_generated_number_unique" ON "numbering_sequence_ledger" USING btree ("tenant_id","entity_type","generated_number");--> statement-breakpoint
CREATE UNIQUE INDEX "numbering_sequence_ledger_series_period_sequence_unique" ON "numbering_sequence_ledger" USING btree ("tenant_id","series_id","period_key","sequence_number");--> statement-breakpoint
CREATE INDEX "numbering_sequence_ledger_tenant_reference_idx" ON "numbering_sequence_ledger" USING btree ("tenant_id","reference_table","reference_id");--> statement-breakpoint
CREATE INDEX "numbering_sequence_ledger_tenant_created_idx" ON "numbering_sequence_ledger" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "numbering_series_tenant_idx" ON "numbering_series" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "numbering_series_tenant_entity_type_unique" ON "numbering_series" USING btree ("tenant_id","entity_type");--> statement-breakpoint
CREATE UNIQUE INDEX "numbering_series_tenant_series_code_unique" ON "numbering_series" USING btree ("tenant_id","series_code");--> statement-breakpoint
CREATE INDEX "numbering_series_tenant_status_idx" ON "numbering_series" USING btree ("tenant_id","status");