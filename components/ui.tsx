// RC1 UI V2 — Shared UI primitives. Used across all screens.
// No business logic here — pure presentation components.

import { ReactNode } from "react";

// ── Page wrapper ─────────────────────────────────────────────
export function PageContent({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`page-content ${className}`}>{children}</div>;
}

// ── Page header ──────────────────────────────────────────────
export function PageHeader({
  title, subtitle, actions,
}: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 mb-4">
      <div>
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

// ── Section header ───────────────────────────────────────────
export function SectionHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <div className="section-header">
      <h2 className="section-title">{title}</h2>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

// ── Card ─────────────────────────────────────────────────────
export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`card ${className}`}>{children}</div>;
}
export function CardHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <div className="card-header">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
export function CardBody({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`card-body ${className}`}>{children}</div>;
}

// ── KPI Grid ─────────────────────────────────────────────────
export function KpiGrid({ children, cols = 4 }: { children: ReactNode; cols?: 2|3|4|5 }) {
  const colClass = { 2: "grid-cols-2", 3: "grid-cols-2 md:grid-cols-3", 4: "grid-cols-2 md:grid-cols-4", 5: "grid-cols-2 md:grid-cols-5" }[cols];
  return <div className={`grid ${colClass} gap-3`}>{children}</div>;
}

// ── Buttons ──────────────────────────────────────────────────
export function Btn({
  children, onClick, variant = "secondary", size = "md", disabled, type = "button", className = "",
}: {
  children: ReactNode; onClick?: () => void; variant?: "primary"|"secondary"|"ghost"|"danger"|"outline";
  size?: "sm"|"md"|"lg"; disabled?: boolean; type?: "button"|"submit"; className?: string;
}) {
  const v = { primary:"btn-primary", secondary:"btn-secondary", ghost:"btn-ghost", danger:"btn-danger", outline:"btn-outline" }[variant];
  const s = { sm:"btn-sm", md:"btn-md", lg:"btn-lg" }[size];
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`btn ${v} ${s} ${className}`}>
      {children}
    </button>
  );
}

// ── Form ─────────────────────────────────────────────────────
export function FormInput(props: React.InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  const { label, ...rest } = props;
  return (
    <div>
      {label && <label className="form-label">{label}</label>}
      <input {...rest} className={`form-input ${rest.className ?? ""}`} />
    </div>
  );
}
export function FormSelect(props: React.SelectHTMLAttributes<HTMLSelectElement> & { label?: string; children: ReactNode }) {
  const { label, children, ...rest } = props;
  return (
    <div>
      {label && <label className="form-label">{label}</label>}
      <select {...rest} className={`form-select ${rest.className ?? ""}`}>{children}</select>
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────
export function EmptyState({ icon = "📋", title, body, action }: { icon?: string; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">{icon}</div>
      <p className="empty-state-title">{title}</p>
      {body && <p className="empty-state-body">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// ── Loading ───────────────────────────────────────────────────
export function LoadingRows({ rows = 4, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="animate-pulse space-y-2 p-4">
      {Array.from({length: rows}).map((_, i) => (
        <div key={i} className="flex gap-3">
          {Array.from({length: cols}).map((_, j) => (
            <div key={j} className="h-4 bg-slate-100 rounded flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

// ── Filter bar ────────────────────────────────────────────────
export function FilterBar({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2 mb-4">{children}</div>;
}

// ── Search input ──────────────────────────────────────────────
export function SearchInput({ value, onChange, placeholder = "Search…" }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="relative">
      <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-steel" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <input
        type="search"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="form-input pl-7 pr-3 py-1.5 text-xs w-48"
      />
    </div>
  );
}

// ── Tabs ─────────────────────────────────────────────────────
export function Tabs<T extends string>({
  tabs, active, onChange,
}: { tabs: {key: T; label: string; count?: number}[]; active: T; onChange: (k: T) => void }) {
  return (
    <div className="flex border-b border-slate-200 mb-4">
      {tabs.map(t => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            active === t.key
              ? "border-aqua text-aqua"
              : "border-transparent text-steel hover:text-ink hover:border-slate-300"
          }`}
        >
          {t.label}
          {t.count !== undefined && (
            <span className={`ml-1.5 text-2xs font-semibold px-1.5 py-0.5 rounded-full ${active === t.key ? "bg-aquaLight text-aquaDark" : "bg-slate-100 text-steel"}`}>
              {t.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

// ── Inline ref badge ─────────────────────────────────────────
export function RefBadge({ children }: { children: ReactNode }) {
  return <span className="mono-ref">{children}</span>;
}

// ── Error banner ─────────────────────────────────────────────
export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 bg-dangerLight border border-danger/20 text-danger rounded px-3 py-2 text-sm">
      <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
      {message}
    </div>
  );
}
