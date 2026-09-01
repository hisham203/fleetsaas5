"use client";

import { useRouter } from "next/navigation";

export default function TopNav({ role, extra }: { role: string; extra?: React.ReactNode }) {
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  return (
    <div className="bg-ink text-white px-6 py-3 flex items-center justify-between">
      <span className="font-medium">{role}</span>
      <div className="flex items-center gap-3">
        {extra}
        <button onClick={handleLogout} className="text-steel hover:text-white text-sm">
          Log out
        </button>
      </div>
    </div>
  );
}
