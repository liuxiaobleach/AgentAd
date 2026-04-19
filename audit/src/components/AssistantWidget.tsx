"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

type Msg = { role: "user" | "assistant"; content: string };

const INITIAL_GREETING: Msg = {
  role: "assistant",
  content:
    "Hi! I'm AgentAd's in-app AI assistant. I only answer questions about this platform — how each page works, how to deposit budget, how publishers claim earnings, etc. What would you like to know?",
};

export default function AssistantWidget() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([INITIAL_GREETING]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, open]);

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    const next: Msg[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: next.filter((m) => m !== INITIAL_GREETING),
          currentPath: pathname,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
      }
      const data = await res.json();
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.reply || "(no content)" },
      ]);
    } catch (e: any) {
      setError(e?.message || "Network error");
    } finally {
      setSending(false);
    }
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Open AI assistant"
        style={{
          position: "fixed",
          right: 24,
          bottom: 24,
          width: 52,
          height: 52,
          borderRadius: "50%",
          background: "linear-gradient(135deg, #06b6d4, #a855f7)",
          border: "1px solid rgba(6,182,212,0.5)",
          boxShadow: "0 4px 20px rgba(6,182,212,0.35)",
          color: "#fff",
          fontSize: 22,
          cursor: "pointer",
          zIndex: 1000,
        }}
      >
        {open ? "×" : "?"}
      </button>

      {open && (
        <div
          style={{
            position: "fixed",
            right: 24,
            bottom: 88,
            width: 360,
            maxWidth: "calc(100vw - 48px)",
            height: 480,
            maxHeight: "calc(100vh - 120px)",
            background: "#0d1321",
            border: "1px solid rgba(6,182,212,0.25)",
            borderRadius: 12,
            boxShadow: "0 10px 40px rgba(0,0,0,0.5)",
            display: "flex",
            flexDirection: "column",
            zIndex: 1000,
            color: "#e2e8f0",
            fontSize: 13,
          }}
        >
          <div
            style={{
              padding: "12px 14px",
              borderBottom: "1px solid rgba(6,182,212,0.15)",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "#10b981",
                boxShadow: "0 0 6px #10b981",
              }}
            />
            <span style={{ fontWeight: 600 }}>AgentAd Assistant</span>
            <span style={{ fontSize: 11, color: "#64748b", marginLeft: "auto" }}>
              Platform questions only
            </span>
          </div>

          <div
            ref={scrollRef}
            style={{ flex: 1, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 8 }}
          >
            {messages.map((m, i) => (
              <div
                key={i}
                style={{
                  alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                  maxWidth: "85%",
                  padding: "8px 10px",
                  borderRadius: 10,
                  background:
                    m.role === "user"
                      ? "rgba(6,182,212,0.15)"
                      : "rgba(148,163,184,0.08)",
                  border:
                    m.role === "user"
                      ? "1px solid rgba(6,182,212,0.3)"
                      : "1px solid rgba(148,163,184,0.15)",
                  whiteSpace: "pre-wrap",
                  lineHeight: 1.5,
                }}
              >
                {m.content}
              </div>
            ))}
            {sending && (
              <div style={{ color: "#64748b", fontSize: 12, fontStyle: "italic" }}>
                Thinking...
              </div>
            )}
            {error && (
              <div style={{ color: "#f87171", fontSize: 12 }}>{error}</div>
            )}
          </div>

          <div
            style={{
              borderTop: "1px solid rgba(6,182,212,0.15)",
              padding: 10,
              display: "flex",
              gap: 8,
            }}
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKey}
              rows={2}
              placeholder="Ask anything about how this platform works..."
              style={{
                flex: 1,
                background: "#070b14",
                border: "1px solid rgba(148,163,184,0.2)",
                borderRadius: 8,
                padding: "8px 10px",
                color: "#e2e8f0",
                fontSize: 13,
                resize: "none",
                outline: "none",
                fontFamily: "inherit",
              }}
            />
            <button
              onClick={send}
              disabled={sending || !input.trim()}
              style={{
                padding: "0 14px",
                borderRadius: 8,
                border: "1px solid rgba(6,182,212,0.4)",
                background: sending ? "#1e293b" : "linear-gradient(135deg, #06b6d4, #0ea5e9)",
                color: "#fff",
                fontSize: 13,
                cursor: sending || !input.trim() ? "not-allowed" : "pointer",
                opacity: sending || !input.trim() ? 0.6 : 1,
              }}
            >
              Send
            </button>
          </div>
        </div>
      )}
    </>
  );
}
