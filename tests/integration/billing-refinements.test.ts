import { describe, it, expect, beforeAll } from "vitest";
import { makeRequest, loginAs } from "../helpers/request";

describe("BR-18 billing refinements", () => {
  let adminCookie: string;
  let dispatcherCookie: string;
  let khalidCookie: string;
  let tenantId: string;
  let warehouseId: string;

  beforeAll(async () => {
    adminCookie = await loginAs("admin@demo-water.co", "password123");
    dispatcherCookie = await loginAs("dispatch@demo-water.co", "password123");
    khalidCookie = await loginAs("khalid@demo-water.co", "password123");

    const { GET: tenantGet } = await import("@/app/api/tenant/route");
    tenantId = (await (await tenantGet(makeRequest("/api/tenant", { cookie: adminCookie }))).json()).id;

    const { GET: warehousesGet } = await import("@/app/api/warehouses/route");
    const warehouses = await (await warehousesGet(makeRequest("/api/warehouses", { cookie: dispatcherCookie }))).json();
    warehouseId = warehouses.find((w: any) => w.isDefault).id;
  });

  async function deliverOrder(customerId: string, qty: number, opts: { discountAmount?: number; paymentMethod?: string } = {}) {
    const { POST: createOrder } = await import("@/app/api/orders/route");
    const order = await (
      await createOrder(makeRequest("/api/orders", {
        method: "POST",
        cookie: dispatcherCookie,
        body: {
          customerId,
          qtyOrdered: qty,
          emptyBottlesToCollect: 0,
          paymentMethod: opts.paymentMethod ?? "CASH",
          discountAmount: opts.discountAmount ?? 0,
        },
      }))
    ).json();

    const { GET: driversGet } = await import("@/app/api/drivers/route");
    const drivers = await (await driversGet(makeRequest("/api/drivers", { cookie: dispatcherCookie }))).json();
    const driver = drivers.find((d: any) => d.status === "AVAILABLE");
    const { GET: vehiclesGet } = await import("@/app/api/vehicles/route");
    const vehicles = await (await vehiclesGet(makeRequest("/api/vehicles", { cookie: dispatcherCookie }))).json();
    const vehicle = vehicles.find((v: any) => v.status === "AVAILABLE");

    const { POST: createTrip } = await import("@/app/api/trips/route");
    const trip = await (
      await createTrip(makeRequest("/api/trips", {
        method: "POST",
        cookie: dispatcherCookie,
        body: { driverId: driver.id, vehicleId: vehicle.id, warehouseId, orderIds: [order.id] },
      }))
    ).json();

    const { PATCH: confirmLoading } = await import("@/app/api/trips/[id]/loading/route");
    await confirmLoading(makeRequest(`/api/trips/${trip.id}/loading`, { method: "PATCH", cookie: dispatcherCookie }), { params: { id: trip.id } });
    const { PATCH: tripAction } = await import("@/app/api/trips/[id]/route");
    await tripAction(makeRequest(`/api/trips/${trip.id}`, { method: "PATCH", cookie: dispatcherCookie, body: { action: "dispatch" } }), {
      params: { id: trip.id },
    });

    const stopId = trip.stops[0].id;
    const driverCookie = driver.user.email === "khalid@demo-water.co" ? khalidCookie : await loginAs(driver.user.email, "password123");
    const { PATCH: stopAction } = await import("@/app/api/trips/[id]/stops/[stopId]/route");
    await stopAction(makeRequest(`/api/trips/${trip.id}/stops/${stopId}`, { method: "PATCH", cookie: driverCookie, body: { action: "arrive" } }), {
      params: { id: trip.id, stopId },
    });
    const deliverRes = await stopAction(
      makeRequest(`/api/trips/${trip.id}/stops/${stopId}`, {
        method: "PATCH",
        cookie: driverCookie,
        body: { action: "deliver", deliveredQty: qty, emptiesCollected: 0, recipientName: "Test" },
      }),
      { params: { id: trip.id, stopId } }
    );
    const result = await deliverRes.json();

    // Free the driver/vehicle for other tests.
    await tripAction(makeRequest(`/api/trips/${trip.id}`, { method: "PATCH", cookie: dispatcherCookie, body: { action: "complete" } }), {
      params: { id: trip.id },
    });

    return result.invoice;
  }

  describe("discounts", () => {
    it("applies a flat discount to the invoice subtotal before VAT", async () => {
      const { GET: customersGet } = await import("@/app/api/customers/route");
      const customers = await (await customersGet(makeRequest("/api/customers", { cookie: dispatcherCookie }))).json();
      const customer = customers.find((c: any) => c.name === "Al Yasmin Residence");

      // 3 bottles * 8 SAR = 24 subtotal, minus 10 SAR discount = 14, *1.15 VAT = 16.10
      const invoice = await deliverOrder(customer.id, 3, { discountAmount: 10 });
      expect(invoice.subtotal).toBeCloseTo(14, 2);
      expect(invoice.discountAmount).toBe(10);
      expect(invoice.total).toBeCloseTo(16.1, 2);
    });

    it("clamps the subtotal at zero rather than going negative when the discount exceeds the value", async () => {
      const { GET: customersGet } = await import("@/app/api/customers/route");
      const customers = await (await customersGet(makeRequest("/api/customers", { cookie: dispatcherCookie }))).json();
      const customer = customers.find((c: any) => c.name === "Al Malaz Family");

      // 1 bottle * 8 SAR = 8 subtotal, discount of 100 — should clamp to 0, not -92.
      const invoice = await deliverOrder(customer.id, 1, { discountAmount: 100 });
      expect(invoice.subtotal).toBe(0);
      expect(invoice.total).toBe(0);
    });
  });

  describe("contract pricing", () => {
    it("a B2B customer's contract rate overrides whatever price the order request supplies", async () => {
      const { GET: customersGet } = await import("@/app/api/customers/route");
      const customers = await (await customersGet(makeRequest("/api/customers", { cookie: dispatcherCookie }))).json();
      const jarir = customers.find((c: any) => c.name === "Jarir Bookstore HQ");

      const { PATCH: updateCustomer } = await import("@/app/api/customers/[id]/route");
      await updateCustomer(
        makeRequest(`/api/customers/${jarir.id}`, { method: "PATCH", cookie: adminCookie, body: { contractPricePerBottle: 6.5 } }),
        { params: { id: jarir.id } }
      );

      const { POST: createOrder } = await import("@/app/api/orders/route");
      const res = await createOrder(makeRequest("/api/orders", {
        method: "POST",
        cookie: dispatcherCookie,
        body: { customerId: jarir.id, qtyOrdered: 2, emptyBottlesToCollect: 0, paymentMethod: "ACCOUNT_CREDIT", pricePerBottle: 999 },
      }));
      const order = await res.json();
      expect(order.pricePerBottle).toBe(6.5); // NOT 999 — the contract rate won, ignoring the client-supplied price

      // Clean up: clear the contract rate so it doesn't affect other tests
      // in the suite that assume the default flat pricing for this customer.
      await updateCustomer(
        makeRequest(`/api/customers/${jarir.id}`, { method: "PATCH", cookie: adminCookie, body: { contractPricePerBottle: null } }),
        { params: { id: jarir.id } }
      );
    });

    it("a DISPATCHER cannot set a customer's contract price (ADMIN only)", async () => {
      const { GET: customersGet } = await import("@/app/api/customers/route");
      const customers = await (await customersGet(makeRequest("/api/customers", { cookie: dispatcherCookie }))).json();
      const customer = customers[0];

      const { PATCH: updateCustomer } = await import("@/app/api/customers/[id]/route");
      const res = await updateCustomer(
        makeRequest(`/api/customers/${customer.id}`, { method: "PATCH", cookie: dispatcherCookie, body: { contractPricePerBottle: 5 } }),
        { params: { id: customer.id } }
      );
      expect(res.status).toBe(401);
    });
  });

  describe("credit notes", () => {
    it("issues a credit note against an invoice and rejects one exceeding the remaining balance", async () => {
      const { GET: customersGet } = await import("@/app/api/customers/route");
      const customers = await (await customersGet(makeRequest("/api/customers", { cookie: dispatcherCookie }))).json();
      const customer = customers.find((c: any) => c.name === "Al Yasmin Residence");
      const invoice = await deliverOrder(customer.id, 2); // 2*8*1.15 = 18.40

      const { POST: createCreditNote } = await import("@/app/api/invoices/[id]/credit-notes/route");
      const tooMuch = await createCreditNote(
        makeRequest(`/api/invoices/${invoice.id}/credit-notes`, { method: "POST", cookie: adminCookie, body: { amount: 100, reason: "Test" } }),
        { params: { id: invoice.id } }
      );
      expect(tooMuch.status).toBe(422);

      const valid = await createCreditNote(
        makeRequest(`/api/invoices/${invoice.id}/credit-notes`, {
          method: "POST",
          cookie: adminCookie,
          body: { amount: 5, reason: "Partial refund — bottle was damaged" },
        }),
        { params: { id: invoice.id } }
      );
      expect(valid.status).toBe(201);
      const creditNote = await valid.json();
      expect(creditNote.creditNoteNumber).toMatch(/^CN-/);
      expect(creditNote.amount).toBe(5);

      // A second credit note for the remaining balance should succeed;
      // one exceeding what's left should now fail.
      const { GET: listCreditNotes } = await import("@/app/api/invoices/[id]/credit-notes/route");
      const list = await (await listCreditNotes(makeRequest(`/api/invoices/${invoice.id}/credit-notes`, { cookie: adminCookie }), { params: { id: invoice.id } })).json();
      expect(list).toHaveLength(1);

      const secondTooMuch = await createCreditNote(
        makeRequest(`/api/invoices/${invoice.id}/credit-notes`, { method: "POST", cookie: adminCookie, body: { amount: 20, reason: "Test" } }),
        { params: { id: invoice.id } }
      );
      expect(secondTooMuch.status).toBe(422); // 18.40 total - 5 already credited = 13.40 remaining, 20 exceeds it
    });

    it("a DISPATCHER cannot issue credit notes (ADMIN only)", async () => {
      const { GET: customersGet } = await import("@/app/api/customers/route");
      const customers = await (await customersGet(makeRequest("/api/customers", { cookie: dispatcherCookie }))).json();
      const customer = customers.find((c: any) => c.name === "Al Malaz Family");
      const invoice = await deliverOrder(customer.id, 1);

      const { POST: createCreditNote } = await import("@/app/api/invoices/[id]/credit-notes/route");
      const res = await createCreditNote(
        makeRequest(`/api/invoices/${invoice.id}/credit-notes`, { method: "POST", cookie: dispatcherCookie, body: { amount: 1, reason: "Test" } }),
        { params: { id: invoice.id } }
      );
      expect(res.status).toBe(401);
    });

    it("credit notes reduce a B2B customer's credit exposure", async () => {
      const { GET: customersGet } = await import("@/app/api/customers/route");
      const customers = await (await customersGet(makeRequest("/api/customers", { cookie: dispatcherCookie }))).json();
      const rajhi = customers.find((c: any) => c.name === "Al Rajhi Office Tower");

      const invoice = await deliverOrder(rajhi.id, 5, { paymentMethod: "ACCOUNT_CREDIT" }); // creates a PENDING invoice

      const { GET: statementGet } = await import("@/app/api/customers/[id]/statement/route");
      const before = await (await statementGet(makeRequest(`/api/customers/${rajhi.id}/statement`, { cookie: adminCookie }), { params: { id: rajhi.id } })).json();

      const { POST: createCreditNote } = await import("@/app/api/invoices/[id]/credit-notes/route");
      await createCreditNote(
        makeRequest(`/api/invoices/${invoice.id}/credit-notes`, { method: "POST", cookie: adminCookie, body: { amount: 10, reason: "Goodwill credit" } }),
        { params: { id: invoice.id } }
      );

      const after = await (await statementGet(makeRequest(`/api/customers/${rajhi.id}/statement`, { cookie: adminCookie }), { params: { id: rajhi.id } })).json();
      expect(after.unpaidInvoicesTotal).toBeCloseTo(before.unpaidInvoicesTotal - 10, 2);
      expect(after.totalExposure).toBeLessThan(before.totalExposure);
    });
  });

  describe("cash settlement", () => {
    it("settles cash for a CASH invoice, and rejects settling it twice", async () => {
      const { GET: customersGet } = await import("@/app/api/customers/route");
      const customers = await (await customersGet(makeRequest("/api/customers", { cookie: dispatcherCookie }))).json();
      const customer = customers.find((c: any) => c.name === "Al Yasmin Residence");
      const invoice = await deliverOrder(customer.id, 1, { paymentMethod: "CASH" });

      const { POST: settleCash } = await import("@/app/api/invoices/[id]/settle-cash/route");
      const res = await settleCash(makeRequest(`/api/invoices/${invoice.id}/settle-cash`, { method: "POST", cookie: adminCookie }), {
        params: { id: invoice.id },
      });
      expect(res.status).toBe(200);
      const settled = await res.json();
      expect(settled.cashSettled).toBe(true);
      expect(settled.cashSettledByUserId).toBeTruthy();

      const secondAttempt = await settleCash(makeRequest(`/api/invoices/${invoice.id}/settle-cash`, { method: "POST", cookie: adminCookie }), {
        params: { id: invoice.id },
      });
      expect(secondAttempt.status).toBe(422);
    });

    it("rejects cash settlement for a non-CASH invoice", async () => {
      const { GET: customersGet } = await import("@/app/api/customers/route");
      const customers = await (await customersGet(makeRequest("/api/customers", { cookie: dispatcherCookie }))).json();
      const customer = customers.find((c: any) => c.name === "Al Malaz Family");
      const invoice = await deliverOrder(customer.id, 1, { paymentMethod: "CARD" });

      const { POST: settleCash } = await import("@/app/api/invoices/[id]/settle-cash/route");
      const res = await settleCash(makeRequest(`/api/invoices/${invoice.id}/settle-cash`, { method: "POST", cookie: adminCookie }), {
        params: { id: invoice.id },
      });
      expect(res.status).toBe(422);
    });

    it("a DISPATCHER cannot settle cash (ADMIN only)", async () => {
      const { GET: customersGet } = await import("@/app/api/customers/route");
      const customers = await (await customersGet(makeRequest("/api/customers", { cookie: dispatcherCookie }))).json();
      const customer = customers.find((c: any) => c.name === "Al Yasmin Residence");
      const invoice = await deliverOrder(customer.id, 1, { paymentMethod: "CASH" });

      const { POST: settleCash } = await import("@/app/api/invoices/[id]/settle-cash/route");
      const res = await settleCash(makeRequest(`/api/invoices/${invoice.id}/settle-cash`, { method: "POST", cookie: dispatcherCookie }), {
        params: { id: invoice.id },
      });
      expect(res.status).toBe(401);
    });
  });

  it("Credit Notes appear as a report-builder dataset (BR-18 Collection Report output)", async () => {
    const { GET: datasetsGet } = await import("@/app/api/reports/datasets/route");
    const datasets = await (await datasetsGet(makeRequest("/api/reports/datasets", { cookie: dispatcherCookie }))).json();
    expect(datasets.map((d: any) => d.key)).toContain("creditNotes");

    const { POST: runReport } = await import("@/app/api/reports/run/route");
    const res = await runReport(makeRequest("/api/reports/run", {
      method: "POST",
      cookie: dispatcherCookie,
      body: { datasetKey: "creditNotes", config: { columns: ["customerName", "creditNoteNumber", "amount"], filters: [] } },
    }));
    expect(res.status).toBe(200);
  });
});
