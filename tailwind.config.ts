import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Core neutrals
        ink:    "#0B1220",
        slate: {
          850: "#1B2536",
          750: "#28374D",
          700: "#334155",
        },
        steel:  "#64748B",
        // Brand accent — water/aqua
        aqua:     "#0EA5B7",
        aquaDark: "#0B7F8E",
        aquaLight:"#E0F7FA",
        // Surface
        paper:    "#F1F5F9",
        surface:  "#FFFFFF",
        // Semantic
        ok:      "#16A34A",
        okLight: "#DCFCE7",
        warn:    "#D97706",
        warnLight:"#FEF3C7",
        danger:  "#DC2626",
        dangerLight:"#FEE2E2",
        info:    "#3B82F6",
        infoLight:"#DBEAFE",
        // Sidebar
        sidebar: "#0F1929",
        "sidebar-hover": "#1A2B40",
        "sidebar-active":"#1E3347",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      fontSize: {
        "2xs": ["0.65rem", { lineHeight: "1rem" }],
      },
      boxShadow: {
        card:   "0 1px 3px 0 rgb(0 0 0 / 0.07), 0 1px 2px -1px rgb(0 0 0 / 0.07)",
        "card-md": "0 4px 6px -1px rgb(0 0 0 / 0.07), 0 2px 4px -2px rgb(0 0 0 / 0.07)",
        "card-lg": "0 10px 15px -3px rgb(0 0 0 / 0.08), 0 4px 6px -4px rgb(0 0 0 / 0.04)",
      },
      borderRadius: {
        sm:  "0.375rem",
        DEFAULT: "0.5rem",
        md:  "0.625rem",
        lg:  "0.75rem",
        xl:  "1rem",
      },
      transitionDuration: {
        DEFAULT: "150ms",
      },
    },
  },
  plugins: [],
};
export default config;
