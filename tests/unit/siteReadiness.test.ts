import { describe, it, expect } from "vitest";
import { computeSiteReadinessItems } from "@/lib/siteReadiness";

function find(items: ReturnType<typeof computeSiteReadinessItems>, label: string) {
  const item = items.find((i) => i.label === label);
  expect(item, `expected a readiness item labeled "${label}"`).toBeTruthy();
  return item!;
}

describe("computeSiteReadinessItems (Task K)", () => {
  it("a fully-configured site is Ready across every check", () => {
    const items = computeSiteReadinessItems({
      customerId: "cust-1", address: "123 Main St", cityCode: "RUH", zoneCode: "N", distanceBandCode: "BAND_A", lat: 24.7, lng: 46.7,
    });
    expect(items.every((i) => i.state === "READY")).toBe(true);
  });

  it("a site with no customerId or address shows Missing for both", () => {
    const items = computeSiteReadinessItems({ customerId: null, address: null });
    expect(find(items, "Customer assigned").state).toBe("MISSING");
    expect(find(items, "Address present").state).toBe("MISSING");
  });

  it("missing cityCode/zoneCode/distanceBandCode/coordinates are Warnings, not hard failures", () => {
    const items = computeSiteReadinessItems({ customerId: "cust-1", address: "123 Main St" });
    expect(find(items, "City code set").state).toBe("WARNING");
    expect(find(items, "Zone code set").state).toBe("WARNING");
    expect(find(items, "Distance band set").state).toBe("WARNING");
    expect(find(items, "Coordinates present (for dispatch/map)").state).toBe("WARNING");
  });

  it("partial coordinates (only lat, no lng) still count as missing coordinates", () => {
    const items = computeSiteReadinessItems({ customerId: "cust-1", address: "123 Main St", lat: 24.7, lng: null });
    expect(find(items, "Coordinates present (for dispatch/map)").state).toBe("WARNING");
  });
});
