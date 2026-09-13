ALTER TABLE "customer_locations" ADD COLUMN "site_code" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "customer_code" text;--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN "driver_code" text;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "vehicle_code" text;--> statement-breakpoint
ALTER TABLE "warehouses" ADD COLUMN "loading_point_code" text;--> statement-breakpoint
CREATE INDEX "customer_locations_site_code_idx" ON "customer_locations" USING btree ("site_code");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_tenant_customer_code_unique" ON "customers" USING btree ("tenant_id","customer_code");--> statement-breakpoint
CREATE UNIQUE INDEX "drivers_tenant_driver_code_unique" ON "drivers" USING btree ("tenant_id","driver_code");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicles_tenant_vehicle_code_unique" ON "vehicles" USING btree ("tenant_id","vehicle_code");--> statement-breakpoint
CREATE UNIQUE INDEX "warehouses_tenant_loading_point_code_unique" ON "warehouses" USING btree ("tenant_id","loading_point_code");