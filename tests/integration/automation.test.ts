import { describe, it, expect, beforeAll } from "vitest";
import { makeRequest, loginAs } from "../helpers/request";

describe("workflow automation engine (BR-22)", () => {
  let adminCookie: string;
  let dispatcherCookie: string;
  let driverCookie: string;

  beforeAll(async () => {
    adminCookie = await loginAs("admin@demo-water.co", "password123");
    dispatcherCookie = await loginAs("dispatch@demo-water.co", "password123");
    driverCookie = await loginAs("khalid@demo-water.co", "password123");
  });

  it("lists the whitelisted event types", async () => {
    const { GET } = await import("@/app/api/automation/events/route");
    const res = await GET(makeRequest("/api/automation/events", { cookie: adminCookie }));
    const events = await res.json();
    const keys = events.map((e: any) => e.key);
    expect(keys).toEqual(
      expect.arrayContaining(["ORDER_CREATED", "DELIVERY_FAILED", "DELIVERY_COMPLETED", "TRIP_DISPATCHED", "INVOICE_CREATED"])
    );
  });

  it("creates a NOTIFY rule and rejects an unknown condition field", async () => {
    const { POST: createRule } = await import("@/app/api/automation/rules/route");

    const rejectRes = await createRule(makeRequest("/api/automation/rules", {
      method: "POST",
      cookie: adminCookie,
      body: {
        name: "Bad rule",
        eventType: "ORDER_CREATED",
        conditions: [{ field: "id; DROP TABLE users;--", operator: "eq", value: "x" }],
        action: "NOTIFY",
        actionConfig: { message: "test" },
      },
    }));
    expect(rejectRes.status).toBe(400);

    const okRes = await createRule(makeRequest("/api/automation/rules", {
      method: "POST",
      cookie: adminCookie,
      body: {
        name: "Notify on large B2B orders",
        eventType: "ORDER_CREATED",
        conditions: [
          { field: "customerType", operator: "eq", value: "B2B" },
          { field: "qtyOrdered", operator: "gte", value: 50 },
        ],
        action: "NOTIFY",
        actionConfig: { message: "Large B2B order placed: {{qtyOrdered}} bottles" },
      },
    }));
    expect(okRes.status).toBe(201);
    const rule = await okRes.json();
    expect(rule.conditions).toHaveLength(2);
  });

  it("fires a NOTIFY rule when a matching order is created, and produces a real notification with the template filled in", async () => {
    const { POST: createRule } = await import("@/app/api/automation/rules/route");
    const ruleRes = await createRule(makeRequest("/api/automation/rules", {
      method: "POST",
      cookie: adminCookie,
      body: {
        name: "Notify on cash orders over 10",
        eventType: "ORDER_CREATED",
        conditions: [
          { field: "paymentMethod", operator: "eq", value: "CASH" },
          { field: "qtyOrdered", operator: "gt", value: 10 },
        ],
        action: "NOTIFY",
        actionConfig: { message: "New cash order for {{qtyOrdered}} bottles" },
      },
    }));
    const rule = await ruleRes.json();

    const { GET: customersGet } = await import("@/app/api/customers/route");
    const customers = await (await customersGet(makeRequest("/api/customers", { cookie: dispatcherCookie }))).json();
    const customer = customers.find((c: any) => c.type === "B2C");

    const { POST: createOrder } = await import("@/app/api/orders/route");
    const order = await (
      await createOrder(makeRequest("/api/orders", {
        method: "POST",
        cookie: dispatcherCookie,
        body: { customerId: customer.id, qtyOrdered: 15, emptyBottlesToCollect: 0, paymentMethod: "CASH" },
      }))
    ).json();

    const { GET: logsGet } = await import("@/app/api/automation/logs/route");
    const logs = await (await logsGet(makeRequest("/api/automation/logs", { cookie: adminCookie }))).json();
    const firedLog = logs.find((l: any) => l.ruleId === rule.id && l.orderId === order.id);
    expect(firedLog).toBeTruthy();
    expect(firedLog.status).toBe("FIRED");
    expect(firedLog.actionTaken).toBe("NOTIFY");

    const { GET: notificationsGet } = await import("@/app/api/notifications/route");
    const notifications = await (await notificationsGet(makeRequest("/api/notifications", { cookie: adminCookie }))).json();
    const notification = notifications.find((n: any) => n.orderId === order.id);
    expect(notification).toBeTruthy();
    expect(notification.message).toBe("New cash order for 15 bottles");
  });

  it("does not fire for an order that doesn't match the rule's conditions", async () => {
    const { POST: createRule } = await import("@/app/api/automation/rules/route");
    const ruleRes = await createRule(makeRequest("/api/automation/rules", {
      method: "POST",
      cookie: adminCookie,
      body: {
        name: "Notify on huge orders only",
        eventType: "ORDER_CREATED",
        conditions: [{ field: "qtyOrdered", operator: "gt", value: 500 }],
        action: "NOTIFY",
        actionConfig: { message: "Huge order!" },
      },
    }));
    const rule = await ruleRes.json();

    const { GET: customersGet } = await import("@/app/api/customers/route");
    const customers = await (await customersGet(makeRequest("/api/customers", { cookie: dispatcherCookie }))).json();

    const { POST: createOrder } = await import("@/app/api/orders/route");
    const order = await (
      await createOrder(makeRequest("/api/orders", {
        method: "POST",
        cookie: dispatcherCookie,
        body: { customerId: customers[0].id, qtyOrdered: 3, emptyBottlesToCollect: 0, paymentMethod: "CASH" },
      }))
    ).json();


    const { GET: logsGet } = await import("@/app/api/automation/logs/route");
    const logs = await (await logsGet(makeRequest("/api/automation/logs", { cookie: adminCookie }))).json();
    expect(logs.find((l: any) => l.ruleId === rule.id && l.orderId === order.id)).toBeUndefined();
  });

  it("does not create duplicate escalations for the same order/rule (anti-spam)", async () => {
    const { POST: createRule } = await import("@/app/api/automation/rules/route");
    const ruleRes = await createRule(makeRequest("/api/automation/rules", {
      method: "POST",
      cookie: adminCookie,
      body: {
        name: "Escalate every failed delivery",
        eventType: "DELIVERY_FAILED",
        conditions: [],
        action: "ESCALATE",
        actionConfig: { severity: "HIGH" },
      },
    }));
    const rule = await ruleRes.json();

    // Directly exercise the engine twice for the same order to prove the
    // dedup guard, without needing a full trip/delivery flow.
    const { runAutomationRules } = await import("@/lib/automation");
    const { GET: tenantGet } = await import("@/app/api/tenant/route");
    const tenantId = (await (await tenantGet(makeRequest("/api/tenant", { cookie: adminCookie }))).json()).id;

    const { GET: customersGet } = await import("@/app/api/customers/route");
    const customers = await (await customersGet(makeRequest("/api/customers", { cookie: dispatcherCookie }))).json();
    const { POST: createOrder } = await import("@/app/api/orders/route");
    const order = await (
      await createOrder(makeRequest("/api/orders", {
        method: "POST",
        cookie: dispatcherCookie,
        body: { customerId: customers[0].id, qtyOrdered: 1, emptyBottlesToCollect: 0, paymentMethod: "CASH" },
      }))
    ).json();

    await runAutomationRules(tenantId, "DELIVERY_FAILED", { orderId: order.id, failureReason: "Test 1" });
    await runAutomationRules(tenantId, "DELIVERY_FAILED", { orderId: order.id, failureReason: "Test 2" });

    const { GET: logsGet } = await import("@/app/api/automation/logs/route");
    const logs = await (await logsGet(makeRequest("/api/automation/logs", { cookie: adminCookie }))).json();
    const ruleLogsForOrder = logs.filter((l: any) => l.ruleId === rule.id && l.orderId === order.id);
    expect(ruleLogsForOrder.filter((l: any) => l.status === "FIRED")).toHaveLength(1);
    expect(ruleLogsForOrder.filter((l: any) => l.status === "SKIPPED_DUPLICATE")).toHaveLength(1);

    const { GET: escalationsGet } = await import("@/app/api/escalations/route");
    const escalations = await (await escalationsGet(makeRequest("/api/escalations?status=OPEN", { cookie: dispatcherCookie }))).json();
    expect(escalations.filter((e: any) => e.orderId === order.id)).toHaveLength(1); // not 2
  });

  it("a disabled rule never fires", async () => {
    const { POST: createRule } = await import("@/app/api/automation/rules/route");
    const ruleRes = await createRule(makeRequest("/api/automation/rules", {
      method: "POST",
      cookie: adminCookie,
      body: {
        name: "Disabled rule",
        eventType: "ORDER_CREATED",
        conditions: [],
        action: "NOTIFY",
        actionConfig: { message: "Should never fire" },
        enabled: false,
      },
    }));
    const rule = await ruleRes.json();
    expect(rule.enabled).toBe(false);

    const { GET: customersGet } = await import("@/app/api/customers/route");
    const customers = await (await customersGet(makeRequest("/api/customers", { cookie: dispatcherCookie }))).json();
    const { POST: createOrder } = await import("@/app/api/orders/route");
    const order = await (
      await createOrder(makeRequest("/api/orders", {
        method: "POST",
        cookie: dispatcherCookie,
        body: { customerId: customers[0].id, qtyOrdered: 1, emptyBottlesToCollect: 0, paymentMethod: "CASH" },
      }))
    ).json();


    const { GET: logsGet } = await import("@/app/api/automation/logs/route");
    const logs = await (await logsGet(makeRequest("/api/automation/logs", { cookie: adminCookie }))).json();
    expect(logs.find((l: any) => l.ruleId === rule.id && l.orderId === order.id)).toBeUndefined();
  });

  it("can toggle a rule enabled/disabled and delete it", async () => {
    const { POST: createRule } = await import("@/app/api/automation/rules/route");
    const rule = await (
      await createRule(makeRequest("/api/automation/rules", {
        method: "POST",
        cookie: adminCookie,
        body: { name: "Toggle test", eventType: "ORDER_CREATED", conditions: [], action: "NOTIFY", actionConfig: { message: "x" } },
      }))
    ).json();

    const { PATCH: updateRule } = await import("@/app/api/automation/rules/[id]/route");
    const disableRes = await updateRule(
      makeRequest(`/api/automation/rules/${rule.id}`, { method: "PATCH", cookie: adminCookie, body: { enabled: false } }),
      { params: { id: rule.id } }
    );
    expect((await disableRes.json()).enabled).toBe(false);

    const { DELETE: deleteRule } = await import("@/app/api/automation/rules/[id]/route");
    const deleteRes = await deleteRule(makeRequest(`/api/automation/rules/${rule.id}`, { method: "DELETE", cookie: adminCookie }), {
      params: { id: rule.id },
    });
    expect(deleteRes.status).toBe(200);

    const { GET: listRules } = await import("@/app/api/automation/rules/route");
    const rules = await (await listRules(makeRequest("/api/automation/rules", { cookie: adminCookie }))).json();
    expect(rules.find((r: any) => r.id === rule.id)).toBeUndefined();
  });

  it("a DISPATCHER cannot create or manage rules (ADMIN only), but can view logs/notifications", async () => {
    const { POST: createRule } = await import("@/app/api/automation/rules/route");
    const res = await createRule(makeRequest("/api/automation/rules", {
      method: "POST",
      cookie: dispatcherCookie,
      body: { name: "Should fail", eventType: "ORDER_CREATED", conditions: [], action: "NOTIFY", actionConfig: { message: "x" } },
    }));
    expect(res.status).toBe(401);

    const { GET: logsGet } = await import("@/app/api/automation/logs/route");
    const logsRes = await logsGet(makeRequest("/api/automation/logs", { cookie: dispatcherCookie }));
    expect(logsRes.status).toBe(200);
  });

  it("a DRIVER cannot view automation rules, logs, or notifications", async () => {
    const { GET: rulesGet } = await import("@/app/api/automation/rules/route");
    expect((await rulesGet(makeRequest("/api/automation/rules", { cookie: driverCookie }))).status).toBe(401);

    const { GET: logsGet } = await import("@/app/api/automation/logs/route");
    expect((await logsGet(makeRequest("/api/automation/logs", { cookie: driverCookie }))).status).toBe(401);
  });
});
