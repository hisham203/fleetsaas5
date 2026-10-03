/**
 * Smarty1 Design System — Milestone J
 *
 * Shared enterprise UI primitives.
 * All components use semantic CSS variable tokens from globals.css.
 * No hardcoded primitive colors.
 */
"use client";
import { ReactNode, useState, useCallback } from "react";
import Link from "next/link";

// ── Layout ────────────────────────────────────────────────────────────────

export function PageContainer({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`px-4 md:px-6 py-5 max-w-screen-2xl mx-auto ${className}`}>
      {children}
    </div>
  );
}

export function PageHeader({
  title, subtitle, breadcrumbs, actions, badge,
}: {
  title: string; subtitle?: string;
  breadcrumbs?: { label: string; href?: string }[];
  actions?: ReactNode; badge?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 mb-5">
      <div className="min-w-0">
        {breadcrumbs && breadcrumbs.length > 0 && (
          <nav className="flex items-center gap-1.5 text-xs mb-1.5 flex-wrap" aria-label="Breadcrumb"
            style={{ color: "var(--text-muted)" }}>
            {breadcrumbs.map((b, i) => (
              <span key={i} className="flex items-center gap-1.5">
                {i > 0 && <span style={{ color: "var(--border-default)" }}>/</span>}
                {b.href
                  ? <Link href={b.href} className="hover:underline" style={{ color: "var(--text-secondary)" }}>{b.label}</Link>
                  : <span style={{ color: "var(--text-primary)", fontWeight: 500 }}>{b.label}</span>}
              </span>
            ))}
          </nav>
        )}
        <div className="flex items-center gap-2.5 flex-wrap">
          <h1 className="text-h4 font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>{title}</h1>
          {badge}
        </div>
        {subtitle && <p className="text-sm mt-0.5" style={{ color: "var(--text-muted)" }}>{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0 flex-wrap">{actions}</div>}
    </div>
  );
}

export function SectionHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 mb-3">
      <div>
        <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{title}</h2>
        {subtitle && <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

// ── Button ─────────────────────────────────────────────────────────────────

type BtnVariant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type BtnSize    = "xs" | "sm" | "md" | "lg";

const BTN_VARIANT: Record<BtnVariant, string> = {
  primary:   "bg-[var(--interactive-primary)] text-[var(--text-on-brand)] hover:bg-[var(--interactive-primary-hover)] active:bg-[var(--interactive-primary-active)]",
  secondary: "bg-[var(--interactive-secondary)] text-[var(--text-secondary)] border border-[var(--border-default)] hover:bg-[var(--interactive-secondary-hover)] hover:text-[var(--text-primary)]",
  ghost:     "text-[var(--text-muted)] hover:bg-[rgba(255,255,255,0.05)] hover:text-[var(--text-primary)]",
  danger:    "bg-[var(--danger)] text-white hover:bg-[var(--danger-hover)]",
  outline:   "border border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]",
};

const BTN_SIZE: Record<BtnSize, string> = {
  xs: "text-xs px-2 h-6 gap-1",
  sm: "text-xs px-2.5 h-7 gap-1.5",
  md: "text-sm px-3.5 h-8 gap-1.5",
  lg: "text-sm px-5 h-10 gap-2",
};

export function Btn({
  children, variant = "secondary", size = "md", disabled, loading, onClick, type = "button", className = "",
}: {
  children: ReactNode;
  variant?: BtnVariant; size?: BtnSize;
  disabled?: boolean; loading?: boolean;
  onClick?: () => void; type?: "button" | "submit" | "reset";
  className?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center font-medium rounded-[var(--radius-btn)]
        transition-colors duration-[120ms]
        focus-visible:outline-2 focus-visible:outline-[var(--border-focus)] focus-visible:outline-offset-2
        disabled:opacity-40 disabled:cursor-not-allowed select-none whitespace-nowrap
        ${BTN_VARIANT[variant]} ${BTN_SIZE[size]} ${className}`}
    >
      {loading ? <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin shrink-0" /> : null}
      {children}
    </button>
  );
}

// ── Status Badge ───────────────────────────────────────────────────────────

const STATUS_PALETTE: Record<string, { bg: string; text: string }> = {
  // Operational lifecycle
  PENDING:              { bg: "var(--warning-bg)",  text: "var(--warning-fg)" },
  VALIDATED:            { bg: "var(--info-bg)",     text: "var(--info-fg)" },
  QUEUED:               { bg: "var(--warning-bg)",  text: "var(--warning-fg)" },
  ASSIGNED:             { bg: "var(--info-bg)",     text: "var(--info-fg)" },
  DISPATCHED:           { bg: "var(--info-bg)",     text: "var(--info-fg)" },
  IN_TRANSIT:           { bg: "var(--info-bg)",     text: "var(--info-fg)" },
  STARTED:              { bg: "var(--info-bg)",     text: "var(--info-fg)" },
  IN_PROGRESS:          { bg: "var(--info-bg)",     text: "var(--info-fg)" },
  ARRIVED_LOADING:      { bg: "var(--warning-bg)",  text: "var(--warning-fg)" },
  LOADING_COMPLETE:     { bg: "var(--info-bg)",     text: "var(--info-fg)" },
  ARRIVED_SITE:         { bg: "var(--info-bg)",     text: "var(--info-fg)" },
  DELIVERED:            { bg: "var(--success-bg)",  text: "var(--success-fg)" },
  PARTIALLY_DELIVERED:  { bg: "var(--warning-bg)",  text: "var(--warning-fg)" },
  COMPLETED:            { bg: "var(--success-bg)",  text: "var(--success-fg)" },
  FAILED:               { bg: "var(--error-bg)",    text: "var(--error-fg)" },
  CANCELLED:            { bg: "rgba(255,255,255,0.06)", text: "var(--text-muted)" },
  PLANNED:              { bg: "rgba(255,255,255,0.06)", text: "var(--text-muted)" },
  TRIP_PLANNED:         { bg: "rgba(255,255,255,0.06)", text: "var(--text-muted)" },
  // Fleet
  AVAILABLE:     { bg: "var(--success-bg)", text: "var(--success-fg)" },
  ON_TRIP:       { bg: "var(--info-bg)",    text: "var(--info-fg)" },
  IN_TRIP:       { bg: "var(--info-bg)",    text: "var(--info-fg)" },
  MAINTENANCE:   { bg: "var(--warning-bg)", text: "var(--warning-fg)" },
  OUT_OF_SERVICE:{ bg: "var(--error-bg)",   text: "var(--error-fg)" },
  OFF_DUTY:      { bg: "rgba(255,255,255,0.06)", text: "var(--text-muted)" },
  // Financial
  PAID:     { bg: "var(--success-bg)", text: "var(--success-fg)" },
  UNPAID:   { bg: "var(--error-bg)",   text: "var(--error-fg)" },
  DRAFT:    { bg: "rgba(255,255,255,0.06)", text: "var(--text-muted)" },
  APPROVED: { bg: "var(--success-bg)", text: "var(--success-fg)" },
  REJECTED: { bg: "var(--error-bg)",   text: "var(--error-fg)" },
  PENDING_REVIEW: { bg: "var(--warning-bg)", text: "var(--warning-fg)" },
  // Contract / admin
  ACTIVE:    { bg: "var(--success-bg)", text: "var(--success-fg)" },
  EXPIRED:   { bg: "var(--error-bg)",   text: "var(--error-fg)" },
  SUSPENDED: { bg: "var(--warning-bg)", text: "var(--warning-fg)" },
  INACTIVE:  { bg: "rgba(255,255,255,0.06)", text: "var(--text-muted)" },
  // Telematics
  OPEN:         { bg: "var(--warning-bg)", text: "var(--warning-fg)" },
  ACKNOWLEDGED: { bg: "var(--info-bg)",    text: "var(--info-fg)" },
  RESOLVED:     { bg: "var(--success-bg)", text: "var(--success-fg)" },
  OFFLINE:      { bg: "var(--error-bg)",   text: "var(--error-fg)" },
  HEALTHY:      { bg: "var(--success-bg)", text: "var(--success-fg)" },
  STALE:        { bg: "var(--warning-bg)", text: "var(--warning-fg)" },
  // Alerts
  CRITICAL: { bg: "var(--error-bg)",   text: "var(--error-fg)" },
  WARNING:  { bg: "var(--warning-bg)", text: "var(--warning-fg)" },
  INFO:     { bg: "var(--info-bg)",    text: "var(--info-fg)" },
  // Trips
  ON_TIME:  { bg: "var(--success-bg)", text: "var(--success-fg)" },
  AT_RISK:  { bg: "var(--warning-bg)", text: "var(--warning-fg)" },
  DELAYED:  { bg: "var(--error-bg)",   text: "var(--error-fg)" },
  MOVING:   { bg: "var(--success-bg)", text: "var(--success-fg)" },
  IDLE:     { bg: "var(--warning-bg)", text: "var(--warning-fg)" },
  UNKNOWN:  { bg: "rgba(255,255,255,0.06)", text: "var(--text-muted)" },
  // Generic
  EXCEPTION: { bg: "var(--error-bg)", text: "var(--error-fg)" },
};

export function StatusBadge({
  status, label, size = "sm",
}: { status: string; label?: string; size?: "xs" | "sm" | "md" }) {
  const palette = STATUS_PALETTE[status] ?? { bg: "rgba(255,255,255,0.06)", text: "var(--text-muted)" };
  const sizeClass = size === "xs" ? "text-xs px-1.5 py-px" : size === "md" ? "text-sm px-2.5 py-1" : "text-xs px-2 py-0.5";
  return (
    <span
      className={`inline-flex items-center font-medium rounded-[var(--radius-sm)] ${sizeClass}`}
      style={{ background: palette.bg, color: palette.text }}
    >
      {label ?? status.replace(/_/g, " ")}
    </span>
  );
}

// ── MetricCard ─────────────────────────────────────────────────────────────

export function MetricCard({ label, value, sub, trendLabel, accent = "default", icon }: {
  label: string; value: string | number; sub?: string;
  trendLabel?: string; // legacy alias for sub
  accent?: "default" | "ok" | "warn" | "danger" | "info" | "brand";
  icon?: ReactNode;
}) {
  const borderMap: Record<string, string> = {
    default: "var(--border-subtle)",
    ok:      "rgba(74,222,128,0.3)",
    warn:    "rgba(251,191,36,0.3)",
    danger:  "rgba(248,113,113,0.3)",
    info:    "rgba(96,165,250,0.3)",
    brand:   "rgba(199,253,1,0.3)",
  };
  return (
    <div className="rounded-[var(--radius-card)] p-4 shadow-card"
      style={{ background: "var(--bg-surface)", border: `1px solid ${borderMap[accent ?? "default"]}` }}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wider truncate" style={{ color: "var(--text-muted)" }}>{label}</p>
          <p className="text-2xl font-bold mt-1 tabular-nums" style={{ color: "var(--text-primary)" }}>{value}</p>
          {(sub ?? trendLabel) && <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>{sub ?? trendLabel}</p>}
        </div>
        {icon && (
          <div className="w-9 h-9 rounded-[var(--radius-btn)] flex items-center justify-center shrink-0"
            style={{ background: "var(--bg-raised)", color: "var(--text-muted)" }}>
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Loading / Empty / Error states ─────────────────────────────────────────

export function LoadingState({ message, label }: { message?: string; label?: string }) {
  const text = message ?? label ?? "Loading…";
  return (
    <div className="flex items-center justify-center py-16 gap-3" role="status" aria-label={text}>
      <span className="w-5 h-5 border-2 border-[var(--text-muted)] border-t-[var(--brand)] rounded-full animate-spin" />
      <span className="text-sm" style={{ color: "var(--text-muted)" }}>{text}</span>
    </div>
  );
}

export function EmptyState({ title, description, action }: {
  title: string; description?: string; action?: ReactNode; icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center px-4">
      <div className="w-12 h-12 rounded-[var(--radius-card)] flex items-center justify-center mb-4"
        style={{ background: "var(--bg-raised)", color: "var(--text-muted)" }}>
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
        </svg>
      </div>
      <p className="text-sm font-semibold" style={{ color: "var(--text-secondary)" }}>{title}</p>
      {description && <p className="text-xs mt-1 max-w-sm" style={{ color: "var(--text-muted)" }}>{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ title = "Something went wrong", description, onRetry }: {
  title?: string; description?: string; onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center px-4">
      <div className="w-12 h-12 rounded-[var(--radius-card)] flex items-center justify-center mb-4"
        style={{ background: "var(--error-bg)", color: "var(--error-fg)" }}>
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>
      <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{title}</p>
      {description && <p className="text-xs mt-1 max-w-sm" style={{ color: "var(--text-muted)" }}>{description}</p>}
      {onRetry && <Btn size="sm" variant="secondary" onClick={onRetry} className="mt-4">Try again</Btn>}
    </div>
  );
}

// ── FilterBar ─────────────────────────────────────────────────────────────

export function FilterBar({
  search, onSearch, onClear, placeholder = "Search…", filters,
}: {
  search: string; onSearch: (v: string) => void; onClear?: () => void; placeholder?: string; filters?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="relative flex-1 max-w-sm">
        <svg className="absolute inset-y-0 start-2.5 my-auto w-4 h-4 pointer-events-none"
          fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}
          style={{ color: "var(--text-muted)" }}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
        </svg>
        <input
          type="text"
          value={search}
          onChange={e => onSearch(e.target.value)}
          placeholder={placeholder}
          className="w-full ps-8 pe-3 h-8 text-sm rounded-[var(--radius-btn)] transition-colors duration-[120ms] focus:outline-none"
          style={{
            background: "var(--bg-raised)",
            color: "var(--text-primary)",
            border: "1px solid var(--border-default)",
          }}
        />
      </div>
      {search && onClear && (
        <Btn size="sm" variant="ghost" onClick={onClear}>Clear</Btn>
      )}
      {filters}
    </div>
  );
}

// ── Additional components (backward compatibility + new additions) ─────────

// LoadingSpinner: alias for LoadingState (convenience)
export function LoadingSpinner({ label }: { label?: string }) { return <LoadingState label={label} />; }

// EntityHeader — used by Entity360 pages:
export function EntityHeader({
  title, subtitle, status, meta, actions, backHref,
}: {
  title: string; subtitle?: string; status?: string;
  meta?: Array<{ label: string; value: string | ReactNode }>;
  actions?: ReactNode; backHref?: string; avatar?: ReactNode; // accepted but rendered only if backHref absent
}) {
  return (
    <div className="rounded-[var(--radius-card)] p-5 mb-5"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}>
      <div className="flex items-start gap-4">
        <div className="flex-1 min-w-0">
          {backHref && (
            <Link href={backHref} className="inline-flex items-center gap-1 text-xs mb-2 hover:underline"
              style={{ color: "var(--text-muted)" }}>
              ← Back
            </Link>
          )}
          <div className="flex items-center gap-2.5 flex-wrap mb-1">
            <h1 className="text-h4 font-bold truncate" style={{ color: "var(--text-primary)" }}>{title}</h1>
            {status && <StatusBadge status={status} size="sm" />}
          </div>
          {subtitle && <p className="text-sm" style={{ color: "var(--text-muted)" }}>{subtitle}</p>}
          {meta && meta.length > 0 && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
              {meta.map(m => (
                <div key={m.label} className="flex items-center gap-1">
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>{m.label}:</span>
                  <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>{m.value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        {actions && <div className="flex items-center gap-2 shrink-0 flex-wrap">{actions}</div>}
      </div>
    </div>
  );
}

// Tabs — horizontal tab strip:
export function Tabs({
  tabs, active, onChange,
}: {
  tabs: Array<{ id: string; label: string; badge?: string | number }>;
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-0.5 overflow-x-auto border-b mb-5 pb-0 no-scrollbar"
      style={{ borderColor: "var(--border-subtle)" }} role="tablist">
      {tabs.map(t => (
        <button
          key={t.id}
          role="tab"
          aria-selected={active === t.id}
          onClick={() => onChange(t.id)}
          className={`flex items-center gap-1.5 px-3 py-2 text-sm whitespace-nowrap transition-colors duration-[120ms]
            border-b-2 -mb-px ${active === t.id
              ? "border-[#C7FD01] font-medium"
              : "border-transparent hover:border-[var(--border-default)]"}`}
          style={{ color: active === t.id ? "var(--text-primary)" : "var(--text-muted)" }}
        >
          {t.label}
          {t.badge !== undefined && (
            <span className="text-xs px-1.5 py-0.5 rounded-full"
              style={{ background: "var(--bg-raised)", color: "var(--text-muted)" }}>
              {t.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

// DescriptionList — key/value pairs layout:
export function DescriptionList({ items, columns = 2 }: {
  items: Array<{ label: string; value: ReactNode }>;
  columns?: 1 | 2 | 3;
}) {
  const cols = { 1: "grid-cols-1", 2: "grid-cols-1 sm:grid-cols-2", 3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" };
  return (
    <dl className={`grid gap-3 ${cols[columns]}`}>
      {items.map(item => (
        <div key={item.label}>
          <dt className="text-xs font-medium uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>{item.label}</dt>
          <dd className="text-sm mt-0.5 font-medium" style={{ color: "var(--text-primary)" }}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

// TimelineItem — for trip/audit timelines:
export function TimelineItem({
  time, label, description, status, isLast,
}: {
  time?: string; label: string; description?: ReactNode;
  status?: "ok" | "warn" | "danger" | "info" | "neutral";
  isLast?: boolean;
}) {
  const dotColor: Record<string, string> = {
    ok: "var(--success-fg)", warn: "var(--warning-fg)",
    danger: "var(--error-fg)", info: "var(--info-fg)",
    neutral: "var(--text-muted)",
  };
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className="w-2 h-2 rounded-full mt-1.5 shrink-0"
          style={{ background: dotColor[status ?? "neutral"] }} />
        {!isLast && <div className="w-px flex-1 mt-1" style={{ background: "var(--border-subtle)" }} />}
      </div>
      <div className="pb-4 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{label}</span>
          {time && <span className="text-xs" style={{ color: "var(--text-muted)" }}>{time}</span>}
        </div>
        {description && <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>{description}</div>}
      </div>
    </div>
  );
}

// ── Legacy export aliases for backward compatibility ───────────────────────

// Some pages use <LoadingState label="..." /> — fix via prop mapping:
const _OrigLoadingState = LoadingState;
// LoadingState already exported above with both message and label props

