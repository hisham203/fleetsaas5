import { describe, it, expect } from "vitest";
import { getDataset, isValidColumn, DATASETS } from "@/lib/reportDatasets";

describe("report dataset registry (BR-21)", () => {
  it("returns null for an unknown dataset key", () => {
    expect(getDataset("not_a_real_dataset")).toBeNull();
  });

  it("resolves known datasets", () => {
    expect(getDataset("orders")?.label).toBe("Orders");
    expect(getDataset("invoices")?.label).toBe("Invoices");
    expect(getDataset("trips")?.label).toBe("Trips");
  });

  it("validates columns against the dataset's own whitelist only", () => {
    const orders = getDataset("orders")!;
    const invoices = getDataset("invoices")!;
    expect(isValidColumn(orders, "orderNumber")).toBe(true);
    expect(isValidColumn(orders, "invoiceNumber")).toBe(false); // belongs to invoices, not orders
    expect(isValidColumn(invoices, "invoiceNumber")).toBe(true);
  });

  it("rejects an injection-shaped string as a column name", () => {
    const orders = getDataset("orders")!;
    expect(isValidColumn(orders, "id; DROP TABLE users;--")).toBe(false);
    expect(isValidColumn(orders, "passwordHash")).toBe(false); // not even a real orders column
  });

  it("every dataset has a default sort column that's actually in its own column list", () => {
    for (const dataset of Object.values(DATASETS)) {
      expect(isValidColumn(dataset, dataset.defaultSortColumn)).toBe(true);
    }
  });
});
