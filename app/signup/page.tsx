"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function SignupPage() {
  const router = useRouter();
  const [companyName, setCompanyName] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [password, setPassword] = useState("");
  const [warehouseName, setWarehouseName] = useState("Main Warehouse");
  const [warehouseAddress, setWarehouseAddress] = useState("");
  const [warehouseLat, setWarehouseLat] = useState<number | "">("");
  const [warehouseLng, setWarehouseLng] = useState<number | "">("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyName,
        adminName,
        adminEmail,
        password,
        warehouseName,
        warehouseAddress,
        warehouseLat,
        warehouseLng,
      }),
    });
    const data = await res.json();
    setSubmitting(false);
    if (!res.ok) {
      setError(data.error ?? "Signup failed");
      return;
    }
    router.push("/admin");
  }

  const valid =
    companyName && adminName && adminEmail && password.length >= 6 && warehouseName && warehouseAddress && warehouseLat !== "" && warehouseLng !== "";

  return (
    <main className="min-h-screen bg-ink flex items-center justify-center px-6 py-10">
      <div className="max-w-md w-full">
        <p className="text-aqua text-sm font-mono tracking-widest uppercase mb-2">Fleet Ops</p>
        <h1 className="text-2xl font-semibold text-white mb-1">Set up your company</h1>
        <p className="text-steel text-sm mb-6">
          Every company gets its own fully isolated fleet, customers, and orders — nothing here is
          shared with other companies on this platform.
        </p>

        <form onSubmit={handleSubmit} className="bg-slate-850 rounded-xl border border-slate-750 p-5 space-y-3">
          <div>
            <label className="text-xs text-steel uppercase tracking-wide">Company name</label>
            <input
              className="w-full bg-ink border border-slate-750 rounded-lg px-3 py-2 text-sm text-white mt-1"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
            />
          </div>

          <div className="border-t border-slate-750 pt-3">
            <p className="text-xs text-steel uppercase tracking-wide mb-2">Your admin account</p>
            <div className="space-y-2">
              <input
                className="w-full bg-ink border border-slate-750 rounded-lg px-3 py-2 text-sm text-white"
                placeholder="Full name"
                value={adminName}
                onChange={(e) => setAdminName(e.target.value)}
              />
              <input
                type="email"
                className="w-full bg-ink border border-slate-750 rounded-lg px-3 py-2 text-sm text-white"
                placeholder="Email"
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
              />
              <input
                type="password"
                className="w-full bg-ink border border-slate-750 rounded-lg px-3 py-2 text-sm text-white"
                placeholder="Password (min 6 characters)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          <div className="border-t border-slate-750 pt-3">
            <p className="text-xs text-steel uppercase tracking-wide mb-2">Your first warehouse</p>
            <p className="text-steel text-xs mb-2">
              Used as the origin/destination for route optimization and where inventory is tracked.
              You can add more later.
            </p>
            <div className="space-y-2">
              <input
                className="w-full bg-ink border border-slate-750 rounded-lg px-3 py-2 text-sm text-white"
                placeholder="Warehouse name"
                value={warehouseName}
                onChange={(e) => setWarehouseName(e.target.value)}
              />
              <input
                className="w-full bg-ink border border-slate-750 rounded-lg px-3 py-2 text-sm text-white"
                placeholder="Address"
                value={warehouseAddress}
                onChange={(e) => setWarehouseAddress(e.target.value)}
              />
              <div className="flex gap-2">
                <input
                  type="number"
                  step="any"
                  className="w-1/2 bg-ink border border-slate-750 rounded-lg px-3 py-2 text-sm text-white"
                  placeholder="Latitude"
                  value={warehouseLat}
                  onChange={(e) => setWarehouseLat(e.target.value === "" ? "" : Number(e.target.value))}
                />
                <input
                  type="number"
                  step="any"
                  className="w-1/2 bg-ink border border-slate-750 rounded-lg px-3 py-2 text-sm text-white"
                  placeholder="Longitude"
                  value={warehouseLng}
                  onChange={(e) => setWarehouseLng(e.target.value === "" ? "" : Number(e.target.value))}
                />
              </div>
            </div>
          </div>

          {error && <p className="text-danger text-xs">{error}</p>}

          <button
            type="submit"
            disabled={!valid || submitting}
            className="w-full bg-aquaDark text-white rounded-lg py-2 text-sm font-medium disabled:opacity-40"
          >
            {submitting ? "Creating your company…" : "Create company & sign in"}
          </button>
        </form>

        <p className="text-steel text-xs mt-4 text-center">
          Already have an account?{" "}
          <Link href="/login" className="text-aqua hover:underline">Log in</Link>
        </p>
      </div>
    </main>
  );
}
