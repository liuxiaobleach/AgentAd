"use client";

import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useEffect, useMemo, useState } from "react";
import {
  Address,
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  getAddress,
  http,
  parseUnits,
} from "viem";
import { sepolia } from "viem/chains";

type BalanceSummary = {
  advertiserId: string;
  currency: string;
  totalAtomic: number;
  reservedAtomic: number;
  spendableAtomic: number;
  updatedAt: string;
};

type LedgerEntry = {
  id: string;
  entryType: string;
  amountAtomic: number;
  description: string;
  createdAt: string;
};

type BillingWallet = {
  advertiserId: string;
  linkedWalletAddress: string | null;
  network: string;
  chainId: number;
  chainName: string;
  rpcUrl: string;
  tokenSymbol: string;
  tokenDecimals: number;
  tokenAddress: string;
  treasuryAddress: string;
  explorerBaseUrl: string;
};

type WalletLinkChallenge = {
  message: string;
  issuedAt: string;
  expiresAt: string;
};

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<any>;
  on?: (event: string, handler: (...args: any[]) => void) => void;
  removeListener?: (event: string, handler: (...args: any[]) => void) => void;
};

function formatAtomic(amountAtomic: number | bigint, decimals = 6) {
  const value = Number.parseFloat(formatUnits(BigInt(amountAtomic), decimals));
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

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

function txExplorerUrl(wallet: BillingWallet | null, txHash: string | null) {
  if (!wallet || !txHash) return null;
  return `${wallet.explorerBaseUrl}${txHash}`;
}

function explorerOrigin(wallet: BillingWallet | null) {
  if (!wallet) return "https://sepolia.etherscan.io";
  return wallet.explorerBaseUrl.replace(/\/tx\/?$/, "");
}

async function ensureSepoliaWalletNetwork(ethereum: EthereumProvider, wallet: BillingWallet) {
  const targetChainIdHex = `0x${wallet.chainId.toString(16)}`;
  const currentChainId = await ethereum.request({ method: "eth_chainId" });
  if (currentChainId === targetChainIdHex) {
    return;
  }

  try {
    await ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: targetChainIdHex }],
    });
  } catch (err: any) {
    if (err?.code !== 4902) {
      throw err;
    }
    await ethereum.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: targetChainIdHex,
          chainName: wallet.chainName,
          nativeCurrency: { name: "Sepolia ETH", symbol: "ETH", decimals: 18 },
          rpcUrls: [wallet.rpcUrl],
          blockExplorerUrls: [explorerOrigin(wallet)],
        },
      ],
    });
  }
}

export default function BillingPage() {
  const { refreshUser } = useAuth();
  const [balance, setBalance] = useState<BalanceSummary | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [wallet, setWallet] = useState<BillingWallet | null>(null);
  const [connectedWallet, setConnectedWallet] = useState<string | null>(null);
  const [depositAmount, setDepositAmount] = useState("5");
  const [manualTxHash, setManualTxHash] = useState("");
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [walletBusy, setWalletBusy] = useState(false);
  const [depositBusy, setDepositBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  async function load(isRefresh = false) {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const [balanceRes, ledgerRes, walletRes] = await Promise.all([
        apiFetch("/api/billing/balance"),
        apiFetch("/api/billing/ledger?limit=25"),
        apiFetch("/api/billing/wallet"),
      ]);

      const [balanceData, ledgerData, walletData] = await Promise.all([
        balanceRes.json(),
        ledgerRes.json(),
        walletRes.json(),
      ]);

      if (!balanceRes.ok) {
        throw new Error(balanceData.error || "Failed to load balance");
      }
      if (!ledgerRes.ok) {
        throw new Error(ledgerData.error || "Failed to load ledger");
      }
      if (!walletRes.ok) {
        throw new Error(walletData.error || "Failed to load wallet settings");
      }

      setBalance(balanceData);
      setLedger(Array.isArray(ledgerData) ? ledgerData : []);
      setWallet(walletData);
    } catch (err: any) {
      setError(err.message || "Failed to load billing data");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const ethereum = getEthereum();
    if (!ethereum) return;

    let active = true;
    const syncAccounts = async () => {
      try {
        const accounts = (await ethereum.request({
          method: "eth_accounts",
        })) as string[];
        if (!active) return;
        setConnectedWallet(accounts[0] ? normalizeAddress(accounts[0]) : null);
      } catch {
        if (!active) return;
        setConnectedWallet(null);
      }
    };

    syncAccounts();

    const handleAccountsChanged = (accounts: string[]) => {
      setConnectedWallet(accounts[0] ? normalizeAddress(accounts[0]) : null);
    };

    ethereum.on?.("accountsChanged", handleAccountsChanged);
    return () => {
      active = false;
      ethereum.removeListener?.("accountsChanged", handleAccountsChanged);
    };
  }, []);

  async function connectMetaMask() {
    const ethereum = getEthereum();
    if (!ethereum) {
      throw new Error("MetaMask was not detected. Install it, then reload this page.");
    }

    const accounts = (await ethereum.request({
      method: "eth_requestAccounts",
    })) as string[];
    const firstAccount = accounts[0] ? normalizeAddress(accounts[0]) : null;
    if (!firstAccount) {
      throw new Error("MetaMask did not return a usable wallet address.");
    }
    setConnectedWallet(firstAccount);
    return { ethereum, address: firstAccount };
  }

  async function handleConnectWallet() {
    setWalletBusy(true);
    setError(null);
    setStatus("Connecting MetaMask...");
    try {
      await connectMetaMask();
      setStatus("MetaMask connected.");
    } catch (err: any) {
      setError(err.message || "Failed to connect MetaMask");
      setStatus(null);
    } finally {
      setWalletBusy(false);
    }
  }

  async function handleLinkWallet() {
    setWalletBusy(true);
    setError(null);
    setStatus("Requesting wallet-link challenge...");
    try {
      const { ethereum, address } = await connectMetaMask();

      const challengeRes = await apiFetch("/api/billing/wallet/link-challenge");
      const challengeData: WalletLinkChallenge & { error?: string } =
        await challengeRes.json();
      if (!challengeRes.ok) {
        throw new Error(challengeData.error || "Failed to load wallet-link challenge");
      }

      setStatus("Waiting for MetaMask signature...");
      const signature = (await ethereum.request({
        method: "personal_sign",
        params: [challengeData.message, address],
      })) as string;

      const linkRes = await apiFetch("/api/billing/wallet/link", {
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
      if (!linkRes.ok) {
        throw new Error(linkData.error || "Failed to link wallet");
      }

      setWallet(linkData.wallet);
      await refreshUser();
      setStatus("Wallet linked. You can now top up with Sepolia USDC.");
      await load(true);
    } catch (err: any) {
      setError(err.message || "Failed to link wallet");
      setStatus(null);
    } finally {
      setWalletBusy(false);
    }
  }

  async function claimDeposit(transactionHash: string) {
    const claimRes = await apiFetch("/api/billing/claim-deposit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transactionHash }),
    });
    const claimData = await claimRes.json();
    if (
      claimRes.status === 409 &&
      typeof claimData.error === "string" &&
      claimData.error.toLowerCase().includes("already been credited")
    ) {
      setManualTxHash("");
      await load(true);
      return { ok: true, alreadyCredited: true };
    }
    if (!claimRes.ok) {
      throw new Error(claimData.error || "Failed to claim deposit");
    }
    setManualTxHash("");
    await load(true);
    return claimData;
  }

  async function handleSendDeposit() {
    if (!wallet) {
      setError("Billing wallet configuration has not loaded yet.");
      return;
    }

    if (!normalizedConnectedWallet) {
      setError("Connect MetaMask before sending a Sepolia USDC deposit.");
      return;
    }

    if (normalizedLinkedWallet && normalizedConnectedWallet !== normalizedLinkedWallet) {
      setError("The connected MetaMask wallet does not match the wallet linked to this advertiser.");
      return;
    }

    if (!normalizedLinkedWallet) {
      setError("Link your MetaMask wallet before sending a Sepolia USDC deposit.");
      return;
    }

    setDepositBusy(true);
    setError(null);
    try {
      const ethereum = getEthereum();
      if (!ethereum) {
        throw new Error("MetaMask was not detected. Install it, then reload this page.");
      }

      const trimmedAmount = depositAmount.trim();
      if (!trimmedAmount) {
        throw new Error("Enter a USDC amount before sending the deposit.");
      }

      const amountAtomic = parseUnits(trimmedAmount, wallet.tokenDecimals);
      if (amountAtomic <= BigInt(0)) {
        throw new Error("Deposit amount must be greater than zero.");
      }

      await ensureSepoliaWalletNetwork(ethereum, wallet);

      setStatus("Waiting for MetaMask transfer confirmation...");
      const txHash = (await ethereum.request({
        method: "eth_sendTransaction",
        params: [
          {
            from: normalizedConnectedWallet,
            to: wallet.tokenAddress,
            data: encodeFunctionData({
              abi: erc20Abi,
              functionName: "transfer",
              args: [wallet.treasuryAddress as Address, amountAtomic],
            }),
          },
        ],
      })) as string;

      setLastTxHash(txHash);
      setManualTxHash(txHash);
      setStatus("Sepolia transaction sent. Waiting for on-chain confirmation...");

      const publicClient = createPublicClient({
        chain: sepolia,
        transport: http(wallet.rpcUrl),
      });
      await publicClient.waitForTransactionReceipt({
        hash: txHash as `0x${string}`,
      });

      setStatus("Transaction confirmed. Crediting your platform balance...");
      await claimDeposit(txHash);
      setStatus("Sepolia USDC deposit credited successfully.");
    } catch (err: any) {
      setError(err.message || "Failed to send Sepolia USDC deposit");
      setStatus(null);
    } finally {
      setDepositBusy(false);
    }
  }

  async function handleManualClaim() {
    const txHash = manualTxHash.trim();
    if (!txHash) {
      setError("Paste a Sepolia transaction hash before claiming a deposit.");
      return;
    }

    setDepositBusy(true);
    setError(null);
    setStatus("Verifying Sepolia transaction and crediting balance...");
    try {
      await claimDeposit(txHash);
      setLastTxHash(txHash);
      setStatus("Sepolia USDC deposit credited successfully.");
    } catch (err: any) {
      setError(err.message || "Failed to claim deposit");
      setStatus(null);
    } finally {
      setDepositBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between gap-6">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Billing</h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-500">
            This console now uses real Sepolia USDC for advertiser top-ups. Connect MetaMask, link the wallet you want to fund from, send USDC to the platform treasury, and then claim the on-chain transfer into your prepaid balance.
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {status && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {status}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard
          label="Total Balance"
          value={balance ? `${formatAtomic(balance.totalAtomic)} USDC` : "--"}
          accent="#0f766e"
          loading={loading}
        />
        <MetricCard
          label="Reserved"
          value={balance ? `${formatAtomic(balance.reservedAtomic)} USDC` : "--"}
          accent="#9a3412"
          loading={loading}
        />
        <MetricCard
          label="Spendable"
          value={balance ? `${formatAtomic(balance.spendableAtomic)} USDC` : "--"}
          accent="#1d4ed8"
          loading={loading}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_1.8fr]">
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-5">
            <h3 className="text-lg font-semibold text-slate-900">Sepolia USDC Top-Up</h3>
            <p className="mt-1 text-sm text-slate-500">
              Recharge the advertiser balance with real Ethereum Sepolia USDC, then spend that balance on creative generation and audit jobs.
            </p>
          </div>

          <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <DetailRow
              label="Treasury"
              value={wallet?.treasuryAddress || "Loading..."}
            />
            <DetailRow
              label="USDC Contract"
              value={wallet?.tokenAddress || "Loading..."}
            />
            <DetailRow
              label="Linked Wallet"
              value={wallet?.linkedWalletAddress || "Not linked yet"}
            />
            <DetailRow
              label="Connected MetaMask"
              value={connectedWallet || "Not connected"}
            />
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              onClick={handleConnectWallet}
              disabled={walletBusy}
              className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {walletBusy ? "Working..." : connectedWallet ? "Reconnect MetaMask" : "Connect MetaMask"}
            </button>
            <button
              onClick={handleLinkWallet}
              disabled={walletBusy}
              className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {walletBusy
                ? "Signing..."
                : normalizedLinkedWallet
                ? "Relink Connected Wallet"
                : "Link Connected Wallet"}
            </button>
          </div>

          <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
            {!getEthereum() ? (
              <p>
                MetaMask was not detected. Install MetaMask to link a wallet and send Sepolia USDC directly from this console.
              </p>
            ) : normalizedLinkedWallet && normalizedConnectedWallet && !walletMatches ? (
              <p>
                The connected MetaMask wallet does not match the wallet currently linked to this advertiser. Connect the linked wallet or relink this connected wallet before topping up.
              </p>
            ) : normalizedLinkedWallet ? (
              <p>
                The billing wallet is linked. Send Sepolia USDC from this wallet to the treasury, and the console will credit the transfer into your advertiser balance after confirmation.
              </p>
            ) : (
              <p>
                Connect MetaMask, then click <code>Link Connected Wallet</code>. The console will ask you to sign a short message proving that you control the wallet.
              </p>
            )}
          </div>

          <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-4">
            <label className="block text-sm font-medium text-slate-700">
              Deposit Amount ({wallet?.tokenSymbol || "USDC"})
            </label>
            <input
              value={depositAmount}
              onChange={(event) => setDepositAmount(event.target.value)}
              placeholder="5"
              inputMode="decimal"
              className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-slate-500"
            />
            <button
              onClick={handleSendDeposit}
              disabled={depositBusy || walletBusy || !wallet}
              className="mt-4 w-full rounded-xl bg-emerald-600 px-4 py-3 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {depositBusy ? "Processing Deposit..." : "Send Sepolia USDC with MetaMask"}
            </button>
            <p className="mt-3 text-xs text-slate-500">
              Need test funds? Grab Sepolia ETH and test USDC from{" "}
              <a
                href="https://faucet.circle.com/"
                target="_blank"
                rel="noreferrer"
                className="font-medium text-slate-700 underline decoration-slate-300 underline-offset-4"
              >
                Circle Faucet
              </a>
              .
            </p>
          </div>

          <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-4">
            <label className="block text-sm font-medium text-slate-700">
              Claim an Existing Deposit by Tx Hash
            </label>
            <input
              value={manualTxHash}
              onChange={(event) => setManualTxHash(event.target.value)}
              placeholder="0x..."
              className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-slate-500"
            />
            <button
              onClick={handleManualClaim}
              disabled={depositBusy || !wallet}
              className="mt-4 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {depositBusy ? "Claiming..." : "Claim Deposit"}
            </button>
            {lastTxHash && (
              <a
                href={txExplorerUrl(wallet, lastTxHash) || "#"}
                target="_blank"
                rel="noreferrer"
                className="mt-3 block text-xs font-medium text-slate-600 underline decoration-slate-300 underline-offset-4"
              >
                View latest transaction on explorer
              </a>
            )}
          </div>

          <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
            <p className="font-medium text-slate-800">How this balance is used</p>
            <p className="mt-2">
              <code>Generate</code> and <code>Submit Audit</code> still reserve budget first. After the agents finish, the platform captures the actual job cost and releases any unused budget back to your spendable balance.
            </p>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">Ledger</h3>
              <p className="mt-1 text-sm text-slate-500">
                Recent balance movements for your advertiser account.
              </p>
            </div>
            <button
              onClick={() => load(true)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-50"
            >
              {refreshing ? "Refreshing..." : "Refresh"}
            </button>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200">
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500">Type</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500">Description</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500">Amount</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-sm text-slate-400">
                      Loading ledger...
                    </td>
                  </tr>
                ) : ledger.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-sm text-slate-400">
                      No billing activity yet.
                    </td>
                  </tr>
                ) : (
                  ledger.map((entry) => (
                    <tr key={entry.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 text-sm font-medium text-slate-800">{entry.entryType}</td>
                      <td className="px-4 py-3 text-sm text-slate-600">{entry.description}</td>
                      <td
                        className="px-4 py-3 text-sm font-medium"
                        style={{ color: entry.amountAtomic >= 0 ? "#0f766e" : "#b91c1c" }}
                      >
                        {entry.amountAtomic >= 0 ? "+" : "-"}
                        {formatAtomic(Math.abs(entry.amountAtomic))} USDC
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-500">
                        {new Date(entry.createdAt).toLocaleString()}
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

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-sm font-medium text-slate-500">{label}</span>
      <code className="break-all text-right text-xs text-slate-700">{value}</code>
    </div>
  );
}

function MetricCard({
  label,
  value,
  accent,
  loading,
}: {
  label: string;
  value: string;
  accent: string;
  loading: boolean;
}) {
  return (
    <div
      className="rounded-2xl border bg-white p-6 shadow-sm"
      style={{ borderColor: "rgba(15, 23, 42, 0.08)" }}
    >
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className="mt-3 text-3xl font-semibold" style={{ color: accent }}>
        {loading ? "..." : value}
      </p>
    </div>
  );
}
