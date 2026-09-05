import { describe, it, expect } from "vitest";
import { deriveOperationalStatus, deriveBillingStatus, deriveDemandSource } from "@/lib/controlTowerStatus";

// Milestone Q — Control Tower status normalization tests.
const base = {
  order: { status: "PENDING", contractId: null },
  customer: { type: "B2B" },
  trip: null,
  stop: null,
  exception: null,
  invoice: null,
  contractType: null,
} as const;

describe("deriveOperationalStatus", () => {
  it("a brand-new PENDING order with no trip is NEW", () => {
    expect(deriveOperationalStatus(base)).toBe("NEW");
  });

  it("a VALIDATED/QUEUED order with no trip is READY_FOR_PLANNING", () => {
    expect(deriveOperationalStatus({ ...base, order: { status: "VALIDATED", contractId: null } })).toBe("READY_FOR_PLANNING");
    expect(deriveOperationalStatus({ ...base, order: { status: "QUEUED", contractId: null } })).toBe("READY_FOR_PLANNING");
  });

  it("a trip in PLANNED, not yet loading-confirmed, is ASSIGNED_WAITING_LOADING", () => {
    const input = { ...base, order: { status: "ASSIGNED", contractId: null }, trip: { status: "PLANNED", loadingConfirmed: false } };
    expect(deriveOperationalStatus(input)).toBe("ASSIGNED_WAITING_LOADING");
  });

  it("a trip in PLANNED, loading confirmed, is LOADED", () => {
    const input = { ...base, order: { status: "ASSIGNED", contractId: null }, trip: { status: "PLANNED", loadingConfirmed: true } };
    expect(deriveOperationalStatus(input)).toBe("LOADED");
  });

  it("a DISPATCHED trip with the order not yet delivered is IN_TRANSIT", () => {
    const input = { ...base, order: { status: "ASSIGNED", contractId: null }, trip: { status: "DISPATCHED", loadingConfirmed: true } };
    expect(deriveOperationalStatus(input)).toBe("IN_TRANSIT");
  });

  it("a DISPATCHED trip with the order already DELIVERED (stop closed, trip not yet marked complete) is DELIVERED", () => {
    const input = { ...base, order: { status: "DELIVERED", contractId: null }, trip: { status: "DISPATCHED", loadingConfirmed: true } };
    expect(deriveOperationalStatus(input)).toBe("DELIVERED");
  });

  it("a COMPLETED trip is DELIVERED", () => {
    const input = { ...base, order: { status: "DELIVERED", contractId: null }, trip: { status: "COMPLETED", loadingConfirmed: true } };
    expect(deriveOperationalStatus(input)).toBe("DELIVERED");
  });

  it("an open exception overrides everything else, even a live dispatched trip", () => {
    const input = {
      ...base,
      order: { status: "ASSIGNED", contractId: null },
      trip: { status: "DISPATCHED", loadingConfirmed: true },
      exception: { status: "OPEN" },
    };
    expect(deriveOperationalStatus(input)).toBe("EXCEPTION");
  });

  it("a resolved exception does NOT override — the underlying status governs again", () => {
    const input = {
      ...base,
      order: { status: "DELIVERED", contractId: null },
      trip: { status: "COMPLETED", loadingConfirmed: true },
      exception: { status: "RESOLVED" },
    };
    expect(deriveOperationalStatus(input)).toBe("DELIVERED");
  });

  it("a FAILED order (no open exception row passed) is still EXCEPTION", () => {
    expect(deriveOperationalStatus({ ...base, order: { status: "FAILED", contractId: null } })).toBe("EXCEPTION");
  });

  it("a CANCELLED order is CANCELLED, taking priority even with an open exception", () => {
    const input = { ...base, order: { status: "CANCELLED", contractId: null }, exception: { status: "OPEN" } };
    expect(deriveOperationalStatus(input)).toBe("CANCELLED");
  });
});

describe("deriveBillingStatus", () => {
  it("a non-delivered order is NOT_APPLICABLE regardless of anything else", () => {
    expect(deriveBillingStatus({ ...base, order: { status: "PENDING", contractId: "c1" }, contractType: "ONE_TIME_TRIP_COUNT" })).toBe("NOT_APPLICABLE");
  });

  it("a delivered MONTHLY_ACCUMULATED order is DEFERRED_MONTHLY, never PENDING_BILLING", () => {
    const input = { ...base, order: { status: "DELIVERED", contractId: "c1" }, contractType: "MONTHLY_ACCUMULATED" };
    expect(deriveBillingStatus(input)).toBe("DEFERRED_MONTHLY");
  });

  it("a delivered order with no invoice yet (billingError case) is PENDING_BILLING", () => {
    const input = { ...base, order: { status: "DELIVERED", contractId: "c1" }, contractType: "ONE_TIME_TRIP_COUNT", invoice: null };
    expect(deriveBillingStatus(input)).toBe("PENDING_BILLING");
  });

  it("a delivered order with a PENDING invoice is INVOICED_PENDING", () => {
    const input = { ...base, order: { status: "DELIVERED", contractId: null }, invoice: { status: "PENDING" } };
    expect(deriveBillingStatus(input)).toBe("INVOICED_PENDING");
  });

  it("a delivered order with a PAID invoice is INVOICED_PAID", () => {
    const input = { ...base, order: { status: "DELIVERED", contractId: null }, invoice: { status: "PAID" } };
    expect(deriveBillingStatus(input)).toBe("INVOICED_PAID");
  });

  it("a PARTIALLY_DELIVERED order is treated the same as DELIVERED for billing purposes", () => {
    const input = { ...base, order: { status: "PARTIALLY_DELIVERED", contractId: null }, invoice: { status: "PAID" } };
    expect(deriveBillingStatus(input)).toBe("INVOICED_PAID");
  });
});

describe("deriveDemandSource", () => {
  it("a contract-linked order is B2B_CONTRACT regardless of customer type", () => {
    expect(deriveDemandSource({ ...base, order: { status: "PENDING", contractId: "c1" }, customer: { type: "B2C" } })).toBe("B2B_CONTRACT");
  });

  it("a non-contract B2B customer order is B2B_CASH", () => {
    expect(deriveDemandSource({ ...base, order: { status: "PENDING", contractId: null }, customer: { type: "B2B" } })).toBe("B2B_CASH");
  });

  it("a non-contract B2C customer order is B2C_CASH", () => {
    expect(deriveDemandSource({ ...base, order: { status: "PENDING", contractId: null }, customer: { type: "B2C" } })).toBe("B2C_CASH");
  });

  it("an order with no resolvable customer type reports UNKNOWN rather than guessing", () => {
    expect(deriveDemandSource({ ...base, order: { status: "PENDING", contractId: null }, customer: null })).toBe("UNKNOWN");
    expect(deriveDemandSource({ ...base, order: { status: "PENDING", contractId: null }, customer: { type: "SOMETHING_ELSE" } })).toBe("UNKNOWN");
  });
});
