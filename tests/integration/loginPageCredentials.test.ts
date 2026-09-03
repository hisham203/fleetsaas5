import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { makeRequest } from "../helpers/request";

// Task G — no React-rendering test framework exists in this project (no
// @testing-library, no jsdom — confirmed by direct search), so per this
// task's own "do not create a full frontend testing framework from
// scratch" instruction, this verifies the login page's static source
// text directly, then goes a step further: it actually calls the real
// login API with each credential the page displays, proving they are
// genuinely real, currently-working seeded logins — not just strings
// that happen to appear on screen.
describe("Login page demo credentials (Task G)", () => {
  const loginPageSource = fs.readFileSync(path.join(process.cwd(), "app/login/page.tsx"), "utf8");

  it("1. shows Demo Water Co. credentials", () => {
    expect(loginPageSource).toContain("admin@demo-water.co");
    expect(loginPageSource).toContain("dispatch@demo-water.co");
    expect(loginPageSource).toContain("khalid@demo-water.co");
  });

  it("2. shows Acme Fuel Delivery Co. credentials", () => {
    expect(loginPageSource).toContain("admin@acme-fuel-demo.co");
  });

  it("3. shows Riyadh Bulk Water Logistics credentials — the real seeded emails, not invented ones", () => {
    expect(loginPageSource).toContain("admin@riyadh-bulk-water.co");
    expect(loginPageSource).toContain("dispatch@riyadh-bulk-water.co");
    expect(loginPageSource).toContain("mohammed@riyadh-bulk-water.co");
    expect(loginPageSource).toContain("Riyadh Bulk Water Logistics");
  });

  it("4. never contains passwordHash anywhere in the page source", () => {
    expect(loginPageSource).not.toContain("passwordHash");
  });

  it("every credential shown on the login page is a real, currently-working login — proving these aren't just strings on screen", async () => {
    const { POST: login } = await import("@/app/api/auth/login/route");
    const credentialsShown = [
      "admin@demo-water.co",
      "dispatch@demo-water.co",
      "khalid@demo-water.co",
      "admin@acme-fuel-demo.co",
      "admin@riyadh-bulk-water.co",
      "dispatch@riyadh-bulk-water.co",
      "mohammed@riyadh-bulk-water.co",
    ];
    for (const email of credentialsShown) {
      const res = await login(makeRequest("/api/auth/login", { method: "POST", body: { email, password: "password123" } }));
      expect(res.status, `${email} should be a real, working login`).toBe(200);
    }
  });

  it("the exact Riyadh Bulk Water emails shown match what the real seed script actually creates", () => {
    const seedSource = fs.readFileSync(path.join(process.cwd(), "scripts/seedRiyadhBulkWaterData.ts"), "utf8");
    for (const email of ["admin@riyadh-bulk-water.co", "dispatch@riyadh-bulk-water.co", "mohammed@riyadh-bulk-water.co"]) {
      expect(seedSource).toContain(email);
    }
  });
});
