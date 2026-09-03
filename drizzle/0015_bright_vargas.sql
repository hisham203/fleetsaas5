ALTER TABLE "invoices" ALTER COLUMN "order_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "contract_period_id" text;--> statement-breakpoint
CREATE INDEX "invoices_contract_period_idx" ON "invoices" USING btree ("contract_period_id");