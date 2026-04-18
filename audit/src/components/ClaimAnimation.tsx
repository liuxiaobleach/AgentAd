"use client";

import { useEffect, useMemo, useRef, useState } from "react";

// --- step model ---------------------------------------------------------------

export type ClaimStepId = "prepare" | "wallet" | "onchain" | "confirm";

export const CLAIM_STEPS: { id: ClaimStepId; label: string; sub: string }[] = [
  { id: "prepare", label: "Signing receipt", sub: "Issuer prepares EIP-712 claim" },
  { id: "wallet", label: "Wallet approval", sub: "Confirm the tx in MetaMask" },
  { id: "onchain", label: "On-chain mining", sub: "Waiting for block inclusion" },
  { id: "confirm", label: "Recording claim", sub: "Backend verifies & updates ledger" },
];

// --- stepper component --------------------------------------------------------

type ClaimProgressProps = {
  /** -1 = idle, 0..3 = that step is active, 4 = all done */
  stepIndex: number;
  /** index of the step that errored, if any */
  errorIndex: number | null;
  /** optional error message to surface under the failed step */
  errorMessage?: string | null;
};

export function ClaimProgress({ stepIndex, errorIndex, errorMessage }: ClaimProgressProps) {
  if (stepIndex < 0) return null;
  const completed = errorIndex === null && stepIndex >= CLAIM_STEPS.length;

  return (
    <div
      className="rounded-2xl border p-5"
      style={{
        borderColor: completed
          ? "rgba(16,185,129,0.35)"
          : errorIndex !== null
          ? "rgba(239,68,68,0.35)"
          : "rgba(6,182,212,0.25)",
        background: "rgba(15,23,42,0.6)",
      }}
    >
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm font-semibold" style={{ color: "#e2e8f0" }}>
          {completed
            ? "Claim complete"
            : errorIndex !== null
            ? "Claim interrupted"
            : "Claim in progress"}
        </span>
        <span className="text-[10px] uppercase tracking-widest" style={{ color: "#64748b" }}>
          {completed
            ? "4 / 4"
            : errorIndex !== null
            ? `step ${errorIndex + 1} failed`
            : `step ${Math.min(stepIndex + 1, 4)} / 4`}
        </span>
      </div>

      {/* Indeterminate progress bar while any step is active */}
      {!completed && errorIndex === null && (
        <div
          className="h-0.5 w-full overflow-hidden rounded mb-4"
          style={{ background: "rgba(6,182,212,0.12)" }}
        >
          <div
            style={{
              width: "25%",
              height: "100%",
              background: "linear-gradient(90deg, transparent, #06b6d4, transparent)",
              animation: "claim-bar-indeterminate 1.4s linear infinite",
            }}
          />
        </div>
      )}

      <ol className="space-y-3">
        {CLAIM_STEPS.map((step, i) => {
          const state =
            errorIndex === i
              ? "error"
              : i < stepIndex
              ? "done"
              : i === stepIndex
              ? "active"
              : "pending";
          return (
            <li key={step.id} className="flex items-start gap-3">
              <StepIndicator state={state} />
              <div className="flex-1 min-w-0">
                <div
                  className="text-sm font-medium"
                  style={{
                    color:
                      state === "done"
                        ? "#34d399"
                        : state === "active"
                        ? "#22d3ee"
                        : state === "error"
                        ? "#f87171"
                        : "#64748b",
                  }}
                >
                  {step.label}
                </div>
                <div className="text-xs" style={{ color: "#64748b" }}>
                  {state === "error" && errorMessage ? errorMessage : step.sub}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function StepIndicator({ state }: { state: "pending" | "active" | "done" | "error" }) {
  const base: React.CSSProperties = {
    width: 22,
    height: 22,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    marginTop: 2,
    transition: "all 200ms",
  };

  if (state === "done") {
    return (
      <div style={{ ...base, background: "rgba(16,185,129,0.2)", border: "1px solid #10b981" }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
          <path
            className="claim-check-path"
            d="M5 12.5l4.5 4.5L19 7.5"
            stroke="#34d399"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    );
  }

  if (state === "active") {
    return (
      <div
        style={{
          ...base,
          background: "rgba(6,182,212,0.12)",
          border: "1px solid rgba(6,182,212,0.6)",
          animation: "claim-pulse-ring 1.3s ease-out infinite",
        }}
      >
        <div
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            border: "2px solid rgba(34,211,238,0.25)",
            borderTopColor: "#22d3ee",
            animation: "claim-spin 0.9s linear infinite",
          }}
        />
      </div>
    );
  }

  if (state === "error") {
    return (
      <div style={{ ...base, background: "rgba(239,68,68,0.15)", border: "1px solid #ef4444" }}>
        <span style={{ color: "#f87171", fontSize: 13, fontWeight: 700, lineHeight: 1 }}>
          ×
        </span>
      </div>
    );
  }

  return (
    <div
      style={{
        ...base,
        background: "transparent",
        border: "1px dashed #334155",
      }}
    />
  );
}

// --- confetti burst -----------------------------------------------------------

type ConfettiBurstProps = {
  /** change the key prop to retrigger */
  durationMs?: number;
  pieces?: number;
};

const CONFETTI_COLORS = ["#06b6d4", "#a855f7", "#34d399", "#fbbf24", "#ec4899"];

export function ConfettiBurst({ durationMs = 2600, pieces = 40 }: ConfettiBurstProps) {
  const bits = useMemo(
    () =>
      Array.from({ length: pieces }, (_, i) => {
        const startX = 30 + Math.random() * 40; // % from left
        const driftX = (Math.random() - 0.5) * 40; // vw
        const rot = 360 + Math.random() * 900;
        const delay = Math.random() * 200;
        const size = 6 + Math.random() * 6;
        const dur = durationMs * (0.75 + Math.random() * 0.5);
        return {
          i,
          startX,
          driftX,
          rot,
          delay,
          size,
          dur,
          color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        };
      }),
    [pieces, durationMs]
  );

  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        overflow: "hidden",
        zIndex: 999,
      }}
    >
      {bits.map((b) => (
        <span
          key={b.i}
          style={
            {
              position: "absolute",
              top: 0,
              left: `${b.startX}%`,
              width: b.size,
              height: b.size * 1.4,
              background: b.color,
              borderRadius: 2,
              opacity: 0,
              "--cx": "0px",
              "--dx": `${b.driftX}vw`,
              "--rot": `${b.rot}deg`,
              animation: `claim-confetti-fall ${b.dur}ms cubic-bezier(0.25,0.46,0.45,0.94) ${b.delay}ms forwards`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

// --- tx hash pill -------------------------------------------------------------

type TxHashPillProps = {
  txHash: string;
  explorerBaseUrl?: string;
};

export function TxHashPill({ txHash, explorerBaseUrl }: TxHashPillProps) {
  const [copied, setCopied] = useState(false);
  const short = useMemo(
    () => `${txHash.slice(0, 10)}…${txHash.slice(-6)}`,
    [txHash]
  );
  const href = explorerBaseUrl ? `${explorerBaseUrl}${txHash}` : undefined;

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(txHash);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  return (
    <div
      className="mt-4 flex items-center gap-2 rounded-xl px-3 py-2 text-xs"
      style={{
        background: "rgba(15,23,42,0.6)",
        border: "1px solid rgba(6,182,212,0.2)",
        animation: "claim-pill-reveal 260ms ease-out both",
      }}
    >
      <span style={{ color: "#64748b" }}>tx</span>
      <code
        className="font-mono"
        style={{ color: "#22d3ee", letterSpacing: "0.02em", flex: 1 }}
      >
        {short}
      </code>
      <button
        onClick={onCopy}
        className="px-2 py-0.5 rounded"
        style={{
          fontSize: 10,
          color: copied ? "#34d399" : "#94a3b8",
          background: "transparent",
          border: "1px solid rgba(148,163,184,0.2)",
        }}
      >
        {copied ? "COPIED" : "COPY"}
      </button>
      {href && (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="px-2 py-0.5 rounded"
          style={{
            fontSize: 10,
            color: "#22d3ee",
            background: "rgba(6,182,212,0.1)",
            border: "1px solid rgba(6,182,212,0.3)",
            textDecoration: "none",
          }}
        >
          ETHERSCAN ↗
        </a>
      )}
    </div>
  );
}

// --- animated number ----------------------------------------------------------

type AnimatedUsdcProps = {
  /** atomic units (USDC 6 decimals) */
  atomic: number;
  /** duration in ms */
  durationMs?: number;
};

/**
 * Tween an atomic USDC value toward its target when it changes.
 * Uses requestAnimationFrame with an ease-out cubic so big jumps feel organic.
 */
export function AnimatedUsdc({ atomic, durationMs = 1200 }: AnimatedUsdcProps) {
  const [displayed, setDisplayed] = useState<number>(atomic);
  const fromRef = useRef<number>(atomic);
  const startRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    // Skip if unchanged.
    if (displayed === atomic) return;

    fromRef.current = displayed;
    startRef.current = null;

    const to = atomic;
    const from = fromRef.current;

    function tick(ts: number) {
      if (startRef.current === null) startRef.current = ts;
      const elapsed = ts - startRef.current;
      const t = Math.min(1, elapsed / durationMs);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3);
      const next = Math.round(from + (to - from) * eased);
      setDisplayed(next);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atomic, durationMs]);

  const formatted = (displayed / 1_000_000).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
  return <span>{formatted} USDC</span>;
}
