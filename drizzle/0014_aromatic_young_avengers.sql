CREATE TABLE "contract_site_scope" (
	"id" text PRIMARY KEY NOT NULL,
	"contract_id" text NOT NULL,
	"customer_location_id" text NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_line_items" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"order_id" text,
	"description" text,
	"quantity" real,
	"unit_price" real,
	"line_amount" real NOT NULL,
	"line_vat_amount" real NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "contract_site_scope_contract_site_unique" ON "contract_site_scope" USING btree ("contract_id","customer_location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_line_items_invoice_order_unique" ON "invoice_line_items" USING btree ("invoice_id","order_id");--> statement-breakpoint
CREATE INDEX "invoice_line_items_invoice_idx" ON "invoice_line_items" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "invoice_line_items_order_idx" ON "invoice_line_items" USING btree ("order_id");