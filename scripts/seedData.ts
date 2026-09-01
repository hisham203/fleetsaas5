import { db } from "../lib/db/client";
import {
  tenants,
  users,
  vehicles,
  drivers,
  customers,
  subscriptions,
  orders,
  customerLocations,
  warehouses,
  inventoryItems,
  maintenanceRecords,
  fuelLogs,
  tyreRecords,
  platformAdminTenantGrants,
} from "../lib/db/schema";
import { genId, genNumber } from "../lib/helpers";
import { hashPassword } from "../lib/auth";

const DEMO_PASSWORD = "password123";

export async function seedDemoData() {
  console.log("Seeding demo data...");
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  // ---------- Primary demo tenant: Demo Water Co. ----------
  const tenantId = genId();
  await db.insert(tenants).values({ id: tenantId, name: "Demo Water Co.", sector: "WATER_DELIVERY" });

  // Users
  const adminUserId = genId();
  const dispatcherUserId = genId();
  const driverUser1Id = genId();
  const driverUser2Id = genId();

  await db.insert(users).values([
    { id: adminUserId, tenantId, name: "Sara Admin", email: "admin@demo-water.co", passwordHash, role: "ADMIN" },
    { id: dispatcherUserId, tenantId, name: "Omar Dispatcher", email: "dispatch@demo-water.co", passwordHash, role: "DISPATCHER" },
    { id: driverUser1Id, tenantId, name: "Khalid Driver", email: "khalid@demo-water.co", passwordHash, role: "DRIVER" },
    { id: driverUser2Id, tenantId, name: "Fahad Driver", email: "fahad@demo-water.co", passwordHash, role: "DRIVER" },
  ]);

  // BR-09: two warehouses (depots) for this tenant — demonstrates
  // per-warehouse inventory and lets trip creation pick which one to load
  // from.
  const mainWarehouseId = genId();
  const northWarehouseId = genId();
  await db.insert(warehouses).values([
    { id: mainWarehouseId, tenantId, name: "Main Warehouse - Riyadh Central", address: "King Fahd Rd, Riyadh", lat: 24.7136, lng: 46.6753, isDefault: true },
    { id: northWarehouseId, tenantId, name: "North Depot - Al Yasmin", address: "Al Yasmin District, Riyadh", lat: 24.8125, lng: 46.6285, isDefault: false },
  ]);

  await db.insert(inventoryItems).values([
    { id: genId(), tenantId, warehouseId: mainWarehouseId, itemName: "19L Bottle - Full", quantity: 350, unit: "bottle" },
    { id: genId(), tenantId, warehouseId: mainWarehouseId, itemName: "19L Bottle - Empty", quantity: 25, unit: "bottle" },
    { id: genId(), tenantId, warehouseId: northWarehouseId, itemName: "19L Bottle - Full", quantity: 150, unit: "bottle" },
    { id: genId(), tenantId, warehouseId: northWarehouseId, itemName: "19L Bottle - Empty", quantity: 15, unit: "bottle" },
  ]);

  // Vehicles
  const van1Id = genId();
  const van2Id = genId();
  await db.insert(vehicles).values([
    { id: van1Id, tenantId, plateNumber: "RUH-1024", vehicleType: "Refill Van", capacityUnits: 120, status: "AVAILABLE" },
    { id: van2Id, tenantId, plateNumber: "RUH-2077", vehicleType: "Refill Van", capacityUnits: 90, status: "AVAILABLE" },
  ]);

  // Drivers
  await db.insert(drivers).values([
    { id: genId(), tenantId, userId: driverUser1Id, licenseNumber: "SA-DRV-55210", phone: "0501234567", status: "AVAILABLE" },
    { id: genId(), tenantId, userId: driverUser2Id, licenseNumber: "SA-DRV-77813", phone: "0559876543", status: "AVAILABLE" },
  ]);

  // Customers
  const customerDefs = [
    { name: "Al Nakheel Villas", type: "B2C" as const, address: "Al Nakheel District, Riyadh", lat: 24.7255, lng: 46.6851 },
    { name: "Al Malaz Family", type: "B2C" as const, address: "Al Malaz, Riyadh", lat: 24.6631, lng: 46.7419 },
    { name: "Jarir Bookstore HQ", type: "B2B" as const, address: "Olaya St, Riyadh", lat: 24.6944, lng: 46.6852, creditLimit: 5000, loginEmail: "portal@jarir-demo.co" },
    { name: "Al Rajhi Office Tower", type: "B2B" as const, address: "King Fahd Rd, Riyadh", lat: 24.7136, lng: 46.6753, creditLimit: 8000, loginEmail: "portal@alrajhi-demo.co" },
    { name: "Al Yasmin Residence", type: "B2C" as const, address: "Al Yasmin District, Riyadh", lat: 24.8125, lng: 46.6285 },
  ];

  const customerIds: string[] = [];
  for (const c of customerDefs) {
    const id = genId();
    customerIds.push(id);
    await db.insert(customers).values({
      id,
      tenantId,
      ...c,
      passwordHash: "loginEmail" in c ? passwordHash : undefined,
    });
  }

  // Subscriptions for two residential customers
  await db.insert(subscriptions).values([
    {
      id: genId(),
      customerId: customerIds[0],
      bottleSizeLtr: 19,
      qtyPerDelivery: 2,
      frequencyDays: 7,
      pricePerBottle: 8,
      nextDueDate: new Date(),
    },
    {
      id: genId(),
      customerId: customerIds[1],
      bottleSizeLtr: 19,
      qtyPerDelivery: 1,
      frequencyDays: 14,
      pricePerBottle: 8,
      nextDueDate: new Date(),
    },
  ]);

  // APP-06: B2B customers get multiple delivery locations (branches/sites)
  const jarirId = customerIds[2]; // Jarir Bookstore HQ
  const rajhiId = customerIds[3]; // Al Rajhi Office Tower

  await db.insert(customerLocations).values([
    {
      id: genId(),
      customerId: jarirId,
      label: "Olaya Branch (HQ)",
      address: "Olaya St, Riyadh",
      lat: 24.6944,
      lng: 46.6852,
      contactName: "Abdullah Al-Faisal",
      contactPhone: "0112345678",
    },
    {
      id: genId(),
      customerId: jarirId,
      label: "Al Nakheel Branch",
      address: "Al Nakheel District, Riyadh",
      lat: 24.7255,
      lng: 46.6851,
      contactName: "Nora Al-Sabti",
      contactPhone: "0112345679",
    },
    {
      id: genId(),
      customerId: jarirId,
      label: "Warehouse - Sulay",
      address: "Sulay Industrial Area, Riyadh",
      lat: 24.6408,
      lng: 46.7728,
      contactName: "Fahad Al-Otaibi",
      contactPhone: "0112345680",
    },
    {
      id: genId(),
      customerId: rajhiId,
      label: "King Fahd Rd Tower",
      address: "King Fahd Rd, Riyadh",
      lat: 24.7136,
      lng: 46.6753,
      contactName: "Mohammed Al-Rasheed",
      contactPhone: "0114567890",
    },
    {
      id: genId(),
      customerId: rajhiId,
      label: "Al Malaz Office",
      address: "Al Malaz, Riyadh",
      lat: 24.6631,
      lng: 46.7419,
      contactName: "Sultan Al-Dosari",
      contactPhone: "0114567891",
    },
  ]);

  // Orders — mix reflecting BR-05 lifecycle starting point (all PENDING).
  // A couple are backdated relative to their SLA window so the SLA Monitor
  // (BR-20) has something to show on first load instead of an empty state.
  const now = Date.now();
  const orderDefs = [
    { idx: 0, qty: 2, empties: 2, type: "SUBSCRIPTION" as const, payment: "CASH" as const, slaMinutes: 180, createdAt: new Date(now) },
    { idx: 1, qty: 1, empties: 1, type: "SUBSCRIPTION" as const, payment: "CASH" as const, slaMinutes: 180, createdAt: new Date(now) },
    { idx: 2, qty: 10, empties: 8, type: "ONE_TIME" as const, payment: "ACCOUNT_CREDIT" as const, slaMinutes: 180, createdAt: new Date(now - 160 * 60_000) }, // AT_RISK: 160/180 min elapsed
    { idx: 3, qty: 15, empties: 15, type: "ONE_TIME" as const, payment: "ACCOUNT_CREDIT" as const, slaMinutes: 120, createdAt: new Date(now - 150 * 60_000) }, // BREACHED: past due
    { idx: 4, qty: 3, empties: 0, type: "ONE_TIME" as const, payment: "CASH" as const, slaMinutes: 180, createdAt: new Date(now) },
  ];

  for (const o of orderDefs) {
    const c = customerDefs[o.idx];
    await db.insert(orders).values({
      id: genId(),
      tenantId,
      orderNumber: genNumber("ORD"),
      customerId: customerIds[o.idx],
      type: o.type,
      bottleSizeLtr: 19,
      qtyOrdered: o.qty,
      emptyBottlesToCollect: o.empties,
      deliveryAddress: c.address,
      lat: c.lat,
      lng: c.lng,
      requestedTime: o.createdAt,
      slaMinutes: o.slaMinutes,
      status: "PENDING",
      paymentMethod: o.payment,
      pricePerBottle: 8,
      createdAt: o.createdAt,
    });
  }

  // BR-13/14/15: seed one vehicle with maintenance/fuel/tyre history so the
  // Admin console's Maintenance tab isn't empty on first load.
  await db.insert(fuelLogs).values({
    id: genId(),
    tenantId,
    vehicleId: van1Id,
    litersFilled: 45,
    costSar: 202.5,
    odometerReading: 18500,
  });
  await db.insert(tyreRecords).values([
    { id: genId(), tenantId, vehicleId: van1Id, position: "Front-Left", serialNumber: "TYR-8821", costSar: 480, installOdometer: 12000 },
    { id: genId(), tenantId, vehicleId: van1Id, position: "Front-Right", serialNumber: "TYR-8822", costSar: 480, installOdometer: 12000 },
  ]);
  await db.insert(maintenanceRecords).values({
    id: genId(),
    tenantId,
    vehicleId: van2Id,
    type: "PREVENTIVE",
    description: "10,000km scheduled service — oil, filters, brake check",
    odometerReading: 10000,
    cost: 350,
    status: "COMPLETED",
    completedAt: new Date(now - 20 * 24 * 60 * 60_000),
  });

  // ---------- Second tenant: a different company, fully isolated ----------
  // Exists purely so multi-tenant isolation is demonstrable out of the box —
  // log in as its admin and confirm you see none of "Demo Water Co."'s data.
  const tenant2Id = genId();
  await db.insert(tenants).values({ id: tenant2Id, name: "Acme Fuel Delivery Co.", sector: "FUEL_DELIVERY" });

  const acmeAdminId = genId();
  await db.insert(users).values({
    id: acmeAdminId,
    tenantId: tenant2Id,
    name: "Layla Al-Harbi",
    email: "admin@acme-fuel-demo.co",
    passwordHash,
    role: "ADMIN",
  });

  const acmeWarehouseId = genId();
  await db.insert(warehouses).values({
    id: acmeWarehouseId,
    tenantId: tenant2Id,
    name: "Jeddah Depot",
    address: "Tahlia St, Jeddah",
    lat: 21.5433,
    lng: 39.1728,
    isDefault: true,
  });
  await db.insert(inventoryItems).values([
    { id: genId(), tenantId: tenant2Id, warehouseId: acmeWarehouseId, itemName: "Diesel Tank - Full", quantity: 40, unit: "tank" },
    { id: genId(), tenantId: tenant2Id, warehouseId: acmeWarehouseId, itemName: "Diesel Tank - Empty", quantity: 5, unit: "tank" },
  ]);
  await db.insert(vehicles).values({
    id: genId(),
    tenantId: tenant2Id,
    plateNumber: "JED-4471",
    vehicleType: "Fuel Tanker",
    capacityUnits: 20,
    status: "AVAILABLE",
  });
  await db.insert(customers).values({
    id: genId(),
    tenantId: tenant2Id,
    name: "Red Sea Mall Petrol Station",
    type: "B2B",
    address: "Corniche Rd, Jeddah",
    lat: 21.5539,
    lng: 39.1502,
    creditLimit: 15000,
  });

  // ---------- Company Switcher: a real platform-level admin ----------
  // Home tenant is Demo Water Co., with an explicit grant to also access
  // Acme Fuel Delivery Co. — deliberately real seeded data (a real user
  // row + a real grant row), not something the UI or tests fabricate at
  // runtime, so the switcher is genuinely exercisable end to end.
  const platformAdminId = genId();
  await db.insert(users).values({
    id: platformAdminId,
    tenantId,
    name: "Yousef Platform Admin",
    email: "platform-admin@fleetops-demo.co",
    passwordHash,
    role: "ADMIN",
    isPlatformAdmin: true,
  });
  await db.insert(platformAdminTenantGrants).values({
    id: genId(),
    userId: platformAdminId,
    tenantId: tenant2Id,
  });

  return {
    tenant1Id: tenantId,
    tenant2Id,
    password: DEMO_PASSWORD,
  };
}
