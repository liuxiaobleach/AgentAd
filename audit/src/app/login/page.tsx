"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
      router.push("/dashboard");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden"
      style={{
        background: "radial-gradient(ellipse at 30% 20%, rgba(6,182,212,0.08) 0%, transparent 50%), radial-gradient(ellipse at 70% 80%, rgba(168,85,247,0.06) 0%, transparent 50%), #060a14",
      }}>

      {/* Grid background */}
      <div className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage: "linear-gradient(rgba(6,182,212,1) 1px, transparent 1px), linear-gradient(90deg, rgba(6,182,212,1) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }}
      />

      <div className="relative w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-10">
          <div className="inline-block mb-5">
            <svg viewBox="0 0 68 76" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: 68, height: 76 }}>
              <defs>
                <linearGradient id="login-hex-fill" x1="0" y1="0" x2="68" y2="76" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="rgba(6,182,212,0.15)" />
                  <stop offset="100%" stopColor="rgba(168,85,247,0.15)" />
                </linearGradient>
                <linearGradient id="login-hex-stroke" x1="0" y1="0" x2="68" y2="76" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.6" />
                  <stop offset="100%" stopColor="#a855f7" stopOpacity="0.4" />
                </linearGradient>
                <filter id="login-hex-glow">
                  <feGaussianBlur stdDeviation="3" result="blur" />
                  <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
              </defs>
              <path d="M34 4 L62 21 L62 55 L34 72 L6 55 L6 21 Z"
                fill="url(#login-hex-fill)" stroke="url(#login-hex-stroke)" strokeWidth="1.5" filter="url(#login-hex-glow)" />
              <path d="M34 20 L34 32 M28 28 L40 28 M34 44 L34 56 M24 40 L34 44 L44 40"
                stroke="#06b6d4" strokeWidth="1.8" strokeLinecap="round" opacity="0.7" />
              <circle cx="34" cy="38" r="5" fill="#06b6d4" opacity="0.9" />
              <circle cx="34" cy="38" r="2" fill="white" opacity="0.8" />
              <circle cx="28" cy="28" r="2.2" fill="#a855f7" opacity="0.7" />
              <circle cx="40" cy="28" r="2.2" fill="#06b6d4" opacity="0.7" />
              <circle cx="24" cy="40" r="2.2" fill="#06b6d4" opacity="0.5" />
              <circle cx="44" cy="40" r="2.2" fill="#a855f7" opacity="0.5" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold" style={{ letterSpacing: "0.02em" }}>
            <span style={{ color: "#e2e8f0" }}>Agent</span>
            <span style={{ color: "#06b6d4", textShadow: "0 0 20px rgba(6,182,212,0.5)" }}>Ad</span>
          </h1>
          <p className="text-sm tracking-widest uppercase mt-2" style={{ color: "#64748b" }}>
            AI-Powered Ad Platform
          </p>
        </div>

        {/* Login Card */}
        <form onSubmit={handleSubmit}
          className="rounded-2xl p-8 space-y-5"
          style={{
            background: "rgba(15, 23, 42, 0.8)",
            border: "1px solid rgba(6, 182, 212, 0.1)",
            backdropFilter: "blur(20px)",
            boxShadow: "0 0 60px rgba(6, 182, 212, 0.05)",
          }}>

          <h2 className="text-lg font-semibold" style={{ color: "#e2e8f0" }}>
            Advertiser Login
          </h2>

          {error && (
            <div className="p-3 rounded-lg text-sm"
              style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", color: "#f87171" }}>
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium mb-1.5 uppercase tracking-wide" style={{ color: "#64748b" }}>
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-4 py-2.5 rounded-lg text-sm"
              placeholder="alpha@agentad.demo"
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5 uppercase tracking-wide" style={{ color: "#64748b" }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full px-4 py-2.5 rounded-lg text-sm"
              placeholder="demo123"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg text-sm font-semibold tracking-wide disabled:opacity-50 transition-all"
            style={{
              background: "linear-gradient(135deg, #0891b2, #06b6d4)",
              color: "white",
              border: "1px solid rgba(6, 182, 212, 0.3)",
              boxShadow: "0 0 20px rgba(6, 182, 212, 0.3)",
            }}
          >
            {loading ? "CONNECTING..." : "LOGIN"}
          </button>

          {/* Quick accounts */}
          <div className="pt-5" style={{ borderTop: "1px solid rgba(30, 41, 59, 0.8)" }}>
            <p className="text-[10px] text-center mb-3 uppercase tracking-widest" style={{ color: "#334155" }}>
              Demo Accounts
            </p>
            <div className="grid grid-cols-2 gap-3">
              {[
                { email: "alpha@agentad.demo", name: "Alpha DeFi", strategy: "Growth", color: "#06b6d4" },
                { email: "beta@agentad.demo", name: "Beta Gaming", strategy: "Balanced", color: "#a855f7" },
              ].map((acc) => (
                <button
                  key={acc.email}
                  type="button"
                  onClick={() => { setEmail(acc.email); setPassword("demo123"); }}
                  className="p-3 rounded-lg text-left transition-all"
                  style={{
                    background: "rgba(15, 23, 42, 0.6)",
                    border: "1px solid rgba(30, 41, 59, 0.8)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = acc.color;
                    e.currentTarget.style.boxShadow = `0 0 15px ${acc.color}33`;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "rgba(30, 41, 59, 0.8)";
                    e.currentTarget.style.boxShadow = "none";
                  }}
                >
                  <p className="text-sm font-semibold" style={{ color: acc.color }}>{acc.name}</p>
                  <p className="text-[10px] mt-0.5" style={{ color: "#475569" }}>{acc.strategy} Strategy</p>
                </button>
              ))}
            </div>
          </div>
        </form>

        <p className="text-center mt-6 text-[10px] font-mono" style={{ color: "#1e293b" }}>
          AgentAd v0.2.0 // AI-Powered Ad Platform
        </p>
        <div className="mt-4 text-center">
          <Link
            href="/docs#advertiser-quickstart"
            className="text-xs font-medium uppercase tracking-[0.22em]"
            style={{ color: "#38bdf8" }}
          >
            Read Advertiser Guide
          </Link>
        </div>
      </div>
    </div>
  );
}
