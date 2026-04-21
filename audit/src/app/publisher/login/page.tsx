"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { setPublisherSession } from "@/lib/publisher-api";

export default function PublisherLoginPage() {
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
      const res = await fetch("/api/publisher/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Login failed" }));
        throw new Error(err.error || "Login failed");
      }
      const data = await res.json();
      setPublisherSession(data.token, data.publisher);
      router.push("/publisher/dashboard");
    } catch (err: any) {
      setError(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center relative overflow-hidden"
      style={{
        background:
          "radial-gradient(ellipse at 30% 20%, rgba(16,185,129,0.08) 0%, transparent 50%), radial-gradient(ellipse at 70% 80%, rgba(6,182,212,0.06) 0%, transparent 50%), #060a14",
      }}
    >
      <div className="relative w-full max-w-md">
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold" style={{ letterSpacing: "0.02em" }}>
            <span style={{ color: "#e2e8f0" }}>Agent</span>
            <span style={{ color: "#10b981", textShadow: "0 0 20px rgba(16,185,129,0.5)" }}>
              Ad
            </span>
            <span style={{ color: "#94a3b8", marginLeft: 10, fontSize: "0.6em" }}>
              Publisher
            </span>
          </h1>
          <p className="text-sm tracking-widest uppercase mt-2" style={{ color: "#64748b" }}>
            Earn USDC from your ad slots
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl p-8 space-y-5"
          style={{
            background: "rgba(15, 23, 42, 0.8)",
            border: "1px solid rgba(16, 185, 129, 0.1)",
            backdropFilter: "blur(20px)",
            boxShadow: "0 0 60px rgba(16, 185, 129, 0.05)",
          }}
        >
          <h2 className="text-lg font-semibold" style={{ color: "#e2e8f0" }}>
            Publisher Login
          </h2>

          {error && (
            <div
              className="p-3 rounded-lg text-sm"
              style={{
                background: "rgba(239,68,68,0.1)",
                border: "1px solid rgba(239,68,68,0.2)",
                color: "#f87171",
              }}
            >
              {error}
            </div>
          )}

          <div>
            <label
              className="block text-xs font-medium mb-1.5 uppercase tracking-wide"
              style={{ color: "#64748b" }}
            >
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-4 py-2.5 rounded-lg text-sm"
              placeholder="publisher@agentad.demo"
            />
          </div>

          <div>
            <label
              className="block text-xs font-medium mb-1.5 uppercase tracking-wide"
              style={{ color: "#64748b" }}
            >
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
              background: "linear-gradient(135deg, #059669, #10b981)",
              color: "white",
              border: "1px solid rgba(16, 185, 129, 0.3)",
              boxShadow: "0 0 20px rgba(16, 185, 129, 0.3)",
            }}
          >
            {loading ? "CONNECTING..." : "LOGIN"}
          </button>

          <div className="pt-5" style={{ borderTop: "1px solid rgba(30, 41, 59, 0.8)" }}>
            <p
              className="text-[10px] text-center mb-3 uppercase tracking-widest"
              style={{ color: "#334155" }}
            >
              Demo Account
            </p>
            <button
              type="button"
              onClick={() => {
                setEmail("publisher@agentad.demo");
                setPassword("demo123");
              }}
              className="w-full p-3 rounded-lg text-left transition-all"
              style={{
                background: "rgba(15, 23, 42, 0.6)",
                border: "1px solid rgba(30, 41, 59, 0.8)",
              }}
            >
              <p className="text-sm font-semibold" style={{ color: "#10b981" }}>
                Demo Publisher
              </p>
              <p className="text-[10px] mt-0.5" style={{ color: "#475569" }}>
                publisher@agentad.demo / demo123
              </p>
            </button>
          </div>
        </form>

        <div className="mt-4 text-center">
          <Link
            href="/docs#publisher-quickstart"
            className="text-xs font-medium uppercase tracking-[0.22em]"
            style={{ color: "#6ee7b7" }}
          >
            Read Publisher Guide
          </Link>
        </div>
      </div>
    </div>
  );
}
