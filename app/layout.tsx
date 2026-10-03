import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Smarty1 — Fleet Operations Platform",
  description: "Fleet Operations, Logistics Execution & Telematics Intelligence Platform",
  manifest: "/manifest.json",
};

// Theme script: sets data-theme BEFORE first paint to avoid flash.
// Dark is the default; respects localStorage preference.
const THEME_SCRIPT = `
(function(){
  try {
    var stored = localStorage.getItem('smarty1-theme');
    var theme = stored === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', theme);
  } catch(e) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        {/* Theme initialization — must run before render to prevent flash */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="font-sans antialiased bg-[var(--bg-canvas)] text-[var(--text-primary)]">
        {children}
      </body>
    </html>
  );
}
