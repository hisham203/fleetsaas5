ALTER TABLE "contract_periods" ADD COLUMN "tenant_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "contract_pricing_rules" ADD COLUMN "priority" integer;--> statement-breakpoint
ALTER TABLE "distance_bands" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "distance_bands" ADD COLUMN "retired_at" timestamp;--> statement-breakpoint
ALTER TABLE "distance_bands" ADD COLUMN "replaced_by_distance_band_id" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "invoice_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "contract_periods_contract_period_unique" ON "contract_periods" USING btree ("contract_id","period_start","period_end");--> statement-breakpoint
CREATE INDEX "contract_pricing_rules_lookup_idx" ON "contract_pricing_rules" USING btree ("tenant_id","pricing_scope","rate_type","contract_id");--> statement-breakpoint
CREATE UNIQUE INDEX "distance_bands_tenant_code_unique" ON "distance_bands" USING btree ("tenant_id","code");