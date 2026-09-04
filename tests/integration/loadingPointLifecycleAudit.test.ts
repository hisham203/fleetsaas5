import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { makeRequest, loginAs } from "../helpers/request";
import { db } from "@/lib/db/client";
import { tenants, warehouses } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

// Task M — Loading Point Active/Inactive Lifecycle Audit. Primarily an
// audit/design task; these tests confirm the deliberate absence of any
// fake lifecycle field/control, and that every dependent behavior
// (dispatch, trip creation, PATCH) still treats every loading point as
// unconditionally usable, exactly as documented in the audit.
describe("No active/inactive lifecycle field exists anywhere (Task M)", () => {
  it("1/2. the warehouses schema has no isActive/status/retiredAt-style column", () => {
    const schemaSource = fs.readFileSync(path.join(process.cwd(), "lib/db/schema.ts"), "utf8");
    const warehousesTableSource = schemaSource.slice(
      schemaSource.indexOf('export const warehouses = pgTable("warehouses"'),
      schemaSource.indexOf("});", schemaSource.indexOf('export const warehouses = pgTable("warehouses"'))
    );
    expect(warehousesTableSource).not.toMatch(/isActive|status|retiredAt|isRetired/i);
  });

  it("2. the admin UI shows the audit's informational note and does not expose any active/inactive toggle or control", () => {
    const adminSource = fs.readFileSync(path.join(process.cwd(), "app/admin/page.tsx"), "utf8");
    expect(adminSource).toContain("Loading points don&apos;t yet support an active/inactive status");
    // Isolate the InventoryTab function specifically (where loading
    // points are managed) and confirm no lifecycle-toggle control
    // exists there — a much more meaningful check than scanning the
    // whole 2000+ line file, where other unrelated features (e.g.
    // driver/vehicle status) legitimately do use words like "active".
    const start = adminSource.indexOf("function InventoryTab");
    const end = adminSource.indexOf("\nfunction ", start + 10);
    const inventoryTabSource = adminSource.slice(start, end);
    // Checks for an actual rendered control (a button/label a user
    // could click), not prose — this file's own comments legitimately
    // discuss "retired" as part of documenting this exact audit finding.
    expect(inventoryTabSource).not.toMatch(/>\s*(Retire|Deactivate|Reactivate|Activate)\s*</i);
    expect(inventoryTabSource).not.toMatch(/checked=\{.*isActive/i);
  });

  it("the PATCH route's schema does not accept any lifecycle field, and silently ignores one if sent", async () => {
    const routeSource = fs.readFileSync(path.join(process.cwd(), "app/api/warehouses/[id]/route.ts"), "utf8");
    // Excludes generic "status: <number>" (HTTP response status codes,
    // used legitimately throughout this route) — looks specifically for
    // a lifecycle-style field/value instead.
    expect(routeSource).not.toMatch(/isActive|retiredAt|status:\s*["'](ACTIVE|INACTIVE|RETIRED)["']/i);

    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const loadingPoint = await db.query.warehouses.findFirst({ where: eq(warehouses.tenantId, tenant!.id) });

    const { PATCH: updateWarehouse } = await import("@/app/api/warehouses/[id]/route");
    // Sending an unsupported field is simply dropped by the Zod schema
    // (unknown keys are ignored, not rejected) — confirms there is no
    // hidden, undocumented lifecycle field an admin could accidentally
    // set today.
    const res = await updateWarehouse(
      makeRequest(`/api/warehouses/${loadingPoint!.id}`, { method: "PATCH", cookie: adminCookie, body: { isActive: false, address: loadingPoint!.address } }),
      { params: { id: loadingPoint!.id } }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).not.toHaveProperty("isActive");
  });
});

describe("Dispatch/trip behavior treats every loading point as unconditionally usable (Task M)", () => {
  it("3. the dispatch page's loading-point dropdown lists every warehouse for the tenant, with no filtering logic at all", () => {
    const dispatchSource = fs.readFileSync(path.join(process.cwd(), "app/dispatch/page.tsx"), "utf8");
    // warehouses.map with no .filter( call in between confirms every
    // warehouse the tenant has is offered, unconditionally — matching
    // this task's own audit conclusion that nothing currently filters
    // on any lifecycle state (since none exists).
    const selectBlock = dispatchSource.slice(dispatchSource.indexOf("Loading point / warehouse…") - 50, dispatchSource.indexOf("Loading point / warehouse…") + 200);
    expect(selectBlock).toContain("warehouses.map");
    expect(selectBlock).not.toContain(".filter(");
  });

  it("trip creation accepts any warehouse belonging to the tenant, with no lifecycle-state check", async () => {
    const routeSource = fs.readFileSync(path.join(process.cwd(), "app/api/trips/route.ts"), "utf8");
    const warehouseCheckLine = routeSource.slice(routeSource.indexOf("const warehouse = await db.query.warehouses"), routeSource.indexOf("const warehouse = await db.query.warehouses") + 200);
    expect(warehouseCheckLine).not.toMatch(/isActive|status/i);
  });
});

describe("Regression: existing loading point / warehouse behavior remains unaffected (Task M)", () => {
  it("4. PATCH still works exactly as before for real fields", async () => {
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const loadingPoint = await db.query.warehouses.findFirst({ where: eq(warehouses.tenantId, tenant!.id) });

    const { PATCH: updateWarehouse } = await import("@/app/api/warehouses/[id]/route");
    const res = await updateWarehouse(
      makeRequest(`/api/warehouses/${loadingPoint!.id}`, { method: "PATCH", cookie: adminCookie, body: { address: "Task M regression check address" } }),
      { params: { id: loadingPoint!.id } }
    );
    expect(res.status).toBe(200);
    await db.update(warehouses).set({ address: loadingPoint!.address }).where(eq(warehouses.id, loadingPoint!.id));
  });
});
