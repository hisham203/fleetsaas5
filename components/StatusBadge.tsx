const COLORS: Record<string, string> = {
  PENDING: "bg-warn/15 text-warn",
  VALIDATED: "bg-warn/15 text-warn",
  QUEUED: "bg-warn/15 text-warn",
  ASSIGNED: "bg-aqua/15 text-aquaDark",
  IN_TRANSIT: "bg-aqua/15 text-aquaDark",
  DELIVERED: "bg-ok/15 text-ok",
  PARTIALLY_DELIVERED: "bg-warn/15 text-warn",
  FAILED: "bg-danger/15 text-danger",
  CANCELLED: "bg-steel/15 text-steel",
  PLANNED: "bg-steel/15 text-steel",
  DISPATCHED: "bg-aqua/15 text-aquaDark",
  IN_PROGRESS: "bg-aqua/15 text-aquaDark",
  COMPLETED: "bg-ok/15 text-ok",
  AVAILABLE: "bg-ok/15 text-ok",
  IN_TRIP: "bg-aqua/15 text-aquaDark",
  ON_TRIP: "bg-aqua/15 text-aquaDark",
  MAINTENANCE: "bg-warn/15 text-warn",
  OUT_OF_SERVICE: "bg-danger/15 text-danger",
  OFF_DUTY: "bg-steel/15 text-steel",
  PAID: "bg-ok/15 text-ok",
  ARRIVED: "bg-aqua/15 text-aquaDark",
  // BR-20 SLA statuses
  ON_TRACK: "bg-ok/15 text-ok",
  AT_RISK: "bg-warn/15 text-warn",
  BREACHED: "bg-danger/15 text-danger",
  MET: "bg-ok/15 text-ok",
  MISSED: "bg-danger/15 text-danger",
  // BR-15 maintenance
  OPEN: "bg-warn/15 text-warn",
  // BR-14 tyres
  ACTIVE: "bg-ok/15 text-ok",
  RETIRED: "bg-steel/15 text-steel",
};

export default function StatusBadge({ status }: { status: string }) {
  const cls = COLORS[status] ?? "bg-steel/15 text-steel";
  return <span className={`status-pill ${cls}`}>{status.replace(/_/g, " ")}</span>;
}
