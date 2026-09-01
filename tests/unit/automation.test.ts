import { describe, it, expect } from "vitest";
import { getEventType, isValidEventField, EVENT_TYPES } from "@/lib/automation";

describe("automation event registry (BR-22)", () => {
  it("returns null for an unknown event type", () => {
    expect(getEventType("NOT_A_REAL_EVENT")).toBeNull();
  });

  it("resolves known event types", () => {
    expect(getEventType("ORDER_CREATED")?.label).toBe("Order Created");
    expect(getEventType("DELIVERY_FAILED")?.label).toBe("Delivery Failed");
  });

  it("validates fields against the event's own whitelist only", () => {
    const orderCreated = getEventType("ORDER_CREATED")!;
    const deliveryFailed = getEventType("DELIVERY_FAILED")!;
    expect(isValidEventField(orderCreated, "qtyOrdered")).toBe(true);
    expect(isValidEventField(orderCreated, "failureReason")).toBe(false); // belongs to a different event
    expect(isValidEventField(deliveryFailed, "failureReason")).toBe(true);
  });

  it("rejects an injection-shaped string as a field name", () => {
    const orderCreated = getEventType("ORDER_CREATED")!;
    expect(isValidEventField(orderCreated, "id; DROP TABLE users;--")).toBe(false);
  });

  it("every event type has at least one whitelisted field", () => {
    for (const eventType of Object.values(EVENT_TYPES)) {
      expect(eventType.fields.length).toBeGreaterThan(0);
    }
  });
});
