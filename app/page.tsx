"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const ROLE_DESTINATIONS: Record<string, string> = {
  ADMIN: "/admin",
  DISPATCHER: "/dispatch",
  DRIVER: "/driver",
  CUSTOMER: "/b2b",
};

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.role && ROLE_DESTINATIONS[data.role]) {
          router.replace(ROLE_DESTINATIONS[data.role]);
        } else {
          router.replace("/login");
        }
      })
      .catch(() => router.replace("/login"));
  }, [router]);

  return (
    <main className="min-h-screen bg-ink flex items-center justify-center">
      <p className="text-steel text-sm">Loading…</p>
    </main>
  );
}
