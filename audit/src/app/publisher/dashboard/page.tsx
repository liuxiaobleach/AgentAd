"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Address,
  createPublicClient,
  encodeFunctionData,
  formatUnits,
  getAddress,
  http,
} from "viem";
import { sepolia } from "viem/chains";
import {
  clearPublisherSession,
  getPublisherToken,
  getPublisherUser,
  publisherApiFetch,
  PublisherUser,
  setPublisherSession,
} from "@/lib/publisher-api";
import {
  AnimatedUsdc,
  ClaimProgress,
  ConfettiBurst,
  TxHashPill,
} from "@/components/ClaimAnimation";

type PublisherWallet = {
  publisherId: string;
  linkedWalletAddress: string | null;
  network: string;
  chainId: number;
  chainName: string;
  rpcUrl: string;
  tokenSymbol: string;
  tokenDecimals: number;
  tokenAddress: string;
  escrowAddress: string;
  issuerAddress: string;
  explorerBaseUrl: string;
};

type Earnings = {
  publisherId: string;
  currency: string;
  totalEarnedAtomic: number;
  claimedAtomic: number;
  unclaimedAtomic: number;
  updatedAt: string;
};

type EarningEvent = {
  id: string;
  eventType: string;
  auctionRequestId: string | null;
  auctionBidId: string | null;
  slotId: string | null;
  amountAtomic: number;
  createdAt: string;
};

type ClaimReceipt = {
  id: string;
  walletAddress: string;
  amountAtomic: number;
  expiryAt: string;
  signature: string;
  escrowAddress: string;
  chainId: number;
  status: "issued" | "claimed" | "expired";
  claimTxHash: string | null;
  claimBlockNumber: number | null;
  issuedAt: string;
  claimedAt: string | null;
};

type PrepareClaimResponse = {
  receiptId: string;
  publisher: string;
  amountAtomic: number;
  expiry: number;
  signature: string;
  escrowAddress: string;
  chainId: number;
  issuerAddress: string;
};

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<any>;
  on?: (event: string, handler: (...args: any[]) => void) => void;
  removeListener?: (event: string, handler: (...args: any[]) => void) => void;
};

// Claim(address publisher, uint256 amount, bytes32 receiptId, uint256 expiry, bytes signature)
const budgetEscrowClaimAbi = [
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [
      { name: "publisher", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "receiptId", type: "bytes32" },
      { name: "expiry", type: "uint256" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

function getEthereum(): EthereumProvider | null {
  if (typeof window === "undefined") return null;
  return (window as Window & { ethereum?: EthereumProvider }).ethereum || null;
}

function normalizeAddress(value: string | null | undefined) {
  if (!value) return null;
  try {
    return getAddress(value);
  } catch {
    return null;
  }
}

function formatUsdc(atomic: number | bigint) {
  const value = Number.parseFloat(formatUnits(BigInt(atomic), 6));
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
}

async function ensureSepoliaNetwork(ethereum: EthereumProvider, wallet: PublisherWallet) {
  const targetChainIdHex = `0x${wallet.chainId.toString(16)}`;
  const current = await ethereum.request({ method: "eth_chainId" });
  if (current === targetChainIdHex) return;
  try {
    await ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: targetChainIdHex }],
    });
  } catch (err: any) {
    if (err?.code !== 4902) throw err;
    await ethereum.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: targetChainIdHex,
          chainName: wallet.chainName,
          nativeCurrency: { name: "Sepolia ETH", symbol: "ETH", decimals: 18 },
          rpcUrls: [wallet.rpcUrl],
          blockExplorerUrls: [wallet.explorerBaseUrl.replace(/\/tx\/?$/, "")],
        },
      ],
    });
  }
}

export default function PublisherDashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<PublisherUser | null>(null);
  const [wallet, setWallet] = useState<PublisherWallet | null>(null);
  const [earnings, setEarnings] = useState<Earnings | null>(null);
  const [events, setEvents] = useState<EarningEvent[]>([]);
  const [claims, setClaims] = useState<ClaimReceipt[]>([]);
  const [connectedWallet, setConnectedWallet] = useState<string | null>(null);
  const [claimAmount, setClaimAmount] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Claim flow animation state
  // -1 = idle, 0..3 = active step, 4 = all done. Reset to -1 before a new claim.
  const [claimStep, setClaimStep] = useState<number>(-1);
  const [claimErrorIndex, setClaimErrorIndex] = useState<number | null>(null);
  const [claimTxHash, setClaimTxHash] = useState<string | null>(null);
  const [confettiKey, setConfettiKey] = useState<number>(0);

  const normalizedConnectedWallet = useMemo(
    () => normalizeAddress(connectedWallet),
    [connectedWallet]
  );
  const normalizedLinkedWallet = useMemo(
    () => normalizeAddress(wallet?.linkedWalletAddress),
    [wallet?.linkedWalletAddress]
  );
  const walletMatches = Boolean(
    normalizedConnectedWallet &&
      normalizedLinkedWallet &&
      normalizedConnectedWallet === normalizedLinkedWallet
  );

  useEffect(() => {
    if (!getPublisherToken()) {
      router.replace("/publisher/login");
      return;
    }
    setUser(getPublisherUser());
    load();

    const ethereum = getEthereum();
    if (!ethereum) return;
    (async () => {
      try {
        const accts = (await ethereum.request({ method: "eth_accounts" })) as string[];
        setConnectedWallet(accts[0] ? normalizeAddress(accts[0]) : null);
      } catch {
        /* ignore */
      }
    })();
    const handler = (accts: string[]) =>
      setConnectedWallet(accts[0] ? normalizeAddress(accts[0]) : null);
    ethereum.on?.("accountsChanged", handler);
    return () => ethereum.removeListener?.("accountsChanged", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    setError(null);
    try {
      const [walletRes, earningsRes, eventsRes, claimsRes] = await Promise.all([
        publisherApiFetch("/api/publisher/billing/wallet"),
        publisherApiFetch("/api/publisher/earnings"),
        publisherApiFetch("/api/publisher/earnings/events?limit=50"),
        publisherApiFetch("/api/publisher/claims?limit=20"),
      ]);

      if (walletRes.status === 401 || earningsRes.status === 401) {
        clearPublisherSession();
        router.replace("/publisher/login");
        return;
      }

      const [walletData, earningsData, eventsData, claimsData] = await Promise.all([
        walletRes.json(),
        earningsRes.json(),
        eventsRes.json(),
        claimsRes.json(),
      ]);

      if (!walletRes.ok) throw new Error(walletData.error || "Failed to load wallet");
      if (!earningsRes.ok) throw new Error(earningsData.error || "Failed to load earnings");

      setWallet(walletData);
      setEarnings(earningsData);
      setEvents(Array.isArray(eventsData) ? eventsData : []);
      setClaims(Array.isArray(claimsData) ? claimsData : []);
    } catch (err: any) {
      setError(err.message || "Failed to load data");
    } finally {
      setLoading(false);
    }
  }

  async function connectMetaMask() {
    const ethereum = getEthereum();
    if (!ethereum) throw new Error("MetaMask not detected. Install it and reload.");
    const accts = (await ethereum.request({ method: "eth_requestAccounts" })) as string[];
    const addr = accts[0] ? normalizeAddress(accts[0]) : null;
    if (!addr) throw new Error("MetaMask did not return an address.");
    setConnectedWallet(addr);
    return { ethereum, address: addr };
  }

  async function handleLinkWallet() {
    setBusy(true);
    setError(null);
    setStatus("Requesting wallet-link challenge...");
    try {
      const { ethereum, address } = await connectMetaMask();
      const challengeRes = await publisherApiFetch(
        "/api/publisher/billing/wallet/link-challenge"
      );
      const challengeData = await challengeRes.json();
      if (!challengeRes.ok)
        throw new Error(challengeData.error || "Failed to load challenge");

      setStatus("Waiting for MetaMask signature...");
      const signature = (await ethereum.request({
        method: "personal_sign",
        params: [challengeData.message, address],
      })) as string;

      const linkRes = await publisherApiFetch("/api/publisher/billing/wallet/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: address,
          issuedAt: challengeData.issuedAt,
          expiresAt: challengeData.expiresAt,
          signature,
        }),
      });
      const linkData = await linkRes.json();
      if (!linkRes.ok) throw new Error(linkData.error || "Failed to link wallet");
      setWallet(linkData.wallet);
      // refresh cached user
      if (user) {
        const next = { ...user, walletAddress: linkData.publisher.walletAddress };
        setUser(next);
        // keep the stored token but update user
        const token = getPublisherToken();
        if (token) setPublisherSession(token, next);
      }
      setStatus("Wallet linked. You can now prepare an on-chain claim.");
      await load();
    } catch (err: any) {
      setError(err.message || "Failed to link wallet");
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  async function handleClaim() {
    if (!wallet) {
      setError("Wallet config not loaded yet.");
      return;
    }
    if (!normalizedLinkedWallet) {
      setError("Link a wallet first.");
      return;
    }
    if (!normalizedConnectedWallet) {
      setError("Connect MetaMask first.");
      return;
    }
    if (!walletMatches) {
      setError("Connected MetaMask does not match the linked publisher wallet.");
      return;
    }
    if (!earnings || earnings.unclaimedAtomic <= 0) {
      setError("No unclaimed earnings to redeem.");
      return;
    }

    const amountNum = Number.parseFloat(claimAmount || "0");
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      setError("Enter a positive USDC amount to claim.");
      return;
    }
    const amountAtomic = Math.floor(amountNum * 1_000_000);
    if (amountAtomic > earnings.unclaimedAtomic) {
      setError("Amount exceeds your unclaimed balance.");
      return;
    }

    setBusy(true);
    setError(null);
    setStatus(null);
    setClaimTxHash(null);
    setClaimErrorIndex(null);
    setClaimStep(0);
    let activeStep = 0;
    try {
      // Step 0: prepare
      const prepareRes = await publisherApiFetch("/api/publisher/claim/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountAtomic }),
      });
      const prepareData = await prepareRes.json();
      if (!prepareRes.ok) throw new Error(prepareData.error || "Failed to prepare claim");
      const receipt = prepareData as PrepareClaimResponse;

      // Step 1: wallet signature / tx submission
      activeStep = 1;
      setClaimStep(1);
      const ethereum = getEthereum();
      if (!ethereum) throw new Error("MetaMask not detected.");
      await ensureSepoliaNetwork(ethereum, wallet);

      const txHash = (await ethereum.request({
        method: "eth_sendTransaction",
        params: [
          {
            from: normalizedConnectedWallet,
            to: receipt.escrowAddress,
            data: encodeFunctionData({
              abi: budgetEscrowClaimAbi,
              functionName: "claim",
              args: [
                receipt.publisher as Address,
                BigInt(receipt.amountAtomic),
                receipt.receiptId as `0x${string}`,
                BigInt(receipt.expiry),
                receipt.signature as `0x${string}`,
              ],
            }),
          },
        ],
      })) as string;
      setClaimTxHash(txHash);

      // Step 2: wait for block inclusion
      activeStep = 2;
      setClaimStep(2);
      const publicClient = createPublicClient({
        chain: sepolia,
        transport: http(wallet.rpcUrl),
      });
      await publicClient.waitForTransactionReceipt({ hash: txHash as `0x${string}` });

      // Step 3: backend records the claim
      activeStep = 3;
      setClaimStep(3);
      const confirmRes = await publisherApiFetch("/api/publisher/claim/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          receiptId: receipt.receiptId,
          transactionHash: txHash,
        }),
      });
      const confirmData = await confirmRes.json();
      if (!confirmRes.ok) throw new Error(confirmData.error || "Failed to confirm claim");

      // Done — trigger success celebration
      setClaimStep(4);
      setConfettiKey((k) => k + 1);
      setClaimAmount("");
      await load();
    } catch (err: any) {
      setClaimErrorIndex(activeStep);
      setError(err.message || "Claim failed");
    } finally {
      setBusy(false);
    }
  }

  function logout() {
    clearPublisherSession();
    router.replace("/publisher/login");
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-sm text-slate-500">Loading publisher dashboard...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-8">
      <div className="mx-auto max-w-6xl space-y-8">
        <div className="flex items-start justify-between gap-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              Publisher Dashboard
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Track on-platform ad earnings and redeem them on-chain from the
              AgentAd BudgetEscrow contract.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {user && (
              <div className="text-right text-xs text-slate-500">
                <div className="font-medium text-slate-700">{user.name}</div>
                <div>{user.email}</div>
              </div>
            )}
            <button
              onClick={logout}
              className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-white"
            >
              Log out
            </button>
          </div>
        </div>

        {/* Claim flow: animated stepper replaces the generic status banner */}
        {claimStep >= 0 && (
          <div className="space-y-3">
            <ClaimProgress
              stepIndex={claimStep}
              errorIndex={claimErrorIndex}
              errorMessage={claimErrorIndex !== null ? error : null}
            />
            {claimTxHash && (
              <TxHashPill
                txHash={claimTxHash}
                explorerBaseUrl={wallet?.explorerBaseUrl}
              />
            )}
          </div>
        )}

        {/* Non-claim status / error messages */}
        {claimStep < 0 && error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}
        {claimStep < 0 && status && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {status}
          </div>
        )}

        {/* Success confetti — retriggers on each successful claim via key */}
        {confettiKey > 0 && <ConfettiBurst key={confettiKey} />}

        <div className="grid gap-4 md:grid-cols-3">
          <MetricCard
            label="Total Earned"
            value={
              earnings ? (
                <AnimatedUsdc atomic={earnings.totalEarnedAtomic} />
              ) : (
                "--"
              )
            }
            accent="#0f766e"
          />
          <MetricCard
            label="Claimed On-Chain"
            value={
              earnings ? (
                <AnimatedUsdc atomic={earnings.claimedAtomic} />
              ) : (
                "--"
              )
            }
            accent="#1d4ed8"
          />
          <MetricCard
            label="Unclaimed"
            value={
              earnings ? (
                <AnimatedUsdc atomic={earnings.unclaimedAtomic} />
              ) : (
                "--"
              )
            }
            accent="#9a3412"
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.1fr_1.4fr]">
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-slate-900">
              Wallet &amp; Claim
            </h3>
            <div className="mt-4 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
              <Row label="Chain" value={wallet?.chainName || "--"} />
              <Row label="USDC" value={wallet?.tokenAddress || "--"} />
              <Row label="Escrow" value={wallet?.escrowAddress || "--"} />
              <Row label="Issuer" value={wallet?.issuerAddress || "--"} />
              <Row
                label="Linked Wallet"
                value={wallet?.linkedWalletAddress || "Not linked yet"}
              />
              <Row
                label="Connected MetaMask"
                value={connectedWallet || "Not connected"}
              />
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              <button
                onClick={handleLinkWallet}
                disabled={busy}
                className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {normalizedLinkedWallet
                  ? "Relink Connected Wallet"
                  : "Link Connected Wallet"}
              </button>
            </div>

            <div className="mt-6 rounded-xl border border-slate-200 p-4">
              <label className="block text-sm font-medium text-slate-700">
                Claim Amount (USDC)
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={claimAmount}
                onChange={(e) => setClaimAmount(e.target.value)}
                placeholder={
                  earnings
                    ? (earnings.unclaimedAtomic / 1_000_000).toString()
                    : "0"
                }
                className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-emerald-500"
              />
              <button
                onClick={handleClaim}
                disabled={busy || !earnings || earnings.unclaimedAtomic <= 0}
                className="mt-4 w-full rounded-xl bg-emerald-600 px-4 py-3 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-60"
              >
                {busy ? "Processing..." : "Prepare + Submit Claim"}
              </button>
              <p className="mt-3 text-xs text-slate-500">
                The backend signs an EIP-712 receipt; you submit it to{" "}
                <code>BudgetEscrow.claim()</code>. USDC is transferred from the
                escrow to your linked wallet.
              </p>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-slate-900">
              Earning Events
            </h3>
            <div className="mt-4 max-h-96 overflow-y-auto rounded-xl border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase text-slate-500">
                      Event
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase text-slate-500">
                      Slot
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-medium uppercase text-slate-500">
                      Amount
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase text-slate-500">
                      When
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {events.length === 0 ? (
                    <tr>
                      <td
                        colSpan={4}
                        className="px-4 py-10 text-center text-sm text-slate-400"
                      >
                        No earnings yet. Trigger an auction to see slots credit.
                      </td>
                    </tr>
                  ) : (
                    events.map((ev) => (
                      <tr key={ev.id} className="hover:bg-slate-50">
                        <td className="px-3 py-2 font-medium text-slate-800">
                          {ev.eventType}
                        </td>
                        <td className="px-3 py-2 text-slate-600">
                          <code>{ev.slotId || "-"}</code>
                        </td>
                        <td className="px-3 py-2 text-right font-medium text-emerald-700">
                          +{formatUsdc(ev.amountAtomic)} USDC
                        </td>
                        <td className="px-3 py-2 text-slate-500">
                          {new Date(ev.createdAt).toLocaleTimeString()}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-900">
            Claim Receipts
          </h3>
          <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-slate-500">
                    Receipt
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-medium uppercase text-slate-500">
                    Amount
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-slate-500">
                    Status
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-slate-500">
                    Tx
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-slate-500">
                    Issued
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {claims.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-4 py-10 text-center text-sm text-slate-400"
                    >
                      No claim receipts yet.
                    </td>
                  </tr>
                ) : (
                  claims.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2">
                        <code className="text-xs">
                          {c.id.slice(0, 10)}...{c.id.slice(-6)}
                        </code>
                      </td>
                      <td className="px-3 py-2 text-right font-medium">
                        {formatUsdc(c.amountAtomic)} USDC
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge status={c.status} />
                      </td>
                      <td className="px-3 py-2">
                        {c.claimTxHash ? (
                          <a
                            href={`${wallet?.explorerBaseUrl ?? ""}${c.claimTxHash}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-emerald-700 underline decoration-emerald-300 underline-offset-2"
                          >
                            {c.claimTxHash.slice(0, 10)}...
                          </a>
                        ) : (
                          <span className="text-xs text-slate-400">pending</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-500">
                        {new Date(c.issuedAt).toLocaleString()}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <code className="break-all text-right text-xs text-slate-700">{value}</code>
    </div>
  );
}

function StatusBadge({ status }: { status: ClaimReceipt["status"] }) {
  const styles: Record<ClaimReceipt["status"], string> = {
    issued: "bg-amber-100 text-amber-800",
    claimed: "bg-emerald-100 text-emerald-800",
    expired: "bg-slate-100 text-slate-600",
  };
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${styles[status]}`}
    >
      {status}
    </span>
  );
}

function MetricCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  accent: string;
}) {
  return (
    <div
      className="rounded-2xl border bg-white p-6 shadow-sm"
      style={{ borderColor: "rgba(15, 23, 42, 0.08)" }}
    >
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className="mt-3 text-3xl font-semibold" style={{ color: accent }}>
        {value}
      </p>
    </div>
  );
}
