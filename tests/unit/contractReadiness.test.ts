import { describe, it, expect } from "vitest";
import { computeReadinessItems } from "@/lib/contractReadiness";

// Task J — Contract Readiness Summary. Direct unit tests against the
// extracted, pure computation function — precise and fast, not
// dependent on any API/database/rendering.
function baseContract(overrides: Partial<Parameters<typeof computeReadinessItems>[0]> = {}) {
  return {
    customer: { id: "cust-1" },
    status: "ACTIVE",
    startDate: new Date("2020-01-01"),
    endDate: null,
    appliesToAllSites: true,
    siteScope: [],
    type: "MONTHLY_ACCUMULATED",
    ...overrides,
  };
}

function find(items: ReturnType<typeof computeReadinessItems>, label: string) {
  const item = items.find((i) => i.label === label);
  expect(item, `expected a readiness item labeled "${label}"`).toBeTruthy();
  return item!;
}

describe("computeReadinessItems (Task J)", () => {
  it("1/2. an active, current contract with sites-not-applicable and full pricing is READY across the board", () => {
    const items = computeReadinessItems(
      baseContract(),
      [{ rateType: "STANDARD", tankerCapacityLtr: null, distanceBandCode: null }],
      []
    );
    expect(find(items, "Customer assigned").state).toBe("READY");
    expect(find(items, "Contract active").state).toBe("READY");
    expect(find(items, "Within valid date period").state).toBe("READY");
    expect(find(items, "Site scope configured").state).toBe("READY");
    expect(find(items, "STANDARD pricing configured").state).toBe("READY");
  });

  it("3. a contract that hasn't started yet shows a date-period warning", () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    const items = computeReadinessItems(baseContract({ startDate: future }), [], []);
    expect(find(items, "Within valid date period").state).toBe("WARNING");
  });

  it("4. a contract past its end date shows a date-period warning", () => {
    const past = new Date();
    past.setFullYear(past.getFullYear() - 1);
    const items = computeReadinessItems(baseContract({ endDate: past }), [], []);
    expect(find(items, "Within valid date period").state).toBe("WARNING");
  });

  it("5. a site-restricted contract with zero assigned sites shows Missing", () => {
    const items = computeReadinessItems(baseContract({ appliesToAllSites: false, siteScope: [] }), [], []);
    expect(find(items, "Site scope configured").state).toBe("MISSING");
  });

  it("a site-restricted contract with at least one assigned site is Ready", () => {
    const items = computeReadinessItems(baseContract({ appliesToAllSites: false, siteScope: [{ id: "s1" }] }), [], []);
    expect(find(items, "Site scope configured").state).toBe("READY");
  });

  it("6. no STANDARD pricing rule at all shows Missing", () => {
    const items = computeReadinessItems(baseContract(), [], []);
    expect(find(items, "STANDARD pricing configured").state).toBe("MISSING");
  });

  it("7. a ONE_TIME_TRIP_COUNT contract with STANDARD but no OVERAGE shows a Warning specifically for OVERAGE", () => {
    const items = computeReadinessItems(
      baseContract({ type: "ONE_TIME_TRIP_COUNT" }),
      [{ rateType: "STANDARD", tankerCapacityLtr: null, distanceBandCode: null }],
      []
    );
    expect(find(items, "STANDARD pricing configured").state).toBe("READY");
    expect(find(items, "OVERAGE pricing configured").state).toBe("WARNING");
  });

  it("a ONE_TIME_TRIP_COUNT contract with both STANDARD and OVERAGE is fully Ready on pricing", () => {
    const items = computeReadinessItems(
      baseContract({ type: "ONE_TIME_TRIP_COUNT" }),
      [
        { rateType: "STANDARD", tankerCapacityLtr: null, distanceBandCode: null },
        { rateType: "OVERAGE", tankerCapacityLtr: null, distanceBandCode: null },
      ],
      []
    );
    expect(find(items, "OVERAGE pricing configured").state).toBe("READY");
  });

  it("8a. tanker capacity coverage: a wildcard rule covers everything, even with zero capacity-specific rules", () => {
    const items = computeReadinessItems(
      baseContract(),
      [{ rateType: "STANDARD", tankerCapacityLtr: null, distanceBandCode: null }],
      []
    );
    expect(find(items, "Tanker capacity coverage").state).toBe("READY");
  });

  it("8b. tanker capacity coverage: all three standard capacities explicitly covered is Ready even with no wildcard", () => {
    const items = computeReadinessItems(
      baseContract(),
      [
        { rateType: "STANDARD", tankerCapacityLtr: 18000, distanceBandCode: null },
        { rateType: "STANDARD", tankerCapacityLtr: 21000, distanceBandCode: null },
        { rateType: "STANDARD", tankerCapacityLtr: 28000, distanceBandCode: null },
      ],
      []
    );
    expect(find(items, "Tanker capacity coverage").state).toBe("READY");
  });

  it("8c. tanker capacity coverage: a genuine gap (some capacities covered, no wildcard) shows Warning, not silently Ready", () => {
    const items = computeReadinessItems(
      baseContract(),
      [{ rateType: "STANDARD", tankerCapacityLtr: 18000, distanceBandCode: null }],
      []
    );
    expect(find(items, "Tanker capacity coverage").state).toBe("WARNING");
  });

  it("distance band coverage is only shown when a pricing rule actually references one, and reflects whether that band is still active", () => {
    const noBandUsage = computeReadinessItems(baseContract(), [{ rateType: "STANDARD", tankerCapacityLtr: null, distanceBandCode: null }], []);
    expect(noBandUsage.find((i) => i.label === "Distance band coverage")).toBeUndefined();

    const activeBandUsage = computeReadinessItems(
      baseContract(),
      [{ rateType: "STANDARD", tankerCapacityLtr: null, distanceBandCode: "BAND_A" }],
      [{ code: "BAND_A", isActive: true }]
    );
    expect(find(activeBandUsage, "Distance band coverage").state).toBe("READY");

    const retiredBandUsage = computeReadinessItems(
      baseContract(),
      [{ rateType: "STANDARD", tankerCapacityLtr: null, distanceBandCode: "BAND_B" }],
      [{ code: "BAND_B", isActive: false }]
    );
    expect(find(retiredBandUsage, "Distance band coverage").state).toBe("WARNING");
  });

  it("9. a MONTHLY_ACCUMULATED contract includes a monthly billing readiness row; a ONE_TIME_TRIP_COUNT one does not", () => {
    const monthly = computeReadinessItems(baseContract({ type: "MONTHLY_ACCUMULATED" }), [], []);
    expect(monthly.find((i) => i.label === "Monthly billing readiness")).toBeTruthy();

    const tripCount = computeReadinessItems(baseContract({ type: "ONE_TIME_TRIP_COUNT" }), [], []);
    expect(tripCount.find((i) => i.label === "Monthly billing readiness")).toBeUndefined();
  });

  it("10. payment terms and billing requirements are always shown as Unsupported, never editable or fabricated", () => {
    const items = computeReadinessItems(baseContract(), [], []);
    expect(find(items, "Payment terms").state).toBe("UNSUPPORTED");
    expect(find(items, "Billing requirements (PO/VAT/etc.)").state).toBe("UNSUPPORTED");
  });

  it("a DRAFT or SUSPENDED contract shows a Contract active warning, not a hard failure", () => {
    const draft = computeReadinessItems(baseContract({ status: "DRAFT" }), [], []);
    expect(find(draft, "Contract active").state).toBe("WARNING");
    const suspended = computeReadinessItems(baseContract({ status: "SUSPENDED" }), [], []);
    expect(find(suspended, "Contract active").state).toBe("WARNING");
  });
});
