import { describe, it, expect, beforeAll } from "vitest";
import { makeRequest, loginAs } from "../helpers/request";

describe("custom report builder (BR-21)", () => {
  let dispatcherCookie: string;

  beforeAll(async () => {
    dispatcherCookie = await loginAs("dispatch@demo-water.co", "password123");
  });

  it("lists the whitelisted datasets", async () => {
    const { GET } = await import("@/app/api/reports/datasets/route");
    const res = await GET(makeRequest("/api/reports/datasets", { cookie: dispatcherCookie }));
    const datasets = await res.json();
    const keys = datasets.map((d: any) => d.key);
    expect(keys).toEqual(expect.arrayContaining(["orders", "invoices", "trips", "vehicles", "fuelLogs", "maintenanceRecords", "tasks", "expenseClaims"]));
  });

  it("runs a report with column selection, a filter, and a join (customer name)", async () => {
    const { POST } = await import("@/app/api/reports/run/route");
    const res = await POST(makeRequest("/api/reports/run", {
      method: "POST",
      cookie: dispatcherCookie,
      body: {
        datasetKey: "orders",
        config: {
          columns: ["orderNumber", "customerName", "status"],
          filters: [{ column: "status", operator: "eq", value: "PENDING" }],
        },
      },
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.columns.map((c: any) => c.key)).toEqual(["orderNumber", "customerName", "status"]);
    for (const row of body.rows) {
      expect(row.status).toBe("PENDING");
      expect(row).toHaveProperty("customerName");
      expect(row).not.toHaveProperty("qtyOrdered");
    }
  });

  it("rejects an unknown/injection-shaped column name rather than executing it", async () => {
    const { POST } = await import("@/app/api/reports/run/route");
    const res = await POST(makeRequest("/api/reports/run", {
      method: "POST",
      cookie: dispatcherCookie,
      body: {
        datasetKey: "orders",
        config: { columns: ["id; DROP TABLE users;--"], filters: [] },
      },
    }));
    expect(res.status).toBe(400);
  });

  it("exports the same report as CSV with a matching header row", async () => {
    const { POST } = await import("@/app/api/reports/run/route");
    const res = await POST(makeRequest("/api/reports/run", {
      method: "POST",
      cookie: dispatcherCookie,
      body: {
        datasetKey: "invoices",
        config: { columns: ["invoiceNumber", "total", "status"], filters: [] },
        format: "csv",
      },
    }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const csv = await res.text();
    expect(csv.split("\n")[0]).toBe("Invoice #,Total (SAR),Status");
  });

  it("saves, lists, and deletes a report", async () => {
    const { POST: createReport } = await import("@/app/api/reports/route");
    const createRes = await createReport(makeRequest("/api/reports", {
      method: "POST",
      cookie: dispatcherCookie,
      body: {
        name: "Test Saved Report",
        datasetKey: "trips",
        config: { columns: ["tripNumber", "status"], filters: [] },
      },
    }));
    expect(createRes.status).toBe(201);
    const created = await createRes.json();

    const { GET: listReports } = await import("@/app/api/reports/route");
    const listRes = await listReports(makeRequest("/api/reports", { cookie: dispatcherCookie }));
    const list = await listRes.json();
    expect(list.some((r: any) => r.id === created.id)).toBe(true);

    const { DELETE: deleteReport } = await import("@/app/api/reports/[id]/route");
    const deleteRes = await deleteReport(
      makeRequest(`/api/reports/${created.id}`, { method: "DELETE", cookie: dispatcherCookie }),
      { params: { id: created.id } }
    );
    expect(deleteRes.status).toBe(200);

    const listAfter = await (await listReports(makeRequest("/api/reports", { cookie: dispatcherCookie }))).json();
    expect(listAfter.some((r: any) => r.id === created.id)).toBe(false);
  });

  it("a driver session cannot access the report builder", async () => {
    const driverCookie = await loginAs("khalid@demo-water.co", "password123");
    const { GET } = await import("@/app/api/reports/datasets/route");
    const res = await GET(makeRequest("/api/reports/datasets", { cookie: driverCookie }));
    expect(res.status).toBe(401);
  });

  it("runs a Field Activity Report against the tasks and expenseClaims datasets (BR-23)", async () => {
    const { POST: createTask } = await import("@/app/api/tasks/route");
    const { GET: driversGet } = await import("@/app/api/drivers/route");
    const drivers = await (await driversGet(makeRequest("/api/drivers", { cookie: dispatcherCookie }))).json();
    const driver = drivers[0];
    await createTask(makeRequest("/api/tasks", {
      method: "POST",
      cookie: dispatcherCookie,
      body: { driverId: driver.id, type: "VISIT", title: "Report test task" },
    }));

    const { POST: runReport } = await import("@/app/api/reports/run/route");
    const tasksReport = await runReport(makeRequest("/api/reports/run", {
      method: "POST",
      cookie: dispatcherCookie,
      body: { datasetKey: "tasks", config: { columns: ["driverName", "type", "status"], filters: [] } },
    }));
    expect(tasksReport.status).toBe(200);
    const tasksBody = await tasksReport.json();
    expect(tasksBody.rows.length).toBeGreaterThan(0);
    expect(tasksBody.rows[0]).toHaveProperty("driverName");

    const expensesReport = await runReport(makeRequest("/api/reports/run", {
      method: "POST",
      cookie: dispatcherCookie,
      body: { datasetKey: "expenseClaims", config: { columns: ["driverName", "category", "amount", "status"], filters: [] } },
    }));
    expect(expensesReport.status).toBe(200);
  });
});
