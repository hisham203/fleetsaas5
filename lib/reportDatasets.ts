// BR-21: Custom Report Builder.
//
// This is a whitelist, not a free-form SQL builder — the person building a
// report picks a dataset (a specific table, always pre-scoped to their own
// tenant), then picks from a fixed list of columns and filter fields for
// that dataset. Nothing here ever lets user input become a column name,
// table name, or raw SQL fragment; only values in WHERE clauses are
// user-supplied, and those go through drizzle's parameterized query
// builder. This is the property that makes a "custom report builder"
// safe to expose at all, so don't loosen it to take dataset/column names
// as plain strings without validating against this registry first.

export type ColumnType = "text" | "number" | "date" | "enum";

export type ColumnDef = {
  key: string;
  label: string;
  type: ColumnType;
  enumValues?: string[];
};

export type DatasetDef = {
  key: string;
  label: string;
  description: string;
  columns: ColumnDef[];
  defaultSortColumn: string;
};

export const DATASETS: Record<string, DatasetDef> = {
  orders: {
    key: "orders",
    label: "Orders",
    description: "Every order — status, quantities, payment, timing.",
    defaultSortColumn: "createdAt",
    columns: [
      { key: "orderNumber", label: "Order #", type: "text" },
      { key: "customerName", label: "Customer", type: "text" },
      { key: "type", label: "Type", type: "enum", enumValues: ["ONE_TIME", "SUBSCRIPTION"] },
      { key: "qtyOrdered", label: "Qty Ordered", type: "number" },
      { key: "bottleSizeLtr", label: "Bottle Size (L)", type: "number" },
      {
        key: "status",
        label: "Status",
        type: "enum",
        enumValues: [
          "PENDING", "VALIDATED", "QUEUED", "ASSIGNED", "IN_TRANSIT",
          "DELIVERED", "PARTIALLY_DELIVERED", "FAILED", "CANCELLED",
        ],
      },
      { key: "paymentMethod", label: "Payment Method", type: "enum", enumValues: ["CASH", "CARD", "ONLINE", "ACCOUNT_CREDIT"] },
      { key: "pricePerBottle", label: "Price/Bottle (SAR)", type: "number" },
      { key: "deliveryAddress", label: "Delivery Address", type: "text" },
      { key: "createdAt", label: "Created At", type: "date" },
      { key: "completedAt", label: "Completed At", type: "date" },
    ],
  },
  invoices: {
    key: "invoices",
    label: "Invoices",
    description: "Billing — subtotal, VAT, total, payment status.",
    defaultSortColumn: "createdAt",
    columns: [
      { key: "invoiceNumber", label: "Invoice #", type: "text" },
      { key: "customerName", label: "Customer", type: "text" },
      { key: "subtotal", label: "Subtotal (SAR)", type: "number" },
      { key: "vatAmount", label: "VAT (SAR)", type: "number" },
      { key: "total", label: "Total (SAR)", type: "number" },
      { key: "status", label: "Status", type: "enum", enumValues: ["PENDING", "PAID"] },
      { key: "createdAt", label: "Created At", type: "date" },
    ],
  },
  trips: {
    key: "trips",
    label: "Trips",
    description: "Every trip — driver, vehicle, warehouse, timing, status.",
    defaultSortColumn: "createdAt",
    columns: [
      { key: "tripNumber", label: "Trip #", type: "text" },
      { key: "driverName", label: "Driver", type: "text" },
      { key: "vehiclePlate", label: "Vehicle", type: "text" },
      { key: "warehouseName", label: "Warehouse", type: "text" },
      {
        key: "status",
        label: "Status",
        type: "enum",
        enumValues: ["PLANNED", "DISPATCHED", "IN_PROGRESS", "COMPLETED"],
      },
      { key: "estimatedDurationMinutes", label: "Est. Duration (min)", type: "number" },
      { key: "startedAt", label: "Started At", type: "date" },
      { key: "completedAt", label: "Completed At", type: "date" },
      { key: "createdAt", label: "Created At", type: "date" },
    ],
  },
  vehicles: {
    key: "vehicles",
    label: "Vehicles",
    description: "Fleet roster — type, capacity, status.",
    defaultSortColumn: "createdAt",
    columns: [
      { key: "plateNumber", label: "Plate Number", type: "text" },
      { key: "vehicleType", label: "Type", type: "text" },
      { key: "capacityUnits", label: "Capacity (units)", type: "number" },
      {
        key: "status",
        label: "Status",
        type: "enum",
        enumValues: ["AVAILABLE", "IN_TRIP", "MAINTENANCE", "OUT_OF_SERVICE"],
      },
      { key: "createdAt", label: "Added On", type: "date" },
    ],
  },
  fuelLogs: {
    key: "fuelLogs",
    label: "Fuel Logs",
    description: "Fill-up history — liters, cost, odometer, by vehicle.",
    defaultSortColumn: "filledAt",
    columns: [
      { key: "vehiclePlate", label: "Vehicle", type: "text" },
      { key: "litersFilled", label: "Liters", type: "number" },
      { key: "costSar", label: "Cost (SAR)", type: "number" },
      { key: "odometerReading", label: "Odometer (km)", type: "number" },
      { key: "filledAt", label: "Filled At", type: "date" },
    ],
  },
  maintenanceRecords: {
    key: "maintenanceRecords",
    label: "Maintenance",
    description: "Maintenance history — type, cost, downtime, by vehicle.",
    defaultSortColumn: "openedAt",
    columns: [
      { key: "vehiclePlate", label: "Vehicle", type: "text" },
      { key: "type", label: "Type", type: "enum", enumValues: ["PREVENTIVE", "CORRECTIVE", "EMERGENCY"] },
      { key: "description", label: "Description", type: "text" },
      { key: "cost", label: "Cost (SAR)", type: "number" },
      { key: "status", label: "Status", type: "enum", enumValues: ["OPEN", "COMPLETED"] },
      { key: "openedAt", label: "Opened At", type: "date" },
      { key: "completedAt", label: "Completed At", type: "date" },
    ],
  },
  // BR-23's "Field Activity Report" output — rather than a bespoke report
  // screen, tasks and expense claims are just two more datasets in the
  // same whitelisted report builder every other dataset uses.
  tasks: {
    key: "tasks",
    label: "Tasks",
    description: "Field tasks assigned to drivers — inspections, collections, visits, refuels.",
    defaultSortColumn: "createdAt",
    columns: [
      { key: "driverName", label: "Driver", type: "text" },
      { key: "type", label: "Type", type: "enum", enumValues: ["INSPECTION", "COLLECTION", "VISIT", "REFUEL", "EXCEPTION_HANDLING", "OTHER"] },
      { key: "title", label: "Title", type: "text" },
      { key: "status", label: "Status", type: "enum", enumValues: ["ASSIGNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"] },
      { key: "dueAt", label: "Due At", type: "date" },
      { key: "completedAt", label: "Completed At", type: "date" },
      { key: "createdAt", label: "Assigned At", type: "date" },
    ],
  },
  expenseClaims: {
    key: "expenseClaims",
    label: "Expense Claims",
    description: "Driver-submitted expenses — fuel, tolls, emergency maintenance — with approval status.",
    defaultSortColumn: "createdAt",
    columns: [
      { key: "driverName", label: "Driver", type: "text" },
      { key: "vehiclePlate", label: "Vehicle", type: "text" },
      { key: "category", label: "Category", type: "enum", enumValues: ["FUEL", "TOLL", "MAINTENANCE", "OTHER"] },
      { key: "amount", label: "Amount (SAR)", type: "number" },
      { key: "status", label: "Status", type: "enum", enumValues: ["PENDING", "APPROVED", "REJECTED"] },
      { key: "createdAt", label: "Submitted At", type: "date" },
    ],
  },
  creditNotes: {
    key: "creditNotes",
    label: "Credit Notes",
    description: "Invoice adjustments — BR-18's Collection Report / customer credit history.",
    defaultSortColumn: "createdAt",
    columns: [
      { key: "customerName", label: "Customer", type: "text" },
      { key: "invoiceNumber", label: "Invoice #", type: "text" },
      { key: "creditNoteNumber", label: "Credit Note #", type: "text" },
      { key: "amount", label: "Amount (SAR)", type: "number" },
      { key: "reason", label: "Reason", type: "text" },
      { key: "createdAt", label: "Issued At", type: "date" },
    ],
  },
};

export type FilterOperator = "eq" | "neq" | "contains" | "gt" | "gte" | "lt" | "lte";

export type ReportFilter = {
  column: string;
  operator: FilterOperator;
  value: string | number;
};

export type ReportSort = {
  column: string;
  direction: "asc" | "desc";
};

export type ReportConfig = {
  columns: string[];
  filters: ReportFilter[];
  sort?: ReportSort;
  limit?: number;
};

export function getDataset(key: string): DatasetDef | null {
  return DATASETS[key] ?? null;
}

export function isValidColumn(dataset: DatasetDef, columnKey: string): boolean {
  return dataset.columns.some((c) => c.key === columnKey);
}
