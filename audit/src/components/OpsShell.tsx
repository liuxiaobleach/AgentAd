"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { clearOpsSession, getOpsToken, getOpsUser, OpsUser } from "@/lib/ops-api";

const navItems = [
  { href: "/ops/queue", label: "Review Queue", icon: "\u25A3" },
  { href: "/ops/history", label: "My Reviews", icon: "\u25CE" },
];

// OpsShell renders the authenticated header + nav. It redirects to /ops/login
// if no token is present. Keep the styling close to the publisher dashboard so
// the two consoles feel like siblings.
export default function OpsShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<OpsUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!getOpsToken()) {
      router.replace("/ops/login");
      return;
    }
    setUser(getOpsUser());
    setReady(true);
  }, [router]);

  if (!ready) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: "#0a0e1a" }}
      >
        <div className="text-center">
          <div className="inline-block w-8 h-8 border-2 border-fuchsia-500 border-t-transparent rounded-full animate-spin mb-3" />
          <p style={{ color: "#64748b" }}>Loading ops console...</p>
        </div>
      </div>
    );
  }

  function logout() {
    clearOpsSession();
    router.replace("/ops/login");
  }

  return (
    <div
      className="min-h-screen"
      style={{
        background:
          "radial-gradient(ellipse at 20% 0%, rgba(168,85,247,0.06) 0%, transparent 50%), #060a14",
      }}
    >
      <header
        className="border-b"
        style={{
          borderColor: "rgba(168, 85, 247, 0.12)",
          background: "rgba(6, 10, 20, 0.8)",
          backdropFilter: "blur(12px)",
        }}
      >
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <Link href="/ops/queue" className="flex items-center gap-3">
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center"
                style={{
                  background:
                    "linear-gradient(135deg, rgba(168,85,247,0.2), rgba(6,182,212,0.15))",
                  border: "1px solid rgba(168, 85, 247, 0.3)",
                }}
              >
                <span style={{ color: "#c084fc", fontSize: 16 }}>\u25C9</span>
              </div>
              <div>
                <div className="text-sm font-bold tracking-wide" style={{ color: "#e2e8f0" }}>
                  Ops Console
                </div>
                <div className="text-[10px] uppercase tracking-widest" style={{ color: "#64748b" }}>
                  Manual Review
                </div>
              </div>
            </Link>
            <nav className="flex items-center gap-1">
              {navItems.map((item) => {
                const isActive =
                  pathname === item.href || pathname?.startsWith(item.href + "/");
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="px-4 py-2 rounded-lg text-sm transition-all"
                    style={{
                      background: isActive
                        ? "rgba(168, 85, 247, 0.12)"
                        : "transparent",
                      color: isActive ? "#c084fc" : "#64748b",
                      border: isActive
                        ? "1px solid rgba(168, 85, 247, 0.3)"
                        : "1px solid transparent",
                    }}
                  >
                    <span className="mr-2" style={{ opacity: 0.7 }}>
                      {item.icon}
                    </span>
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="flex items-center gap-4">
            {user && (
              <div className="text-right">
                <div className="text-sm" style={{ color: "#e2e8f0" }}>
                  {user.name}
                </div>
                <div className="text-[10px] font-mono" style={{ color: "#475569" }}>
                  {user.email}
                </div>
              </div>
            )}
            <button
              onClick={logout}
              className="px-3 py-1.5 rounded-lg text-xs"
              style={{
                color: "#64748b",
                border: "1px solid rgba(30, 41, 59, 0.8)",
                background: "rgba(15, 23, 42, 0.4)",
              }}
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6">{children}</main>
    </div>
  );
}
