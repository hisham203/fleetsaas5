"use client";
/**
 * DateRangePicker — shared analytics period selector.
 * Provides preset periods and custom range.
 */
import { useState } from "react";

export type Preset = "today" | "yesterday" | "last7" | "last30" | "thisMonth" | "prevMonth" | "custom";

interface Props {
  value: { from: string; to: string };
  onChange: (range: { from: string; to: string; preset: Preset }) => void;
  className?: string;
}

function isoDate(d: Date) { return d.toISOString().slice(0, 10); }

function presetRange(preset: Preset): { from: string; to: string } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (preset) {
    case "today":
      return { from: isoDate(today), to: isoDate(new Date(today.getTime() + 86400000 - 1)) };
    case "yesterday": {
      const y = new Date(today.getTime() - 86400000);
      return { from: isoDate(y), to: isoDate(new Date(today.getTime() - 1)) };
    }
    case "last7": {
      return { from: isoDate(new Date(today.getTime() - 6 * 86400000)), to: isoDate(now) };
    }
    case "last30": {
      return { from: isoDate(new Date(today.getTime() - 29 * 86400000)), to: isoDate(now) };
    }
    case "thisMonth": {
      const from = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: isoDate(from), to: isoDate(now) };
    }
    case "prevMonth": {
      const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const to   = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: isoDate(from), to: isoDate(to) };
    }
    default:
      return { from: isoDate(new Date(today.getTime() - 29 * 86400000)), to: isoDate(now) };
  }
}

const PRESETS: { id: Preset; label: string }[] = [
  { id: "today",     label: "Today"        },
  { id: "yesterday", label: "Yesterday"    },
  { id: "last7",     label: "Last 7 days"  },
  { id: "last30",    label: "Last 30 days" },
  { id: "thisMonth", label: "This month"   },
  { id: "prevMonth", label: "Prev month"   },
  { id: "custom",    label: "Custom"       },
];

export default function DateRangePicker({ value, onChange, className = "" }: Props) {
  const [showCustom, setShowCustom] = useState(false);
  const [customFrom, setCustomFrom] = useState(value.from);
  const [customTo,   setCustomTo  ] = useState(value.to);

  function selectPreset(p: Preset) {
    if (p === "custom") { setShowCustom(true); return; }
    setShowCustom(false);
    onChange({ ...presetRange(p), preset: p });
  }

  function applyCustom() {
    if (!customFrom || !customTo || customFrom > customTo) return;
    onChange({ from: customFrom, to: customTo, preset: "custom" });
    setShowCustom(false);
  }

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {PRESETS.map(p => (
        <button key={p.id} onClick={() => selectPreset(p.id)}
          className="text-xs px-3 py-1.5 rounded-[var(--radius-btn)] border transition-colors duration-[120ms]" style={{ background: "var(--bg-raised)", color: "var(--text-muted)", borderColor: "var(--border-default)" }} onMouseEnter={e=>{(e.target as HTMLElement).style.color="var(--text-primary)"}} onMouseLeave={e=>{(e.target as HTMLElement).style.color="var(--text-muted)"}}>
          {p.label}
        </button>
      ))}
      {showCustom && (
        <div className="flex items-center gap-1.5">
          <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
            className="form-input text-xs py-1.5" style={{ width: "auto" }} />
          <span className="text-xs text-steel">→</span>
          <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
            className="form-input text-xs py-1.5" style={{ width: "auto" }} />
          <button onClick={applyCustom}
            className="btn-primary btn-sm text-xs">
            Apply
          </button>
        </div>
      )}
      <span className="text-2xs text-steel ms-1">
        {value.from} → {value.to}
      </span>
    </div>
  );
}

export { presetRange, isoDate };
