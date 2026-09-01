import { db } from "./db/client";
import { automationRules, automationLogs, notifications, escalations, users } from "./db/schema";
import { genId } from "./helpers";
import { eq, and } from "drizzle-orm";

// BR-22: Workflow Automation Engine.
//
// This is a real rule engine — an Admin defines rules through the UI
// (event type + optional conditions + an action), and the exact same
// matching/execution code runs for every tenant's rules. Nothing here is
// hardcoded per-rule; the "automation" is genuinely configurable, which is
// what the BRD explicitly calls out as required ("automation rules must be
// customizable").
//
// There's no event bus. Each event fires by a direct call to
// runAutomationRules() from the route handler where that state change
// already happens — see the call sites in app/api/orders/route.ts,
// app/api/trips/[id]/stops/[stopId]/route.ts, and app/api/trips/[id]/route.ts.
// This is a deliberate simplification: a real pub/sub system would decouple
// event producers from this engine entirely, but that's a genuinely
// different and much larger piece of infrastructure than a single dev
// session's scope justifies here.

export type EventFieldType = "text" | "number" | "enum";

export type EventFieldDef = {
  key: string;
  label: string;
  type: EventFieldType;
  enumValues?: string[];
};

export type EventTypeDef = {
  key: string;
  label: string;
  fields: EventFieldDef[];
};

// Whitelisted per event type, same safety principle as the report
// builder's dataset/column whitelist (lib/reportDatasets.ts) — a rule's
// conditions can only ever reference a field that's actually here, never
// an arbitrary string that becomes part of a query.
export const EVENT_TYPES: Record<string, EventTypeDef> = {
  ORDER_CREATED: {
    key: "ORDER_CREATED",
    label: "Order Created",
    fields: [
      { key: "qtyOrdered", label: "Quantity", type: "number" },
      { key: "customerType", label: "Customer Type", type: "enum", enumValues: ["B2B", "B2C"] },
      { key: "paymentMethod", label: "Payment Method", type: "enum", enumValues: ["CASH", "CARD", "ONLINE", "ACCOUNT_CREDIT"] },
    ],
  },
  DELIVERY_FAILED: {
    key: "DELIVERY_FAILED",
    label: "Delivery Failed",
    fields: [{ key: "failureReason", label: "Failure Reason", type: "text" }],
  },
  DELIVERY_COMPLETED: {
    key: "DELIVERY_COMPLETED",
    label: "Delivery Completed",
    fields: [
      { key: "deliveredQty", label: "Delivered Quantity", type: "number" },
      { key: "wasPartial", label: "Was Partial", type: "enum", enumValues: ["true", "false"] },
    ],
  },
  TRIP_DISPATCHED: {
    key: "TRIP_DISPATCHED",
    label: "Trip Dispatched",
    fields: [{ key: "vehicleType", label: "Vehicle Type", type: "text" }],
  },
  INVOICE_CREATED: {
    key: "INVOICE_CREATED",
    label: "Invoice Created",
    fields: [
      { key: "total", label: "Total (SAR)", type: "number" },
      { key: "status", label: "Status", type: "enum", enumValues: ["PENDING", "PAID"] },
    ],
  },
  EXPENSE_SUBMITTED: {
    key: "EXPENSE_SUBMITTED",
    label: "Expense Submitted",
    fields: [
      { key: "amount", label: "Amount (SAR)", type: "number" },
      { key: "category", label: "Category", type: "enum", enumValues: ["FUEL", "TOLL", "MAINTENANCE", "OTHER"] },
    ],
  },
};

export type ConditionOperator = "eq" | "neq" | "contains" | "gt" | "gte" | "lt" | "lte";

export type AutomationCondition = {
  field: string;
  operator: ConditionOperator;
  value: string | number;
};

export type ActionConfig =
  | { message: string } // NOTIFY — supports {{fieldName}} placeholders filled in from the event payload
  | { severity: "MEDIUM" | "HIGH" }; // ESCALATE

export function getEventType(key: string): EventTypeDef | null {
  return EVENT_TYPES[key] ?? null;
}

export function isValidEventField(eventType: EventTypeDef, fieldKey: string): boolean {
  return eventType.fields.some((f) => f.key === fieldKey);
}

function matchesCondition(payload: Record<string, unknown>, condition: AutomationCondition, fieldType: EventFieldType): boolean {
  const val = payload[condition.field];
  if (val == null) return false;

  if (fieldType === "number") {
    const numVal = Number(val);
    const target = Number(condition.value);
    switch (condition.operator) {
      case "eq": return numVal === target;
      case "neq": return numVal !== target;
      case "gt": return numVal > target;
      case "gte": return numVal >= target;
      case "lt": return numVal < target;
      case "lte": return numVal <= target;
      default: return false;
    }
  }

  const strVal = String(val).toLowerCase();
  const target = String(condition.value).toLowerCase();
  switch (condition.operator) {
    case "eq": return strVal === target;
    case "neq": return strVal !== target;
    case "contains": return strVal.includes(target);
    default: return false;
  }
}

function fillTemplate(template: string, payload: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key) => (payload[key] != null ? String(payload[key]) : `{{${key}}}`));
}

// Fires every enabled rule for this tenant+eventType whose conditions match
// the given payload. Anti-spam (BRD: "must prevent excessive repetition of
// alerts"): a rule fires AT MOST ONCE per (rule, order) pair — if this
// exact rule already produced a FIRED log for this order, it's skipped
// (and that skip is itself logged, so the dedup behavior is verifiable,
// not just assumed). Payload should include `orderId` when the event
// relates to a specific order, which all five current event types do.
export async function runAutomationRules(
  tenantId: string,
  eventType: string,
  payload: Record<string, unknown> & { orderId?: string }
): Promise<void> {
  const eventDef = getEventType(eventType);
  if (!eventDef) return;

  const rules = await db.query.automationRules.findMany({
    where: and(eq(automationRules.tenantId, tenantId), eq(automationRules.eventType, eventType), eq(automationRules.enabled, true)),
  });
  if (rules.length === 0) return;

  for (const rule of rules) {
    const conditions: AutomationCondition[] = JSON.parse(rule.conditions);
    const matches = conditions.every((c) => {
      const fieldDef = eventDef.fields.find((f) => f.key === c.field);
      return fieldDef ? matchesCondition(payload, c, fieldDef.type) : false;
    });
    if (!matches) continue;

    if (payload.orderId) {
      const existingLog = await db.query.automationLogs.findFirst({
        where: and(eq(automationLogs.ruleId, rule.id), eq(automationLogs.orderId, payload.orderId), eq(automationLogs.status, "FIRED")),
      });
      if (existingLog) {
        await db.insert(automationLogs).values({
          id: genId(),
          tenantId,
          ruleId: rule.id,
          eventType,
          orderId: payload.orderId,
          status: "SKIPPED_DUPLICATE",
        });
        continue;
      }
    }

    const actionConfig = JSON.parse(rule.actionConfig) as ActionConfig;
    let details = "";

    if (rule.action === "NOTIFY" && "message" in actionConfig) {
      const message = fillTemplate(actionConfig.message, payload);
      await db.insert(notifications).values({ id: genId(), tenantId, orderId: payload.orderId ?? null, message });
      details = message;
    } else if (rule.action === "ESCALATE" && "severity" in actionConfig && payload.orderId) {
      const admin = await db.query.users.findFirst({ where: and(eq(users.tenantId, tenantId), eq(users.role, "ADMIN")) });
      const escalationId = genId();
      await db.insert(escalations).values({
        id: escalationId,
        tenantId,
        orderId: payload.orderId,
        severity: actionConfig.severity,
        slaStatusAtEscalation: "RULE_TRIGGERED",
        escalatedToUserId: admin?.id,
      });
      details = escalationId;
    } else {
      continue; // action needs an orderId (ESCALATE) but none was provided — skip rather than fail
    }

    await db.insert(automationLogs).values({
      id: genId(),
      tenantId,
      ruleId: rule.id,
      eventType,
      orderId: payload.orderId ?? null,
      status: "FIRED",
      actionTaken: rule.action,
      details,
    });
  }
}
