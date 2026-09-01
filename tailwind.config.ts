import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0B1220",       // primary background / headers
        slate: {
          850: "#1B2536",
          750: "#28374D",
        },
        steel: "#425466",     // secondary text / borders
        aqua: "#0EA5B7",      // primary brand accent (water)
        aquaDark: "#0B7F8E",
        ok: "#16A34A",        // delivered / success
        warn: "#D97706",      // pending / at-risk SLA
        danger: "#DC2626",    // failed / critical
        paper: "#F6F8FA",     // page background
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
    },
  },
  plugins: [],
};
export default config;
