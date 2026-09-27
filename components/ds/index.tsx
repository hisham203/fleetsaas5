/**
 * Smarty1 Design System — Milestone A
 * Shared enterprise UI primitives.
 */
"use client";
import { ReactNode } from "react";

export function PageContainer({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`px-4 md:px-6 py-6 max-w-screen-2xl mx-auto ${className}`}>{children}</div>;
}

export function PageHeader({
  title, subtitle, breadcrumbs, actions, badge,
}: {
  title: string; subtitle?: string;
  breadcrumbs?: { label: string; href?: string }[];
  actions?: ReactNode; badge?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 mb-6">
      <div className="min-w-0">
        {breadcrumbs && breadcrumbs.length > 0 && (
          <nav className="flex items-center gap-1.5 text-xs text-steel mb-1.5">
            {breadcrumbs.map((b, i) => (
              <span key={i} className="flex items-center gap-1.5">
                {i > 0 && <span className="text-slate-300">/</span>}
                {b.href ? <a href={b.href} className="hover:text-ink transition-colors">{b.label}</a>
                  : <span className="text-ink font-medium">{b.label}</span>}
              </span>
            ))}
          </nav>
        )}
        <div className="flex items-center gap-2.5 flex-wrap">
          <h1 className="text-xl font-semibold text-ink tracking-tight">{title}</h1>
          {badge}
        </div>
        {subtitle && <p className="text-sm text-steel mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

export function SectionHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 mb-3">
      <div>
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {subtitle && <p className="text-xs text-steel mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function MetricCard({ label, value, trendLabel, accent = "default", icon }: {
  label: string; value: string | number; trendLabel?: string;
  accent?: "default"|"ok"|"warn"|"danger"|"info"; icon?: ReactNode;
}) {
  const borders = { default:"border-slate-200", ok:"border-ok/30", warn:"border-warn/30", danger:"border-danger/30", info:"border-info/30" };
  return (
    <div className={`bg-white rounded-xl border ${borders[accent]} p-4 shadow-card`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-steel truncate">{label}</p>
          <p className="text-2xl font-bold text-ink mt-1 tabular-nums">{value}</p>
          {trendLabel && <p className="text-xs text-steel mt-1">{trendLabel}</p>}
        </div>
        {icon && <div className="w-9 h-9 rounded-lg bg-paper flex items-center justify-center text-steel shrink-0">{icon}</div>}
      </div>
    </div>
  );
}

const STATUS_MAP: Record<string, { bg: string; text: string; dot?: string }> = {
  PENDING: { bg:"bg-warnLight", text:"text-warn", dot:"bg-warn" },
  VALIDATED: { bg:"bg-warnLight", text:"text-warn" },
  ASSIGNED: { bg:"bg-infoLight", text:"text-info", dot:"bg-info" },
  IN_TRANSIT: { bg:"bg-infoLight", text:"text-info", dot:"bg-info" },
  DELIVERED: { bg:"bg-okLight", text:"text-ok", dot:"bg-ok" },
  PARTIALLY_DELIVERED: { bg:"bg-warnLight", text:"text-warn" },
  FAILED: { bg:"bg-dangerLight", text:"text-danger", dot:"bg-danger" },
  CANCELLED: { bg:"bg-slate-100", text:"text-steel" },
  PLANNED: { bg:"bg-slate-100", text:"text-steel" },
  DISPATCHED: { bg:"bg-infoLight", text:"text-info", dot:"bg-info" },
  IN_PROGRESS: { bg:"bg-infoLight", text:"text-info", dot:"bg-info" },
  COMPLETED: { bg:"bg-okLight", text:"text-ok" },
  AVAILABLE: { bg:"bg-okLight", text:"text-ok", dot:"bg-ok" },
  IN_TRIP: { bg:"bg-infoLight", text:"text-info", dot:"bg-info" },
  ON_TRIP: { bg:"bg-infoLight", text:"text-info", dot:"bg-info" },
  MAINTENANCE: { bg:"bg-warnLight", text:"text-warn" },
  OUT_OF_SERVICE: { bg:"bg-dangerLight", text:"text-danger" },
  OFF_DUTY: { bg:"bg-slate-100", text:"text-steel" },
  PAID: { bg:"bg-okLight", text:"text-ok" },
  UNPAID: { bg:"bg-dangerLight", text:"text-danger" },
  DRAFT: { bg:"bg-slate-100", text:"text-steel" },
  ACTIVE: { bg:"bg-okLight", text:"text-ok" },
  EXPIRED: { bg:"bg-dangerLight", text:"text-danger" },
  SUSPENDED: { bg:"bg-warnLight", text:"text-warn" },
  EXCEPTION: { bg:"bg-dangerLight", text:"text-danger", dot:"bg-danger" },
  OPEN: { bg:"bg-warnLight", text:"text-warn", dot:"bg-warn" },
  CLOSED: { bg:"bg-okLight", text:"text-ok" },
  ON_TRACK: { bg:"bg-okLight", text:"text-ok" },
  AT_RISK: { bg:"bg-warnLight", text:"text-warn" },
  BREACHED: { bg:"bg-dangerLight", text:"text-danger" },
  MET: { bg:"bg-okLight", text:"text-ok" },
  MISSED: { bg:"bg-dangerLight", text:"text-danger" },
  RETIRED: { bg:"bg-slate-100", text:"text-steel" },
};

export function StatusBadge({ status, size = "sm" }: { status: string; size?: "xs"|"sm"|"md" }) {
  const cfg = STATUS_MAP[status] ?? { bg:"bg-slate-100", text:"text-steel" };
  const sz = { xs:"text-2xs px-1.5 py-0.5", sm:"text-xs px-2 py-0.5", md:"text-sm px-2.5 py-1" };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full font-medium ${cfg.bg} ${cfg.text} ${sz[size]}`}>
      {cfg.dot && <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />}
      {status.replace(/_/g," ")}
    </span>
  );
}

export function EmptyState({ title, description, action, icon }: {
  title: string; description?: string; action?: ReactNode; icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      {icon && <div className="mb-4 text-slate-300">{icon}</div>}
      <h3 className="text-sm font-semibold text-ink mb-1">{title}</h3>
      {description && <p className="text-sm text-steel max-w-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function LoadingState({ label="Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center py-16 gap-2 text-steel">
      <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function Tabs({ tabs, active, onChange }: {
  tabs: { id: string; label: string; badge?: number }[];
  active: string; onChange: (id: string) => void;
}) {
  return (
    <div className="flex gap-0 border-b border-slate-200 mb-6 overflow-x-auto">
      {tabs.map(tab => (
        <button key={tab.id} onClick={() => onChange(tab.id)}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap ${
            active===tab.id ? "border-aqua text-aqua" : "border-transparent text-steel hover:text-ink"}`}>
          {tab.label}
          {tab.badge != null && tab.badge > 0 && (
            <span className={`text-2xs px-1.5 py-0.5 rounded-full font-semibold ${active===tab.id?"bg-aqua/10 text-aqua":"bg-slate-100 text-steel"}`}>
              {tab.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

export function Btn({ children, onClick, variant="primary", size="sm", disabled, type="button" }: {
  children: ReactNode; onClick?: () => void;
  variant?: "primary"|"secondary"|"ghost"|"danger";
  size?: "xs"|"sm"|"md"; disabled?: boolean; type?: "button"|"submit";
}) {
  const v = { primary:"bg-aqua text-white hover:bg-aquaDark", secondary:"bg-white border border-slate-200 text-ink hover:bg-paper", ghost:"text-steel hover:bg-paper hover:text-ink", danger:"bg-danger text-white hover:bg-red-700" };
  const s = { xs:"text-xs px-2.5 py-1.5", sm:"text-sm px-3.5 py-2", md:"text-sm px-4 py-2.5" };
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      className={`inline-flex items-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${v[variant]} ${s[size]}`}>
      {children}
    </button>
  );
}

export function EntityHeader({ title, subtitle, status, meta, actions, avatar }: {
  title: string; subtitle?: string; status?: string;
  meta?: { label: string; value: string }[];
  actions?: ReactNode; avatar?: ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6 shadow-card">
      <div className="flex items-start gap-4">
        {avatar && <div className="w-12 h-12 rounded-xl bg-paper border border-slate-200 flex items-center justify-center text-steel shrink-0">{avatar}</div>}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-lg font-semibold text-ink">{title}</h1>
            {status && <StatusBadge status={status} />}
          </div>
          {subtitle && <p className="text-sm text-steel mt-0.5">{subtitle}</p>}
          {meta && meta.length > 0 && (
            <div className="flex flex-wrap gap-x-6 gap-y-1 mt-2">
              {meta.map(m => (
                <span key={m.label} className="text-xs text-steel">
                  <span className="font-medium text-ink">{m.value}</span> {m.label}
                </span>
              ))}
            </div>
          )}
        </div>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </div>
    </div>
  );
}

export function DescriptionList({ items }: { items: { label: string; value?: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-4">
      {items.map(item => (
        <div key={item.label}>
          <dt className="text-xs font-medium text-steel">{item.label}</dt>
          <dd className="mt-0.5 text-sm text-ink">{item.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Drawer({ open, title, onClose, children, width="w-96" }: {
  open: boolean; title: string; onClose: () => void; children: ReactNode; width?: string;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className={`${width} bg-white h-full shadow-2xl flex flex-col max-w-full`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-paper text-steel transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">{children}</div>
      </div>
    </div>
  );
}

// ── Timeline ───────────────────────────────────────────────────────────────
export function TimelineItem({
  label, time, description, status = "pending", isLast,
}: {
  label: string; time?: string; description?: string;
  status?: "done" | "active" | "pending"; isLast?: boolean;
}) {
  const dotColor = { done: "bg-ok", active: "bg-aqua ring-2 ring-aqua/30", pending: "bg-slate-200" };
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className={`w-3 h-3 rounded-full mt-0.5 shrink-0 ${dotColor[status]}`} />
        {!isLast && <div className="w-px flex-1 bg-slate-200 mt-1 mb-1" />}
      </div>
      <div className={`${isLast ? "pb-0" : "pb-4"} min-w-0`}>
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className={`text-sm ${status === "done" ? "text-ink font-medium" : status === "active" ? "text-aqua font-semibold" : "text-steel"}`}>
            {label}
          </span>
          {time && <span className="text-2xs text-slate-400">{time}</span>}
        </div>
        {description && <p className="text-xs text-steel mt-0.5">{description}</p>}
      </div>
    </div>
  );
}

// ── Filter Bar ─────────────────────────────────────────────────────────────
export function FilterBar({
  search, onSearch, filters, onClear,
}: {
  search?: string;
  onSearch?: (v: string) => void;
  filters?: ReactNode;
  onClear?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 mb-4">
      {onSearch !== undefined && (
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-steel pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 15.803a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input
            type="text"
            value={search ?? ""}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search…"
            className="pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-aqua/30 focus:border-aqua bg-white min-w-[180px]"
          />
        </div>
      )}
      {filters}
      {onClear && (
        <button onClick={onClear} className="text-xs text-steel hover:text-ink px-2 py-1.5 rounded-lg hover:bg-paper">
          Clear
        </button>
      )}
    </div>
  );
}
