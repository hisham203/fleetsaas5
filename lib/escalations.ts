import { db } from "./db/client";
import { orders, escalations, users } from "./db/schema";
import { computeSlaStatus } from "./sla";
import { eq, and, notInArray, or } from "drizzle-orm";
import { genId } from "./helpers";

// BR-20: SLA & Escalation Management — the automatic half of it.
//
// Called as a side effect of the existing SLA-polling endpoints (GET
// /api/sla and GET /api/escalations), so any order that has crossed into
// AT_RISK or BREACHED gets a persisted escalation row within one poll
// cycle — a few seconds in practice, given the Dispatcher console polls
// every 4s. This is genuinely automatic in effect without needing a real
// cron/background-job scheduler, which this build doesn't have (see the
// schema comment on `escalations` for the full honest framing).
//
// Severity: AT_RISK -> MEDIUM (an early warning), BREACHED -> HIGH (the
// real thing). If an order's situation gets WORSE while an escalation is
// still open (MEDIUM -> HIGH), the existing row is upgraded in place rather
// than creating a duplicate — but a NEW escalation is created if the
// previous one was already RESOLVED and the order is still at risk or
// breached (e.g. resolved prematurely, or a fresh SLA clock via a
// rescheduled order) — the escalation log stays a genuine audit trail,
// not a single mutable status flag.
function severityFor(slaStatus: "AT_RISK" | "BREACHED"): "MEDIUM" | "HIGH" {
  return slaStatus === "BREACHED" ? "HIGH" : "MEDIUM";
}

const severityRank = { MEDIUM: 1, HIGH: 2 } as const;

export async function checkAndCreateEscalations(tenantId: string): Promise<void> {
  const activeOrders = await db.query.orders.findMany({
    where: and(
      eq(orders.tenantId, tenantId),
      notInArray(orders.status, ["DELIVERED", "PARTIALLY_DELIVERED", "FAILED", "CANCELLED"])
    ),
  });

  if (activeOrders.length === 0) return;

  // One admin per tenant to escalate to — see the schema comment on why
  // this build doesn't model a distinct Supervisor role.
  const admin = await db.query.users.findFirst({ where: and(eq(users.tenantId, tenantId), eq(users.role, "ADMIN")) });

  for (const order of activeOrders) {
    const sla = computeSlaStatus({
      createdAt: order.createdAt,
      slaMinutes: order.slaMinutes,
      status: order.status,
      completedAt: order.completedAt,
    });

    if (sla.slaStatus !== "AT_RISK" && sla.slaStatus !== "BREACHED") continue;
    const severity = severityFor(sla.slaStatus);

    const existing = await db.query.escalations.findFirst({
      where: and(eq(escalations.orderId, order.id), or(eq(escalations.status, "OPEN"), eq(escalations.status, "ACKNOWLEDGED"))),
    });

    if (!existing) {
      await db.insert(escalations).values({
        id: genId(),
        tenantId,
        orderId: order.id,
        severity,
        slaStatusAtEscalation: sla.slaStatus,
        escalatedToUserId: admin?.id,
      });
      continue;
    }

    if (severityRank[severity as "MEDIUM" | "HIGH"] > severityRank[existing.severity as "MEDIUM" | "HIGH"]) {
      await db
        .update(escalations)
        .set({ severity, slaStatusAtEscalation: sla.slaStatus, notifiedAt: new Date() })
        .where(eq(escalations.id, existing.id));
    }
  }
}
