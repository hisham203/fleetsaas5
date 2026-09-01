CREATE TABLE "customer_locations" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"label" text NOT NULL,
	"address" text NOT NULL,
	"lat" real,
	"lng" real,
	"contact_name" text,
	"contact_phone" text,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT 'B2C' NOT NULL,
	"phone" text,
	"address" text NOT NULL,
	"lat" real,
	"lng" real,
	"credit_limit" real,
	"login_email" text,
	"password_hash" text,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "customers_login_email_unique" UNIQUE("login_email")
);
--> statement-breakpoint
CREATE TABLE "drivers" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"license_number" text NOT NULL,
	"license_expiry" timestamp,
	"phone" text,
	"status" text DEFAULT 'AVAILABLE' NOT NULL,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "drivers_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "epods" (
	"id" text PRIMARY KEY NOT NULL,
	"trip_stop_id" text NOT NULL,
	"delivered_qty" integer NOT NULL,
	"empties_collected" integer DEFAULT 0 NOT NULL,
	"recipient_name" text,
	"signature_note" text,
	"lat" real,
	"lng" real,
	"notes" text,
	"delivered_at" timestamp NOT NULL,
	CONSTRAINT "epods_trip_stop_id_unique" UNIQUE("trip_stop_id")
);
--> statement-breakpoint
CREATE TABLE "fuel_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"vehicle_id" text NOT NULL,
	"trip_id" text,
	"liters_filled" real NOT NULL,
	"cost_sar" real NOT NULL,
	"odometer_reading" integer,
	"filled_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_items" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"warehouse_id" text NOT NULL,
	"item_name" text NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"unit" text DEFAULT 'bottle' NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"invoice_number" text NOT NULL,
	"order_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"subtotal" real NOT NULL,
	"vat_rate" real DEFAULT 0.15 NOT NULL,
	"vat_amount" real NOT NULL,
	"total" real NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "invoices_invoice_number_unique" UNIQUE("invoice_number"),
	CONSTRAINT "invoices_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
CREATE TABLE "maintenance_records" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"vehicle_id" text NOT NULL,
	"type" text DEFAULT 'PREVENTIVE' NOT NULL,
	"description" text NOT NULL,
	"odometer_reading" integer,
	"cost" real,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"opened_at" timestamp NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"order_number" text NOT NULL,
	"customer_id" text NOT NULL,
	"location_id" text,
	"type" text DEFAULT 'ONE_TIME' NOT NULL,
	"bottle_size_ltr" integer DEFAULT 19 NOT NULL,
	"qty_ordered" integer DEFAULT 1 NOT NULL,
	"empty_bottles_to_collect" integer DEFAULT 0 NOT NULL,
	"delivery_address" text NOT NULL,
	"lat" real,
	"lng" real,
	"requested_time" timestamp,
	"sla_minutes" integer DEFAULT 180 NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"payment_method" text DEFAULT 'CASH' NOT NULL,
	"price_per_bottle" real DEFAULT 8 NOT NULL,
	"failure_reason" text,
	"completed_at" timestamp,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "orders_order_number_unique" UNIQUE("order_number")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"bottle_size_ltr" integer DEFAULT 19 NOT NULL,
	"qty_per_delivery" integer DEFAULT 1 NOT NULL,
	"frequency_days" integer DEFAULT 7 NOT NULL,
	"price_per_bottle" real DEFAULT 8 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"next_due_date" timestamp,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"sector" text DEFAULT 'WATER_DELIVERY' NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trip_stops" (
	"id" text PRIMARY KEY NOT NULL,
	"trip_id" text NOT NULL,
	"order_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"arrived_at" timestamp,
	"completed_at" timestamp,
	CONSTRAINT "trip_stops_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
CREATE TABLE "trips" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"trip_number" text NOT NULL,
	"driver_id" text NOT NULL,
	"vehicle_id" text NOT NULL,
	"warehouse_id" text NOT NULL,
	"status" text DEFAULT 'PLANNED' NOT NULL,
	"loading_confirmed" boolean DEFAULT false NOT NULL,
	"loading_confirmed_at" timestamp,
	"estimated_duration_minutes" integer,
	"current_lat" real,
	"current_lng" real,
	"last_ping_at" timestamp,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "trips_trip_number_unique" UNIQUE("trip_number")
);
--> statement-breakpoint
CREATE TABLE "tyre_records" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"vehicle_id" text NOT NULL,
	"position" text NOT NULL,
	"serial_number" text,
	"cost_sar" real,
	"install_odometer" integer,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"installed_at" timestamp NOT NULL,
	"retired_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"role" text NOT NULL,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"plate_number" text NOT NULL,
	"vehicle_type" text NOT NULL,
	"capacity_liters" integer,
	"capacity_units" integer,
	"status" text DEFAULT 'AVAILABLE' NOT NULL,
	"license_expiry" timestamp,
	"insurance_expiry" timestamp,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "warehouses" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"address" text NOT NULL,
	"lat" real NOT NULL,
	"lng" real NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp NOT NULL
);
