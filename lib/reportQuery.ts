import { db } from "./db/client";
import { orders, invoices, trips, vehicles, fuelLogs, maintenanceRecords, tasks, expenseClaims, creditNotes } from "./db/schema";
import { eq } from "drizzle-orm";
import { DATASETS, getDataset, isValidColumn, type ReportConfig, type ReportFilter, type ReportSort } from "./reportDatasets";

// A hard cap independent of any `limit` the report config requests — this
// is a report builder for ops-scale data (hundreds to low thousands of
// rows), not a data warehouse export tool. Filtering/sorting happens in
// JS after a single tenant-scoped fetch per dataset (see the module doc in
// reportDatasets.ts for why: it keeps every dataset's columns and filters
// safely whitelisted without needing a fully generic dynamic-SQL builder).
const HARD_ROW_CAP = 2000;

type Row = Record<string, unknown>;

async function fetchOrdersRows(tenantId: string): Promise<Row[]> {
  const rows = await db.query.orders.findMany({
    where: eq(orders.tenantId, tenantId),
    with: { customer: true },
  });
  return rows.map((o) => ({
    orderNumber: o.orderNumber,
    customerName: o.customer?.name ?? null,
    type: o.type,
    qtyOrdered: o.qtyOrdered,
    bottleSizeLtr: o.bottleSizeLtr,
    status: o.status,
    paymentMethod: o.paymentMethod,
    pricePerBottle: o.pricePerBottle,
    deliveryAddress: o.deliveryAddress,
    createdAt: o.createdAt,
    completedAt: o.completedAt,
  }));
}

async function fetchInvoicesRows(tenantId: string): Promise<Row[]> {
  const rows = await db.query.invoices.findMany({
    where: eq(invoices.tenantId, tenantId),
    with: { customer: true },
  });
  return rows.map((i) => ({
    invoiceNumber: i.invoiceNumber,
    customerName: i.customer?.name ?? null,
    subtotal: i.subtotal,
    vatAmount: i.vatAmount,
    total: i.total,
    status: i.status,
    createdAt: i.createdAt,
  }));
}

async function fetchTripsRows(tenantId: string): Promise<Row[]> {
  const rows = await db.query.trips.findMany({
    where: eq(trips.tenantId, tenantId),
    with: { driver: { with: { user: true } }, vehicle: true, warehouse: true },
  });
  return rows.map((t) => ({
    tripNumber: t.tripNumber,
    driverName: t.driver?.user?.name ?? null,
    vehiclePlate: t.vehicle?.plateNumber ?? null,
    warehouseName: t.warehouse?.name ?? null,
    status: t.status,
    estimatedDurationMinutes: t.estimatedDurationMinutes,
    startedAt: t.startedAt,
    completedAt: t.completedAt,
    createdAt: t.createdAt,
  }));
}

async function fetchVehiclesRows(tenantId: string): Promise<Row[]> {
  const rows = await db.query.vehicles.findMany({ where: eq(vehicles.tenantId, tenantId) });
  return rows.map((v) => ({
    plateNumber: v.plateNumber,
    vehicleType: v.vehicleType,
    capacityUnits: v.capacityUnits,
    status: v.status,
    createdAt: v.createdAt,
  }));
}

async function fetchFuelLogsRows(tenantId: string): Promise<Row[]> {
  const rows = await db.query.fuelLogs.findMany({
    where: eq(fuelLogs.tenantId, tenantId),
    with: { vehicle: true },
  });
  return rows.map((f) => ({
    vehiclePlate: f.vehicle?.plateNumber ?? null,
    litersFilled: f.litersFilled,
    costSar: f.costSar,
    odometerReading: f.odometerReading,
    filledAt: f.filledAt,
  }));
}

async function fetchMaintenanceRows(tenantId: string): Promise<Row[]> {
  const rows = await db.query.maintenanceRecords.findMany({
    where: eq(maintenanceRecords.tenantId, tenantId),
    with: { vehicle: true },
  });
  return rows.map((m) => ({
    vehiclePlate: m.vehicle?.plateNumber ?? null,
    type: m.type,
    description: m.description,
    cost: m.cost,
    status: m.status,
    openedAt: m.openedAt,
    completedAt: m.completedAt,
  }));
}

async function fetchTasksRows(tenantId: string): Promise<Row[]> {
  const rows = await db.query.tasks.findMany({
    where: eq(tasks.tenantId, tenantId),
    with: { driver: { with: { user: true } } },
  });
  return rows.map((t) => ({
    driverName: t.driver?.user?.name ?? null,
    type: t.type,
    title: t.title,
    status: t.status,
    dueAt: t.dueAt,
    completedAt: t.completedAt,
    createdAt: t.createdAt,
  }));
}

async function fetchExpenseClaimsRows(tenantId: string): Promise<Row[]> {
  const rows = await db.query.expenseClaims.findMany({
    where: eq(expenseClaims.tenantId, tenantId),
    with: { driver: { with: { user: true } }, vehicle: true },
  });
  return rows.map((e) => ({
    driverName: e.driver?.user?.name ?? null,
    vehiclePlate: e.vehicle?.plateNumber ?? null,
    category: e.category,
    amount: e.amount,
    status: e.status,
    createdAt: e.createdAt,
  }));
}

async function fetchCreditNotesRows(tenantId: string): Promise<Row[]> {
  const rows = await db.query.creditNotes.findMany({
    where: eq(creditNotes.tenantId, tenantId),
    with: { customer: true, invoice: true },
  });
  return rows.map((c) => ({
    customerName: c.customer?.name ?? null,
    invoiceNumber: c.invoice?.invoiceNumber ?? null,
    creditNoteNumber: c.creditNoteNumber,
    amount: c.amount,
    reason: c.reason,
    createdAt: c.createdAt,
  }));
}

const FETCHERS: Record<string, (tenantId: string) => Promise<Row[]>> = {
  orders: fetchOrdersRows,
  invoices: fetchInvoicesRows,
  trips: fetchTripsRows,
  vehicles: fetchVehiclesRows,
  fuelLogs: fetchFuelLogsRows,
  maintenanceRecords: fetchMaintenanceRows,
  tasks: fetchTasksRows,
  expenseClaims: fetchExpenseClaimsRows,
  creditNotes: fetchCreditNotesRows,
};

function applyFilter(rows: Row[], filter: ReportFilter, columnType: string): Row[] {
  return rows.filter((row) => {
    const val = row[filter.column];
    if (val == null) return false;

    if (columnType === "number") {
      const numVal = Number(val);
      const filterNum = Number(filter.value);
      switch (filter.operator) {
        case "eq": return numVal === filterNum;
        case "neq": return numVal !== filterNum;
        case "gt": return numVal > filterNum;
        case "gte": return numVal >= filterNum;
        case "lt": return numVal < filterNum;
        case "lte": return numVal <= filterNum;
        default: return true;
      }
    }

    if (columnType === "date") {
      const dateVal = new Date(val as string).getTime();
      const filterDate = new Date(filter.value).getTime();
      switch (filter.operator) {
        case "eq": return dateVal === filterDate;
        case "gt": return dateVal > filterDate;
        case "gte": return dateVal >= filterDate;
        case "lt": return dateVal < filterDate;
        case "lte": return dateVal <= filterDate;
        default: return true;
      }
    }

    // text / enum
    const strVal = String(val).toLowerCase();
    const filterVal = String(filter.value).toLowerCase();
    switch (filter.operator) {
      case "eq": return strVal === filterVal;
      case "neq": return strVal !== filterVal;
      case "contains": return strVal.includes(filterVal);
      default: return true;
    }
  });
}

function applySort(rows: Row[], sort: ReportSort | undefined, columnType: string | undefined): Row[] {
  if (!sort) return rows;
  const dir = sort.direction === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const av = a[sort.column];
    const bv = b[sort.column];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (columnType === "number") return (Number(av) - Number(bv)) * dir;
    if (columnType === "date") return (new Date(av as string).getTime() - new Date(bv as string).getTime()) * dir;
    return String(av).localeCompare(String(bv)) * dir;
  });
}

export type ReportResult = {
  columns: { key: string; label: string }[];
  rows: Row[];
  totalMatched: number;
};

// Validates the requested dataset/columns/filters/sort against the
// whitelist in reportDatasets.ts, then executes and returns a shaped
// result. Throws a plain Error with a user-facing message on validation
// failure — callers (the API route) turn that into a 400.
export async function runReport(datasetKey: string, tenantId: string, config: ReportConfig): Promise<ReportResult> {
  const dataset = getDataset(datasetKey);
  if (!dataset) throw new Error(`Unknown dataset: ${datasetKey}`);

  const columns = config.columns.length > 0 ? config.columns : dataset.columns.map((c) => c.key);
  for (const col of columns) {
    if (!isValidColumn(dataset, col)) throw new Error(`Unknown column "${col}" for dataset "${datasetKey}"`);
  }
  for (const filter of config.filters) {
    if (!isValidColumn(dataset, filter.column)) throw new Error(`Unknown filter column "${filter.column}"`);
  }
  if (config.sort && !isValidColumn(dataset, config.sort.column)) {
    throw new Error(`Unknown sort column "${config.sort.column}"`);
  }

  const fetcher = FETCHERS[datasetKey];
  if (!fetcher) throw new Error(`No data fetcher registered for dataset "${datasetKey}"`);

  let rows = await fetcher(tenantId);

  for (const filter of config.filters) {
    const colDef = dataset.columns.find((c) => c.key === filter.column)!;
    rows = applyFilter(rows, filter, colDef.type);
  }

  const totalMatched = rows.length;

  const sort = config.sort ?? { column: dataset.defaultSortColumn, direction: "desc" as const };
  const sortColDef = dataset.columns.find((c) => c.key === sort.column);
  rows = applySort(rows, sort, sortColDef?.type);

  const limit = Math.min(config.limit ?? HARD_ROW_CAP, HARD_ROW_CAP);
  rows = rows.slice(0, limit);

  const projected = rows.map((row) => {
    const out: Row = {};
    for (const col of columns) out[col] = row[col];
    return out;
  });

  return {
    columns: columns.map((key) => ({ key, label: dataset.columns.find((c) => c.key === key)!.label })),
    rows: projected,
    totalMatched,
  };
}

export function toCsv(result: ReportResult): string {
  const header = result.columns.map((c) => csvEscape(c.label)).join(",");
  const lines = result.rows.map((row) =>
    result.columns.map((c) => csvEscape(formatCsvValue(row[c.key]))).join(",")
  );
  return [header, ...lines].join("\n");
}

function formatCsvValue(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
