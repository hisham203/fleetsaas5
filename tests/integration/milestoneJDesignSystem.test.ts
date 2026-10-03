/**
 * milestoneJDesignSystem.test.ts — Milestone J: Design System & UX Standardization
 *
 * A. Design token foundation (globals.css / tailwind.config.ts)
 * B. Theme system (dark/light, flash prevention, dir persistence)
 * C. AppShell (dark-first, mobile drawer, RTL toggle)
 * D. AdminShell (backward-compat wrapper)
 * E. DS component exports (all required components present)
 * F. Status badge (complete semantic mapping)
 * G. Button system (primary = lime, not white-on-lime)
 * H. Typography (Tajawal, not Inter)
 * I. RTL — zero directional CSS classes in app/ and components/
 * J. Entity360 — DS component adoption
 * K. No fake features
 * L. No hardcoded light-only primitive colors in core components
 * M. Business logic regression guards
 * N. No DB migration
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join } from "path";

const file = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

function globTsx(dir: string): string[] {
  const results: string[] = [];
  function walk(d: string) {
    try {
      for (const entry of readdirSync(d)) {
        const full = `${d}/${entry}`;
        if (statSync(full).isDirectory()) walk(full);
        else if (full.endsWith(".tsx")) results.push(full);
      }
    } catch {}
  }
  walk(join(process.cwd(), dir));
  return results;
}

// ── A. Design token foundation ──────────────────────────────────────────────
describe("A. Design token foundation", () => {
  it("A1. globals.css has dark theme CSS variables (bg-canvas: #080C15)", () => {
    expect(file("app/globals.css")).toContain("--bg-canvas:  #080C15");
  });
  it("A2. globals.css has light theme ([data-theme=light])", () => {
    const css = file("app/globals.css");
    expect(css).toContain('[data-theme="light"]');
    expect(css).toContain("--bg-canvas:  #F1F5F9");
  });
  it("A3. Brand #C7FD01 is the interactive primary token", () => {
    expect(file("app/globals.css")).toContain("--brand:            #C7FD01");
    expect(file("app/globals.css")).toContain("--interactive-primary:       #C7FD01");
  });
  it("A4. Semantic text tokens defined", () => {
    const css = file("app/globals.css");
    expect(css).toContain("--text-primary");
    expect(css).toContain("--text-muted");
    expect(css).toContain("--text-on-brand");
  });
  it("A5. prefers-reduced-motion honored", () => {
    expect(file("app/globals.css")).toContain("prefers-reduced-motion");
  });
  it("A6. tailwind.config maps legacy token 'ink' to CSS variable", () => {
    expect(file("tailwind.config.ts")).toContain('ink:       "var(--text-primary)"');
  });
  it("A7. tailwind.config maps 'aqua' to brand lime (not teal)", () => {
    const tw = file("tailwind.config.ts");
    expect(tw).not.toContain('"aqua":      "#0EA5B7"');
    expect(tw).toContain('aqua:      "var(--interactive-primary)"');
  });
  it("A8. tailwind.config maps status colors to CSS variables", () => {
    const tw = file("tailwind.config.ts");
    expect(tw).toContain('ok:        "var(--success-fg)"');
    expect(tw).toContain('danger:    "var(--error-fg)"');
  });
});

// ── B. Theme system ──────────────────────────────────────────────────────────
describe("B. Theme + dir persistence", () => {
  it("B1. layout.tsx sets data-theme=dark on html", () => {
    expect(file("app/layout.tsx")).toContain('data-theme="dark"');
  });
  it("B2. Inline script reads smarty1-theme before first paint", () => {
    expect(file("app/layout.tsx")).toContain("smarty1-theme");
  });
  it("B3. suppressHydrationWarning on html element", () => {
    expect(file("app/layout.tsx")).toContain("suppressHydrationWarning");
  });
  it("B4. dir=ltr default on html element", () => {
    expect(file("app/layout.tsx")).toContain('dir="ltr"');
  });
  it("B5. Inline script reads smarty1-dir from localStorage", () => {
    expect(file("app/layout.tsx")).toContain("smarty1-dir");
  });
});

// ── C. AppShell ──────────────────────────────────────────────────────────────
describe("C. AppShell", () => {
  it("C1. Dark sidebar (#080C15)", () => {
    expect(file("components/AppShell.tsx")).toContain("#080C15");
  });
  it("C2. Brand lime active state", () => {
    expect(file("components/AppShell.tsx")).toContain("rgba(199,253,1,0.12)");
  });
  it("C3. Theme toggle (useTheme + localStorage)", () => {
    const src = file("components/AppShell.tsx");
    expect(src).toContain("useTheme");
    expect(src).toContain("smarty1-theme");
  });
  it("C4. Mobile drawer (hamburger trigger, backdrop)", () => {
    const src = file("components/AppShell.tsx");
    expect(src).toContain("MobileDrawer");
    expect(src).toContain("inset-0");
  });
  it("C5. RTL toggle (useDir + AR/EN button)", () => {
    const src = file("components/AppShell.tsx");
    expect(src).toContain("useDir");
    expect(src).toContain("smarty1-dir");
    expect(src).toContain('"ar"');
  });
  it("C6. overflow-x-hidden on main content (no page scroll)", () => {
    expect(file("components/AppShell.tsx")).toContain("overflow-x-hidden");
  });
  it("C7. Logical CSS properties (RTL-safe)", () => {
    expect(file("components/AppShell.tsx")).toMatch(/ms-auto|ps-\d|pe-\d|start-|end-/);
  });
});

// ── D. AdminShell ────────────────────────────────────────────────────────────
describe("D. AdminShell", () => {
  it("D1. AdminShell delegates to AppShell", () => {
    expect(file("components/AdminShell.tsx")).toContain("import AppShell");
  });
  it("D2. Legacy props still accepted", () => {
    const src = file("components/AdminShell.tsx");
    expect(src).toContain("sections");
    expect(src).toContain("activeKey");
  });
});

// ── E. DS component exports ──────────────────────────────────────────────────
describe("E. DS component exports", () => {
  const required = [
    "PageContainer", "PageHeader", "Btn", "StatusBadge", "MetricCard",
    "LoadingState", "EmptyState", "ErrorState", "FilterBar",
    "EntityHeader", "Tabs", "DescriptionList", "TimelineItem",
  ];
  for (const name of required) {
    it(`E. exports ${name}`, () => {
      expect(file("components/ds/index.tsx")).toContain(`export function ${name}`);
    });
  }
  it("E. LoadingState accepts both message and label", () => {
    expect(file("components/ds/index.tsx")).toContain("label?: string");
    expect(file("components/ds/index.tsx")).toContain("message?: string");
  });
  it("E. Tabs has overflow-x-auto for mobile", () => {
    expect(file("components/ds/index.tsx")).toContain("overflow-x-auto");
  });
});

// ── F. Status badge ──────────────────────────────────────────────────────────
describe("F. StatusBadge semantic tokens", () => {
  it("F1. Uses success/warning/error/info CSS variables", () => {
    const src = file("components/ds/index.tsx");
    expect(src).toContain("var(--success-bg)");
    expect(src).toContain("var(--error-fg)");
    expect(src).toContain("var(--warning-bg)");
  });
  it("F2. No hardcoded hex in STATUS_PALETTE", () => {
    const src = file("components/ds/index.tsx");
    const palette = src.split("STATUS_PALETTE")[1]?.split("};")[0] ?? "";
    expect(palette).not.toMatch(/#[0-9A-Fa-f]{6}/);
  });
  const statuses = ["PENDING","COMPLETED","FAILED","AVAILABLE","ON_TRIP","APPROVED","ACTIVE","OFFLINE"];
  for (const s of statuses) {
    it(`F3. StatusBadge maps ${s}`, () => {
      expect(file("components/ds/index.tsx")).toContain(`${s}:`);
    });
  }
});

// ── G. Button system ─────────────────────────────────────────────────────────
describe("G. Button system", () => {
  it("G1. Primary uses brand lime fill", () => {
    expect(file("components/ds/index.tsx")).toContain("var(--interactive-primary)");
    expect(file("components/ds/index.tsx")).toContain("var(--text-on-brand)");
  });
  it("G2. Primary never has text-white (white on lime forbidden)", () => {
    const BTN_VARIANT = file("components/ds/index.tsx")
      .split("BTN_VARIANT")[1]?.split("};")[0] ?? "";
    const primaryLine = BTN_VARIANT.split("primary:")[1]?.split(",")[0] ?? "";
    expect(primaryLine).not.toContain("text-white");
  });
});

// ── H. Typography ────────────────────────────────────────────────────────────
describe("H. Typography", () => {
  it("H1. Tajawal imported", () => {
    expect(file("app/globals.css")).toContain("Tajawal");
  });
  it("H2. Inter NOT imported (replaced by Tajawal)", () => {
    const css = file("app/globals.css");
    expect(css).not.toContain("family=Inter");
    expect(css).not.toContain("'Inter'");
  });
  it("H3. JetBrains Mono imported for code identifiers", () => {
    expect(file("app/globals.css")).toContain("JetBrains");
  });
});

// ── I. RTL — zero directional classes ───────────────────────────────────────
describe("I. RTL — zero directional CSS classes", () => {
  it("I1. No ml- in app/ (replaced with ms-)", () => {
    for (const f of globTsx("app")) {
      const s = readFileSync(f, "utf8");
      if (/[" ]ml-/.test(s)) throw new Error(`${f} still has ml-`);
    }
  });
  it("I2. No text-left in app/ (replaced with text-start)", () => {
    for (const f of globTsx("app")) {
      const s = readFileSync(f, "utf8");
      if (/[" ]text-left\b/.test(s)) throw new Error(`${f} still has text-left`);
    }
  });
  it("I3. No text-right in app/ (replaced with text-end)", () => {
    for (const f of globTsx("app")) {
      const s = readFileSync(f, "utf8");
      if (/[" ]text-right\b/.test(s)) throw new Error(`${f} still has text-right`);
    }
  });
  it("I4. No border-l in app/ (replaced with border-s)", () => {
    for (const f of globTsx("app")) {
      const s = readFileSync(f, "utf8");
      if (/[" ]border-l[-\s]/.test(s)) throw new Error(`${f} still has border-l`);
    }
  });
  it("I5. AppShell uses logical CSS", () => {
    expect(file("components/AppShell.tsx")).not.toContain(' ml-');
    expect(file("components/AppShell.tsx")).not.toContain(' text-left');
  });
});

// ── J. Entity360 DS adoption ─────────────────────────────────────────────────
describe("J. Entity360 DS component adoption", () => {
  it("J1. Trip360 renders EntityHeader", () => {
    expect(file("app/operations/trips/[id]/page.tsx")).toContain("<EntityHeader");
  });
  it("J2. Trip360 renders Tabs (mobile-safe)", () => {
    expect(file("app/operations/trips/[id]/page.tsx")).toContain("<Tabs");
  });
  it("J3. Trip360 renders DescriptionList", () => {
    expect(file("app/operations/trips/[id]/page.tsx")).toContain("<DescriptionList");
  });
  it("J4. Trip360 renders TimelineItem", () => {
    expect(file("app/operations/trips/[id]/page.tsx")).toContain("<TimelineItem");
  });
  it("J5. Vehicle360 renders EntityHeader", () => {
    expect(file("app/fleet/vehicles/[id]/page.tsx")).toContain("<EntityHeader");
  });
  it("J6. Vehicle360 renders Tabs", () => {
    expect(file("app/fleet/vehicles/[id]/page.tsx")).toContain("<Tabs");
  });
  it("J7. Driver360 renders EntityHeader", () => {
    expect(file("app/fleet/drivers/[id]/page.tsx")).toContain("<EntityHeader");
  });
  it("J8. Driver360 renders Tabs", () => {
    expect(file("app/fleet/drivers/[id]/page.tsx")).toContain("<Tabs");
  });
});

// ── K. No fake features ───────────────────────────────────────────────────────
describe("K. No fake features", () => {
  it("K1. No Smarty AI component or route", () => {
    expect(existsSync(join(process.cwd(), "app/smarty-ai"))).toBe(false);
  });
  it("K2. Navigation has no unimplemented placeholder routes", () => {
    expect(file("lib/navigation.ts")).not.toContain("/smarty-ai");
  });
});

// ── L. No hardcoded primitive colors in core components ────────────────────
describe("L. No hardcoded primitive colors in core DS", () => {
  it("L1. globals.css component layer uses CSS variables", () => {
    const after = file("app/globals.css").split("@layer components")[1] ?? "";
    expect(after).toContain("var(--");
    expect(after).not.toContain("background-color: #FFFFFF");
  });
  it("L2. AppShell has no hardcoded bg-white or bg-gray", () => {
    expect(file("components/AppShell.tsx")).not.toContain('className="bg-white"');
    expect(file("components/AppShell.tsx")).not.toContain('bg-gray-');
  });
  it("L3. DS components use CSS variable tokens", () => {
    const src = file("components/ds/index.tsx");
    expect(src).toContain("var(--bg-surface)");
    expect(src).toContain("var(--text-primary)");
  });
});

// ── M. Business logic regression ─────────────────────────────────────────────
describe("M. Business logic unchanged", () => {
  it("M1. GPS ingestion pipeline intact", () => {
    const src = file("lib/gpsIngestion.ts");
    expect(src).toContain("validateGpsPing");
    expect(src).toContain("processGpsGeofence");
  });
  it("M2. Dispatch route sets baselineEtaAt", () => {
    expect(file("app/api/trips/[id]/dispatch/route.ts")).toContain("baselineEtaAt");
  });
  it("M3. SLA computation unchanged", () => {
    expect(file("lib/sla.ts")).toContain("computeSlaStatus");
  });
  it("M4. executiveDashboard uses ORIGINAL in-memory pattern (not K bounded queries)", () => {
    const src = file("lib/executiveDashboard.ts");
    // J branch has original in-memory period filter:
    expect(src).toContain("inPeriod");
    // K's signature used gte/lte WHERE clauses pushed to PostgreSQL — J must NOT have these:
    expect(src).not.toContain("gte(orders.createdAt");
    expect(src).not.toContain("lte(trips.createdAt");
  });
  it("M5. scorecards has NO ScorecardPeriod type (that is K scope)", () => {
    expect(file("lib/scorecards.ts")).not.toContain("ScorecardPeriod");
  });
});

// ── N. No DB migration ────────────────────────────────────────────────────────
describe("N. No DB migration", () => {
  it("N1. Migration count still 30 (0000–0029)", () => {
    const count = readdirSync(join(process.cwd(), "drizzle"))
      .filter(f => f.endsWith(".sql")).length;
    expect(count).toBe(30);
  });
});
