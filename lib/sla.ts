// BR-20: SLA & Escalation Management.
// SLA status is computed on read rather than stored/polled, since Phase 2
// has no background job runner — this keeps it simple and always accurate.

export type SlaStatus = "ON_TRACK" | "AT_RISK" | "BREACHED" | "MET" | "MISSED";

const AT_RISK_THRESHOLD_RATIO = 0.8; // flag "at risk" once 80% of the SLA window has elapsed

export function computeSlaStatus(params: {
  createdAt: Date | string;
  slaMinutes: number;
  status: string; // order status
  completedAt?: Date | string | null; // when it was actually delivered/failed, if applicable
}): { dueBy: Date; minutesRemaining: number; slaStatus: SlaStatus } {
  const createdAt = new Date(params.createdAt);
  const dueBy = new Date(createdAt.getTime() + params.slaMinutes * 60_000);
  const now = new Date();

  const terminalDelivered = params.status === "DELIVERED" || params.status === "PARTIALLY_DELIVERED";
  const terminalFailed = params.status === "FAILED" || params.status === "CANCELLED";

  if (terminalDelivered && params.completedAt) {
    const completedAt = new Date(params.completedAt);
    const minutesRemaining = Math.round((dueBy.getTime() - completedAt.getTime()) / 60_000);
    return { dueBy, minutesRemaining, slaStatus: completedAt <= dueBy ? "MET" : "MISSED" };
  }

  if (terminalFailed) {
    // Failed/cancelled orders don't carry an SLA breach forward — they're an
    // exception-handling concern (BR-11), not an SLA one.
    const minutesRemaining = Math.round((dueBy.getTime() - now.getTime()) / 60_000);
    return { dueBy, minutesRemaining, slaStatus: "MET" };
  }

  // still in flight
  const minutesRemaining = Math.round((dueBy.getTime() - now.getTime()) / 60_000);
  const elapsedRatio = (now.getTime() - createdAt.getTime()) / (dueBy.getTime() - createdAt.getTime());

  if (now > dueBy) return { dueBy, minutesRemaining, slaStatus: "BREACHED" };
  if (elapsedRatio >= AT_RISK_THRESHOLD_RATIO) return { dueBy, minutesRemaining, slaStatus: "AT_RISK" };
  return { dueBy, minutesRemaining, slaStatus: "ON_TRACK" };
}
