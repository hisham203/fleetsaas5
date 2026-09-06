import { describe, it, expect, vi } from "vitest";
import { calcInvoiceTotals, genNumber, genId } from "@/lib/helpers";

describe("calcInvoiceTotals", () => {
  it("applies 15% Saudi VAT by default", () => {
    const { vatAmount, total } = calcInvoiceTotals(100);
    expect(vatAmount).toBe(15);
    expect(total).toBe(115);
  });

  it("matches the real BR-18 case from manual testing: 2 bottles at 8 SAR", () => {
    const subtotal = 2 * 8; // 16
    const { vatAmount, total } = calcInvoiceTotals(subtotal);
    expect(vatAmount).toBe(2.4);
    expect(total).toBe(18.4);
  });

  it("rounds to 2 decimal places", () => {
    const { vatAmount, total } = calcInvoiceTotals(33.33);
    expect(vatAmount).toBeCloseTo(5.0, 2);
    expect(total).toBeCloseTo(38.33, 2);
  });

  it("supports a custom VAT rate", () => {
    const { vatAmount, total } = calcInvoiceTotals(100, 0.05);
    expect(vatAmount).toBe(5);
    expect(total).toBe(105);
  });
});

describe("genNumber", () => {
  it("prefixes with the given string", () => {
    expect(genNumber("ORD")).toMatch(/^ORD-/);
    expect(genNumber("TRIP")).toMatch(/^TRIP-/);
    expect(genNumber("INV")).toMatch(/^INV-/);
  });

  it("produces different values when the underlying random draw differs (deterministic, not relying on timing/chance)", () => {
    // genNumber combines Date.now() (which can be identical across
    // calls made in the same millisecond — a real risk in a tight test
    // loop) with Math.random() (only 900 possible values, 100-999).
    // Testing this by simply calling genNumber twice in a row is
    // genuinely flaky: it can hit the same millisecond AND the same
    // random draw. Mocking Math.random to return two different values
    // isolates exactly the property this test cares about — a
    // different random draw produces a different number — without any
    // dependency on real timing.
    const randomSpy = vi.spyOn(Math, "random");
    randomSpy.mockReturnValueOnce(0.1).mockReturnValueOnce(0.9);
    const a = genNumber("ORD");
    const b = genNumber("ORD");
    expect(a).not.toBe(b);
    randomSpy.mockRestore();
  });
});

describe("genId", () => {
  it("produces unique values", () => {
    const ids = new Set(Array.from({ length: 100 }, () => genId()));
    expect(ids.size).toBe(100);
  });
});
