import { db } from "@/lib/db/client";
import { users, drivers, vehicles } from "@/lib/db/schema";
import { genId } from "@/lib/helpers";
import { hashPassword } from "@/lib/auth";
import { loginAs } from "./request";

// Test isolation fix: several integration test files previously hardcoded
// a specific seeded driver by email (most commonly khalid@demo-water.co)
// as "the test driver", cached once in beforeAll. This was fragile in a
// real CI run: multiple test files reach for the same small shared pool
// of seeded drivers/vehicles, sequential test-file execution order isn't
// something to rely on, and a single earlier assertion failure anywhere
// in a trip's lifecycle can abort that test before its own cleanup step
// runs — leaving the shared driver stuck busy for every later test in
// every file that also depends on that same specific driver by name.
//
// The fix is genuine test isolation, not weaker validation: each test
// file that needs a driver/vehicle to run real trips through creates its
// own dedicated ones here, used by nothing else, so there is no pool to
// contend over at all. Every real driver/vehicle availability check in
// the application itself (the actual business logic) is completely
// unchanged and still fully exercised — these fixtures are ordinary rows
// created through the same schema and constraints as any seeded driver
// or vehicle, not a special-cased bypass.
export async function createIsolatedDriverAndVehicle(tenantId: string, label: string) {
  const password = "password123";
  const passwordHash = await hashPassword(password);
  const suffix = genId().slice(0, 8);

  const userId = genId();
  const email = `test-${label}-${suffix}@isolated-test.local`;
  await db.insert(users).values({
    id: userId,
    tenantId,
    name: `Isolated Test Driver (${label})`,
    email,
    passwordHash,
    role: "DRIVER",
  });

  const driverId = genId();
  await db.insert(drivers).values({
    id: driverId,
    tenantId,
    userId,
    licenseNumber: `TEST-${suffix.toUpperCase()}`,
    phone: "0500000000",
    status: "AVAILABLE",
  });

  const vehicleId = genId();
  await db.insert(vehicles).values({
    id: vehicleId,
    tenantId,
    plateNumber: `TEST-${suffix.toUpperCase()}`,
    vehicleType: "Refill Van",
    capacityUnits: 100,
    status: "AVAILABLE",
  });

  const driverCookie = await loginAs(email, password);

  return { driverId, vehicleId, driverCookie, driverEmail: email };
}
