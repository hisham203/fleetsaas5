/**
 * milestoneJDesignSystem.test.ts — Milestone J: Design System & UX Standardization
 *
 * A. Design token foundation (globals.css)
 * B. Tailwind config — brand lime, no hardcoded primitives
 * C. AppShell — dark-first, theme toggle, mobile drawer, RTL
 * D. AdminShell — backward-compat wrapper
 * E. DS component exports — all required components present
 * F. Status badge — complete status mapping
 * G. Button system — primary = lime, no white-on-lime
 * H. Typography — Tajawal, no Inter
 * I. No fake features introduced
 * J. Business logic regression guards
 * K. No hardcoded light-only hex colors
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const globals = () => readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
const tailwind = () => readFileSync(join(process.cwd(), "tailwind.config.ts"), "utf8");
const appShell = () => readFileSync(join(process.cwd(), "components/AppShell.tsx"), "utf8");
const adminShell = () => readFileSync(join(process.cwd(), "components/AdminShell.tsx"), "utf8");
const ds = () => readFileSync(join(process.cwd(), "components/ds/index.tsx"), "utf8");
const layout = () => readFileSync(join(process.cwd(), "app/layout.tsx"), "utf8");

// ── A. Design token foundation ──────────────────────────────────────────────
describe("A. Design token foundation", () => {
  it("A1. globals.css defines dark-theme CSS variables", () => {
    const css = globals();
    expect(css).toContain("--bg-canvas:  #080C15");
    expect(css).toContain("--bg-surface: #0F172A");
    expect(css).toContain("--bg-raised:  #1E293B");
  });

  it("A2. globals.css defines light-theme CSS variables", () => {
    const css = globals();
    expect(css).toContain('[data-theme="light"]');
    expect(css).toContain("--bg-canvas:  #F1F5F9");
    expect(css).toContain("--bg-surface: #FFFFFF");
  });

  it("A3. Brand accent #C7FD01 is defined as interactive-primary", () => {
    const css = globals();
    expect(css).toContain("--brand:            #C7FD01");
    expect(css).toContain("--interactive-primary:       #C7FD01");
  });

  it("A4. Semantic text tokens exist", () => {
    const css = globals();
    expect(css).toContain("--text-primary");
    expect(css).toContain("--text-secondary");
    expect(css).toContain("--text-muted");
    expect(css).toContain("--text-on-brand");
  });

  it("A5. Semantic border tokens exist", () => {
    const css = globals();
    expect(css).toContain("--border-subtle");
    expect(css).toContain("--border-default");
    expect(css).toContain("--border-focus");
  });

  it("A6. Semantic status tokens exist (success/warning/error/info)", () => {
    const css = globals();
    expect(css).toContain("--success-fg");
    expect(css).toContain("--warning-fg");
    expect(css).toContain("--error-fg");
    expect(css).toContain("--info-fg");
  });

  it("A7. prefers-reduced-motion is honored", () => {
    const css = globals();
    expect(css).toContain("prefers-reduced-motion");
    expect(css).toContain("animation-duration: 0.01ms");
  });

  it("A8. Font is Tajawal, Inter font is not imported", () => {
    const css = globals();
    expect(css).toContain("Tajawal");
    // "Inter" must not appear as a Google Fonts import or font-family value:
    expect(css).not.toContain("family=Inter");
    expect(css).not.toContain("'Inter'");
    expect(css).not.toContain('"Inter"');
  });
});

// ── B. Tailwind config ──────────────────────────────────────────────────────
describe("B. Tailwind config — brand lime, semantic tokens", () => {
  it("B1. Brand lime #C7FD01 is the primary action color", () => {
    const tw = tailwind();
    expect(tw).toContain("#C7FD01");
  });

  it("B2. Legacy color tokens mapped to CSS variables (not hardcoded)", () => {
    const tw = tailwind();
    expect(tw).toContain('ink:       "var(--text-primary)"');
    expect(tw).toContain('steel:     "var(--text-muted)"');
    expect(tw).toContain('surface:   "var(--bg-surface)"');
  });

  it("B3. Aqua remapped to brand lime (not teal)", () => {
    const tw = tailwind();
    // aqua should be the brand interactive primary (lime), not original teal #0EA5B7:
    expect(tw).not.toContain('"aqua":      "#0EA5B7"');
    expect(tw).not.toContain('aqua:      "#0EA5B7"');
    expect(tw).toContain('aqua:      "var(--interactive-primary)"');
  });

  it("B4. Status colors use CSS variables", () => {
    const tw = tailwind();
    expect(tw).toContain('ok:        "var(--success-fg)"');
    expect(tw).toContain('danger:    "var(--error-fg)"');
  });

  it("B5. Tajawal is the primary sans font", () => {
    const tw = tailwind();
    expect(tw).toContain("Tajawal");
    expect(tw).not.toContain('"Inter"');
  });

  it("B6. Button height system defined (h-7/h-8/h-10)", () => {
    const tw = tailwind();
    expect(tw).toContain('7:  "1.75rem"');
    expect(tw).toContain('8:  "2rem"');
    expect(tw).toContain('10: "2.5rem"');
  });
});

// ── C. AppShell ─────────────────────────────────────────────────────────────
describe("C. AppShell — dark-first, theme, mobile, RTL", () => {
  it("C1. AppShell is dark-first (#080C15 sidebar)", () => {
    const src = appShell();
    expect(src).toContain("#080C15");
  });

  it("C2. Brand lime active state in navigation", () => {
    const src = appShell();
    expect(src).toContain("text-[#C7FD01]");
    expect(src).toContain("rgba(199,253,1,0.12)");
  });

  it("C3. Theme toggle present (dark/light switcher)", () => {
    const src = appShell();
    expect(src).toContain("useTheme");
    expect(src).toContain("localStorage");
    expect(src).toContain("smarty1-theme");
  });

  it("C4. Mobile drawer implemented (not just hidden sidebar)", () => {
    const src = appShell();
    expect(src).toContain("MobileDrawer");
    expect(src).toContain("hamburger");
    expect(src).toContain("inset-0");
  });

  it("C5. RTL-aware logical CSS properties used", () => {
    const src = appShell();
    // Should use logical properties not directional:
    expect(src).toMatch(/ms-auto|ps-|pe-|start-|end-/);
  });

  it("C6. No horizontal overflow (overflow-hidden on main wrapper)", () => {
    const src = appShell();
    expect(src).toContain("overflow-hidden");
  });

  it("C7. Notification bell integrated", () => {
    const src = appShell();
    expect(src).toContain("NotificationBell");
    expect(src).toContain("/api/notifications");
  });

  it("C8. domainId prop accepted for backward compat", () => {
    const src = appShell();
    expect(src).toContain("domainId");
  });
});

// ── D. AdminShell ────────────────────────────────────────────────────────────
describe("D. AdminShell backward-compat wrapper", () => {
  it("D1. AdminShell delegates to AppShell", () => {
    const src = adminShell();
    expect(src).toContain("import AppShell");
    expect(src).toContain("<AppShell");
  });

  it("D2. AdminShell accepts all legacy props", () => {
    const src = adminShell();
    expect(src).toContain("sections");
    expect(src).toContain("activeKey");
    expect(src).toContain("extra");
  });

  it("D3. AdminNavItem href is optional (backward compat)", () => {
    const src = adminShell();
    expect(src).toContain("href?: string");
  });
});

// ── E. DS component exports ──────────────────────────────────────────────────
describe("E. DS component exports", () => {
  const required = [
    "PageContainer", "PageHeader", "SectionHeader",
    "Btn", "StatusBadge", "MetricCard",
    "LoadingState", "EmptyState", "ErrorState", "FilterBar",
    "EntityHeader", "Tabs", "DescriptionList", "TimelineItem",
  ];

  for (const comp of required) {
    it(`E. exports ${comp}`, () => {
      const src = ds();
      expect(src).toContain(`export function ${comp}`);
    });
  }

  it("E. LoadingState accepts both message and label props", () => {
    const src = ds();
    expect(src).toContain("label?: string");
    expect(src).toContain("message?: string");
  });

  it("E. MetricCard accepts trendLabel as legacy alias for sub", () => {
    const src = ds();
    expect(src).toContain("trendLabel?: string");
  });
});

// ── F. Status badge ──────────────────────────────────────────────────────────
describe("F. Status badge complete coverage", () => {
  const statuses = [
    "PENDING","DISPATCHED","COMPLETED","FAILED","CANCELLED",
    "AVAILABLE","ON_TRIP","MAINTENANCE","OUT_OF_SERVICE",
    "APPROVED","REJECTED","ACTIVE","EXPIRED",
    "OPEN","ACKNOWLEDGED","RESOLVED",
    "HEALTHY","STALE","OFFLINE",
    "ON_TIME","AT_RISK","DELAYED","MOVING","IDLE",
  ];

  for (const s of statuses) {
    it(`F. StatusBadge has mapping for ${s}`, () => {
      expect(ds()).toContain(`${s}:`);
    });
  }

  it("F. StatusBadge uses CSS variable semantic tokens", () => {
    const src = ds();
    expect(src).toContain("var(--success-bg)");
    expect(src).toContain("var(--error-fg)");
    expect(src).not.toContain('"#16A34A"'); // no hardcoded ok green
    expect(src).not.toContain('"#DC2626"'); // no hardcoded danger red
  });
});

// ── G. Button system ─────────────────────────────────────────────────────────
describe("G. Button system", () => {
  it("G1. Primary button uses brand lime fill", () => {
    const src = ds();
    expect(src).toContain("var(--interactive-primary)");
    expect(src).toContain("var(--text-on-brand)");
  });

  it("G2. Primary button NEVER has white text on lime", () => {
    const src = ds();
    // text-white must NOT appear in the primary button definition:
    const primaryDef = src.split("primary:")[1]?.split(",")[0] ?? "";
    expect(primaryDef).not.toContain("text-white");
  });

  it("G3. All four required variants exist", () => {
    const src = ds();
    expect(src).toContain('primary:');
    expect(src).toContain('secondary:');
    expect(src).toContain('ghost:');
    expect(src).toContain('danger:');
  });

  it("G4. Btn has loading spinner support", () => {
    expect(ds()).toContain("loading?");
    expect(ds()).toContain("animate-spin");
  });
});

// ── H. Typography ────────────────────────────────────────────────────────────
describe("H. Typography", () => {
  it("H1. Tajawal imported in globals.css", () => {
    expect(globals()).toContain("family=Tajawal");
  });

  it("H2. JetBrains Mono imported", () => {
    expect(globals()).toContain("JetBrains+Mono");
  });

  it("H3. No Inter font in globals.css", () => {
    expect(globals()).not.toContain("Inter");
  });

  it("H4. layout.tsx uses Tajawal via font-sans class", () => {
    const src = layout();
    expect(src).toContain("font-sans");
  });

  it("H5. Theme flash prevention script in layout", () => {
    const src = layout();
    expect(src).toContain("smarty1-theme");
    expect(src).toContain("data-theme");
    expect(src).toContain("suppressHydrationWarning");
  });
});

// ── I. No fake features ──────────────────────────────────────────────────────
describe("I. No fake features introduced", () => {
  it("I1. No Smarty AI component created", () => {
    expect(existsSync(join(process.cwd(), "components/SmartAI.tsx"))).toBe(false);
    expect(existsSync(join(process.cwd(), "app/smarty-ai"))).toBe(false);
  });

  it("I2. No fake telemetry components", () => {
    expect(existsSync(join(process.cwd(), "components/FakeHardwareStatus.tsx"))).toBe(false);
  });

  it("I3. Navigation shows only implemented routes", () => {
    const src = readFileSync(join(process.cwd(), "lib/navigation.ts"), "utf8");
    // Should not have PlannedModulePlaceholder routes:
    expect(src).not.toContain("/smarty-ai");
    expect(src).not.toContain("/predictive-maintenance");
  });
});

// ── J. Business logic regression guards ──────────────────────────────────────
describe("J. Business logic unchanged", () => {
  it("J1. GPS ingestion pipeline intact", () => {
    const src = readFileSync(join(process.cwd(), "lib/gpsIngestion.ts"), "utf8");
    expect(src).toContain("validateGpsPing");
    expect(src).toContain("persistGpsPing");
    expect(src).toContain("processGpsGeofence");
  });

  it("J2. Trip dispatch route unchanged", () => {
    const src = readFileSync(join(process.cwd(), "app/api/trips/[id]/dispatch/route.ts"), "utf8");
    expect(src).toContain("DISPATCHED");
    expect(src).toContain("baselineEtaAt");
  });

  it("J3. SLA computation unchanged", () => {
    const src = readFileSync(join(process.cwd(), "lib/sla.ts"), "utf8");
    expect(src).toContain("computeSlaStatus");
  });

  it("J4. Expense EXP-001 workflow unchanged", () => {
    const src = readFileSync(join(process.cwd(), "app/api/expenses/route.ts"), "utf8");
    expect(src).toContain("CONFIGURE_NUMBERING");
  });

  it("J5. No DB migration in Milestone J (0029 still latest)", () => {
    const { readdirSync } = require("fs");
    const count = readdirSync(join(process.cwd(), "drizzle")).filter((f: string) => f.endsWith(".sql")).length;
    expect(count).toBe(30); // 0000–0029
  });
});

// ── K. No hardcoded light-only hex colors ────────────────────────────────────
describe("K. No hardcoded light-only hex colors in core components", () => {
  it("K1. globals.css uses CSS variables in component layer", () => {
    const css = globals();
    // Component layer should use var() not hardcoded:
    const componentLayer = css.split("@layer components")[1] ?? "";
    expect(componentLayer).toContain("var(--");
    // Should not have primitive light-only hex in component defs:
    expect(componentLayer).not.toContain("background-color: #FFFFFF");
  });

  it("K2. AppShell has no hardcoded light-mode backgrounds", () => {
    const src = appShell();
    expect(src).not.toContain('className="bg-white"');
    expect(src).not.toContain('className="bg-gray-');
  });

  it("K3. Design system uses var(--) for all colors", () => {
    const src = ds();
    // Primary structural colors should use CSS variables:
    expect(src).toContain("var(--bg-surface)");
    expect(src).toContain("var(--text-primary)");
    expect(src).toContain("var(--border-subtle)");
  });

  it("K4. Login page has no hardcoded hex", () => {
    const src = readFileSync(join(process.cwd(), "app/login/page.tsx"), "utf8");
    const hexMatches = src.match(/bg-\[#[0-9A-Fa-f]{3,6}\]/g) ?? [];
    // Only allowed: C7FD01 (brand lime) if used there
    const nonBrand = hexMatches.filter(h => !h.includes("C7FD01") && !h.includes("c7fd01"));
    expect(nonBrand).toHaveLength(0);
  });
});
