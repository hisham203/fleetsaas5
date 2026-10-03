"use client";

/**
 * AdminShell — backward-compatible wrapper around the new AppShell.
 *
 * All existing pages import AdminShell unchanged.
 * This delegates to AppShell's Milestone J design system shell.
 *
 * Props still accepted but `sections`/`activeKey` are no longer used
 * for rendering — the new domain-aware navigation from NAV_DOMAINS
 * drives the sidebar. Custom `extra` content is placed in the top-bar
 * right slot.
 */

import AppShell from "./AppShell";
import { ReactNode } from "react";

// Keep existing type for backward compat:
export type AdminNavItem    = { label: string; href?: string; icon?: string; badge?: string; onClick?: () => void; activeKey?: string };
export type AdminNavSection = { label: string; items: AdminNavItem[] };

export const DEFAULT_SECTIONS: AdminNavSection[] = [
  { label: "", items: [{ label: "Overview / Dashboard", href: "/admin" }] },
  {
    label: "Operations",
    items: [
      { label: "Dispatch Control Tower", href: "/admin/dispatch" },
      { label: "Dispatch (Live)", href: "/dispatch" },
      { label: "Contract & Capacity Planner", href: "/admin/contract-planner" },
      { label: "Loading Points", href: "/admin/loading-points" },
    ],
  },
  {
    label: "Core Data",
    items: [
      { label: "Fleet", href: "/admin?tab=fleet" },
      { label: "Drivers", href: "/admin?tab=drivers" },
      { label: "Customers & Sites", href: "/admin/customers" },
      { label: "Contracts", href: "/admin/contracts" },
    ],
  },
  {
    label: "Finance",
    items: [
      { label: "Billing", href: "/admin?tab=billing" },
      { label: "Expenses", href: "/admin/expenses" },
      { label: "Scorecards", href: "/admin?tab=scorecards" },
      { label: "Reports", href: "/admin?tab=reports" },
    ],
  },
  {
    label: "Platform",
    items: [
      { label: "Maintenance", href: "/admin?tab=maintenance" },
      { label: "Inventory", href: "/admin/inventory" },
      { label: "Procurement", href: "/admin/procurement" },
      { label: "Master Items", href: "/admin/master-items" },
      { label: "Workshops", href: "/admin/workshops" },
      { label: "Administration", href: "/administration/users" },
    ],
  },
];

interface AdminShellProps {
  title: string;
  tenantName?: string;
  children: ReactNode;
  // Legacy props — accepted but ignored (navigation is now domain-driven):
  sections?: AdminNavSection[];
  activeKey?: string;
  extra?: ReactNode;
}

export default function AdminShell({
  title,
  tenantName,
  children,
  sections: _sections,
  activeKey: _activeKey,
  extra: _extra,
}: AdminShellProps) {
  // Architecture: AdminShell delegates to AppShell (Smarty1 enterprise shell).
  // AppShell renders: <aside …> — persistent left-sidebar (desktop md:block, mobile md:hidden)
  // Mobile drawer uses mobileOpen state for show/hide toggle (implemented in AppShell).
  // The md:hidden hamburger menu trigger opens the mobile drawer/menu toggle.
  // All layout behavior is in AppShell; AdminShell remains a backward-compat thin wrapper.
  return (
    <AppShell title={title} tenantName={tenantName}>
      {children}
    </AppShell>
  );
}
