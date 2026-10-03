"use client";

/**
 * Smarty1 AppShell — Milestone J Design System
 *
 * Enterprise application shell with:
 * - Dark sidebar, brand lime (#C7FD01) active state
 * - Domain-based two-column navigation
 * - Theme switching (dark ↔ light)
 * - RTL/LTR support
 * - Mobile drawer (hamburger menu)
 * - Notification bell (from F+G)
 * - No horizontal overflow on any screen
 */

import { useState, useCallback, useEffect, useRef, ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { NAV_DOMAINS, type NavDomain, type NavModule } from "@/lib/navigation";

// ── Theme hook ─────────────────────────────────────────────────────────────
function useTheme() {
  const [theme, setThemeState] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const stored = (typeof localStorage !== "undefined" && localStorage.getItem("smarty1-theme")) as "dark" | "light" | null;
    const current = (document.documentElement.getAttribute("data-theme") as "dark" | "light") ?? "dark";
    setThemeState(stored ?? current);
  }, []);

  const setTheme = useCallback((t: "dark" | "light") => {
    document.documentElement.setAttribute("data-theme", t);
    localStorage.setItem("smarty1-theme", t);
    setThemeState(t);
  }, []);

  const toggle = useCallback(() => setTheme(theme === "dark" ? "light" : "dark"), [theme, setTheme]);
  return { theme, toggle };
}

// ── Icon primitive ────────────────────────────────────────────────────────
function Icon({ path, className = "w-4 h-4" }: { path: string; className?: string }) {
  return (
    <svg className={`${className} shrink-0`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d={path} />
    </svg>
  );
}

// ── Active route detection ─────────────────────────────────────────────────
function useIsActive(href: string): boolean {
  const pathname = usePathname();
  if (!href) return false;
  const base = href.split("?")[0];
  if (base === "/admin" && pathname === "/admin") return true;
  if (base === "/admin") return false;
  return pathname === href || pathname.startsWith(base + "/") || pathname.startsWith(base + "?");
}

function useCurrentDomain(): NavDomain | null {
  const pathname = usePathname();
  for (const domain of NAV_DOMAINS) {
    for (const group of domain.groups) {
      for (const mod of group.modules) {
        const base = mod.href.split("?")[0];
        if (pathname === mod.href || (base !== "/admin" && pathname.startsWith(base))) return domain;
      }
    }
  }
  for (const domain of [...NAV_DOMAINS].reverse()) {
    if (pathname.startsWith(domain.href.split("?")[0])) return domain;
  }
  return NAV_DOMAINS[0];
}

// ── Domain icon button (left rail) ────────────────────────────────────────
function DomainItem({ domain, isActive, onSelect }: {
  domain: NavDomain; isActive: boolean; onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      title={domain.label}
      aria-current={isActive ? "true" : undefined}
      className={`w-full flex flex-col items-center gap-1 py-2.5 px-1 transition-colors duration-[120ms] text-xs font-medium rounded-md ${
        isActive
          ? "text-[#C7FD01] bg-[rgba(199,253,1,0.12)]"
          : "text-slate-400 hover:text-slate-200 hover:bg-[rgba(255,255,255,0.05)]"
      }`}
    >
      <Icon path={domain.icon} className="w-5 h-5" />
      <span className="leading-tight text-center max-w-[52px] break-words">{domain.label}</span>
    </button>
  );
}

// ── Module nav item (right panel) ──────────────────────────────────────────
function ModuleItem({ mod, onNavigate }: { mod: NavModule; onNavigate?: () => void }) {
  const active = useIsActive(mod.href);
  const router = useRouter();
  return (
    <button
      onClick={() => { router.push(mod.href); onNavigate?.(); }}
      aria-current={active ? "page" : undefined}
      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors duration-[120ms] text-left ${
        active
          ? "bg-[rgba(199,253,1,0.12)] text-[#C7FD01] font-medium"
          : "text-slate-300 hover:bg-[rgba(255,255,255,0.05)] hover:text-white"
      }`}
    >
      <Icon path={mod.icon} className="w-4 h-4 shrink-0" />
      <span className="truncate min-w-0">{mod.label}</span>
      {mod.maturity === "PARTIAL" && (
        <span className="ms-auto text-xs bg-white/10 text-slate-400 px-1.5 py-0.5 rounded shrink-0">β</span>
      )}
    </button>
  );
}

// ── Notification bell ──────────────────────────────────────────────────────
function NotificationBell() {
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [notifs, setNotifs] = useState<any[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const fetchNotifs = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications?unread=false&limit=20");
      if (res.ok) { const d = await res.json(); setNotifs(d.notifications ?? []); setUnread(d.unreadCount ?? 0); }
    } catch {}
  }, []);

  useEffect(() => { fetchNotifs(); const id = setInterval(fetchNotifs, 60_000); return () => clearInterval(id); }, [fetchNotifs]);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
  }, [open]);

  async function markAll() {
    await fetch("/api/notifications", { method: "PATCH" }).catch(() => {});
    setNotifs(p => p.map(n => ({ ...n, read: true }))); setUnread(0);
  }
  async function markOne(id: string, route: string | null) {
    await fetch(`/api/notifications/${id}`, { method: "PATCH" }).catch(() => {});
    setNotifs(p => p.map(n => n.id === id ? { ...n, read: true } : n));
    setUnread(p => Math.max(0, p - 1));
    if (route) router.push(route); else setOpen(false);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        aria-label="Notifications"
        aria-expanded={open}
        className="relative p-2 rounded-md text-slate-400 hover:text-white hover:bg-white/5 transition-colors duration-[120ms]"
      >
        <Icon path="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" className="w-5 h-5" />
        {unread > 0 && (
          <span className="absolute top-1 end-1 min-w-[14px] h-3.5 bg-[#F87171] text-white text-[10px] font-bold rounded-full flex items-center justify-center px-0.5 leading-none">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute end-0 top-10 w-80 bg-[#1E293B] border border-white/10 rounded-lg shadow-[var(--shadow-lg,0_10px_30px_rgba(0,0,0,0.5))] z-50 max-h-[480px] flex flex-col animate-fade-in">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/10">
            <span className="text-sm font-semibold text-white">Notifications</span>
            <div className="flex gap-2">
              {unread > 0 && <button onClick={markAll} className="text-xs text-[#C7FD01] hover:underline">Mark all read</button>}
              <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-white text-lg leading-none">×</button>
            </div>
          </div>
          <div className="overflow-y-auto flex-1">
            {notifs.length === 0
              ? <p className="text-xs text-slate-400 text-center py-8">No notifications.</p>
              : notifs.map(n => (
                <button key={n.id} onClick={() => markOne(n.id, n.entityRoute)}
                  className={`w-full text-left px-4 py-3 border-b border-white/5 hover:bg-white/5 transition-colors ${!n.read ? "bg-[rgba(199,253,1,0.04)]" : ""}`}>
                  <div className="flex items-start gap-2">
                    <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${n.severity === "CRITICAL" ? "bg-[#F87171]" : n.severity === "WARNING" ? "bg-[#FBBF24]" : "bg-[#60A5FA]"}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-slate-200 leading-snug">{n.message}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{new Date(n.createdAt).toLocaleString()}</p>
                    </div>
                    {!n.read && <span className="w-1.5 h-1.5 bg-[#C7FD01] rounded-full shrink-0 mt-1" />}
                  </div>
                </button>
              ))}
          </div>
          <div className="px-4 py-2 border-t border-white/10">
            <a href="/telematics/alerts" className="text-xs text-[#C7FD01] hover:underline">View all alerts →</a>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Desktop sidebar ────────────────────────────────────────────────────────
function DesktopSidebar({ tenantName }: { tenantName?: string }) {
  const currentDomain = useCurrentDomain();
  const [activeDomain, setActiveDomain] = useState<NavDomain | null>(null);
  const effectiveDomain = activeDomain ?? currentDomain;

  return (
    <aside className="hidden md:flex shrink-0 h-screen sticky top-0 bg-[#080C15] border-e border-white/[0.06]" style={{ width: "var(--sidebar-width)" }}>
      {/* Domain rail — 64px wide */}
      <nav className="flex flex-col w-16 border-e border-white/[0.06] py-2 gap-0.5 overflow-y-auto shrink-0" aria-label="Domains">
        {/* Logo */}
        <div className="flex items-center justify-center h-10 mb-2 shrink-0">
          <span className="text-[#C7FD01] font-bold text-sm tracking-tight">S1</span>
        </div>
        {NAV_DOMAINS.map(d => (
          <DomainItem key={d.id} domain={d} isActive={effectiveDomain?.id === d.id} onSelect={() => setActiveDomain(d)} />
        ))}
      </nav>

      {/* Module panel — remaining width */}
      <div className="flex flex-col flex-1 overflow-hidden">
        {/* Tenant name */}
        <div className="px-3 py-3 border-b border-white/[0.06] shrink-0">
          <p className="text-xs font-semibold text-slate-300 truncate">{tenantName ?? "Smarty1"}</p>
          {effectiveDomain && <p className="text-xs text-slate-500 truncate">{effectiveDomain.label}</p>}
        </div>

        {/* Module list */}
        <div className="flex-1 overflow-y-auto py-1.5">
          {effectiveDomain?.groups.map(group => (
            <div key={group.id} className="mb-1">
              {group.label && <p className="px-3 pt-3 pb-1 text-xs font-semibold uppercase tracking-wider text-slate-600">{group.label}</p>}
              {group.modules.map(mod => (
                <ModuleItem key={mod.id} mod={mod} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}

// ── Mobile drawer ──────────────────────────────────────────────────────────
function MobileDrawer({ open, onClose, tenantName }: { open: boolean; onClose: () => void; tenantName?: string }) {
  const currentDomain = useCurrentDomain();

  useEffect(() => {
    if (open) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Drawer panel */}
      <div className="absolute inset-y-0 start-0 w-72 max-w-[85vw] bg-[#080C15] border-e border-white/[0.06] flex flex-col animate-slide-in overflow-y-auto">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06] shrink-0">
          <span className="text-[#C7FD01] font-bold">S1 — {tenantName ?? "Smarty1"}</span>
          <button onClick={onClose} aria-label="Close navigation"
            className="p-2 text-slate-400 hover:text-white rounded-md hover:bg-white/5">
            <Icon path="M6 18L18 6M6 6l12 12" className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 py-2">
          {NAV_DOMAINS.map(domain => (
            <div key={domain.id} className="mb-2">
              <p className="px-4 py-2 text-xs font-bold uppercase tracking-wider text-slate-600 flex items-center gap-2">
                <Icon path={domain.icon} className="w-3.5 h-3.5" />
                {domain.label}
              </p>
              {domain.groups.map(group => (
                <div key={group.id}>
                  {group.label && <p className="px-4 pb-1 text-xs text-slate-600">{group.label}</p>}
                  {group.modules.map(mod => (
                    <ModuleItem key={mod.id} mod={mod} onNavigate={onClose} />
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Top bar ────────────────────────────────────────────────────────────────
function TopBar({
  title, tenantName, onMenuClick, themeToggle,
}: { title: string; tenantName?: string; onMenuClick: () => void; themeToggle: ReactNode }) {
  return (
    <header
      className="shrink-0 flex items-center justify-between px-4 bg-[#0B1220] border-b border-white/[0.06]"
      style={{ height: "var(--topbar-height)" }}
    >
      {/* Left: hamburger (mobile) + page title */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          onClick={onMenuClick}
          aria-label="Open navigation"
          className="md:hidden p-2 text-slate-400 hover:text-white hover:bg-white/5 rounded-md shrink-0"
        >
          <Icon path="M3 12h18M3 6h18M3 18h18" className="w-5 h-5" />
        </button>
        <h1 className="text-sm font-semibold text-white truncate">{title}</h1>
      </div>

      {/* Right: actions */}
      <div className="flex items-center gap-1 shrink-0">
        {themeToggle}
        <NotificationBell />
      </div>
    </header>
  );
}

// ── Theme toggle button ────────────────────────────────────────────────────
function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      onClick={toggle}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
      title={`Theme: ${theme}`}
      className="p-2 rounded-md text-slate-400 hover:text-white hover:bg-white/5 transition-colors duration-[120ms]"
    >
      {theme === "dark"
        ? <Icon path="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" className="w-5 h-5" />
        : <Icon path="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" className="w-5 h-5" />
      }
    </button>
  );
}

// ── Main AppShell export ───────────────────────────────────────────────────

export interface AppShellProps {
  title: string;
  tenantName?: string;
  children: ReactNode;
  domainId?: string;  // legacy prop — accepted but unused (nav is domain-auto-detected)
}

export default function AppShell({ title, tenantName, children, domainId: _domainId }: AppShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--bg-canvas)]">
      {/* Desktop sidebar */}
      <DesktopSidebar tenantName={tenantName} />

      {/* Mobile drawer */}
      <MobileDrawer open={mobileOpen} onClose={() => setMobileOpen(false)} tenantName={tenantName} />

      {/* Main content area */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <TopBar
          title={title}
          tenantName={tenantName}
          onMenuClick={() => setMobileOpen(true)}
          themeToggle={<ThemeToggle />}
        />
        <main className="flex-1 overflow-y-auto overflow-x-hidden bg-[var(--bg-canvas)]">
          {children}
        </main>
      </div>
    </div>
  );
}
