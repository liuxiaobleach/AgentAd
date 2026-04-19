"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";

type Ticket = {
  id: string;
  requesterType: "advertiser" | "publisher";
  requesterName: string;
  requesterEmail: string;
  category: string;
  subject: string;
  body: string;
  status: "open" | "in_progress" | "waiting" | "resolved" | "closed";
  priority: "low" | "normal" | "high" | "urgent";
  lastMessageAt: string;
  createdAt: string;
};

type Message = {
  id: string;
  ticketId: string;
  authorType: "advertiser" | "publisher" | "support";
  authorName: string;
  body: string;
  createdAt: string;
};

type TicketDetail = Ticket & { messages: Message[] };

const CATEGORIES: { value: string; label: string }[] = [
  { value: "billing", label: "Billing / Budget" },
  { value: "audit", label: "Audit" },
  { value: "bidding", label: "Bidder Agent" },
  { value: "creatives", label: "Creatives" },
  { value: "publisher", label: "Publisher / Earnings" },
  { value: "technical", label: "Technical / Integration" },
  { value: "account", label: "Account" },
  { value: "other", label: "Other" },
];

const PRIORITIES: { value: string; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

function categoryLabel(v: string) {
  return CATEGORIES.find((c) => c.value === v)?.label ?? v;
}

function statusLabel(v: Ticket["status"]) {
  switch (v) {
    case "open":
      return { text: "Open", color: "#22d3ee", bg: "rgba(6,182,212,0.15)", border: "rgba(6,182,212,0.3)" };
    case "in_progress":
      return { text: "In Progress", color: "#c084fc", bg: "rgba(168,85,247,0.15)", border: "rgba(168,85,247,0.3)" };
    case "waiting":
      return { text: "Waiting", color: "#fbbf24", bg: "rgba(245,158,11,0.15)", border: "rgba(245,158,11,0.3)" };
    case "resolved":
      return { text: "Resolved", color: "#34d399", bg: "rgba(16,185,129,0.15)", border: "rgba(16,185,129,0.3)" };
    case "closed":
      return { text: "Closed", color: "#64748b", bg: "rgba(100,116,139,0.15)", border: "rgba(100,116,139,0.3)" };
  }
}

function formatTimestamp(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return (
    localStorage.getItem("zkdsp_token") ||
    localStorage.getItem("zkdsp_publisher_token")
  );
}

async function supportFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return fetch(url, { ...init, headers });
}

type View = "list" | "new" | "detail";

export default function SupportCenter() {
  const pathname = usePathname() || "";
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("list");
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Hide on login pages — requests need a token anyway.
  const hidden = pathname === "/login" || pathname === "/publisher/login";

  const loggedIn = useMemo(() => {
    if (typeof window === "undefined") return false;
    return Boolean(
      localStorage.getItem("zkdsp_token") ||
        localStorage.getItem("zkdsp_publisher_token")
    );
  }, [open]);

  const refreshList = useCallback(async () => {
    setLoadingList(true);
    setListError(null);
    try {
      const res = await supportFetch("/api/support/tickets");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Load failed (${res.status})`);
      }
      const data = await res.json();
      setTickets(data.tickets || []);
    } catch (e: any) {
      setListError(e?.message || "Network error");
    } finally {
      setLoadingList(false);
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    setActiveId(id);
    setView("detail");
    setDetail(null);
    setLoadingDetail(true);
    setDetailError(null);
    try {
      const res = await supportFetch(`/api/support/tickets/${id}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Load failed (${res.status})`);
      }
      const data = (await res.json()) as TicketDetail;
      setDetail(data);
    } catch (e: any) {
      setDetailError(e?.message || "Network error");
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  // Reload list each time the modal opens.
  useEffect(() => {
    if (open && view === "list" && loggedIn) {
      refreshList();
    }
  }, [open, view, loggedIn, refreshList]);

  if (hidden) return null;

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Support"
        style={{
          position: "fixed",
          right: 24,
          bottom: 86,
          width: 44,
          height: 44,
          borderRadius: "50%",
          background: "linear-gradient(135deg, #1e293b, #0f172a)",
          border: "1px solid rgba(168,85,247,0.45)",
          boxShadow: "0 4px 18px rgba(168,85,247,0.25)",
          color: "#c084fc",
          fontSize: 18,
          cursor: "pointer",
          zIndex: 999,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
        title={open ? "Close support center" : "Submit a ticket"}
      >
        {open ? "×" : "✉"}
      </button>

      {open && (
        <div
          style={{
            position: "fixed",
            right: 24,
            bottom: 140,
            width: 460,
            maxWidth: "calc(100vw - 48px)",
            height: 560,
            maxHeight: "calc(100vh - 180px)",
            background: "#0d1321",
            border: "1px solid rgba(168,85,247,0.25)",
            borderRadius: 12,
            boxShadow: "0 10px 40px rgba(0,0,0,0.5)",
            display: "flex",
            flexDirection: "column",
            zIndex: 999,
            color: "#e2e8f0",
            fontSize: 13,
          }}
        >
          <Header
            view={view}
            onBack={() => {
              setView("list");
              setDetail(null);
              setActiveId(null);
            }}
            onNew={() => {
              setView("new");
            }}
            onClose={() => setOpen(false)}
          />

          <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
            {!loggedIn ? (
              <EmptyState
                title="Please sign in"
                subtitle="Sign in as an advertiser or publisher to submit or view tickets."
              />
            ) : view === "list" ? (
              <TicketList
                tickets={tickets}
                loading={loadingList}
                error={listError}
                onOpen={loadDetail}
                onRefresh={refreshList}
                onNew={() => setView("new")}
              />
            ) : view === "new" ? (
              <NewTicketForm
                currentPath={pathname}
                onCreated={(created) => {
                  setDetail(created);
                  setActiveId(created.id);
                  setView("detail");
                  refreshList();
                }}
                onCancel={() => setView("list")}
              />
            ) : (
              <TicketDetailView
                detail={detail}
                loading={loadingDetail}
                error={detailError}
                onReply={async (body) => {
                  if (!activeId) return;
                  const res = await supportFetch(
                    `/api/support/tickets/${activeId}/messages`,
                    {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ body }),
                    }
                  );
                  if (!res.ok) {
                    const b = await res.json().catch(() => ({}));
                    throw new Error(b.error || `Send failed (${res.status})`);
                  }
                  await loadDetail(activeId);
                  refreshList();
                }}
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}

function Header({
  view,
  onBack,
  onNew,
  onClose,
}: {
  view: View;
  onBack: () => void;
  onNew: () => void;
  onClose: () => void;
}) {
  return (
    <div
      style={{
        padding: "12px 14px",
        borderBottom: "1px solid rgba(168,85,247,0.15)",
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      {view !== "list" && (
        <button
          onClick={onBack}
          style={{
            background: "transparent",
            border: "1px solid rgba(148,163,184,0.2)",
            color: "#94a3b8",
            borderRadius: 6,
            padding: "2px 8px",
            cursor: "pointer",
            fontSize: 12,
          }}
        >
          ← Back
        </button>
      )}
      <span style={{ fontWeight: 600 }}>
        {view === "list"
          ? "My Tickets"
          : view === "new"
          ? "New Ticket"
          : "Ticket Detail"}
      </span>
      <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
        {view === "list" && (
          <button
            onClick={onNew}
            style={{
              background: "linear-gradient(135deg, #a855f7, #c084fc)",
              border: "1px solid rgba(168,85,247,0.5)",
              color: "#fff",
              borderRadius: 6,
              padding: "4px 10px",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            + New
          </button>
        )}
        <button
          onClick={onClose}
          style={{
            background: "transparent",
            border: "none",
            color: "#64748b",
            fontSize: 18,
            cursor: "pointer",
          }}
          aria-label="Close"
        >
          ×
        </button>
      </div>
    </div>
  );
}

function EmptyState({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        textAlign: "center",
        gap: 6,
      }}
    >
      <div style={{ color: "#cbd5e1", fontWeight: 600 }}>{title}</div>
      {subtitle && (
        <div style={{ color: "#64748b", fontSize: 12 }}>{subtitle}</div>
      )}
    </div>
  );
}

function TicketList({
  tickets,
  loading,
  error,
  onOpen,
  onRefresh,
  onNew,
}: {
  tickets: Ticket[] | null;
  loading: boolean;
  error: string | null;
  onOpen: (id: string) => void;
  onRefresh: () => void;
  onNew: () => void;
}) {
  if (loading && !tickets) {
    return <EmptyState title="Loading..." />;
  }
  if (error) {
    return (
      <div style={{ padding: 16 }}>
        <div style={{ color: "#f87171", fontSize: 12, marginBottom: 8 }}>{error}</div>
        <button
          onClick={onRefresh}
          style={{
            padding: "4px 10px",
            borderRadius: 6,
            border: "1px solid rgba(6,182,212,0.3)",
            background: "transparent",
            color: "#22d3ee",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          Retry
        </button>
      </div>
    );
  }
  if (!tickets || tickets.length === 0) {
    return (
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          gap: 12,
          textAlign: "center",
        }}
      >
        <div style={{ color: "#cbd5e1", fontWeight: 600 }}>No tickets yet</div>
        <div style={{ color: "#64748b", fontSize: 12 }}>
          Hit a problem? Tap the button below to open your first ticket.
        </div>
        <button
          onClick={onNew}
          style={{
            marginTop: 8,
            background: "linear-gradient(135deg, #a855f7, #c084fc)",
            border: "1px solid rgba(168,85,247,0.5)",
            color: "#fff",
            borderRadius: 8,
            padding: "8px 16px",
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          Submit a ticket
        </button>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: 10 }}>
      {tickets.map((t) => {
        const s = statusLabel(t.status);
        return (
          <button
            key={t.id}
            onClick={() => onOpen(t.id)}
            style={{
              width: "100%",
              textAlign: "left",
              background: "rgba(15,23,42,0.6)",
              border: "1px solid rgba(148,163,184,0.12)",
              borderRadius: 10,
              padding: 12,
              marginBottom: 8,
              cursor: "pointer",
              color: "#e2e8f0",
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span
                style={{
                  fontSize: 10,
                  padding: "1px 6px",
                  borderRadius: 4,
                  color: s.color,
                  background: s.bg,
                  border: `1px solid ${s.border}`,
                }}
              >
                {s.text}
              </span>
              <span style={{ fontSize: 10, color: "#64748b" }}>
                {categoryLabel(t.category)}
              </span>
              <span style={{ fontSize: 10, color: "#475569", marginLeft: "auto" }}>
                {formatTimestamp(t.lastMessageAt)}
              </span>
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#cbd5e1" }}>
              {t.subject}
            </div>
            <div
              style={{
                fontSize: 11,
                color: "#64748b",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {t.body}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function NewTicketForm({
  currentPath,
  onCreated,
  onCancel,
}: {
  currentPath: string;
  onCreated: (t: TicketDetail) => void;
  onCancel: () => void;
}) {
  const [category, setCategory] = useState("other");
  const [priority, setPriority] = useState("normal");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!subject.trim() || !body.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const suffix = currentPath ? `\n\n(Current page: ${currentPath})` : "";
      const res = await supportFetch("/api/support/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          priority,
          subject: subject.trim(),
          body: body.trim() + suffix,
        }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || `Submit failed (${res.status})`);
      }
      const data = (await res.json()) as TicketDetail;
      onCreated(data);
    } catch (e: any) {
      setError(e?.message || "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
      <Row label="Category">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          style={selectStyle}
        >
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Priority">
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
          style={selectStyle}
        >
          {PRIORITIES.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Subject">
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={200}
          placeholder="Short summary of the issue"
          style={inputStyle}
        />
      </Row>
      <Row label="Details">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={7}
          placeholder="Describe steps to reproduce, expected vs actual behavior. If wallet/transaction related, include the address or txHash."
          style={{ ...inputStyle, resize: "vertical", minHeight: 140, fontFamily: "inherit" }}
        />
      </Row>
      {error && <div style={{ color: "#f87171", fontSize: 12 }}>{error}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: "auto", paddingTop: 8 }}>
        <button
          onClick={onCancel}
          disabled={submitting}
          style={{
            flex: 1,
            padding: "8px 0",
            borderRadius: 8,
            border: "1px solid rgba(148,163,184,0.25)",
            background: "transparent",
            color: "#94a3b8",
            cursor: submitting ? "not-allowed" : "pointer",
            fontSize: 13,
          }}
        >
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={submitting || !subject.trim() || !body.trim()}
          style={{
            flex: 1,
            padding: "8px 0",
            borderRadius: 8,
            border: "1px solid rgba(168,85,247,0.5)",
            background: submitting
              ? "#1e293b"
              : "linear-gradient(135deg, #a855f7, #c084fc)",
            color: "#fff",
            cursor:
              submitting || !subject.trim() || !body.trim()
                ? "not-allowed"
                : "pointer",
            fontSize: 13,
            fontWeight: 600,
            opacity:
              submitting || !subject.trim() || !body.trim() ? 0.6 : 1,
          }}
        >
          {submitting ? "Submitting..." : "Submit ticket"}
        </button>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 11, color: "#94a3b8", letterSpacing: "0.03em" }}>
        {label}
      </span>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  background: "#070b14",
  border: "1px solid rgba(148,163,184,0.2)",
  borderRadius: 8,
  padding: "8px 10px",
  color: "#e2e8f0",
  fontSize: 13,
  outline: "none",
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  appearance: "none",
};

function TicketDetailView({
  detail,
  loading,
  error,
  onReply,
}: {
  detail: TicketDetail | null;
  loading: boolean;
  error: string | null;
  onReply: (body: string) => Promise<void>;
}) {
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [detail?.messages?.length]);

  if (loading && !detail) {
    return <EmptyState title="Loading..." />;
  }
  if (error) {
    return <EmptyState title="Load failed" subtitle={error} />;
  }
  if (!detail) return null;

  const s = statusLabel(detail.status);
  const closed = detail.status === "closed";

  async function send() {
    const text = reply.trim();
    if (!text || sending) return;
    setSending(true);
    setReplyError(null);
    try {
      await onReply(text);
      setReply("");
    } catch (e: any) {
      setReplyError(e?.message || "Send failed");
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div
        style={{
          padding: "10px 14px",
          borderBottom: "1px solid rgba(148,163,184,0.12)",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span
            style={{
              fontSize: 10,
              padding: "1px 6px",
              borderRadius: 4,
              color: s.color,
              background: s.bg,
              border: `1px solid ${s.border}`,
            }}
          >
            {s.text}
          </span>
          <span style={{ fontSize: 10, color: "#64748b" }}>
            {categoryLabel(detail.category)}
          </span>
          <span style={{ fontSize: 10, color: "#475569", marginLeft: "auto" }}>
            #{detail.id.slice(0, 10)}
          </span>
        </div>
        <div style={{ fontSize: 14, fontWeight: 600, color: "#cbd5e1" }}>
          {detail.subject}
        </div>
      </div>

      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: 12,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {detail.messages.map((m) => {
          const isSupport = m.authorType === "support";
          return (
            <div
              key={m.id}
              style={{
                alignSelf: isSupport ? "flex-start" : "flex-end",
                maxWidth: "85%",
                padding: "8px 10px",
                borderRadius: 10,
                background: isSupport
                  ? "rgba(168,85,247,0.12)"
                  : "rgba(6,182,212,0.12)",
                border: isSupport
                  ? "1px solid rgba(168,85,247,0.3)"
                  : "1px solid rgba(6,182,212,0.3)",
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  color: isSupport ? "#c084fc" : "#22d3ee",
                  marginBottom: 4,
                  display: "flex",
                  gap: 8,
                }}
              >
                <span>{isSupport ? "AgentAd Support" : m.authorName}</span>
                <span style={{ color: "#475569" }}>
                  {formatTimestamp(m.createdAt)}
                </span>
              </div>
              <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.5, fontSize: 13 }}>
                {m.body}
              </div>
            </div>
          );
        })}
      </div>

      <div
        style={{
          borderTop: "1px solid rgba(148,163,184,0.12)",
          padding: 10,
          display: "flex",
          gap: 8,
        }}
      >
        <textarea
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          rows={2}
          placeholder={closed ? "This ticket is closed" : "Add a reply..."}
          disabled={closed || sending}
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
            opacity: closed ? 0.5 : 1,
          }}
        />
        <button
          onClick={send}
          disabled={closed || sending || !reply.trim()}
          style={{
            padding: "0 14px",
            borderRadius: 8,
            border: "1px solid rgba(168,85,247,0.5)",
            background: sending
              ? "#1e293b"
              : "linear-gradient(135deg, #a855f7, #c084fc)",
            color: "#fff",
            fontSize: 13,
            cursor:
              closed || sending || !reply.trim() ? "not-allowed" : "pointer",
            opacity: closed || sending || !reply.trim() ? 0.5 : 1,
          }}
        >
          Send
        </button>
      </div>
      {replyError && (
        <div style={{ color: "#f87171", fontSize: 12, padding: "0 12px 10px" }}>
          {replyError}
        </div>
      )}
    </div>
  );
}
