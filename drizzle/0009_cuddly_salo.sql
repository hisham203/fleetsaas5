CREATE TABLE "credit_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"credit_note_number" text NOT NULL,
	"amount" real NOT NULL,
	"reason" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "credit_notes_credit_note_number_unique" UNIQUE("credit_note_number")
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "contract_price_per_bottle" real;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "discount_amount" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "cash_settled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "cash_settled_at" timestamp;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "cash_settled_by_user_id" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "discount_amount" real DEFAULT 0 NOT NULL;