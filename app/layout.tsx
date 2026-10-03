import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Smarty1 — Fleet Operations Platform",
  description: "Fleet Operations, Logistics Execution & Telematics Intelligence Platform",
  manifest: "/manifest.json",
};

// Theme + dir initialization: runs before first paint via inline script.
// Dark is the platform default; respects localStorage preference.
const THEME_SCRIPT = `
(function(){
  try {
    var theme = localStorage.getItem('smarty1-theme');
    document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark');
    var dir = localStorage.getItem('smarty1-dir');
    if (dir === 'rtl') document.documentElement.setAttribute('dir', 'rtl');
  } catch(e) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="font-sans antialiased bg-[var(--bg-canvas)] text-[var(--text-primary)]">
        {children}
      </body>
    </html>
  );
}
