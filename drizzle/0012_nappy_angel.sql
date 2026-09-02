DROP TABLE "contract_sites" CASCADE;--> statement-breakpoint
DROP TABLE "invoice_orders" CASCADE;--> statement-breakpoint
ALTER TABLE "contract_periods" DROP COLUMN "invoice_id";