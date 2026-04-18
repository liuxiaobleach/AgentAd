"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: "\u25C8" },
  { href: "/billing", label: "Billing", icon: "\u25A0" },
  { href: "/creatives", label: "Creatives", icon: "\u25A3" },
  { href: "/audit-cases", label: "Audit Cases", icon: "\u25CE" },
  { href: "/bidder-agents", label: "Bidder Agents", icon: "\u2B23" },
  { href: "/auctions", label: "My Bids", icon: "\u26A1" },
  { href: "/reports", label: "Reports", icon: "\u25B2" },
  { href: "/analyst", label: "Ad Analyst", icon: "\u25C7" },
  { href: "/certificates", label: "Certificates", icon: "\u25C9" },
  { href: "/integrations", label: "Integration", icon: "\u29BF" },
];

export default function Sidebar({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, logout, loading } = useAuth();
  const walletLabel = user?.walletAddress
    ? `${user.walletAddress.slice(0, 6)}...${user.walletAddress.slice(-4)}`
    : "Wallet not linked";

  if (pathname === "/login" || pathname.startsWith("/publisher")) {
    return <>{children}</>;
  }

  if (!loading && !user && pathname !== "/login") {
    if (typeof window !== "undefined") {
      window.location.href = "/login";
    }
    return null;
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#0a0e1a" }}>
        <div className="text-center">
          <div className="inline-block w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin mb-3" />
          <p style={{ color: "#64748b" }}>Initializing...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className="w-64 flex flex-col relative overflow-hidden"
        style={{
          background: "linear-gradient(180deg, #070b14 0%, #0d1321 100%)",
          borderRight: "1px solid rgba(6, 182, 212, 0.1)",
        }}>

        {/* Background grid effect */}
        <div className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: "linear-gradient(rgba(6,182,212,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(6,182,212,0.5) 1px, transparent 1px)",
            backgroundSize: "20px 20px",
          }}
        />

        {/* Logo */}
        <div className="relative p-6 border-b" style={{ borderColor: "rgba(6, 182, 212, 0.1)" }}>
          <div className="flex items-center gap-3">
            {/* Hexagon icon */}
            <div className="relative flex-shrink-0" style={{ width: 34, height: 38 }}>
              <svg viewBox="0 0 34 38" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: 34, height: 38 }}>
                <defs>
                  <linearGradient id="hex-fill" x1="0" y1="0" x2="34" y2="38" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="rgba(6,182,212,0.2)" />
                    <stop offset="100%" stopColor="rgba(168,85,247,0.2)" />
                  </linearGradient>
                  <linearGradient id="hex-stroke" x1="0" y1="0" x2="34" y2="38" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.6" />
                    <stop offset="100%" stopColor="#a855f7" stopOpacity="0.4" />
                  </linearGradient>
                  <filter id="hex-glow">
                    <feGaussianBlur stdDeviation="2" result="blur" />
                    <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                  </filter>
                </defs>
                <path d="M17 2 L31 10.5 L31 27.5 L17 36 L3 27.5 L3 10.5 Z"
                  fill="url(#hex-fill)" stroke="url(#hex-stroke)" strokeWidth="1.2" filter="url(#hex-glow)" />
                {/* Inner circuit lines */}
                <path d="M17 10 L17 16 M14 14 L20 14 M17 22 L17 28 M12 20 L17 22 L22 20"
                  stroke="#06b6d4" strokeWidth="1" strokeLinecap="round" opacity="0.7" />
                {/* Center node */}
                <circle cx="17" cy="19" r="2.5" fill="#06b6d4" opacity="0.9" />
                <circle cx="17" cy="19" r="1" fill="white" opacity="0.8" />
                {/* Corner nodes */}
                <circle cx="14" cy="14" r="1.2" fill="#a855f7" opacity="0.7" />
                <circle cx="20" cy="14" r="1.2" fill="#06b6d4" opacity="0.7" />
                <circle cx="12" cy="20" r="1.2" fill="#06b6d4" opacity="0.5" />
                <circle cx="22" cy="20" r="1.2" fill="#a855f7" opacity="0.5" />
              </svg>
            </div>
            <div>
              <h1 className="text-base font-bold leading-tight" style={{ letterSpacing: "0.02em" }}>
                <span style={{ color: "#e2e8f0" }}>Agent</span>
                <span style={{ color: "#06b6d4", textShadow: "0 0 12px rgba(6,182,212,0.5)" }}>Ad</span>
              </h1>
              <p className="text-[10px] tracking-widest uppercase" style={{ color: "#64748b" }}>
                AI-Powered Ad Platform
              </p>
            </div>
          </div>
        </div>

        {/* User info */}
        {user && (
          <div className="relative px-6 py-3 border-b" style={{ borderColor: "rgba(6, 182, 212, 0.1)" }}>
            <div className="flex items-center gap-3">
              <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
                style={{
                  background: "rgba(168, 85, 247, 0.15)",
                  border: "1px solid rgba(168, 85, 247, 0.3)",
                  color: "#c084fc",
                }}>
                {user.name.charAt(0)}
              </div>
              <div>
                <p className="text-sm font-medium" style={{ color: "#e2e8f0" }}>{user.name}</p>
                <p className="text-[10px]" style={{ color: "#475569" }}>{user.email}</p>
                <p className="text-[10px] font-mono mt-0.5" style={{ color: user.walletAddress ? "#22c55e" : "#64748b" }}>
                  {walletLabel}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Nav */}
        <nav className="relative flex-1 p-3 space-y-0.5">
          {navItems.map((item) => {
            const isActive = pathname === item.href || pathname?.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm transition-all duration-200"
                style={{
                  background: isActive
                    ? "linear-gradient(90deg, rgba(6,182,212,0.12), rgba(6,182,212,0.04))"
                    : "transparent",
                  borderLeft: isActive ? "2px solid #06b6d4" : "2px solid transparent",
                  color: isActive ? "#22d3ee" : "#64748b",
                  textShadow: isActive ? "0 0 10px rgba(6, 182, 212, 0.5)" : "none",
                }}
              >
                <span className="text-base w-5 text-center" style={{ opacity: isActive ? 1 : 0.6 }}>{item.icon}</span>
                <span className="font-medium">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="relative p-3 border-t" style={{ borderColor: "rgba(6, 182, 212, 0.1)" }}>
          <button
            onClick={logout}
            className="w-full px-4 py-2 text-sm rounded-lg transition-all text-left"
            style={{ color: "#475569" }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "#f87171"; e.currentTarget.style.background = "rgba(239,68,68,0.08)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "#475569"; e.currentTarget.style.background = "transparent"; }}
          >
            Logout
          </button>
          <div className="px-4 py-1.5 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#10b981", boxShadow: "0 0 6px #10b981" }} />
            <span className="text-[10px] font-mono" style={{ color: "#334155" }}>v0.2.0 // ONLINE</span>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto">
        <div className="max-w-7xl mx-auto p-8">{children}</div>
      </main>
    </div>
  );
}
