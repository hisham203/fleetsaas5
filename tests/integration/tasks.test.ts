import { describe, it, expect, beforeAll } from "vitest";
import { makeRequest, loginAs } from "../helpers/request";

describe("field task management (BR-23)", () => {
  let dispatcherCookie: string;
  let khalidCookie: string;
  let fahadCookie: string;
  let khalidDriverId: string;

  beforeAll(async () => {
    dispatcherCookie = await loginAs("dispatch@demo-water.co", "password123");
    khalidCookie = await loginAs("khalid@demo-water.co", "password123");
    fahadCookie = await loginAs("fahad@demo-water.co", "password123");

    const { GET: driversGet } = await import("@/app/api/drivers/route");
    const drivers = await (await driversGet(makeRequest("/api/drivers", { cookie: dispatcherCookie }))).json();
    khalidDriverId = drivers.find((d: any) => d.user.email === "khalid@demo-water.co").id;
  });

  it("a dispatcher assigns a task to a driver", async () => {
    const { POST } = await import("@/app/api/tasks/route");
    const res = await POST(makeRequest("/api/tasks", {
      method: "POST",
      cookie: dispatcherCookie,
      body: { driverId: khalidDriverId, type: "INSPECTION", title: "Pre-trip vehicle inspection" },
    }));
    expect(res.status).toBe(201);
    const task = await res.json();
    expect(task.status).toBe("ASSIGNED");
    expect(task.driver.user.name).toBe("Khalid Driver");
  });

  it("a driver only sees their own tasks, not another driver's", async () => {
    const { POST: createTask } = await import("@/app/api/tasks/route");
    await createTask(makeRequest("/api/tasks", {
      method: "POST",
      cookie: dispatcherCookie,
      body: { driverId: khalidDriverId, type: "VISIT", title: "Customer site visit" },
    }));

    const { GET } = await import("@/app/api/tasks/route");
    const khalidTasks = await (await GET(makeRequest("/api/tasks", { cookie: khalidCookie }))).json();
    expect(khalidTasks.length).toBeGreaterThan(0);
    expect(khalidTasks.every((t: any) => t.driverId === khalidDriverId)).toBe(true);

    const fahadTasks = await (await GET(makeRequest("/api/tasks", { cookie: fahadCookie }))).json();
    expect(fahadTasks.every((t: any) => t.driverId !== khalidDriverId)).toBe(true);
  });

  it("a driver can start and complete their own task with notes", async () => {
    const { POST: createTask } = await import("@/app/api/tasks/route");
    const task = await (
      await createTask(makeRequest("/api/tasks", {
        method: "POST",
        cookie: dispatcherCookie,
        body: { driverId: khalidDriverId, type: "REFUEL", title: "Refuel at depot" },
      }))
    ).json();

    const { PATCH } = await import("@/app/api/tasks/[id]/route");
    const startRes = await PATCH(makeRequest(`/api/tasks/${task.id}`, { method: "PATCH", cookie: khalidCookie, body: { action: "START" } }), {
      params: { id: task.id },
    });
    expect((await startRes.json()).status).toBe("IN_PROGRESS");

    const completeRes = await PATCH(
      makeRequest(`/api/tasks/${task.id}`, { method: "PATCH", cookie: khalidCookie, body: { action: "COMPLETE", completionNotes: "Tank filled, 45L" } }),
      { params: { id: task.id } }
    );
    const completed = await completeRes.json();
    expect(completed.status).toBe("COMPLETED");
    expect(completed.completionNotes).toBe("Tank filled, 45L");
    expect(completed.completedAt).toBeTruthy();
  });

  it("a driver cannot act on another driver's task", async () => {
    const { POST: createTask } = await import("@/app/api/tasks/route");
    const task = await (
      await createTask(makeRequest("/api/tasks", { method: "POST", cookie: dispatcherCookie, body: { driverId: khalidDriverId, type: "OTHER", title: "Test" } }))
    ).json();

    const { PATCH } = await import("@/app/api/tasks/[id]/route");
    const res = await PATCH(makeRequest(`/api/tasks/${task.id}`, { method: "PATCH", cookie: fahadCookie, body: { action: "START" } }), {
      params: { id: task.id },
    });
    expect(res.status).toBe(403);
  });

  it("a driver cannot cancel a task (Admin/Dispatcher only)", async () => {
    const { POST: createTask } = await import("@/app/api/tasks/route");
    const task = await (
      await createTask(makeRequest("/api/tasks", { method: "POST", cookie: dispatcherCookie, body: { driverId: khalidDriverId, type: "OTHER", title: "Cancel test" } }))
    ).json();

    const { PATCH } = await import("@/app/api/tasks/[id]/route");
    const driverAttempt = await PATCH(makeRequest(`/api/tasks/${task.id}`, { method: "PATCH", cookie: khalidCookie, body: { action: "CANCEL" } }), {
      params: { id: task.id },
    });
    expect(driverAttempt.status).toBe(403);

    const dispatcherAttempt = await PATCH(
      makeRequest(`/api/tasks/${task.id}`, { method: "PATCH", cookie: dispatcherCookie, body: { action: "CANCEL" } }),
      { params: { id: task.id } }
    );
    expect((await dispatcherAttempt.json()).status).toBe("CANCELLED");
  });
});
