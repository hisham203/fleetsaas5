import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  // No darkMode class — we use data-theme="dark" on <html> via CSS variables
  theme: {
    extend: {
      colors: {
        // ── Legacy token names — now CSS-variable-backed for dark/light ──
        // These class names exist throughout 100s of pages.
        // Remapping them to CSS variables makes the whole app theme-aware
        // without touching every page file.
        ink:       "var(--text-primary)",
        steel:     "var(--text-muted)",
        paper:     "var(--bg-raised)",
        surface:   "var(--bg-surface)",
        aqua:      "var(--interactive-primary)",   // lime #C7FD01 in dark; same in light
        aquaDark:  "var(--interactive-primary-hover)",
        aquaLight: "var(--brand-subtle)",
        // bg-white → bg-[var(--bg-surface)] via token:
        // We extend 'white' to be theme-aware:
        white:     "var(--bg-surface)",

        // ── Brand ──────────────────────────────────────────────────────────
        brand:     "#C7FD01",
        "brand-hover":  "#B8ED00",
        "brand-subtle": "rgba(199,253,1,0.12)",

        // ── Semantic status — CSS-variable-backed ────────────────────────
        ok:        "var(--success-fg)",
        okLight:   "var(--success-bg)",
        warn:      "var(--warning-fg)",
        warnLight: "var(--warning-bg)",
        danger:    "var(--error-fg)",
        dangerLight:"var(--error-bg)",
        info:      "var(--info-fg)",
        infoLight: "var(--info-bg)",

        // ── Surfaces — CSS-variable-backed ───────────────────────────────
        canvas:  "var(--bg-canvas)",
        sidebar: "var(--sidebar-bg)",
        "sidebar-hover":  "var(--nav-item-hover)",
        "sidebar-active": "var(--nav-item-active)",

        // ── Slate extensions ──────────────────────────────────────────────
        slate: {
          850: "#1B2536",
          750: "#28374D",
          700: "#334155",
          // border-subtle mapping:
          100: "var(--border-subtle)",   // border-slate-100 → subtle border (theme-aware)
          200: "var(--border-default)",  // border-slate-200 → default border
          300: "var(--border-strong)",   // border-slate-300 → strong border
        },
      },

      fontFamily: {
        // Tajawal: supports Arabic + English, weights 400/500/700
        sans: ["Tajawal", "'Segoe UI'", "system-ui", "sans-serif"],
        mono: ["'JetBrains Mono'", "'Cascadia Code'", "'Fira Code'", "monospace"],
      },

      fontSize: {
        // Design system hierarchy
        "2xs":     ["0.688rem", { lineHeight: "1rem" }],      // 11px / caption
        "xs":      ["0.75rem",  { lineHeight: "1rem" }],      // 12px / label
        "sm":      ["0.8125rem",{ lineHeight: "1.25rem" }],   // 13px / body-sm
        "base":    ["0.875rem", { lineHeight: "1.25rem" }],   // 14px / body (app default)
        "body-lg": ["1rem",     { lineHeight: "1.5rem" }],    // 16px
        "h5":      ["1rem",     { lineHeight: "1.5rem"  }],   // 16/24
        "h4":      ["1.125rem", { lineHeight: "1.75rem" }],   // 18/28
        "h3":      ["1.375rem", { lineHeight: "1.75rem" }],   // 22/28
        "h2":      ["1.75rem",  { lineHeight: "2.25rem" }],   // 28/36
        "h1":      ["2.25rem",  { lineHeight: "2.75rem" }],   // 36/44
        "display": ["3rem",     { lineHeight: "3.25rem" }],   // 48/52 — empty states only
      },

      spacing: {
        // 4px grid — core values
        "0.5": "0.125rem",  // 2px
        "1":   "0.25rem",   // 4px
        "1.5": "0.375rem",  // 6px
        "2":   "0.5rem",    // 8px
        "2.5": "0.625rem",  // 10px
        "3":   "0.75rem",   // 12px
        "4":   "1rem",      // 16px
        "5":   "1.25rem",   // 20px
        "6":   "1.5rem",    // 24px
        "8":   "2rem",      // 32px
        "10":  "2.5rem",    // 40px
        "12":  "3rem",      // 48px
        "16":  "4rem",      // 64px
      },

      // Control heights: sm=28, md=32, lg=40
      height: {
        7:  "1.75rem",  // 28px — small control
        8:  "2rem",     // 32px — default control
        10: "2.5rem",   // 40px — large control
      },

      borderRadius: {
        "none":  "0",
        "sm":    "0.25rem",   // 4px — badges/chips
        DEFAULT: "0.375rem",  // 6px — buttons/inputs/nav
        "md":    "0.5rem",    // 8px — cards/dialogs
        "lg":    "0.75rem",   // 12px — large tiles
        "xl":    "1rem",
        "full":  "9999px",
      },

      boxShadow: {
        // Flat surfaces: border only (no shadow)
        "card":    "0 1px 2px rgba(0,0,0,0.4)",
        "card-md": "0 4px 6px rgba(0,0,0,0.4)",
        "card-lg": "0 10px 15px rgba(0,0,0,0.5)",
        "focus":   "0 0 0 3px rgba(199,253,1,0.25)",
        "none":    "none",
      },

      transitionDuration: {
        DEFAULT: "120ms",
        "200":   "200ms",
        "300":   "300ms",
      },

      transitionTimingFunction: {
        DEFAULT: "ease",
      },

      animation: {
        "fade-in": "fadeIn 120ms ease",
        "slide-in": "slideIn 160ms ease",
      },

      keyframes: {
        fadeIn:  { from: { opacity: "0" }, to: { opacity: "1" } },
        slideIn: { from: { transform: "translateY(-4px)", opacity: "0" }, to: { transform: "translateY(0)", opacity: "1" } },
      },
    },
  },
  plugins: [],
};

export default config;
