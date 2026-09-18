import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Smarty1 — Fleet & Delivery Operations",
  description: "Enterprise Fleet, Logistics & Delivery Operations Platform",
  manifest: "/manifest.json",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
  
      </head>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
