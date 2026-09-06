CREATE TABLE "contract_delivery_schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"contract_id" text NOT NULL,
	"location_id" text,
	"schedule_name" text NOT NULL,
	"schedule_type" text NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"start_date" timestamp NOT NULL,
	"end_date" timestamp,
	"preferred_start_time" text,
	"preferred_end_time" text,
	"timezone" text,
	"weekdays" text,
	"month_day" integer,
	"interval_every_days" integer,
	"quantity_liters" real,
	"preferred_tanker_capacity_liters" integer,
	"loading_point_id" text,
	"notes" text,
	"created_by_user_id" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "planned_contract_demands" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"contract_id" text NOT NULL,
	"contract_delivery_schedule_id" text,
	"customer_id" text NOT NULL,
	"location_id" text,
	"planned_date" timestamp NOT NULL,
	"planned_start_time" text,
	"planned_end_time" text,
	"timezone" text,
	"quantity_liters" real,
	"preferred_tanker_capacity_liters" integer,
	"loading_point_id" text,
	"status" text DEFAULT 'GENERATED' NOT NULL,
	"readiness_status" text,
	"blocked_reasons" text,
	"capacity_match_status" text DEFAULT 'NOT_CHECKED',
	"generated_at" timestamp,
	"approved_at" timestamp,
	"approved_by_user_id" text,
	"converted_order_id" text,
	"converted_at" timestamp,
	"cancelled_at" timestamp,
	"cancelled_by_user_id" text,
	"cancellation_reason" text,
	"generation_key" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE INDEX "contract_delivery_schedules_tenant_idx" ON "contract_delivery_schedules" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "contract_delivery_schedules_contract_status_idx" ON "contract_delivery_schedules" USING btree ("tenant_id","contract_id","status");--> statement-breakpoint
CREATE INDEX "contract_delivery_schedules_status_idx" ON "contract_delivery_schedules" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "planned_contract_demands_tenant_idx" ON "planned_contract_demands" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "planned_contract_demands_status_date_idx" ON "planned_contract_demands" USING btree ("tenant_id","status","planned_date");--> statement-breakpoint
CREATE INDEX "planned_contract_demands_contract_date_idx" ON "planned_contract_demands" USING btree ("tenant_id","contract_id","planned_date");--> statement-breakpoint
CREATE INDEX "planned_contract_demands_customer_date_idx" ON "planned_contract_demands" USING btree ("tenant_id","customer_id","planned_date");--> statement-breakpoint
CREATE UNIQUE INDEX "planned_contract_demands_converted_order_unique" ON "planned_contract_demands" USING btree ("converted_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "planned_contract_demands_generation_key_unique" ON "planned_contract_demands" USING btree ("generation_key");