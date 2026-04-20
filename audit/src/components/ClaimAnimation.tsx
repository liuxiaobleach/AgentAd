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

// --- step indicator (shared by modal) ----------------------------------------

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

// --- modal overlay ------------------------------------------------------------

type ClaimProgressModalProps = {
  open: boolean;
  /** -1 = idle, 0..3 = that step is active, 4 = all done */
  stepIndex: number;
  errorIndex: number | null;
  errorMessage?: string | null;
  /** display-formatted amount, e.g. "1.25" */
  amountUsdc?: string;
  /** recipient wallet (full address; modal shortens it) */
  walletAddress?: string;
  txHash?: string | null;
  explorerBaseUrl?: string;
  onClose: () => void;
};

const MODAL_KEYFRAMES = `
  @keyframes claim-modal-pop {
    0%   { transform: scale(0.88); opacity: 0; }
    60%  { transform: scale(1.04); opacity: 1; }
    100% { transform: scale(1); opacity: 1; }
  }
  @keyframes claim-modal-fade {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
  @keyframes claim-coin-slide {
    0%   { transform: translateX(0); }
    50%  { transform: translateX(calc(var(--rail-span, 180px) * 0.55)); }
    100% { transform: translateX(var(--rail-span, 180px)); }
  }
  @keyframes claim-coin-bob {
    0%, 100% { transform: translateX(var(--rail-span, 180px)) translateY(0); }
    50%      { transform: translateX(var(--rail-span, 180px)) translateY(-4px); }
  }
  @keyframes claim-success-ring {
    0%   { transform: scale(0.7); opacity: 0.55; }
    100% { transform: scale(2.1); opacity: 0; }
  }
  @keyframes claim-success-pop {
    0%   { transform: scale(0.4); opacity: 0; }
    60%  { transform: scale(1.12); opacity: 1; }
    100% { transform: scale(1); opacity: 1; }
  }
  @keyframes claim-success-check {
    from { stroke-dashoffset: 48; }
    to   { stroke-dashoffset: 0; }
  }
  @keyframes claim-fade-up {
    from { transform: translateY(8px); opacity: 0; }
    to   { transform: translateY(0); opacity: 1; }
  }
`;

function shortAddress(a?: string) {
  if (!a || a.length < 12) return a || "";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function ClaimProgressModal({
  open,
  stepIndex,
  errorIndex,
  errorMessage,
  amountUsdc,
  walletAddress,
  txHash,
  explorerBaseUrl,
  onClose,
}: ClaimProgressModalProps) {
  if (!open) return null;

  const isSuccess = errorIndex === null && stepIndex >= CLAIM_STEPS.length;
  const isError = errorIndex !== null;
  const isWorking = !isSuccess && !isError;
  const canClose = isSuccess || isError;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center px-4"
      role="dialog"
      aria-modal="true"
      style={{
        background: "rgba(8, 12, 22, 0.62)",
        backdropFilter: "blur(6px)",
        animation: "claim-modal-fade 160ms ease-out both",
      }}
    >
      <style>{MODAL_KEYFRAMES}</style>

      <div
        className="relative w-full max-w-md rounded-3xl p-7"
        style={{
          background: "#0b1220",
          border: "1px solid rgba(6,182,212,0.25)",
          boxShadow:
            "0 30px 70px rgba(2, 6, 23, 0.6), 0 0 0 1px rgba(148,163,184,0.05)",
          animation: "claim-modal-pop 360ms cubic-bezier(0.34,1.56,0.64,1) both",
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-3">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-2xl text-base"
            style={{
              background: isError
                ? "rgba(239,68,68,0.14)"
                : isSuccess
                ? "rgba(16,185,129,0.14)"
                : "rgba(6,182,212,0.14)",
              color: isError ? "#f87171" : isSuccess ? "#34d399" : "#22d3ee",
              border: `1px solid ${
                isError
                  ? "rgba(239,68,68,0.4)"
                  : isSuccess
                  ? "rgba(16,185,129,0.4)"
                  : "rgba(6,182,212,0.4)"
              }`,
            }}
          >
            {isSuccess ? "✓" : isError ? "!" : "↗"}
          </div>
          <div className="min-w-0">
            <p
              className="text-[10px] uppercase tracking-[0.24em]"
              style={{ color: "#64748b" }}
            >
              Publisher Claim
            </p>
            <p
              className="text-lg font-semibold truncate"
              style={{ color: "#e2e8f0" }}
            >
              {amountUsdc ? `${amountUsdc} USDC` : "USDC from BudgetEscrow"}
            </p>
          </div>
        </div>

        {/* Body */}
        <div className="mt-6">
          {isWorking && (
            <>
              <CoinFlightRail stepIndex={stepIndex} />
              <ClaimStepList
                stepIndex={stepIndex}
                errorIndex={errorIndex}
                errorMessage={errorMessage ?? undefined}
              />
            </>
          )}
          {isSuccess && (
            <ClaimSuccessArt
              amountUsdc={amountUsdc}
              walletAddress={walletAddress}
            />
          )}
          {isError && (
            <ClaimErrorArt
              errorIndex={errorIndex ?? 0}
              message={errorMessage ?? "Claim interrupted."}
            />
          )}
        </div>

        {/* Tx hash */}
        {txHash && (
          <TxHashPill txHash={txHash} explorerBaseUrl={explorerBaseUrl} />
        )}

        {/* Footer */}
        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            disabled={!canClose}
            className="rounded-xl px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed"
            style={{
              background: isSuccess
                ? "#10b981"
                : isError
                ? "#ef4444"
                : "rgba(148,163,184,0.15)",
              color: canClose ? "white" : "#64748b",
              border: "none",
              opacity: canClose ? 1 : 0.7,
            }}
          >
            {isSuccess ? "Done" : isError ? "Close" : "Please wait…"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CoinFlightRail({ stepIndex }: { stepIndex: number }) {
  // Coin travels during step 1 (wallet approval) and 2 (on-chain mining),
  // and "lands" on wallet side at step 3 (recording claim).
  const inFlight = stepIndex === 1 || stepIndex === 2;
  const landed = stepIndex >= 3;

  return (
    <div
      className="relative mb-5 flex items-center justify-between rounded-2xl px-4 py-3"
      style={{
        background: "rgba(15,23,42,0.7)",
        border: "1px solid rgba(148,163,184,0.12)",
        ["--rail-span" as any]: "180px",
      }}
    >
      {/* Escrow end */}
      <div className="flex flex-col items-center text-center" style={{ width: 60 }}>
        <div
          className="flex h-9 w-9 items-center justify-center rounded-lg"
          style={{
            background: "rgba(168,85,247,0.14)",
            border: "1px solid rgba(168,85,247,0.45)",
            color: "#c4b5fd",
            fontSize: 14,
          }}
        >
          ▣
        </div>
        <span
          className="mt-1 text-[10px] uppercase tracking-wider"
          style={{ color: "#94a3b8" }}
        >
          Escrow
        </span>
      </div>

      {/* Rail */}
      <div className="relative flex-1 mx-3">
        <div
          style={{
            height: 2,
            background:
              "linear-gradient(90deg, rgba(168,85,247,0.4) 0%, rgba(6,182,212,0.4) 50%, rgba(16,185,129,0.4) 100%)",
            borderRadius: 2,
          }}
        />
        {/* Traveling coin */}
        <div
          className="absolute"
          style={{
            top: -10,
            left: 0,
            transform: landed ? "translateX(var(--rail-span, 180px))" : undefined,
            animation: inFlight
              ? "claim-coin-slide 1.6s ease-in-out infinite"
              : landed
              ? "claim-coin-bob 1.4s ease-in-out infinite"
              : "none",
            transition: "transform 400ms ease-out",
          }}
        >
          <div
            className="flex h-[22px] w-[22px] items-center justify-center rounded-full text-[9px] font-bold"
            style={{
              background: "linear-gradient(135deg, #22d3ee, #3b82f6)",
              color: "white",
              boxShadow: "0 0 12px rgba(34,211,238,0.65)",
            }}
          >
            $
          </div>
        </div>
      </div>

      {/* Wallet end */}
      <div className="flex flex-col items-center text-center" style={{ width: 60 }}>
        <div
          className="flex h-9 w-9 items-center justify-center rounded-lg"
          style={{
            background: landed ? "rgba(16,185,129,0.14)" : "rgba(148,163,184,0.08)",
            border: `1px solid ${
              landed ? "rgba(16,185,129,0.45)" : "rgba(148,163,184,0.2)"
            }`,
            color: landed ? "#34d399" : "#94a3b8",
            fontSize: 14,
            transition: "all 280ms",
          }}
        >
          ◉
        </div>
        <span
          className="mt-1 text-[10px] uppercase tracking-wider"
          style={{ color: landed ? "#34d399" : "#94a3b8", transition: "color 280ms" }}
        >
          Wallet
        </span>
      </div>
    </div>
  );
}

function ClaimStepList({
  stepIndex,
  errorIndex,
  errorMessage,
}: {
  stepIndex: number;
  errorIndex: number | null;
  errorMessage?: string;
}) {
  return (
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
  );
}

function ClaimSuccessArt({
  amountUsdc,
  walletAddress,
}: {
  amountUsdc?: string;
  walletAddress?: string;
}) {
  return (
    <div className="flex flex-col items-center py-3">
      <div className="relative flex h-24 w-24 items-center justify-center">
        <span
          className="absolute inset-0 rounded-full"
          style={{
            background: "rgba(16,185,129,0.3)",
            animation: "claim-success-ring 1.6s ease-out infinite",
          }}
        />
        <span
          className="absolute inset-0 rounded-full"
          style={{
            background: "rgba(16,185,129,0.18)",
            animation: "claim-success-ring 1.6s ease-out 0.45s infinite",
          }}
        />
        <div
          className="relative flex h-20 w-20 items-center justify-center rounded-full"
          style={{
            background: "#10b981",
            boxShadow: "0 10px 28px rgba(16,185,129,0.45)",
            animation:
              "claim-success-pop 520ms cubic-bezier(0.34,1.56,0.64,1) both",
          }}
        >
          <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
            <path
              d="M9 18.5 L15.5 25 L27 12"
              stroke="white"
              strokeWidth="3.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{
                strokeDasharray: 48,
                strokeDashoffset: 48,
                animation:
                  "claim-success-check 480ms 260ms ease-out forwards",
              }}
            />
          </svg>
        </div>
      </div>
      <p
        className="mt-5 text-lg font-semibold"
        style={{
          color: "#e2e8f0",
          animation: "claim-fade-up 420ms 200ms ease-out both",
        }}
      >
        {amountUsdc ? `${amountUsdc} USDC claimed` : "Claim successful"}
      </p>
      <p
        className="mt-1 text-center text-xs leading-5"
        style={{
          color: "#94a3b8",
          animation: "claim-fade-up 420ms 320ms ease-out both",
          maxWidth: 280,
        }}
      >
        {walletAddress
          ? `Transferred from BudgetEscrow to ${shortAddress(walletAddress)}.`
          : "Transferred from BudgetEscrow to your wallet."}
      </p>
    </div>
  );
}

function ClaimErrorArt({
  errorIndex,
  message,
}: {
  errorIndex: number;
  message: string;
}) {
  const stepLabel = CLAIM_STEPS[errorIndex]?.label ?? "Claim";
  return (
    <div className="flex flex-col items-center py-3">
      <div
        className="flex h-16 w-16 items-center justify-center rounded-full text-3xl"
        style={{
          background: "rgba(239,68,68,0.14)",
          color: "#f87171",
          border: "1px solid rgba(239,68,68,0.35)",
          animation:
            "claim-success-pop 420ms cubic-bezier(0.34,1.56,0.64,1) both",
        }}
      >
        ×
      </div>
      <p
        className="mt-4 text-base font-semibold"
        style={{
          color: "#e2e8f0",
          animation: "claim-fade-up 380ms 160ms ease-out both",
        }}
      >
        Failed at: {stepLabel}
      </p>
      <p
        className="mt-2 max-h-28 overflow-auto text-center text-xs leading-5"
        style={{
          color: "#94a3b8",
          animation: "claim-fade-up 380ms 260ms ease-out both",
          maxWidth: 300,
        }}
      >
        {message}
      </p>
    </div>
  );
}
