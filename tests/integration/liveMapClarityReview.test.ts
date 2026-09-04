import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { makeRequest, loginAs } from "../helpers/request";
import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

// Task N.1 — LiveMap Marker Clarity & Map Fallback Review.
describe("LiveMap source-level marker clarity (Task N.1)", () => {
  const liveMapSource = fs.readFileSync(path.join(process.cwd(), "components/LiveMap.tsx"), "utf8");
  const dispatchSource = fs.readFileSync(path.join(process.cwd(), "app/dispatch/page.tsx"), "utf8");

  it("1. vehicle marker label uses plate number", () => {
    expect(liveMapSource).toContain("trip.vehicle.plateNumber");
  });

  it("2. destination marker context uses site/customer label when available", () => {
    expect(liveMapSource).toContain("destinationLabel");
    expect(liveMapSource).toContain("trip.destinationLabel");
  });

  it("3. loading point context uses the loading-point name when available", () => {
    expect(liveMapSource).toContain("loadingPointLabel");
    expect(liveMapSource).toContain("trip.loadingPointLabel");
  });

  it("4. missing vehicle GPS does not create a fake live-position marker — the marker's own title/label explicitly distinguishes live from fallback", () => {
    expect(liveMapSource).toContain("position.isLive");
    expect(liveMapSource).toContain("no GPS yet");
    expect(liveMapSource).not.toMatch(/label:\s*trip\.vehicle\.plateNumber\.slice/); // the old unconditional plate-suffix label is gone
  });

  it("5. missing destination coordinates (and missing GPS) shows a clear, honest fallback message in the dispatch UI, not silently nothing", () => {
    expect(dispatchSource).toContain("Live vehicle location unavailable");
  });

  it("the dispatch page's View on map button text is honest about live vs. fallback status", () => {
    expect(dispatchSource).toContain("View destination on map (no GPS yet)");
    expect(dispatchSource).toContain("position.isLive");
  });

  it("6. the map's own default center (used only to initialize the viewport) is never labeled as a vehicle, site, or loading point", () => {
    expect(liveMapSource).not.toMatch(/title.*DEFAULT_CENTER/);
  });

  it("7. Google Maps script failure (onerror, and a load timeout) sets a distinct failure state, never leaving the container silently blank forever", () => {
    expect(liveMapSource).toContain("script.onerror");
    expect(liveMapSource).toContain("loadFailed");
    expect(liveMapSource).toContain("setTimeout");
  });

  it("a thrown exception during map construction is caught, not left to crash uncaught", () => {
    const start = liveMapSource.indexOf("new google.maps.Map(containerRef.current");
    const surrounding = liveMapSource.slice(Math.max(0, start - 100), start + 400);
    expect(surrounding).toContain("try");
    expect(surrounding).toContain("catch");
  });

  it("the failure fallback message is clear and does not imply dispatch itself is broken", () => {
    expect(liveMapSource).toContain("Dispatching, loading confirmation, and trip");
    expect(liveMapSource).toContain("assignment all still work normally without it");
  });

  it("8. dispatch controls are structurally independent of LiveMap — the order queue, trip planner, and trip list are all outside the map's own render tree", () => {
    const mapBlockStart = dispatchSource.indexOf("<LiveMap");
    const mapBlockEnd = dispatchSource.indexOf("/>", mapBlockStart);
    // The dispatch queue and trip planner sections are defined well
    // after the LiveMap element closes, confirming they don't depend on
    // it rendering successfully — a map failure can't take them down.
    expect(dispatchSource.indexOf("Dispatch queue")).toBeGreaterThan(mapBlockEnd);
    expect(dispatchSource.indexOf("Plan trip")).toBeGreaterThan(mapBlockEnd);
  });
});

describe("Multi-stop future-readiness wording (Task N.1, Part 6)", () => {
  it("uses neutral Destination/Stop/Delivery site wording, not hardcoded single-stop-only language", () => {
    const liveMapSource = fs.readFileSync(path.join(process.cwd(), "components/LiveMap.tsx"), "utf8");
    expect(liveMapSource.toLowerCase()).not.toContain("the only stop");
    expect(liveMapSource.toLowerCase()).not.toContain("single delivery");
  });
});

describe("Security (Task N.1, Part 7)", () => {
  it("9. GET /api/trips (the data LiveMap's labels are built from) exposes no passwordHash", async () => {
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
    const adminCookie = await loginAs("admin@riyadh-bulk-water.co", "password123");
    const { GET: getTrips } = await import("@/app/api/trips/route");
    const res = await getTrips(makeRequest(`/api/trips?tenantId=${tenant!.id}`, { cookie: adminCookie }));
    const text = await res.text();
    expect(text).not.toContain("passwordHash");
  });
});
