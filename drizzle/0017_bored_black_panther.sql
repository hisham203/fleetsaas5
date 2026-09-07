CREATE TABLE "goods_receipt_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"goods_receipt_id" text NOT NULL,
	"purchase_order_line_id" text NOT NULL,
	"item_id" text NOT NULL,
	"received_quantity" real NOT NULL,
	"accepted_quantity" real DEFAULT 0 NOT NULL,
	"rejected_quantity" real DEFAULT 0 NOT NULL,
	"unit_of_measure" text NOT NULL,
	"notes" text,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goods_receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"receipt_number" text NOT NULL,
	"purchase_order_id" text NOT NULL,
	"warehouse_id" text NOT NULL,
	"received_by_user_id" text NOT NULL,
	"received_at" timestamp NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"notes" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "item_categories" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"item_group_id" text,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "item_groups" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "item_subcategories" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"category_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"item_code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"item_group_id" text,
	"category_id" text NOT NULL,
	"sub_category_id" text,
	"item_type" text NOT NULL,
	"unit_of_measure" text NOT NULL,
	"is_stocked" boolean DEFAULT true NOT NULL,
	"is_serialized" boolean DEFAULT false NOT NULL,
	"is_tire" boolean DEFAULT false NOT NULL,
	"brand" text,
	"model" text,
	"part_number" text,
	"image_url" text,
	"compatible_vehicle_type" text,
	"minimum_stock_level" real,
	"reorder_point" real,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "maintenance_inventory_balances" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"warehouse_id" text NOT NULL,
	"item_id" text NOT NULL,
	"quantity_on_hand" real DEFAULT 0 NOT NULL,
	"quantity_reserved" real DEFAULT 0 NOT NULL,
	"quantity_available" real DEFAULT 0 NOT NULL,
	"last_movement_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "maintenance_inventory_movements" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"warehouse_id" text NOT NULL,
	"item_id" text NOT NULL,
	"movement_type" text NOT NULL,
	"quantity" real NOT NULL,
	"unit_of_measure" text NOT NULL,
	"reference_type" text,
	"reference_id" text,
	"vehicle_id" text,
	"maintenance_record_id" text,
	"purchase_order_id" text,
	"goods_receipt_id" text,
	"notes" text,
	"created_by_user_id" text,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "maintenance_warehouses" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"warehouse_code" text NOT NULL,
	"name" text NOT NULL,
	"warehouse_type" text DEFAULT 'WORKSHOP_STORE' NOT NULL,
	"workshop_id" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"address" text,
	"city" text,
	"district" text,
	"lat" real,
	"lng" real,
	"notes" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "purchase_order_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"purchase_order_id" text NOT NULL,
	"item_id" text NOT NULL,
	"description" text,
	"ordered_quantity" real NOT NULL,
	"received_quantity" real DEFAULT 0 NOT NULL,
	"unit_of_measure" text NOT NULL,
	"unit_price" real DEFAULT 0 NOT NULL,
	"tax_rate" real DEFAULT 0 NOT NULL,
	"line_total" real DEFAULT 0 NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"po_number" text NOT NULL,
	"supplier_id" text NOT NULL,
	"source_purchase_requisition_id" text,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"order_date" timestamp NOT NULL,
	"expected_delivery_date" timestamp,
	"subtotal" real DEFAULT 0 NOT NULL,
	"tax_amount" real DEFAULT 0 NOT NULL,
	"total_amount" real DEFAULT 0 NOT NULL,
	"notes" text,
	"issued_by_user_id" text,
	"issued_at" timestamp,
	"closed_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "purchase_requisition_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"purchase_requisition_id" text NOT NULL,
	"item_id" text NOT NULL,
	"description" text,
	"quantity" real NOT NULL,
	"unit_of_measure" text NOT NULL,
	"estimated_unit_cost" real,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "purchase_requisitions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"pr_number" text NOT NULL,
	"requested_by_user_id" text NOT NULL,
	"workshop_id" text,
	"warehouse_id" text,
	"vehicle_id" text,
	"maintenance_record_id" text,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"priority" text DEFAULT 'NORMAL' NOT NULL,
	"required_by_date" timestamp,
	"justification" text,
	"approved_by_user_id" text,
	"approved_at" timestamp,
	"rejected_by_user_id" text,
	"rejected_at" timestamp,
	"rejection_reason" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"supplier_code" text NOT NULL,
	"name" text NOT NULL,
	"contact_name" text,
	"phone" text,
	"email" text,
	"address" text,
	"tax_number" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"notes" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "workshops" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"workshop_code" text NOT NULL,
	"name" text NOT NULL,
	"workshop_type" text DEFAULT 'INTERNAL' NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"address" text,
	"city" text,
	"district" text,
	"lat" real,
	"lng" real,
	"contact_name" text,
	"contact_phone" text,
	"contact_email" text,
	"notes" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE INDEX "goods_receipt_lines_tenant_idx" ON "goods_receipt_lines" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "goods_receipt_lines_tenant_receipt_idx" ON "goods_receipt_lines" USING btree ("tenant_id","goods_receipt_id");--> statement-breakpoint
CREATE INDEX "goods_receipt_lines_tenant_po_line_idx" ON "goods_receipt_lines" USING btree ("tenant_id","purchase_order_line_id");--> statement-breakpoint
CREATE INDEX "goods_receipt_lines_tenant_item_idx" ON "goods_receipt_lines" USING btree ("tenant_id","item_id");--> statement-breakpoint
CREATE INDEX "goods_receipts_tenant_idx" ON "goods_receipts" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "goods_receipts_tenant_receipt_number_unique" ON "goods_receipts" USING btree ("tenant_id","receipt_number");--> statement-breakpoint
CREATE INDEX "goods_receipts_tenant_po_idx" ON "goods_receipts" USING btree ("tenant_id","purchase_order_id");--> statement-breakpoint
CREATE INDEX "goods_receipts_tenant_warehouse_idx" ON "goods_receipts" USING btree ("tenant_id","warehouse_id");--> statement-breakpoint
CREATE INDEX "goods_receipts_tenant_status_idx" ON "goods_receipts" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "item_categories_tenant_idx" ON "item_categories" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "item_categories_tenant_code_unique" ON "item_categories" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "item_categories_tenant_group_idx" ON "item_categories" USING btree ("tenant_id","item_group_id");--> statement-breakpoint
CREATE INDEX "item_categories_tenant_status_idx" ON "item_categories" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "item_groups_tenant_idx" ON "item_groups" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "item_groups_tenant_code_unique" ON "item_groups" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "item_groups_tenant_status_idx" ON "item_groups" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "item_subcategories_tenant_idx" ON "item_subcategories" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "item_subcategories_tenant_category_idx" ON "item_subcategories" USING btree ("tenant_id","category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "item_subcategories_tenant_code_unique" ON "item_subcategories" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "item_subcategories_tenant_status_idx" ON "item_subcategories" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "items_tenant_idx" ON "items" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "items_tenant_item_code_unique" ON "items" USING btree ("tenant_id","item_code");--> statement-breakpoint
CREATE INDEX "items_tenant_category_idx" ON "items" USING btree ("tenant_id","category_id");--> statement-breakpoint
CREATE INDEX "items_tenant_subcategory_idx" ON "items" USING btree ("tenant_id","sub_category_id");--> statement-breakpoint
CREATE INDEX "items_tenant_type_idx" ON "items" USING btree ("tenant_id","item_type");--> statement-breakpoint
CREATE INDEX "items_tenant_status_idx" ON "items" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "maintenance_inventory_balances_tenant_idx" ON "maintenance_inventory_balances" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "maintenance_inventory_balances_tenant_warehouse_idx" ON "maintenance_inventory_balances" USING btree ("tenant_id","warehouse_id");--> statement-breakpoint
CREATE INDEX "maintenance_inventory_balances_tenant_item_idx" ON "maintenance_inventory_balances" USING btree ("tenant_id","item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "maintenance_inventory_balances_warehouse_item_unique" ON "maintenance_inventory_balances" USING btree ("tenant_id","warehouse_id","item_id");--> statement-breakpoint
CREATE INDEX "maintenance_inventory_movements_tenant_idx" ON "maintenance_inventory_movements" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "maintenance_inventory_movements_tenant_warehouse_idx" ON "maintenance_inventory_movements" USING btree ("tenant_id","warehouse_id");--> statement-breakpoint
CREATE INDEX "maintenance_inventory_movements_tenant_item_idx" ON "maintenance_inventory_movements" USING btree ("tenant_id","item_id");--> statement-breakpoint
CREATE INDEX "maintenance_inventory_movements_tenant_type_idx" ON "maintenance_inventory_movements" USING btree ("tenant_id","movement_type");--> statement-breakpoint
CREATE INDEX "maintenance_inventory_movements_tenant_created_idx" ON "maintenance_inventory_movements" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "maintenance_inventory_movements_tenant_vehicle_idx" ON "maintenance_inventory_movements" USING btree ("tenant_id","vehicle_id");--> statement-breakpoint
CREATE INDEX "maintenance_inventory_movements_tenant_reference_idx" ON "maintenance_inventory_movements" USING btree ("tenant_id","reference_type","reference_id");--> statement-breakpoint
CREATE INDEX "maintenance_warehouses_tenant_idx" ON "maintenance_warehouses" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "maintenance_warehouses_tenant_code_unique" ON "maintenance_warehouses" USING btree ("tenant_id","warehouse_code");--> statement-breakpoint
CREATE INDEX "maintenance_warehouses_tenant_workshop_idx" ON "maintenance_warehouses" USING btree ("tenant_id","workshop_id");--> statement-breakpoint
CREATE INDEX "maintenance_warehouses_tenant_status_idx" ON "maintenance_warehouses" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "maintenance_warehouses_tenant_city_idx" ON "maintenance_warehouses" USING btree ("tenant_id","city");--> statement-breakpoint
CREATE INDEX "purchase_order_lines_tenant_idx" ON "purchase_order_lines" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "purchase_order_lines_tenant_po_idx" ON "purchase_order_lines" USING btree ("tenant_id","purchase_order_id");--> statement-breakpoint
CREATE INDEX "purchase_order_lines_tenant_item_idx" ON "purchase_order_lines" USING btree ("tenant_id","item_id");--> statement-breakpoint
CREATE INDEX "purchase_orders_tenant_idx" ON "purchase_orders" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_orders_tenant_po_number_unique" ON "purchase_orders" USING btree ("tenant_id","po_number");--> statement-breakpoint
CREATE INDEX "purchase_orders_tenant_supplier_idx" ON "purchase_orders" USING btree ("tenant_id","supplier_id");--> statement-breakpoint
CREATE INDEX "purchase_orders_tenant_status_idx" ON "purchase_orders" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "purchase_orders_tenant_source_pr_idx" ON "purchase_orders" USING btree ("tenant_id","source_purchase_requisition_id");--> statement-breakpoint
CREATE INDEX "purchase_requisition_lines_tenant_idx" ON "purchase_requisition_lines" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "purchase_requisition_lines_tenant_pr_idx" ON "purchase_requisition_lines" USING btree ("tenant_id","purchase_requisition_id");--> statement-breakpoint
CREATE INDEX "purchase_requisition_lines_tenant_item_idx" ON "purchase_requisition_lines" USING btree ("tenant_id","item_id");--> statement-breakpoint
CREATE INDEX "purchase_requisitions_tenant_idx" ON "purchase_requisitions" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_requisitions_tenant_pr_number_unique" ON "purchase_requisitions" USING btree ("tenant_id","pr_number");--> statement-breakpoint
CREATE INDEX "purchase_requisitions_tenant_status_idx" ON "purchase_requisitions" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "purchase_requisitions_tenant_requested_by_idx" ON "purchase_requisitions" USING btree ("tenant_id","requested_by_user_id");--> statement-breakpoint
CREATE INDEX "purchase_requisitions_tenant_workshop_idx" ON "purchase_requisitions" USING btree ("tenant_id","workshop_id");--> statement-breakpoint
CREATE INDEX "purchase_requisitions_tenant_warehouse_idx" ON "purchase_requisitions" USING btree ("tenant_id","warehouse_id");--> statement-breakpoint
CREATE INDEX "purchase_requisitions_tenant_vehicle_idx" ON "purchase_requisitions" USING btree ("tenant_id","vehicle_id");--> statement-breakpoint
CREATE INDEX "suppliers_tenant_idx" ON "suppliers" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_tenant_code_unique" ON "suppliers" USING btree ("tenant_id","supplier_code");--> statement-breakpoint
CREATE INDEX "suppliers_tenant_status_idx" ON "suppliers" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "workshops_tenant_idx" ON "workshops" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workshops_tenant_code_unique" ON "workshops" USING btree ("tenant_id","workshop_code");--> statement-breakpoint
CREATE INDEX "workshops_tenant_status_idx" ON "workshops" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "workshops_tenant_city_idx" ON "workshops" USING btree ("tenant_id","city");