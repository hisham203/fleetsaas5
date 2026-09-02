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
  trips,
  tripStops,
  epods,
  invoices,
  exceptions,
} from "../lib/db/schema";
import { genId, genNumber, calcInvoiceTotals } from "../lib/helpers";
import { hashPassword } from "../lib/auth";

const DEMO_PASSWORD = "password123";

// One historical delivery attempt — an order, its trip, its single stop,
// and (if delivered) an epod + invoice, or (if failed) an exception row —
// built with the exact same math and status shapes the real API produces
// (see app/api/trips/[id]/stops/[stopId]/route.ts), so the Executive
// Dashboard, scorecards, and SLA monitor all compute real, internally
// consistent numbers from this data rather than needing special-casing.
type HistoricalOutcome = "ON_TIME" | "LATE" | "FAILED";

async function seedHistoricalDelivery(params: {
  tenantId: string;
  driverId: string;
  vehicleId: string;
  warehouseId: string;
  customerId: string;
  address: string;
  lat: number;
  lng: number;
  qty: number;
  pricePerBottle: number;
  bottleSizeLtr: number;
  paymentMethod: "CASH" | "ACCOUNT_CREDIT" | "CARD";
  slaMinutes: number;
  createdAt: Date;
  outcome: HistoricalOutcome;
}) {
  const orderId = genId();
  const tripId = genId();
  const stopId = genId();

  const isDelivered = params.outcome !== "FAILED";
  // On-time deliveries land comfortably inside the SLA window; late ones
  // land just past it — both are realistic operational timings, not
  // instantaneous or wildly delayed.
  const deliveryOffsetMinutes =
    params.outcome === "LATE" ? Math.round(params.slaMinutes * 1.1) : Math.round(params.slaMinutes * 0.45);
  const completedAt = new Date(params.createdAt.getTime() + deliveryOffsetMinutes * 60_000);
  const startedAt = new Date(params.createdAt.getTime() + 5 * 60_000);
  const arrivedAt = new Date(completedAt.getTime() - 4 * 60_000);

  await db.insert(orders).values({
    id: orderId,
    tenantId: params.tenantId,
    orderNumber: genNumber("ORD"),
    customerId: params.customerId,
    type: "ONE_TIME",
    bottleSizeLtr: params.bottleSizeLtr,
    qtyOrdered: params.qty,
    emptyBottlesToCollect: isDelivered ? Math.max(0, params.qty - 1) : 0,
    deliveryAddress: params.address,
    lat: params.lat,
    lng: params.lng,
    requestedTime: params.createdAt,
    slaMinutes: params.slaMinutes,
    status: isDelivered ? "DELIVERED" : "FAILED",
    paymentMethod: params.paymentMethod,
    pricePerBottle: params.pricePerBottle,
    failureReason: isDelivered ? undefined : "Customer unavailable at delivery address",
    completedAt,
    createdAt: params.createdAt,
  });

  await db.insert(trips).values({
    id: tripId,
    tenantId: params.tenantId,
    tripNumber: genNumber("TRIP"),
    driverId: params.driverId,
    vehicleId: params.vehicleId,
    warehouseId: params.warehouseId,
    status: "COMPLETED",
    loadingConfirmed: true,
    loadingConfirmedAt: params.createdAt,
    startedAt,
    completedAt,
    createdAt: params.createdAt,
  });

  await db.insert(tripStops).values({
    id: stopId,
    tripId,
    orderId,
    sequence: 1,
    status: isDelivered ? "DELIVERED" : "FAILED",
    arrivedAt,
    completedAt,
  });

  if (isDelivered) {
    await db.insert(epods).values({
      id: genId(),
      tripStopId: stopId,
      deliveredQty: params.qty,
      emptiesCollected: Math.max(0, params.qty - 1),
      recipientName: "Reception",
      deliveredAt: completedAt,
    });

    const subtotal = Math.round(params.qty * params.pricePerBottle * 100) / 100;
    const { vatAmount, total } = calcInvoiceTotals(subtotal);
    await db.insert(invoices).values({
      id: genId(),
      tenantId: params.tenantId,
      invoiceNumber: genNumber("INV"),
      orderId,
      customerId: params.customerId,
      subtotal,
      vatAmount,
      total,
      status: params.paymentMethod === "ACCOUNT_CREDIT" ? "PENDING" : "PAID",
      createdAt: completedAt,
    });
  } else {
    await db.insert(exceptions).values({
      id: genId(),
      tenantId: params.tenantId,
      orderId,
      tripStopId: stopId,
      type: "FAILED",
      reason: "Customer unavailable at delivery address",
      status: "OPEN",
    });
  }
}

// Deterministic outcome pattern rather than Math.random(): about 1 in 12
// deliveries fails, about 1 in 8 of the rest arrives just past its SLA
// window, and the remainder are comfortably on time — a realistic spread
// (~8% failed, ~11% late, ~81% on-time) that's the same every time this
// script runs, so a reset staging environment always looks the same.
function outcomeForIndex(i: number): HistoricalOutcome {
  if (i % 12 === 11) return "FAILED";
  if (i % 8 === 5) return "LATE";
  return "ON_TIME";
}

export async function seedDemoData() {
  console.log("Seeding demo data...");
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const now = Date.now();
  const HISTORY_DAYS = 35;
  const historyStart = now - HISTORY_DAYS * 24 * 60 * 60_000;

  // ==========================================================
  // Tenant 1: Demo Water Co. — Riyadh water bottle delivery (B2C + B2B)
  // ==========================================================
  const tenantId = genId();
  await db.insert(tenants).values({ id: tenantId, name: "Demo Water Co.", sector: "WATER_DELIVERY" });

  // Users: 1 admin, 1 dispatcher, 5 drivers
  const adminUserId = genId();
  const dispatcherUserId = genId();
  const driverUserIds = [genId(), genId(), genId(), genId(), genId()];
  const driverNames = ["Khalid Driver", "Fahad Driver", "Nasser Driver", "Turki Driver", "Bandar Driver"];
  const driverEmails = [
    "khalid@demo-water.co",
    "fahad@demo-water.co",
    "nasser@demo-water.co",
    "turki@demo-water.co",
    "bandar@demo-water.co",
  ];

  await db.insert(users).values([
    { id: adminUserId, tenantId, name: "Sara Admin", email: "admin@demo-water.co", passwordHash, role: "ADMIN" },
    { id: dispatcherUserId, tenantId, name: "Omar Dispatcher", email: "dispatch@demo-water.co", passwordHash, role: "DISPATCHER" },
    ...driverUserIds.map((id, i) => ({ id, tenantId, name: driverNames[i], email: driverEmails[i], passwordHash, role: "DRIVER" as const })),
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
    { id: genId(), tenantId, warehouseId: mainWarehouseId, itemName: "19L Bottle - Full", quantity: 620, unit: "bottle" },
    { id: genId(), tenantId, warehouseId: mainWarehouseId, itemName: "19L Bottle - Empty", quantity: 40, unit: "bottle" },
    { id: genId(), tenantId, warehouseId: northWarehouseId, itemName: "19L Bottle - Full", quantity: 280, unit: "bottle" },
    { id: genId(), tenantId, warehouseId: northWarehouseId, itemName: "19L Bottle - Empty", quantity: 22, unit: "bottle" },
  ]);

  // Vehicles: 5 refill vans of varying capacity
  const vehicleIds = [genId(), genId(), genId(), genId(), genId()];
  const platesAndCapacity: [string, number][] = [
    ["RUH-1024", 120],
    ["RUH-2077", 90],
    ["RUH-3391", 100],
    ["RUH-4456", 130],
    ["RUH-5210", 80],
  ];
  await db.insert(vehicles).values(
    vehicleIds.map((id, i) => ({
      id,
      tenantId,
      plateNumber: platesAndCapacity[i][0],
      vehicleType: "Refill Van",
      capacityUnits: platesAndCapacity[i][1],
      status: "AVAILABLE" as const,
    }))
  );
  const [van1Id, van2Id, van3Id, van4Id, van5Id] = vehicleIds;

  // Drivers (driver rows, distinct from the user rows above)
  const licenseNumbers = ["SA-DRV-55210", "SA-DRV-77813", "SA-DRV-91042", "SA-DRV-33217", "SA-DRV-68824"];
  const phones = ["0501234567", "0559876543", "0533019284", "0567712398", "0541098765"];
  const driverRowIds = [genId(), genId(), genId(), genId(), genId()];
  await db.insert(drivers).values(
    driverRowIds.map((id, i) => ({
      id,
      tenantId,
      userId: driverUserIds[i],
      licenseNumber: licenseNumbers[i],
      phone: phones[i],
      status: "AVAILABLE" as const,
    }))
  );

  // Customers: original 5 (kept exactly as-is — referenced by name in
  // several tests) plus 3 new ones for more realistic variety and volume.
  const customerDefs = [
    { name: "Al Nakheel Villas", type: "B2C" as const, address: "Al Nakheel District, Riyadh", lat: 24.7255, lng: 46.6851 },
    { name: "Al Malaz Family", type: "B2C" as const, address: "Al Malaz, Riyadh", lat: 24.6631, lng: 46.7419 },
    { name: "Jarir Bookstore HQ", type: "B2B" as const, address: "Olaya St, Riyadh", lat: 24.6944, lng: 46.6852, creditLimit: 5000, loginEmail: "portal@jarir-demo.co" },
    { name: "Al Rajhi Office Tower", type: "B2B" as const, address: "King Fahd Rd, Riyadh", lat: 24.7136, lng: 46.6753, creditLimit: 8000, loginEmail: "portal@alrajhi-demo.co" },
    { name: "Al Yasmin Residence", type: "B2C" as const, address: "Al Yasmin District, Riyadh", lat: 24.8125, lng: 46.6285 },
    { name: "Al Olaya Grocers", type: "B2B" as const, address: "Al Olaya District, Riyadh", lat: 24.6989, lng: 46.6844, creditLimit: 3000 },
    { name: "Al Malqa Compound", type: "B2C" as const, address: "Al Malqa District, Riyadh", lat: 24.7896, lng: 46.6142 },
    { name: "Diplomatic Quarter Residence", type: "B2C" as const, address: "Diplomatic Quarter, Riyadh", lat: 24.6877, lng: 46.6212 },
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
    { id: genId(), customerId: jarirId, label: "Olaya Branch (HQ)", address: "Olaya St, Riyadh", lat: 24.6944, lng: 46.6852, contactName: "Abdullah Al-Faisal", contactPhone: "0112345678" },
    { id: genId(), customerId: jarirId, label: "Al Nakheel Branch", address: "Al Nakheel District, Riyadh", lat: 24.7255, lng: 46.6851, contactName: "Nora Al-Sabti", contactPhone: "0112345679" },
    { id: genId(), customerId: jarirId, label: "Warehouse - Sulay", address: "Sulay Industrial Area, Riyadh", lat: 24.6408, lng: 46.7728, contactName: "Fahad Al-Otaibi", contactPhone: "0112345680" },
    { id: genId(), customerId: rajhiId, label: "King Fahd Rd Tower", address: "King Fahd Rd, Riyadh", lat: 24.7136, lng: 46.6753, contactName: "Mohammed Al-Rasheed", contactPhone: "0114567890" },
    { id: genId(), customerId: rajhiId, label: "Al Malaz Office", address: "Al Malaz, Riyadh", lat: 24.6631, lng: 46.7419, contactName: "Sultan Al-Dosari", contactPhone: "0114567891" },
  ]);

  // Live, still-open orders — a couple are backdated relative to their SLA
  // window so the SLA Monitor (BR-20) has something to show on first load
  // instead of an empty state, alongside the historical closed volume below.
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

  // Historical closed deliveries — this is what gives the Executive
  // Dashboard, driver/vehicle scorecards, and SLA compliance rate real,
  // non-zero substance instead of the all-zeros a brand-new database would
  // otherwise show. Spread over the last 35 days, cycling through all 5
  // vehicles/drivers and all 8 customers for realistic coverage; B2B
  // customers order in bulk (8-15 bottles), B2C in small quantities (1-4).
  const TENANT1_TRIP_COUNT = 56;
  for (let i = 0; i < TENANT1_TRIP_COUNT; i++) {
    const dayOffset = Math.floor((i / TENANT1_TRIP_COUNT) * HISTORY_DAYS);
    const hourOfDay = 8 + (i % 9); // business hours, 8am-4pm
    const createdAt = new Date(historyStart + dayOffset * 24 * 60 * 60_000 + hourOfDay * 60 * 60_000);

    const customerIdx = i % customerDefs.length;
    const cust = customerDefs[customerIdx];
    const qty = cust.type === "B2B" ? 8 + (i % 8) : 1 + (i % 4);

    await seedHistoricalDelivery({
      tenantId,
      driverId: driverRowIds[i % driverRowIds.length],
      vehicleId: vehicleIds[i % vehicleIds.length],
      warehouseId: i % 3 === 0 ? northWarehouseId : mainWarehouseId,
      customerId: customerIds[customerIdx],
      address: cust.address,
      lat: cust.lat,
      lng: cust.lng,
      qty,
      pricePerBottle: 8,
      bottleSizeLtr: 19,
      paymentMethod: cust.type === "B2B" ? "ACCOUNT_CREDIT" : "CASH",
      slaMinutes: 180,
      createdAt,
      outcome: outcomeForIndex(i),
    });
  }

  // BR-13/14/15: fuel/maintenance/tyre history spread across all 5
  // vehicles over the same historical window, so Maintenance/Fuel tabs and
  // the Executive Dashboard's cost KPIs reflect a real fleet's spread of
  // costs rather than one or two token records.
  const fuelFillsTenant1: { vehicleId: string; dayOffset: number; liters: number; costSar: number; odometer: number }[] = [
    { vehicleId: van1Id, dayOffset: 2, liters: 42, costSar: 189.0, odometer: 18200 },
    { vehicleId: van1Id, dayOffset: 16, liters: 45, costSar: 202.5, odometer: 19400 },
    { vehicleId: van1Id, dayOffset: 30, liters: 40, costSar: 180.0, odometer: 20550 },
    { vehicleId: van2Id, dayOffset: 5, liters: 38, costSar: 171.0, odometer: 15100 },
    { vehicleId: van2Id, dayOffset: 20, liters: 41, costSar: 184.5, odometer: 16250 },
    { vehicleId: van3Id, dayOffset: 8, liters: 44, costSar: 198.0, odometer: 9800 },
    { vehicleId: van3Id, dayOffset: 24, liters: 43, costSar: 193.5, odometer: 10900 },
    { vehicleId: van4Id, dayOffset: 11, liters: 47, costSar: 211.5, odometer: 22300 },
    { vehicleId: van4Id, dayOffset: 28, liters: 46, costSar: 207.0, odometer: 23500 },
    { vehicleId: van5Id, dayOffset: 14, liters: 36, costSar: 162.0, odometer: 6700 },
    { vehicleId: van5Id, dayOffset: 32, liters: 37, costSar: 166.5, odometer: 7850 },
  ];
  await db.insert(fuelLogs).values(
    fuelFillsTenant1.map((f) => ({
      id: genId(),
      tenantId,
      vehicleId: f.vehicleId,
      litersFilled: f.liters,
      costSar: f.costSar,
      odometerReading: f.odometer,
      filledAt: new Date(historyStart + f.dayOffset * 24 * 60 * 60_000),
    }))
  );

  await db.insert(tyreRecords).values([
    { id: genId(), tenantId, vehicleId: van1Id, position: "Front-Left", serialNumber: "TYR-8821", costSar: 480, installOdometer: 12000 },
    { id: genId(), tenantId, vehicleId: van1Id, position: "Front-Right", serialNumber: "TYR-8822", costSar: 480, installOdometer: 12000 },
    { id: genId(), tenantId, vehicleId: van3Id, position: "Rear-Left", serialNumber: "TYR-9014", costSar: 460, installOdometer: 8000 },
  ]);

  const maintenanceTenant1: { vehicleId: string; dayOffset: number; type: "PREVENTIVE" | "CORRECTIVE"; description: string; cost: number; odometer: number }[] = [
    { vehicleId: van2Id, dayOffset: 15, type: "PREVENTIVE", description: "10,000km scheduled service — oil, filters, brake check", cost: 350, odometer: 10000 },
    { vehicleId: van4Id, dayOffset: 22, type: "CORRECTIVE", description: "AC compressor repair", cost: 620, odometer: 21800 },
    { vehicleId: van5Id, dayOffset: 9, type: "PREVENTIVE", description: "5,000km scheduled service — oil and filter change", cost: 240, odometer: 6000 },
  ];
  await db.insert(maintenanceRecords).values(
    maintenanceTenant1.map((m) => ({
      id: genId(),
      tenantId,
      vehicleId: m.vehicleId,
      type: m.type,
      description: m.description,
      odometerReading: m.odometer,
      cost: m.cost,
      status: "COMPLETED" as const,
      openedAt: new Date(historyStart + (m.dayOffset - 1) * 24 * 60 * 60_000),
      completedAt: new Date(historyStart + m.dayOffset * 24 * 60 * 60_000),
    }))
  );

  // ==========================================================
  // Tenant 2: Acme Fuel Delivery Co. — Jeddah/Dammam wholesale fuel
  // delivery (B2B only), fully isolated. Deliberately a different sector,
  // different scale, and different transaction size than Tenant 1, so the
  // Company Switcher visibly shows a different business, not just a
  // smaller copy of the same one.
  // ==========================================================
  const tenant2Id = genId();
  await db.insert(tenants).values({ id: tenant2Id, name: "Acme Fuel Delivery Co.", sector: "FUEL_DELIVERY" });

  const acmeAdminId = genId();
  const acmeDispatcherId = genId();
  const acmeDriverUserIds = [genId(), genId(), genId()];
  const acmeDriverNames = ["Saeed Driver", "Majed Driver", "Faris Driver"];
  const acmeDriverEmails = ["saeed@acme-fuel-demo.co", "majed@acme-fuel-demo.co", "faris@acme-fuel-demo.co"];

  await db.insert(users).values([
    { id: acmeAdminId, tenantId: tenant2Id, name: "Layla Al-Harbi", email: "admin@acme-fuel-demo.co", passwordHash, role: "ADMIN" },
    { id: acmeDispatcherId, tenantId: tenant2Id, name: "Huda Dispatcher", email: "dispatch@acme-fuel-demo.co", passwordHash, role: "DISPATCHER" },
    ...acmeDriverUserIds.map((id, i) => ({ id, tenantId: tenant2Id, name: acmeDriverNames[i], email: acmeDriverEmails[i], passwordHash, role: "DRIVER" as const })),
  ]);

  const acmeWarehouseId = genId();
  const acmeDammamWarehouseId = genId();
  await db.insert(warehouses).values([
    {
      id: acmeWarehouseId,
      tenantId: tenant2Id,
      name: "Jeddah Depot",
      address: "Tahlia St, Jeddah",
      lat: 21.5433,
      lng: 39.1728,
      isDefault: true,
    },
    {
      id: acmeDammamWarehouseId,
      tenantId: tenant2Id,
      name: "Dammam Depot",
      address: "King Fahd Corniche, Dammam",
      lat: 26.4207,
      lng: 50.0888,
      isDefault: false,
    },
  ]);
  await db.insert(inventoryItems).values([
    { id: genId(), tenantId: tenant2Id, warehouseId: acmeWarehouseId, itemName: "Diesel Tank - Full", quantity: 55, unit: "tank" },
    { id: genId(), tenantId: tenant2Id, warehouseId: acmeWarehouseId, itemName: "Diesel Tank - Empty", quantity: 8, unit: "tank" },
    { id: genId(), tenantId: tenant2Id, warehouseId: acmeDammamWarehouseId, itemName: "Diesel Tank - Full", quantity: 20, unit: "tank" },
    { id: genId(), tenantId: tenant2Id, warehouseId: acmeDammamWarehouseId, itemName: "Diesel Tank - Empty", quantity: 3, unit: "tank" },
  ]);

  const acmeVehicleIds = [genId(), genId(), genId()];
  const acmePlates: [string, number][] = [
    ["JED-4471", 20],
    ["JED-5588", 18],
    ["DMM-2201", 22],
  ];
  await db.insert(vehicles).values(
    acmeVehicleIds.map((id, i) => ({
      id,
      tenantId: tenant2Id,
      plateNumber: acmePlates[i][0],
      vehicleType: "Fuel Tanker",
      capacityUnits: acmePlates[i][1],
      status: "AVAILABLE" as const,
    }))
  );
  const [tanker1Id, tanker2Id, tanker3Id] = acmeVehicleIds;

  const acmeLicenseNumbers = ["SA-DRV-40218", "SA-DRV-51309", "SA-DRV-62410"];
  const acmePhones = ["0561122334", "0577788990", "0589900112"];
  const acmeDriverRowIds = [genId(), genId(), genId()];
  await db.insert(drivers).values(
    acmeDriverRowIds.map((id, i) => ({
      id,
      tenantId: tenant2Id,
      userId: acmeDriverUserIds[i],
      licenseNumber: acmeLicenseNumbers[i],
      phone: acmePhones[i],
      status: "AVAILABLE" as const,
    }))
  );

  // Customers — B2B fuel wholesale accounts across Jeddah and Dammam.
  const acmeCustomerDefs = [
    { name: "Red Sea Mall Petrol Station", type: "B2B" as const, address: "Corniche Rd, Jeddah", lat: 21.5539, lng: 39.1502, creditLimit: 15000 },
    { name: "Corniche Fuel Station - Dammam", type: "B2B" as const, address: "King Fahd Corniche, Dammam", lat: 26.4344, lng: 50.1033, creditLimit: 20000 },
    { name: "Tahlia Auto Services", type: "B2B" as const, address: "Tahlia St, Jeddah", lat: 21.5654, lng: 39.1731, creditLimit: 10000 },
  ];
  const acmeCustomerIds: string[] = [];
  for (const c of acmeCustomerDefs) {
    const id = genId();
    acmeCustomerIds.push(id);
    await db.insert(customers).values({ id, tenantId: tenant2Id, ...c });
  }

  // A couple of live pending orders too, so Acme's Dispatcher console
  // isn't purely historical.
  await db.insert(orders).values([
    {
      id: genId(),
      tenantId: tenant2Id,
      orderNumber: genNumber("ORD"),
      customerId: acmeCustomerIds[0],
      type: "ONE_TIME",
      bottleSizeLtr: 19,
      qtyOrdered: 3,
      emptyBottlesToCollect: 0,
      deliveryAddress: acmeCustomerDefs[0].address,
      lat: acmeCustomerDefs[0].lat,
      lng: acmeCustomerDefs[0].lng,
      requestedTime: new Date(now),
      slaMinutes: 240,
      status: "PENDING",
      paymentMethod: "ACCOUNT_CREDIT",
      pricePerBottle: 185,
      createdAt: new Date(now),
    },
    {
      id: genId(),
      tenantId: tenant2Id,
      orderNumber: genNumber("ORD"),
      customerId: acmeCustomerIds[2],
      type: "ONE_TIME",
      bottleSizeLtr: 19,
      qtyOrdered: 2,
      emptyBottlesToCollect: 0,
      deliveryAddress: acmeCustomerDefs[2].address,
      lat: acmeCustomerDefs[2].lat,
      lng: acmeCustomerDefs[2].lng,
      requestedTime: new Date(now - 200 * 60_000),
      slaMinutes: 240,
      status: "PENDING",
      paymentMethod: "ACCOUNT_CREDIT",
      pricePerBottle: 185,
      createdAt: new Date(now - 200 * 60_000),
    },
  ]);

  // Historical closed deliveries for Acme — fewer than Tenant 1 (a smaller
  // company) and priced as bulk wholesale fuel transactions (larger unit
  // price, smaller unit counts) rather than retail water bottles, so the
  // Company Switcher shows a visibly different business, not a smaller
  // copy of the same one.
  const TENANT2_TRIP_COUNT = 30;
  for (let i = 0; i < TENANT2_TRIP_COUNT; i++) {
    const dayOffset = Math.floor((i / TENANT2_TRIP_COUNT) * HISTORY_DAYS);
    const hourOfDay = 7 + (i % 8);
    const createdAt = new Date(historyStart + dayOffset * 24 * 60 * 60_000 + hourOfDay * 60 * 60_000);

    const customerIdx = i % acmeCustomerDefs.length;
    const cust = acmeCustomerDefs[customerIdx];
    // "Corniche Fuel Station - Dammam" (index 1) is served from the Dammam
    // depot, not hauled ~860km from Jeddah — matters for a believable
    // estimated distance/cost-per-km, not just plate-number realism.
    const originWarehouseId = customerIdx === 1 ? acmeDammamWarehouseId : acmeWarehouseId;

    await seedHistoricalDelivery({
      tenantId: tenant2Id,
      driverId: acmeDriverRowIds[i % acmeDriverRowIds.length],
      vehicleId: acmeVehicleIds[i % acmeVehicleIds.length],
      warehouseId: originWarehouseId,
      customerId: acmeCustomerIds[customerIdx],
      address: cust.address,
      lat: cust.lat,
      lng: cust.lng,
      qty: 2 + (i % 4), // 2-5 tanker units per delivery
      pricePerBottle: 180 + (i % 3) * 10, // 180-200 SAR per unit — wholesale fuel pricing, not retail water
      bottleSizeLtr: 19,
      paymentMethod: "ACCOUNT_CREDIT",
      slaMinutes: 240,
      createdAt,
      outcome: outcomeForIndex(i),
    });
  }

  const fuelFillsTenant2: { vehicleId: string; dayOffset: number; liters: number; costSar: number; odometer: number }[] = [
    { vehicleId: tanker1Id, dayOffset: 4, liters: 60, costSar: 270.0, odometer: 30500 },
    { vehicleId: tanker1Id, dayOffset: 19, liters: 58, costSar: 261.0, odometer: 31900 },
    { vehicleId: tanker2Id, dayOffset: 9, liters: 55, costSar: 247.5, odometer: 24200 },
    { vehicleId: tanker2Id, dayOffset: 26, liters: 57, costSar: 256.5, odometer: 25600 },
    { vehicleId: tanker3Id, dayOffset: 13, liters: 62, costSar: 279.0, odometer: 12800 },
  ];
  await db.insert(fuelLogs).values(
    fuelFillsTenant2.map((f) => ({
      id: genId(),
      tenantId: tenant2Id,
      vehicleId: f.vehicleId,
      litersFilled: f.liters,
      costSar: f.costSar,
      odometerReading: f.odometer,
      filledAt: new Date(historyStart + f.dayOffset * 24 * 60 * 60_000),
    }))
  );

  await db.insert(maintenanceRecords).values({
    id: genId(),
    tenantId: tenant2Id,
    vehicleId: tanker2Id,
    type: "PREVENTIVE",
    description: "Tanker safety inspection and valve service",
    odometerReading: 24500,
    cost: 540,
    status: "COMPLETED",
    openedAt: new Date(historyStart + 9 * 24 * 60 * 60_000),
    completedAt: new Date(historyStart + 10 * 24 * 60 * 60_000),
  });

  // ==========================================================
  // Company Switcher: a real platform-level admin
  // ==========================================================
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
