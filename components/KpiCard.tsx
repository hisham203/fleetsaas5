// RC1 UI V2 — KpiCard. Renders real tenant data only. No invented metrics.
export default function KpiCard({
  label,
  value,
  sub,
  tone,
  icon,
}: {
  label: string;
  value: number | string;
  sub?: string;
  tone?: "default" | "warn" | "danger" | "ok" | "info";
  icon?: string; // SVG path d= value
}) {
  const valueColor =
    tone === "warn"   ? "text-warn"   :
    tone === "danger" ? "text-danger" :
    tone === "ok"     ? "text-ok"     :
    tone === "info"   ? "text-info"   : "text-ink";

  const iconBg =
    tone === "warn"   ? "bg-warnLight text-warn"     :
    tone === "danger" ? "bg-dangerLight text-danger"  :
    tone === "ok"     ? "bg-okLight text-ok"          :
    tone === "info"   ? "bg-infoLight text-info"      : "bg-slate-100 text-steel";

  return (
    <div className="kpi-card flex items-start gap-3">
      {icon && (
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${iconBg}`}>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
            <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
          </svg>
        </div>
      )}
      <div className="min-w-0">
        <p className="kpi-label">{label}</p>
        <p className={`kpi-value ${valueColor}`}>{value}</p>
        {sub && <p className="kpi-sub">{sub}</p>}
      </div>
    </div>
  );
}
