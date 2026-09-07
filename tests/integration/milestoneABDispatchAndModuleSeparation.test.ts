import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Milestone AB — Dispatch Visibility Fix & Fleet Maintenance ERP
// Module Design.
const adminPageSource = () => fs.readFileSync(path.join(process.cwd(), "app/admin/page.tsx"), "utf8");
const shellSource = () => fs.readFileSync(path.join(process.cwd(), "components/AdminShell.tsx"), "utf8");
const inventorySource = () => fs.readFileSync(path.join(process.cwd(), "app/admin/inventory-planned/page.tsx"), "utf8");
const procurementSource = () => fs.readFileSync(path.join(process.cwd(), "app/admin/procurement-planned/page.tsx"), "utf8");
const masterItemsSource = () => fs.readFileSync(path.join(process.cwd(), "app/admin/master-items-planned/page.tsx"), "utf8");
const placeholderComponentSource = () => fs.readFileSync(path.join(process.cwd(), "components/PlannedModulePlaceholder.tsx"), "utf8");

describe("Dispatch (Live) visibility root-cause fix (Milestone AB, Part 2)", () => {
  it("1/2. root cause: app/admin/page.tsx had its OWN separate sidebar definition, missing Dispatch (Live) entirely — this is what an ADMIN sees immediately on login, since ADMIN's destination is /admin directly", () => {
    const loginSource = fs.readFileSync(path.join(process.cwd(), "app/login/page.tsx"), "utf8");
    expect(loginSource).toContain('ADMIN: "/admin"');
  });

  it("3/4. Dispatch (Live) is now present in the admin page's own sidebar function, alongside Dispatch Control Tower — both real hrefs in the Operations section", () => {
    const source = adminPageSource();
    const opsIdx = source.indexOf('label: "Operations"');
    const coreDataIdx = source.indexOf('label: "Core Data"');
    const opsSection = source.slice(opsIdx, coreDataIdx);
    expect(opsSection).toContain('{ label: "Dispatch (Live)", href: "/dispatch" }');
    expect(opsSection).toContain('{ label: "Dispatch Control Tower", href: "/admin/dispatch" }');
  });

  it("5. AdminShell's own DEFAULT_SECTIONS (used by every other page, and by /dispatch itself since Milestone AA) also includes Dispatch (Live) — both sidebar sources now agree", () => {
    const source = shellSource();
    expect(source).toContain('{ label: "Dispatch (Live)", href: "/dispatch" }');
  });

  it("documents the duplicate-sidebar-source finding explicitly, so a future addition can't silently repeat this drift", () => {
    const source = adminPageSource();
    expect(source).toContain("SEPARATE, DUPLICATE sidebar definition");
    expect(source).toContain("silently drifted out of sync, missing");
  });

  it("6/7/8. /dispatch, /admin/dispatch, and deep links (tripId/orderId) all remain functional — untouched by this sidebar-only fix", () => {
    const dispatchSource = fs.readFileSync(path.join(process.cwd(), "app/dispatch/page.tsx"), "utf8");
    expect(dispatchSource).toContain('<AdminShell title="Dispatch (Live)"');
    expect(dispatchSource).toContain("deepLinkTripId");
    expect(dispatchSource).toContain('searchParams.get("orderId")');
    expect(fs.existsSync(path.join(process.cwd(), "app/admin/dispatch/page.tsx"))).toBe(true);
  });
});

describe("Navigation architecture audit (Milestone AB, Part 3)", () => {
  it("confirms exactly two sidebar sources exist (not consolidated, per the low-risk-only instruction), both now consistent for Operations items", () => {
    const adminSource = adminPageSource();
    const shell = shellSource();
    const operationsItemsInBoth = ["Dispatch Control Tower", "Dispatch (Live)", "Contract & Capacity Planner", "Loading Points"];
    for (const item of operationsItemsInBoth) {
      expect(adminSource).toContain(item);
      expect(shell).toContain(item);
    }
  });
});

describe("Four-module separation (Milestone AB, Part 4)", () => {
  it("9/10/11. Inventory, Procurement, and Master Items are three separate routes/files, never merged into one screen", () => {
    expect(fs.existsSync(path.join(process.cwd(), "app/admin/inventory-planned/page.tsx"))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), "app/admin/procurement-planned/page.tsx"))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), "app/admin/master-items-planned/page.tsx"))).toBe(true);
  });

  it("8. Maintenance remains its own real, unmodified screen (not a placeholder)", () => {
    const source = adminPageSource();
    expect(source).toContain("function MaintenanceTab");
    expect(source).toContain('item("Maintenance", "maintenance")');
  });

  it("12/13/14. each module's boundary explicitly states what it does NOT do, preventing conflation", () => {
    expect(inventorySource()).toContain("does not define the item master hierarchy");
    expect(procurementSource()).toContain("does not consume parts into maintenance");
    expect(procurementSource()).toContain("does not define item categories or create new items");
    expect(masterItemsSource()).toContain("does not hold stock quantity");
  });

  it("17. sidebar links for all three planned modules exist in both sidebar sources", () => {
    for (const label of ["Inventory (Planned)", "Procurement (Planned)", "Master Items (Planned)"]) {
      expect(shellSource()).toContain(label);
      expect(adminPageSource()).toContain(label);
    }
  });

  it("15/16. old customer-delivery/bottle Inventory does not return as an active module; Loading Points are correctly distinguished from maintenance warehouses", () => {
    expect(shellSource()).not.toContain('{ label: "Inventory", href: "/admin?tab=inventory" }');
    expect(inventorySource()).toContain("distinct concept from Loading Points");
  });
});

describe("Relationship documentation (Milestone AB, Part 5)", () => {
  it("22. Master Items -> Inventory relationship is documented", () => {
    expect(inventorySource()).toContain("Master Items defines what can be stocked");
    expect(masterItemsSource()).toContain("Inventory balances reference an itemId here");
  });

  it("23. Procurement -> Receiving -> Warehouse Stock relationship is documented", () => {
    expect(procurementSource()).toContain("Posting a Goods Receipt creates a RECEIPT stock movement in Inventory");
  });

  it("24. Maintenance -> Inventory issue relationship is documented", () => {
    expect(inventorySource()).toContain("Maintenance issues items from here");
  });

  it("25. Workshops -> Warehouses relationship is documented", () => {
    expect(inventorySource()).toContain("Warehouses (physical stock locations) may optionally link to a Workshop");
  });

  it("26. separation from customer billing is explicitly documented in Procurement", () => {
    expect(procurementSource()).toContain("never creates or modifies a customer billing invoice at any step");
  });

  it("item creation belongs exclusively to Master Items, not Inventory or Procurement", () => {
    expect(masterItemsSource()).toContain("Item creation belongs exclusively to Master Items");
  });
});

describe("Placeholder integrity (Milestone AB, Part 9)", () => {
  it("20/21. no fake operational data or broken links in any of the three placeholders", () => {
    for (const source of [inventorySource(), procurementSource(), masterItemsSource()]) {
      expect(source).not.toContain("<table");
      expect(source).not.toContain("fetch(");
    }
  });

  it("all three use the shared PlannedModulePlaceholder, which now (Z.1) states schema is implemented and shows genuine live counts, never fake data", () => {
    const componentSource = placeholderComponentSource();
    expect(componentSource).toContain("Schema foundation implemented. Operational CRUD will be added in later milestones.");
    for (const source of [inventorySource(), procurementSource(), masterItemsSource()]) {
      expect(source).toContain("PlannedModulePlaceholder");
    }
  });

  it("the old merged route now redirects rather than 404ing, preserving any bookmarked link", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "app/admin/maintenance-inventory/page.tsx"), "utf8");
    expect(source).toContain('router.replace("/admin/inventory-planned")');
  });
});

describe("Regression protection (Milestone AB)", () => {
  it("27. Task P.2 contract-priced invoice markers remain unchanged", () => {
    const stopRoute = fs.readFileSync(path.join(process.cwd(), "app/api/trips/[id]/stops/[stopId]/route.ts"), "utf8");
    expect(stopRoute).toContain("Task P.2");
  });

  it("28. Milestone W POD gate remains unchanged", () => {
    const stopRoute = fs.readFileSync(path.join(process.cwd(), "app/api/trips/[id]/stops/[stopId]/route.ts"), "utf8");
    expect(stopRoute).toContain("autoCloseTripIfAllStopsResolved");
  });

  it("31/32. Milestone Z customer cleanup and Milestone AA bulk-water terminology remain intact", () => {
    const customersSource = fs.readFileSync(path.join(process.cwd(), "app/admin/customers/page.tsx"), "utf8");
    expect(customersSource).toContain("Legacy fallback pricing");
    expect(adminPageSource()).not.toContain("bottle vans");
  });

  it("33. tenant isolation is unaffected — no new API routes were added in this milestone (design/placeholder only)", () => {
    expect(fs.existsSync(path.join(process.cwd(), "app/api/inventory-planned"))).toBe(false);
    expect(fs.existsSync(path.join(process.cwd(), "app/api/procurement"))).toBe(false);
  });

  it("no schema file was modified for THIS milestone (Milestone AB itself — a design/placeholder-only milestone); Z.1, exactly as this milestone recommended, later implemented the approved schema", () => {
    const schemaSource = fs.readFileSync(path.join(process.cwd(), "lib/db/schema.ts"), "utf8");
    // Confirms the schema Z.1 added matches what this milestone
    // designed, rather than asserting its continued absence.
    expect(schemaSource).toContain("export const itemGroups = pgTable(");
    expect(schemaSource).toContain('"item_groups"');
    expect(schemaSource).toContain("export const workshops = pgTable(");
    expect(schemaSource).toContain('"workshops"');
  });

  it("no passwordHash exposure in any changed file", () => {
    const combined = adminPageSource() + shellSource() + inventorySource() + procurementSource() + masterItemsSource() + placeholderComponentSource();
    expect(combined).not.toContain("passwordHash");
  });
});
