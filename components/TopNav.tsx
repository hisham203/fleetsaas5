"use client";

import { useRouter } from "next/navigation";

export default function TopNav({ role, extra }: { role: string; extra?: React.ReactNode }) {
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  return (
    <div className="bg-sidebar text-white px-4 flex items-center justify-between border-b border-white/5" style={{ height: "var(--topbar-height, 52px)" }}>
      <div className="flex items-center gap-2.5">
        <div className="w-6 h-6 rounded-md bg-aqua/20 flex items-center justify-center">
          <svg className="w-3.5 h-3.5 text-aqua" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
          </svg>
        </div>
        <span className="text-sm font-semibold text-white">Smarty1</span>
        {role && <span className="text-slate-500 text-xs">/ {role}</span>}
      </div>
      <div className="flex items-center gap-3">
        {extra}
        <button onClick={handleLogout} className="flex items-center gap-1.5 text-slate-400 hover:text-white text-sm transition-colors">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          Sign out
        </button>
      </div>
    </div>
  );
}
