import { db } from "../lib/db/client";
import {
  tenants,
  users,
  vehicles,
  drivers,
  customers,
  orders,
  customerLocations,
  warehouses,
  trips,
  tripStops,
  contracts,
  contractSiteScope,
  contractPricingRules,
  distanceBands,
} from "../lib/db/schema";
import { genId, genNumber } from "../lib/helpers";
import { eq, and } from "drizzle-orm";

// S3 hotfix — extracted from scripts/seedData.ts and made genuinely
// idempotent. The original version (Task F) always called genId() and
// inserted unconditionally, which is exactly what broke on Railway: running
// `npm run db:seed` (which seeds Demo Water Co. + Acme + this tenant
// together) against a database that already has Demo Water Co.'s users
// fails immediately on THEIR duplicate emails, long before this tenant's
// own code ever runs. This module is now safe to call on its own, against
// a database that already has old seed data, and safe to call more than
// once: every resource here is found-by-a-stable-identifier-or-created,
// tracked in the returned summary so a caller (the new standalone CLI
// script) can report exactly what happened.
//
// Deliberately NOT extended to Demo Water Co./Acme's own seeding in
// seedData.ts — those remain exactly as they were (non-idempotent,
// pre-existing, documented behavior). Fixing this tenant's own
// addability was the actual, scoped hotfix; broadening it further would
// be a larger refactor than this fix calls for.
export type SeedRiyadhBulkWaterResult = {
  tenantId: string;
  created: { tenant: boolean; users: number; drivers: number; vehicles: number; customers: number; contracts: number; pricingRules: number };
  reused: { tenant: boolean; users: number; drivers: number; vehicles: number; customers: number; contracts: number; pricingRules: number };
};

export async function seedRiyadhBulkWaterTenant(passwordHash: string, now: number): Promise<SeedRiyadhBulkWaterResult> {
  const created = { tenant: false, users: 0, drivers: 0, vehicles: 0, customers: 0, contracts: 0, pricingRules: 0 };
  const reused = { tenant: false, users: 0, drivers: 0, vehicles: 0, customers: 0, contracts: 0, pricingRules: 0 };

  // ---------- Tenant ----------
  const existingTenant = await db.query.tenants.findFirst({ where: eq(tenants.name, "Riyadh Bulk Water Logistics") });
  let tenant3Id: string;
  if (existingTenant) {
    reused.tenant = true;
    tenant3Id = existingTenant.id;
  } else {
    tenant3Id = genId();
    await db.insert(tenants).values({ id: tenant3Id, name: "Riyadh Bulk Water Logistics", sector: "WATER_DELIVERY" });
    created.tenant = true;
  }

  // ---------- Users (find-or-create by email — the real unique constraint) ----------
  async function findOrCreateUser(email: string, name: string, role: "ADMIN" | "DISPATCHER" | "DRIVER") {
    const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
    if (existing) {
      reused.users++;
      return existing.id;
    }
    const id = genId();
    await db.insert(users).values({ id, tenantId: tenant3Id, name, email, passwordHash, role });
    created.users++;
    return id;
  }

  const rbwAdminId = await findOrCreateUser("admin@riyadh-bulk-water.co", "Abdullah Al-Otaibi", "ADMIN");
  await findOrCreateUser("dispatch@riyadh-bulk-water.co", "Reem Al-Qahtani", "DISPATCHER");
  const rbwDriverNames = ["Mohammed Al-Dosari", "Ibrahim Al-Shammari", "Ahmed Al-Ghamdi", "Yousef Al-Zahrani"];
  const rbwDriverEmails = [
    "mohammed@riyadh-bulk-water.co",
    "ibrahim@riyadh-bulk-water.co",
    "ahmed@riyadh-bulk-water.co",
    "yousef@riyadh-bulk-water.co",
  ];
  const rbwDriverUserIds = await Promise.all(rbwDriverEmails.map((email, i) => findOrCreateUser(email, rbwDriverNames[i], "DRIVER")));

  // ---------- Drivers (find-or-create by userId — the real unique constraint) ----------
  async function findOrCreateDriver(userId: string, licenseNumber: string, phone: string) {
    const existing = await db.query.drivers.findFirst({ where: eq(drivers.userId, userId) });
    if (existing) {
      reused.drivers++;
      return existing.id;
    }
    const id = genId();
    await db.insert(drivers).values({ id, tenantId: tenant3Id, userId, licenseNumber, phone, status: "AVAILABLE" });
    created.drivers++;
    return id;
  }
  const rbwDriverIds = await Promise.all(
    rbwDriverUserIds.map((userId, i) => findOrCreateDriver(userId, `RBW-LIC-${1000 + i}`, `05${(50000000 + i * 111111).toString().slice(0, 8)}`))
  );

  // ---------- Loading point (find-or-create by tenantId+name) ----------
  const existingLoadingPoint = await db.query.warehouses.findFirst({ where: and(eq(warehouses.tenantId, tenant3Id), eq(warehouses.name, "Main Loading Point - Riyadh Industrial Area")) });
  let rbwLoadingPointId: string;
  if (existingLoadingPoint) {
    rbwLoadingPointId = existingLoadingPoint.id;
  } else {
    rbwLoadingPointId = genId();
    await db.insert(warehouses).values({
      id: rbwLoadingPointId, tenantId: tenant3Id, name: "Main Loading Point - Riyadh Industrial Area",
      address: "2nd Industrial City, Riyadh", lat: 24.6333, lng: 46.7167, isDefault: true,
    });
  }

  // ---------- Vehicles (find-or-create by tenantId+plateNumber) ----------
  async function findOrCreateVehicle(plateNumber: string, capacityLiters: number) {
    const existing = await db.query.vehicles.findFirst({ where: and(eq(vehicles.tenantId, tenant3Id), eq(vehicles.plateNumber, plateNumber)) });
    if (existing) {
      reused.vehicles++;
      return existing.id;
    }
    const id = genId();
    await db.insert(vehicles).values({ id, tenantId: tenant3Id, plateNumber, vehicleType: "Water Tanker", capacityLiters, status: "AVAILABLE", homeWarehouseId: rbwLoadingPointId });
    created.vehicles++;
    return id;
  }
  const rbwVehicleSpecs: [string, number][] = [
    ["RBW-T001", 18000], ["RBW-T002", 18000],
    ["RBW-T003", 21000], ["RBW-T004", 21000],
    ["RBW-T005", 28000], ["RBW-T006", 28000],
  ];
  const rbwVehicleIds = await Promise.all(rbwVehicleSpecs.map(([plate, cap]) => findOrCreateVehicle(plate, cap)));

  // ---------- Distance bands (find-or-create by the real (tenantId, code) unique constraint) ----------
  const rbwBands: { code: string; fromKm: number; toKm: number | null; label: string }[] = [
    { code: "RIYADH_CENTRAL_0_15", fromKm: 0, toKm: 15, label: "Central Riyadh (0-15km)" },
    { code: "RIYADH_NEAR_15_30", fromKm: 15, toKm: 30, label: "Near Riyadh (15-30km)" },
    { code: "RIYADH_MID_30_50", fromKm: 30, toKm: 50, label: "Mid-distance Riyadh (30-50km)" },
    { code: "RIYADH_FAR_50_PLUS", fromKm: 50, toKm: null, label: "Far Riyadh / Industrial (50km+)" },
  ];
  for (const b of rbwBands) {
    const existing = await db.query.distanceBands.findFirst({ where: and(eq(distanceBands.tenantId, tenant3Id), eq(distanceBands.code, b.code)) });
    if (!existing) {
      await db.insert(distanceBands).values({ id: genId(), tenantId: tenant3Id, code: b.code, fromKm: b.fromKm, toKm: b.toKm ?? undefined, label: b.label });
    }
  }

  // ---------- Customers (find-or-create by tenantId+name — stable per this demo, though not DB-unique) ----------
  async function findOrCreateCustomer(name: string, fields: Partial<typeof customers.$inferInsert>) {
    const existing = await db.query.customers.findFirst({ where: and(eq(customers.tenantId, tenant3Id), eq(customers.name, name)) });
    if (existing) {
      reused.customers++;
      return existing.id;
    }
    const id = genId();
    await db.insert(customers).values({ id, tenantId: tenant3Id, name, type: "B2B", ...fields } as typeof customers.$inferInsert);
    created.customers++;
    return id;
  }
  const riyadhTowersId = await findOrCreateCustomer("Riyadh Towers Facilities", { address: "King Fahd Rd, North Riyadh", lat: 24.7743, lng: 46.6389 });
  const alNakheelId = await findOrCreateCustomer("Al Nakheel Compound", { address: "Al Nakheel District, East Riyadh", lat: 24.6877, lng: 46.7828 });
  const industrialZoneId = await findOrCreateCustomer("Industrial Zone Operations", { address: "2nd Industrial City, Riyadh", lat: 24.6289, lng: 46.7301 });
  const metroConstructionId = await findOrCreateCustomer("Metro Construction Site", { address: "King Abdullah Financial District, Central Riyadh", lat: 24.7614, lng: 46.6428 });
  const hospitalId = await findOrCreateCustomer("Hospital Facilities Group", {
    address: "Airport Rd, Riyadh", lat: 24.9578, lng: 46.7203, creditLimit: 50000, loginEmail: "portal@hospital-facilities-demo.co", passwordHash,
  });
  const universityId = await findOrCreateCustomer("University Campus Services", {
    address: "Diriyah, West Riyadh", lat: 24.7340, lng: 46.5750, creditLimit: 40000, loginEmail: "portal@university-campus-demo.co", passwordHash,
  });

  // ---------- Customer sites (find-or-create by customerId+label) ----------
  async function findOrCreateLocation(customerId: string, label: string, fields: Partial<typeof customerLocations.$inferInsert>) {
    const existing = await db.query.customerLocations.findFirst({ where: and(eq(customerLocations.customerId, customerId), eq(customerLocations.label, label)) });
    if (existing) return existing.id;
    const id = genId();
    await db.insert(customerLocations).values({ id, customerId, label, ...fields } as typeof customerLocations.$inferInsert);
    return id;
  }
  const riyadhTowersLocId = await findOrCreateLocation(riyadhTowersId, "North Riyadh Tower Site", { address: "King Fahd Rd, North Riyadh", lat: 24.7743, lng: 46.6389, cityCode: "RUH", zoneCode: "NORTH", distanceBandCode: "RIYADH_NEAR_15_30" });
  await findOrCreateLocation(alNakheelId, "Al Nakheel Compound - East Gate", { address: "Al Nakheel District, East Riyadh", lat: 24.6877, lng: 46.7828, cityCode: "RUH", zoneCode: "EAST", distanceBandCode: "RIYADH_MID_30_50" });
  const industrialZoneScopedLocId = await findOrCreateLocation(industrialZoneId, "Industrial Area - Plant 1 (scoped)", { address: "2nd Industrial City, Riyadh", lat: 24.6289, lng: 46.7301, cityCode: "RUH", zoneCode: "INDUSTRIAL", distanceBandCode: "RIYADH_FAR_50_PLUS" });
  await findOrCreateLocation(industrialZoneId, "Industrial Area - Plant 2 (unscoped, demo only)", { address: "2nd Industrial City, Riyadh", lat: 24.6350, lng: 46.7410, cityCode: "RUH", zoneCode: "INDUSTRIAL", distanceBandCode: "RIYADH_FAR_50_PLUS" });
  const metroConstructionLocId = await findOrCreateLocation(metroConstructionId, "KAFD Construction Site", { address: "King Abdullah Financial District, Central Riyadh", lat: 24.7614, lng: 46.6428, cityCode: "RUH", zoneCode: "CENTRAL", distanceBandCode: "RIYADH_CENTRAL_0_15" });
  const hospitalLocId = await findOrCreateLocation(hospitalId, "Hospital Campus - Airport Rd", { address: "Airport Rd, Riyadh", lat: 24.9578, lng: 46.7203, cityCode: "RUH", zoneCode: "AIRPORT", distanceBandCode: "RIYADH_NEAR_15_30" });
  const universityLocId = await findOrCreateLocation(universityId, "University Campus - Diriyah", { address: "Diriyah, West Riyadh", lat: 24.7340, lng: 46.5750, cityCode: "RUH", zoneCode: "WEST", distanceBandCode: "RIYADH_MID_30_50" });

  // ---------- Contracts (find-or-create by contractNumber — now a STABLE,
  // deterministic string per customer+type, not derived from a fresh
  // genId() each run, which is what made the original version's
  // "unique" number change on every call and therefore never
  // re-discoverable) ----------
  const monthStart = new Date(new Date(now).getFullYear(), new Date(now).getMonth(), 1);
  const contractStart = new Date(monthStart);
  contractStart.setMonth(contractStart.getMonth() - 3);

  async function findOrCreateContract(contractNumber: string, fields: Partial<typeof contracts.$inferInsert>) {
    const existing = await db.query.contracts.findFirst({ where: eq(contracts.contractNumber, contractNumber) });
    if (existing) {
      reused.contracts++;
      return { id: existing.id, isNew: false };
    }
    const id = genId();
    await db.insert(contracts).values({ id, tenantId: tenant3Id, contractNumber, status: "ACTIVE", startDate: contractStart, ...fields } as typeof contracts.$inferInsert);
    created.contracts++;
    return { id, isNew: true };
  }

  const hospitalContract = await findOrCreateContract("RBW-HOSPITAL-MONTHLY", { customerId: hospitalId, type: "MONTHLY_ACCUMULATED", appliesToAllSites: true, billingCadence: "MONTHLY" });
  const universityContract = await findOrCreateContract("RBW-UNIVERSITY-MONTHLY", { customerId: universityId, type: "MONTHLY_ACCUMULATED", appliesToAllSites: false, billingCadence: "MONTHLY" });
  const metroContract = await findOrCreateContract("RBW-METRO-ONETIME", { customerId: metroConstructionId, type: "ONE_TIME_TRIP_COUNT", appliesToAllSites: true, totalTripsPurchased: 10, tripsUsed: 8 });
  const industrialContract = await findOrCreateContract("RBW-INDUSTRIAL-ONETIME", { customerId: industrialZoneId, type: "ONE_TIME_TRIP_COUNT", appliesToAllSites: false, totalTripsPurchased: 5, tripsUsed: 5 });

  // ---------- Site scope (relies on the real (contractId, customerLocationId) unique constraint — only attempted for newly-created contracts, since an existing contract already has whatever scope it was given the first time) ----------
  if (universityContract.isNew) {
    await db.insert(contractSiteScope).values({ id: genId(), contractId: universityContract.id, customerLocationId: universityLocId });
  }
  if (industrialContract.isNew) {
    await db.insert(contractSiteScope).values({ id: genId(), contractId: industrialContract.id, customerLocationId: industrialZoneScopedLocId });
  }

  // ---------- Pricing rules (tied to whether their owning contract/tenant
  // context is new — contract_pricing_rules has no natural unique key of
  // its own to check per-row, so rules are only ever (re-)created
  // together with the contract or tenant they were first created for) ----------
  const tenantDefaultRulesExist = await db.query.contractPricingRules.findFirst({ where: and(eq(contractPricingRules.tenantId, tenant3Id), eq(contractPricingRules.pricingScope, "TENANT_DEFAULT")) });
  if (!tenantDefaultRulesExist) {
    await db.insert(contractPricingRules).values([
      { id: genId(), tenantId: tenant3Id, pricingScope: "TENANT_DEFAULT", rateType: "STANDARD", tankerCapacityLtr: 18000, pricePerTrip: 450, vatRate: 0.15 },
      { id: genId(), tenantId: tenant3Id, pricingScope: "TENANT_DEFAULT", rateType: "STANDARD", tankerCapacityLtr: 21000, pricePerTrip: 550, vatRate: 0.15 },
      { id: genId(), tenantId: tenant3Id, pricingScope: "TENANT_DEFAULT", rateType: "STANDARD", tankerCapacityLtr: 28000, pricePerTrip: 700, vatRate: 0.15 },
      // No `priority` here — see the S3/Task F note: setting one would
      // make this wildcard always outrank the capacity-specific rules
      // above, backwards from its intended last-resort role.
      { id: genId(), tenantId: tenant3Id, pricingScope: "TENANT_DEFAULT", rateType: "STANDARD", pricePerTrip: 500, vatRate: 0.15 },
    ]);
    created.pricingRules += 4;
  } else {
    reused.pricingRules += 4;
  }

  async function ensureContractRules(contractResult: { id: string; isNew: boolean }, rules: Partial<typeof contractPricingRules.$inferInsert>[]) {
    if (!contractResult.isNew) {
      reused.pricingRules += rules.length;
      return;
    }
    await db.insert(contractPricingRules).values(
      rules.map((r) => ({ id: genId(), tenantId: tenant3Id, pricingScope: "CONTRACT" as const, contractId: contractResult.id, vatRate: 0.15, ...r })) as (typeof contractPricingRules.$inferInsert)[]
    );
    created.pricingRules += rules.length;
  }
  await ensureContractRules(hospitalContract, [{ rateType: "STANDARD", pricePerTrip: 480 }]);
  await ensureContractRules(universityContract, [{ rateType: "STANDARD", pricePerTrip: 520 }]);
  await ensureContractRules(metroContract, [
    { rateType: "STANDARD", pricePerTrip: 460 },
    { rateType: "OVERAGE", pricePerTrip: 600 },
  ]);
  await ensureContractRules(industrialContract, [
    { rateType: "STANDARD", pricePerTrip: 470 },
    { rateType: "OVERAGE", pricePerTrip: 620 },
  ]);

  // ---------- Orders + trip (only for a genuinely NEW tenant — demo
  // orders aren't the kind of thing that should be recreated/duplicated
  // on a second run; if the tenant already existed, its demo orders
  // already exist too) ----------
  if (created.tenant) {
    const midMonth = new Date(monthStart);
    midMonth.setDate(10);
    const adHocOrderId = genId();
    const hospitalOrderId = genId();
    const metroOrderId = genId();
    const universityOrderId = genId();

    await db.insert(orders).values([
      {
        id: adHocOrderId, tenantId: tenant3Id, orderNumber: genNumber("ORD"), customerId: riyadhTowersId, locationId: riyadhTowersLocId,
        qtyOrdered: 1, emptyBottlesToCollect: 0, deliveryAddress: "King Fahd Rd, North Riyadh", lat: 24.7743, lng: 46.6389,
        requestedTime: new Date(now), status: "PENDING", paymentMethod: "CASH",
      },
      {
        id: hospitalOrderId, tenantId: tenant3Id, orderNumber: genNumber("ORD"), customerId: hospitalId, locationId: hospitalLocId, contractId: hospitalContract.id,
        qtyOrdered: 1, emptyBottlesToCollect: 0, deliveryAddress: "Airport Rd, Riyadh", lat: 24.9578, lng: 46.7203,
        requestedTime: midMonth, status: "DELIVERED", paymentMethod: "ACCOUNT_CREDIT", completedAt: midMonth,
      },
      {
        id: metroOrderId, tenantId: tenant3Id, orderNumber: genNumber("ORD"), customerId: metroConstructionId, locationId: metroConstructionLocId, contractId: metroContract.id,
        qtyOrdered: 1, emptyBottlesToCollect: 0, deliveryAddress: "King Abdullah Financial District, Central Riyadh", lat: 24.7614, lng: 46.6428,
        requestedTime: midMonth, status: "DELIVERED", paymentMethod: "ACCOUNT_CREDIT", completedAt: midMonth,
      },
      {
        id: universityOrderId, tenantId: tenant3Id, orderNumber: genNumber("ORD"), customerId: universityId, locationId: universityLocId, contractId: universityContract.id,
        qtyOrdered: 1, emptyBottlesToCollect: 0, deliveryAddress: "Diriyah, West Riyadh", lat: 24.7340, lng: 46.5750,
        requestedTime: new Date(now), status: "PENDING", paymentMethod: "ACCOUNT_CREDIT",
      },
    ]);

    const rbwTripId = genId();
    await db.insert(trips).values({
      id: rbwTripId, tenantId: tenant3Id, tripNumber: genNumber("TRP"),
      driverId: rbwDriverIds[0], vehicleId: rbwVehicleIds[0], warehouseId: rbwLoadingPointId, status: "PLANNED",
    });
    await db.insert(tripStops).values({ id: genId(), tripId: rbwTripId, orderId: adHocOrderId, sequence: 1, status: "PENDING" });
  }

  return { tenantId: tenant3Id, created, reused };
}
