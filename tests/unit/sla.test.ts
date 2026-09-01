import { describe, it, expect } from "vitest";
import { computeSlaStatus } from "@/lib/sla";

describe("computeSlaStatus (BR-20)", () => {
  it("is ON_TRACK well within the SLA window", () => {
    const result = computeSlaStatus({
      createdAt: new Date(), // just created
      slaMinutes: 180,
      status: "PENDING",
    });
    expect(result.slaStatus).toBe("ON_TRACK");
    expect(result.minutesRemaining).toBeGreaterThan(170);
  });

  it("is AT_RISK once 80% of the window has elapsed", () => {
    const result = computeSlaStatus({
      createdAt: new Date(Date.now() - 150 * 60_000), // 150/180 min elapsed = 83%
      slaMinutes: 180,
      status: "ASSIGNED",
    });
    expect(result.slaStatus).toBe("AT_RISK");
  });

  it("is BREACHED once past the due time and still not delivered", () => {
    const result = computeSlaStatus({
      createdAt: new Date(Date.now() - 200 * 60_000),
      slaMinutes: 180,
      status: "IN_TRANSIT",
    });
    expect(result.slaStatus).toBe("BREACHED");
    expect(result.minutesRemaining).toBeLessThan(0);
  });

  it("is MET when delivered before the due time", () => {
    const createdAt = new Date(Date.now() - 100 * 60_000);
    const completedAt = new Date(Date.now() - 50 * 60_000); // delivered 50 min ago, well before 180-min due time
    const result = computeSlaStatus({
      createdAt,
      slaMinutes: 180,
      status: "DELIVERED",
      completedAt,
    });
    expect(result.slaStatus).toBe("MET");
  });

  it("is MISSED when delivered after the due time", () => {
    const createdAt = new Date(Date.now() - 300 * 60_000);
    const completedAt = new Date(Date.now() - 10 * 60_000); // delivered 10 min ago, well past 180-min due time
    const result = computeSlaStatus({
      createdAt,
      slaMinutes: 180,
      status: "PARTIALLY_DELIVERED",
      completedAt,
    });
    expect(result.slaStatus).toBe("MISSED");
  });

  it("treats FAILED/CANCELLED orders as resolved (MET), not carrying a breach forward", () => {
    const result = computeSlaStatus({
      createdAt: new Date(Date.now() - 500 * 60_000), // way past any SLA window
      slaMinutes: 180,
      status: "FAILED",
    });
    expect(result.slaStatus).toBe("MET");
  });

  it("computes dueBy as createdAt + slaMinutes", () => {
    const createdAt = new Date("2026-01-01T10:00:00Z");
    const result = computeSlaStatus({ createdAt, slaMinutes: 120, status: "PENDING" });
    expect(result.dueBy.toISOString()).toBe("2026-01-01T12:00:00.000Z");
  });
});
