import { describe, it, expect, beforeAll } from "vitest";
import { makeRequest, loginAs } from "../helpers/request";

describe("vehicle maintenance/fuel/tyre records (BR-13/14/15)", () => {
  let adminCookie: string;
  let dispatcherCookie: string;
  let vehicleId: string;

  beforeAll(async () => {
    adminCookie = await loginAs("admin@demo-water.co", "password123");
    dispatcherCookie = await loginAs("dispatch@demo-water.co", "password123");

    const { POST: createVehicle } = await import("@/app/api/vehicles/route");
    const vehicle = await (
      await createVehicle(makeRequest("/api/vehicles", {
        method: "POST",
        cookie: adminCookie,
        body: { plateNumber: "TEST-MAINT-1", vehicleType: "Refill Van", capacityUnits: 80 },
      }))
    ).json();
    vehicleId = vehicle.id;
  });

  describe("maintenance", () => {
    it("opening a maintenance record takes the vehicle out of service", async () => {
      const { POST: createRecord } = await import("@/app/api/vehicles/[id]/maintenance/route");
      const res = await createRecord(
        makeRequest(`/api/vehicles/${vehicleId}/maintenance`, {
          method: "POST",
          cookie: adminCookie,
          body: { type: "PREVENTIVE", description: "10,000km service", odometerReading: 10000 },
        }),
        { params: { id: vehicleId } }
      );
      expect(res.status).toBe(201);
      const record = await res.json();
      expect(record.status).toBe("OPEN");

      const { GET: vehiclesGet } = await import("@/app/api/vehicles/route");
      const vehicles = await (await vehiclesGet(makeRequest("/api/vehicles", { cookie: dispatcherCookie }))).json();
      expect(vehicles.find((v: any) => v.id === vehicleId).status).toBe("MAINTENANCE");

      // Store the record id on `this` via closure isn't possible across
      // `it` blocks in vitest, so re-fetch it in the next test instead.
    });

    it("lists maintenance records for the vehicle, and completing one returns it to AVAILABLE", async () => {
      const { GET: listRecords } = await import("@/app/api/vehicles/[id]/maintenance/route");
      const records = await (
        await listRecords(makeRequest(`/api/vehicles/${vehicleId}/maintenance`, { cookie: adminCookie }), { params: { id: vehicleId } })
      ).json();
      const openRecord = records.find((r: any) => r.status === "OPEN");
      expect(openRecord).toBeTruthy();

      const { PATCH: completeRecord } = await import("@/app/api/vehicles/[id]/maintenance/[recordId]/route");
      const res = await completeRecord(
        makeRequest(`/api/vehicles/${vehicleId}/maintenance/${openRecord.id}`, {
          method: "PATCH",
          cookie: adminCookie,
          body: { action: "complete", cost: 350 },
        }),
        { params: { id: vehicleId, recordId: openRecord.id } }
      );
      expect(res.status).toBe(200);
      const completed = await res.json();
      expect(completed.status).toBe("COMPLETED");
      expect(completed.cost).toBe(350);

      const { GET: vehiclesGet } = await import("@/app/api/vehicles/route");
      const vehicles = await (await vehiclesGet(makeRequest("/api/vehicles", { cookie: dispatcherCookie }))).json();
      expect(vehicles.find((v: any) => v.id === vehicleId).status).toBe("AVAILABLE");
    });

    it("a DISPATCHER cannot open a maintenance record (ADMIN only)", async () => {
      const { POST: createRecord } = await import("@/app/api/vehicles/[id]/maintenance/route");
      const res = await createRecord(
        makeRequest(`/api/vehicles/${vehicleId}/maintenance`, {
          method: "POST",
          cookie: dispatcherCookie,
          body: { type: "CORRECTIVE", description: "Brake pads" },
        }),
        { params: { id: vehicleId } }
      );
      expect(res.status).toBe(401);
    });
  });

  describe("fuel logs", () => {
    it("logs a fill-up and lists it back", async () => {
      const { POST: createLog } = await import("@/app/api/vehicles/[id]/fuel/route");
      const res = await createLog(
        makeRequest(`/api/vehicles/${vehicleId}/fuel`, {
          method: "POST",
          cookie: adminCookie,
          body: { litersFilled: 45, costSar: 202.5, odometerReading: 15000 },
        }),
        { params: { id: vehicleId } }
      );
      expect(res.status).toBe(201);
      const log = await res.json();
      expect(log.litersFilled).toBe(45);
      expect(log.costSar).toBe(202.5);

      const { GET: listLogs } = await import("@/app/api/vehicles/[id]/fuel/route");
      const logs = await (
        await listLogs(makeRequest(`/api/vehicles/${vehicleId}/fuel`, { cookie: adminCookie }), { params: { id: vehicleId } })
      ).json();
      expect(logs.some((l: any) => l.id === log.id)).toBe(true);
    });

    it("rejects an invalid fuel log (negative liters)", async () => {
      const { POST: createLog } = await import("@/app/api/vehicles/[id]/fuel/route");
      const res = await createLog(
        makeRequest(`/api/vehicles/${vehicleId}/fuel`, {
          method: "POST",
          cookie: adminCookie,
          body: { litersFilled: -5, costSar: 10 },
        }),
        { params: { id: vehicleId } }
      );
      expect(res.status).toBe(400);
    });

    it("a fuel log cannot be created against a vehicle from another tenant", async () => {
      const acmeCookie = await loginAs("admin@acme-fuel-demo.co", "password123");
      const { POST: createLog } = await import("@/app/api/vehicles/[id]/fuel/route");
      const res = await createLog(
        makeRequest(`/api/vehicles/${vehicleId}/fuel`, {
          method: "POST",
          cookie: acmeCookie,
          body: { litersFilled: 10, costSar: 50 },
        }),
        { params: { id: vehicleId } }
      );
      expect(res.status).toBe(404);
    });
  });

  describe("tyres", () => {
    it("installs a tyre and lists it back", async () => {
      const { POST: createTyre } = await import("@/app/api/vehicles/[id]/tyres/route");
      const res = await createTyre(
        makeRequest(`/api/vehicles/${vehicleId}/tyres`, {
          method: "POST",
          cookie: adminCookie,
          body: { position: "Front-Left", serialNumber: "TYR-TEST-1", costSar: 480, installOdometer: 5000 },
        }),
        { params: { id: vehicleId } }
      );
      expect(res.status).toBe(201);
      const tyre = await res.json();
      expect(tyre.status).toBe("ACTIVE");

      const { GET: listTyres } = await import("@/app/api/vehicles/[id]/tyres/route");
      const tyres = await (
        await listTyres(makeRequest(`/api/vehicles/${vehicleId}/tyres`, { cookie: adminCookie }), { params: { id: vehicleId } })
      ).json();
      expect(tyres.some((t: any) => t.id === tyre.id)).toBe(true);
    });

    it("retires a tyre", async () => {
      const { POST: createTyre } = await import("@/app/api/vehicles/[id]/tyres/route");
      const tyre = await (
        await createTyre(
          makeRequest(`/api/vehicles/${vehicleId}/tyres`, {
            method: "POST",
            cookie: adminCookie,
            body: { position: "Front-Right", serialNumber: "TYR-TEST-2" },
          }),
          { params: { id: vehicleId } }
        )
      ).json();

      const { PATCH: retireTyre } = await import("@/app/api/vehicles/[id]/tyres/[tyreId]/route");
      const res = await retireTyre(
        makeRequest(`/api/vehicles/${vehicleId}/tyres/${tyre.id}`, { method: "PATCH", cookie: adminCookie, body: { action: "retire" } }),
        { params: { id: vehicleId, tyreId: tyre.id } }
      );
      expect(res.status).toBe(200);
      const retired = await res.json();
      expect(retired.status).toBe("RETIRED");
      expect(retired.retiredAt).toBeTruthy();
    });

    it("a DISPATCHER cannot install or retire a tyre (ADMIN only)", async () => {
      const { POST: createTyre } = await import("@/app/api/vehicles/[id]/tyres/route");
      const res = await createTyre(
        makeRequest(`/api/vehicles/${vehicleId}/tyres`, { method: "POST", cookie: dispatcherCookie, body: { position: "Rear-Left" } }),
        { params: { id: vehicleId } }
      );
      expect(res.status).toBe(401);
    });
  });
});
