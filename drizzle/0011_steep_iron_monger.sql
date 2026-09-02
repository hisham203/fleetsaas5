CREATE TABLE "contract_periods" (
	"id" text PRIMARY KEY NOT NULL,
	"contract_id" text NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"period_trips" integer DEFAULT 0 NOT NULL,
	"period_liters" real DEFAULT 0 NOT NULL,
	"period_revenue" real DEFAULT 0 NOT NULL,
	"invoice_id" text,
	"invoiced_at" timestamp,
	"invoiced_by_user_id" text,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contract_pricing_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"pricing_scope" text NOT NULL,
	"contract_id" text,
	"rate_type" text NOT NULL,
	"city_code" text,
	"zone_code" text,
	"distance_band_code" text,
	"tanker_capacity_ltr" integer,
	"price_per_trip" real,
	"price_per_liter" real,
	"vat_rate" real DEFAULT 0.15 NOT NULL,
	"effective_start_date" timestamp,
	"effective_end_date" timestamp,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contract_sites" (
	"id" text PRIMARY KEY NOT NULL,
	"contract_id" text NOT NULL,
	"customer_location_id" text NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"contract_number" text NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"applies_to_all_sites" boolean DEFAULT true NOT NULL,
	"total_trips_purchased" integer,
	"trips_used" integer DEFAULT 0 NOT NULL,
	"start_date" timestamp NOT NULL,
	"end_date" timestamp,
	"billing_cadence" text,
	"notes" text,
	"created_by_user_id" text,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "contracts_contract_number_unique" UNIQUE("contract_number")
);
--> statement-breakpoint
CREATE TABLE "distance_bands" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"code" text NOT NULL,
	"from_km" real NOT NULL,
	"to_km" real,
	"label" text NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"invoice_id" text NOT NULL,
	"order_id" text NOT NULL,
	"line_amount" real NOT NULL,
	"line_vat_amount" real NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customer_locations" ADD COLUMN "city_code" text;--> statement-breakpoint
ALTER TABLE "customer_locations" ADD COLUMN "zone_code" text;--> statement-breakpoint
ALTER TABLE "customer_locations" ADD COLUMN "distance_band_code" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "contract_id" text;