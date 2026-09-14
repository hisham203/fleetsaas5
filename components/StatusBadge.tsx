const STATUS_CONFIG: Record<string, { bg: string; text: string; dot?: string }> = {
  // Orders
  PENDING:              { bg: "bg-warnLight",   text: "text-warn",    dot: "bg-warn" },
  VALIDATED:            { bg: "bg-warnLight",   text: "text-warn" },
  QUEUED:               { bg: "bg-warnLight",   text: "text-warn" },
  ASSIGNED:             { bg: "bg-infoLight",   text: "text-info",    dot: "bg-info" },
  IN_TRANSIT:           { bg: "bg-infoLight",   text: "text-info",    dot: "bg-info" },
  DELIVERED:            { bg: "bg-okLight",     text: "text-ok",      dot: "bg-ok" },
  PARTIALLY_DELIVERED:  { bg: "bg-warnLight",   text: "text-warn" },
  FAILED:               { bg: "bg-dangerLight", text: "text-danger",  dot: "bg-danger" },
  CANCELLED:            { bg: "bg-slate-100",   text: "text-steel" },
  // Trips
  PLANNED:              { bg: "bg-slate-100",   text: "text-steel" },
  DISPATCHED:           { bg: "bg-infoLight",   text: "text-info" },
  IN_PROGRESS:          { bg: "bg-infoLight",   text: "text-info",    dot: "bg-info" },
  COMPLETED:            { bg: "bg-okLight",     text: "text-ok" },
  // Fleet
  AVAILABLE:            { bg: "bg-okLight",     text: "text-ok",      dot: "bg-ok" },
  IN_TRIP:              { bg: "bg-infoLight",   text: "text-info",    dot: "bg-info" },
  ON_TRIP:              { bg: "bg-infoLight",   text: "text-info",    dot: "bg-info" },
  MAINTENANCE:          { bg: "bg-warnLight",   text: "text-warn" },
  OUT_OF_SERVICE:       { bg: "bg-dangerLight", text: "text-danger" },
  // Driver
  OFF_DUTY:             { bg: "bg-slate-100",   text: "text-steel" },
  ARRIVED:              { bg: "bg-infoLight",   text: "text-info" },
  // Finance
  PAID:                 { bg: "bg-okLight",     text: "text-ok" },
  // SLA
  ON_TRACK:             { bg: "bg-okLight",     text: "text-ok" },
  AT_RISK:              { bg: "bg-warnLight",   text: "text-warn" },
  BREACHED:             { bg: "bg-dangerLight", text: "text-danger" },
  MET:                  { bg: "bg-okLight",     text: "text-ok" },
  MISSED:               { bg: "bg-dangerLight", text: "text-danger" },
  // Maintenance
  OPEN:                 { bg: "bg-warnLight",   text: "text-warn",    dot: "bg-warn" },
  // Tyres
  ACTIVE:               { bg: "bg-okLight",     text: "text-ok" },
  RETIRED:              { bg: "bg-slate-100",   text: "text-steel" },
  // Control Tower
  NEW:                  { bg: "bg-slate-100",   text: "text-steel" },
  READY_FOR_PLANNING:   { bg: "bg-warnLight",   text: "text-warn" },
  WAITING_ASSIGNMENT:   { bg: "bg-warnLight",   text: "text-warn" },
  ASSIGNED_WAITING_LOADING: { bg: "bg-warnLight", text: "text-warn" },
  LOADED:               { bg: "bg-infoLight",   text: "text-info" },
  EXCEPTION:            { bg: "bg-dangerLight", text: "text-danger",  dot: "bg-danger" },
  NOT_APPLICABLE:       { bg: "bg-slate-100",   text: "text-steel" },
  PENDING_BILLING:      { bg: "bg-warnLight",   text: "text-warn" },
  INVOICED_PENDING:     { bg: "bg-warnLight",   text: "text-warn" },
  INVOICED_PAID:        { bg: "bg-okLight",     text: "text-ok" },
  DEFERRED_MONTHLY:     { bg: "bg-slate-100",   text: "text-steel" },
  B2B_CONTRACT:         { bg: "bg-infoLight",   text: "text-info" },
  B2B_CASH:             { bg: "bg-slate-100",   text: "text-steel" },
  B2C_CASH:             { bg: "bg-slate-100",   text: "text-steel" },
  UNKNOWN:              { bg: "bg-slate-100",   text: "text-steel" },
  // Contracts
  DRAFT:                { bg: "bg-slate-100",   text: "text-steel" },
  EXPIRED:              { bg: "bg-dangerLight", text: "text-danger" },
  SUSPENDED:            { bg: "bg-warnLight",   text: "text-warn" },
};

const LABEL_OVERRIDES: Record<string, string> = {
  IN_PROGRESS: "In Progress",
  IN_TRANSIT: "In Transit",
  IN_TRIP: "On Trip",
  ON_TRIP: "On Trip",
  PARTIALLY_DELIVERED: "Partial",
  OUT_OF_SERVICE: "Out of Service",
  OFF_DUTY: "Off Duty",
  READY_FOR_PLANNING: "Ready",
  WAITING_ASSIGNMENT: "Unassigned",
  ASSIGNED_WAITING_LOADING: "Pre-load",
  PENDING_BILLING: "Pending",
  INVOICED_PENDING: "Invoiced",
  INVOICED_PAID: "Paid",
  DEFERRED_MONTHLY: "Monthly",
  B2B_CONTRACT: "Contract",
  B2B_CASH: "Cash",
  B2C_CASH: "Cash",
  NOT_APPLICABLE: "N/A",
};

export default function StatusBadge({ status, showDot = false }: { status: string; showDot?: boolean }) {
  const cfg = STATUS_CONFIG[status] ?? { bg: "bg-slate-100", text: "text-steel" };
  const label = LABEL_OVERRIDES[status] ?? status.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  return (
    <span className={`status-pill ${cfg.bg} ${cfg.text}`}>
      {(showDot && cfg.dot) && (
        <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot} inline-block`} />
      )}
      {label}
    </span>
  );
}
