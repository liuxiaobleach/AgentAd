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
  toFunctionSelector,
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
  treasuryAddress: string; // this is the BudgetEscrow contract address
  explorerBaseUrl: string;
};

// Minimal BudgetEscrow ABI — deposit(amount) + depositWithPermit(...).
const budgetEscrowAbi = [
  {
    type: "function",
    name: "deposit",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "depositWithPermit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "deadline", type: "uint256" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "deposits",
    stateMutability: "view",
    inputs: [{ name: "advertiser", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

// EIP-2612 permit support on the USDC token — read nonces, name, version.
const permitTokenAbi = [
  {
    type: "function",
    name: "nonces",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "version",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
] as const;

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

type PermitSignatureComponents = { v: number; r: `0x${string}`; s: `0x${string}` };

const DEPOSIT_WITH_PERMIT_SELECTOR = toFunctionSelector(
  "depositWithPermit(uint256,uint256,uint8,bytes32,bytes32)"
).slice(2); // strip 0x

async function escrowSupportsDepositWithPermit(
  publicClient: ReturnType<typeof createPublicClient>,
  escrowAddress: Address
): Promise<boolean> {
  try {
    const code = await publicClient.getCode({ address: escrowAddress });
    if (!code) return false;
    return code.toLowerCase().includes(DEPOSIT_WITH_PERMIT_SELECTOR.toLowerCase());
  } catch {
    return false;
  }
}

async function trySignPermit({
  ethereum,
  publicClient,
  wallet,
  owner,
  amount,
  deadline,
}: {
  ethereum: EthereumProvider;
  publicClient: ReturnType<typeof createPublicClient>;
  wallet: BillingWallet;
  owner: Address;
  amount: bigint;
  deadline: bigint;
}): Promise<PermitSignatureComponents | null> {
  // Probe the token for EIP-2612 support. If nonces() or name() is missing,
  // bail out — caller will fall back to approve + deposit.
  let nonce: bigint;
  let tokenName: string;
  let tokenVersion = "1";
  try {
    nonce = (await publicClient.readContract({
      address: wallet.tokenAddress as Address,
      abi: permitTokenAbi,
      functionName: "nonces",
      args: [owner],
    })) as bigint;
    tokenName = (await publicClient.readContract({
      address: wallet.tokenAddress as Address,
      abi: permitTokenAbi,
      functionName: "name",
      args: [],
    })) as string;
  } catch {
    return null;
  }
  try {
    tokenVersion = (await publicClient.readContract({
      address: wallet.tokenAddress as Address,
      abi: permitTokenAbi,
      functionName: "version",
      args: [],
    })) as string;
  } catch {
    // Some permit tokens (e.g. Circle USDC) use version "2"; fall back to "1"
    // when the call reverts. If the signature ends up invalid, the contract
    // will reject it and the caller retries via approve + deposit.
    tokenVersion = "1";
  }

  const typedData = {
    domain: {
      name: tokenName,
      version: tokenVersion,
      chainId: wallet.chainId,
      verifyingContract: wallet.tokenAddress,
    },
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "Permit",
    message: {
      owner,
      spender: wallet.treasuryAddress,
      value: amount.toString(),
      nonce: nonce.toString(),
      deadline: deadline.toString(),
    },
  };

  let signature: string;
  try {
    signature = (await ethereum.request({
      method: "eth_signTypedData_v4",
      params: [owner, JSON.stringify(typedData)],
    })) as string;
  } catch {
    return null;
  }

  if (!signature || !signature.startsWith("0x") || signature.length < 132) {
    return null;
  }

  const r = `0x${signature.slice(2, 66)}` as `0x${string}`;
  const s = `0x${signature.slice(66, 130)}` as `0x${string}`;
  let v = parseInt(signature.slice(130, 132), 16);
  if (v < 27) v += 27;

  return { v, r, s };
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

type DepositStage =
  | "idle"
  | "permit-sign"
  | "deposit-sign"
  | "deposit-wait"
  | "crediting"
  | "success"
  | "error";

type DepositRunContext = {
  amount: string;
  tokenSymbol: string;
  mode: "permit" | "approve" | "manual";
  depositTxHash?: string;
  errorMessage?: string;
  manualClaim?: boolean;
};

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
  const [depositStage, setDepositStage] = useState<DepositStage>("idle");
  const [depositRun, setDepositRun] = useState<DepositRunContext | null>(null);

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
    const tokenSymbol = wallet.tokenSymbol || "USDC";
    const trimmedAmount = depositAmount.trim();
    setDepositRun({ amount: trimmedAmount, tokenSymbol, mode: "permit" });
    setDepositStage("permit-sign");
    try {
      const ethereum = getEthereum();
      if (!ethereum) {
        throw new Error("MetaMask was not detected. Install it, then reload this page.");
      }

      if (!trimmedAmount) {
        throw new Error("Enter a USDC amount before sending the deposit.");
      }

      const amountAtomic = parseUnits(trimmedAmount, wallet.tokenDecimals);
      if (amountAtomic <= BigInt(0)) {
        throw new Error("Deposit amount must be greater than zero.");
      }

      await ensureSepoliaWalletNetwork(ethereum, wallet);

      const publicClient = createPublicClient({
        chain: sepolia,
        transport: http(wallet.rpcUrl),
      });

      // Try the EIP-2612 permit fast path: sign a Permit typed-data message
      // off-chain and let BudgetEscrow.depositWithPermit bundle
      // permit + transferFrom + deposit into a single on-chain tx.
      // We first check the deployed escrow actually implements
      // depositWithPermit — older deployments don't, and we should avoid
      // asking the user to sign a permit we can't consume.
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 30); // 30 min
      const escrowSupportsPermit = await escrowSupportsDepositWithPermit(
        publicClient,
        wallet.treasuryAddress as Address
      );
      const permitSig = escrowSupportsPermit
        ? await trySignPermit({
            ethereum,
            publicClient,
            wallet,
            owner: normalizedConnectedWallet,
            amount: amountAtomic,
            deadline,
          })
        : null;

      let txHash: string;
      if (permitSig) {
        setDepositStage("deposit-sign");
        setStatus("Sending depositWithPermit() in a single transaction...");
        txHash = (await ethereum.request({
          method: "eth_sendTransaction",
          params: [
            {
              from: normalizedConnectedWallet,
              to: wallet.treasuryAddress,
              data: encodeFunctionData({
                abi: budgetEscrowAbi,
                functionName: "depositWithPermit",
                args: [amountAtomic, deadline, permitSig.v, permitSig.r, permitSig.s],
              }),
            },
          ],
        })) as string;
      } else {
        // Fallback: token does not support permit. Fall back to the legacy
        // two-tx approve + deposit flow.
        setDepositRun((prev) => (prev ? { ...prev, mode: "approve" } : prev));
        setDepositStage("permit-sign");
        setStatus("Token has no permit support — falling back to approve + deposit...");

        const approveTxHash = (await ethereum.request({
          method: "eth_sendTransaction",
          params: [
            {
              from: normalizedConnectedWallet,
              to: wallet.tokenAddress,
              data: encodeFunctionData({
                abi: erc20Abi,
                functionName: "approve",
                args: [wallet.treasuryAddress as Address, amountAtomic],
              }),
            },
          ],
        })) as string;
        setStatus("Waiting for approve tx confirmation...");
        await publicClient.waitForTransactionReceipt({
          hash: approveTxHash as `0x${string}`,
        });

        setDepositStage("deposit-sign");
        setStatus("Sending deposit() transaction...");
        txHash = (await ethereum.request({
          method: "eth_sendTransaction",
          params: [
            {
              from: normalizedConnectedWallet,
              to: wallet.treasuryAddress,
              data: encodeFunctionData({
                abi: budgetEscrowAbi,
                functionName: "deposit",
                args: [amountAtomic],
              }),
            },
          ],
        })) as string;
      }

      setLastTxHash(txHash);
      setManualTxHash(txHash);
      setDepositRun((prev) => (prev ? { ...prev, depositTxHash: txHash } : prev));
      setDepositStage("deposit-wait");
      setStatus("Waiting for deposit tx confirmation...");
      await publicClient.waitForTransactionReceipt({
        hash: txHash as `0x${string}`,
      });

      setDepositStage("crediting");
      setStatus("Deposit confirmed on-chain. Crediting your platform balance...");
      await claimDeposit(txHash);
      setStatus("Sepolia USDC deposit credited successfully.");
      setDepositStage("success");
    } catch (err: any) {
      const message = err?.message || "Failed to send Sepolia USDC deposit";
      setError(message);
      setStatus(null);
      setDepositRun((prev) => (prev ? { ...prev, errorMessage: message } : prev));
      setDepositStage("error");
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

    const tokenSymbol = wallet?.tokenSymbol || "USDC";
    setDepositBusy(true);
    setError(null);
    setStatus("Verifying Sepolia transaction and crediting balance...");
    setDepositRun({
      amount: depositAmount.trim() || "--",
      tokenSymbol,
      mode: "manual",
      depositTxHash: txHash,
      manualClaim: true,
    });
    setDepositStage("crediting");
    try {
      await claimDeposit(txHash);
      setLastTxHash(txHash);
      setStatus("Sepolia USDC deposit credited successfully.");
      setDepositStage("success");
    } catch (err: any) {
      const message = err?.message || "Failed to claim deposit";
      setError(message);
      setStatus(null);
      setDepositRun((prev) => (prev ? { ...prev, errorMessage: message } : prev));
      setDepositStage("error");
    } finally {
      setDepositBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <DepositProgressModal
        stage={depositStage}
        run={depositRun}
        explorerUrl={txExplorerUrl(wallet, depositRun?.depositTxHash || null)}
        onClose={() => {
          setDepositStage("idle");
          setDepositRun(null);
        }}
      />
      <div className="flex items-end justify-between gap-6">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Billing</h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-500">
            Top-ups use an EIP-2612 permit so approve + deposit happen in a single{" "}
            <code>BudgetEscrow.depositWithPermit()</code> transaction. You sign the permit
            off-chain (no gas), and the console credits your spendable balance after the
            deposit tx is confirmed.
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
              label="Budget Escrow"
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
              {depositBusy ? "Processing Deposit..." : "Deposit in one tx (Permit)"}
            </button>
            <p className="mt-2 text-xs text-slate-500">
              MetaMask prompts twice: first a <em>typed-data permit signature</em> (free,
              off-chain), then <code>escrow.depositWithPermit()</code>, which bundles the
              approve + deposit on-chain. Tokens without permit fall back to the legacy
              two-tx flow automatically.
            </p>
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

function DepositProgressModal({
  stage,
  run,
  explorerUrl,
  onClose,
}: {
  stage: DepositStage;
  run: DepositRunContext | null;
  explorerUrl: string | null;
  onClose: () => void;
}) {
  if (stage === "idle" || !run) return null;

  const phases: Array<{ key: string; label: string; subtitle: string }> = run.mode === "manual"
    ? [
        { key: "credit", label: "Credit balance", subtitle: "Verify the pasted transaction and credit your balance." },
      ]
    : run.mode === "approve"
    ? [
        { key: "approve", label: "Approve USDC (fallback)", subtitle: "Token has no permit — sending a separate approve tx." },
        { key: "deposit", label: "Deposit", subtitle: "Call BudgetEscrow.deposit() with your amount." },
        { key: "credit", label: "Credit balance", subtitle: "Verify the on-chain event and credit your balance." },
      ]
    : [
        { key: "permit", label: "Sign permit (gasless)", subtitle: "Sign a typed-data Permit so no approve tx is needed." },
        { key: "deposit", label: "Deposit (single tx)", subtitle: "Call depositWithPermit() — approve + deposit in one tx." },
        { key: "credit", label: "Credit balance", subtitle: "Verify the on-chain event and credit your balance." },
      ];

  const stageToIndex: Record<DepositStage, number> = run.mode === "manual"
    ? {
        idle: -1,
        "permit-sign": -1,
        "deposit-sign": -1,
        "deposit-wait": -1,
        crediting: 0,
        success: 1,
        error: -1,
      }
    : {
        idle: -1,
        "permit-sign": 0,
        "deposit-sign": 1,
        "deposit-wait": 1,
        crediting: 2,
        success: 3,
        error: -1,
      };
  const stageLabel: Record<DepositStage, string> = {
    idle: "",
    "permit-sign": run.mode === "approve"
      ? "Confirm the approve transaction in MetaMask"
      : "Sign the permit message in MetaMask (no gas)",
    "deposit-sign": run.mode === "approve"
      ? "Confirm the deposit transaction in MetaMask"
      : "Confirm the depositWithPermit transaction in MetaMask",
    "deposit-wait": "Waiting for the deposit tx to be mined",
    crediting: "Backend verifying tx and crediting your balance",
    success: "Top-up complete",
    error: "Something went wrong",
  };

  const activeIdx = stageToIndex[stage];
  const isSuccess = stage === "success";
  const isError = stage === "error";
  const runSummary = run.manualClaim ? "Manual deposit claim" : "Sepolia USDC top-up";

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center px-4"
      style={{ background: "rgba(15, 23, 42, 0.55)", backdropFilter: "blur(6px)" }}
      role="dialog"
      aria-modal="true"
    >
      <style>{`
        @keyframes zkdsp-pop-in {
          0% { transform: scale(0.4); opacity: 0; }
          60% { transform: scale(1.12); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes zkdsp-ring-pulse {
          0% { transform: scale(0.7); opacity: 0.55; }
          100% { transform: scale(2.2); opacity: 0; }
        }
        @keyframes zkdsp-draw-check {
          from { stroke-dashoffset: 48; }
          to { stroke-dashoffset: 0; }
        }
        @keyframes zkdsp-fade-up {
          from { transform: translateY(8px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        .zkdsp-pop-in { animation: zkdsp-pop-in 0.55s cubic-bezier(0.34, 1.56, 0.64, 1) forwards; }
        .zkdsp-ring-pulse { animation: zkdsp-ring-pulse 1.6s ease-out infinite; }
        .zkdsp-draw-check {
          stroke-dasharray: 48;
          stroke-dashoffset: 48;
          animation: zkdsp-draw-check 0.5s 0.25s ease-out forwards;
        }
        .zkdsp-fade-up { animation: zkdsp-fade-up 0.45s 0.2s ease-out both; }
        .zkdsp-spinner {
          border: 3px solid rgba(15, 118, 110, 0.18);
          border-top-color: #0f766e;
          border-radius: 9999px;
          animation: spin 0.9s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>

      <div
        className="relative w-full max-w-md rounded-3xl bg-white p-7 shadow-2xl zkdsp-pop-in"
        style={{ boxShadow: "0 25px 60px rgba(15, 23, 42, 0.25)" }}
      >
        <div className="flex items-center gap-3">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-2xl"
            style={{
              background: isError
                ? "rgba(220, 38, 38, 0.1)"
                : isSuccess
                ? "rgba(16, 185, 129, 0.12)"
                : "rgba(15, 118, 110, 0.12)",
              color: isError ? "#dc2626" : isSuccess ? "#059669" : "#0f766e",
            }}
          >
            {isSuccess ? "✓" : isError ? "!" : "⟳"}
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-slate-400">{runSummary}</p>
            <p className="text-lg font-semibold text-slate-900">
              {run.amount} {run.tokenSymbol}
            </p>
          </div>
        </div>

        <div className="mt-6">
          {isSuccess ? (
            <DepositSuccessArt />
          ) : isError ? (
            <DepositErrorArt message={run.errorMessage || "Deposit failed"} />
          ) : (
            <DepositStepList phases={phases} activeIdx={activeIdx} stage={stage} stageLabel={stageLabel[stage]} />
          )}
        </div>

        {run.depositTxHash && (
          <div className="mt-6 space-y-1 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
            {run.depositTxHash && (
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-slate-500">Deposit Tx</span>
                {explorerUrl ? (
                  <a
                    href={explorerUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="truncate text-slate-700 underline decoration-slate-300 underline-offset-2 hover:text-slate-900"
                  >
                    {shortenHash(run.depositTxHash)}
                  </a>
                ) : (
                  <code className="truncate">{shortenHash(run.depositTxHash)}</code>
                )}
              </div>
            )}
          </div>
        )}

        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            disabled={!isSuccess && !isError}
            className="rounded-xl px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50"
            style={{
              background: isSuccess ? "#059669" : isError ? "#dc2626" : "#e2e8f0",
              color: isSuccess || isError ? "white" : "#64748b",
            }}
          >
            {isSuccess ? "Done" : isError ? "Close" : "Please wait..."}
          </button>
        </div>
      </div>
    </div>
  );
}

function DepositStepList({
  phases,
  activeIdx,
  stage,
  stageLabel,
}: {
  phases: Array<{ key: string; label: string; subtitle: string }>;
  activeIdx: number;
  stage: DepositStage;
  stageLabel: string;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">{stageLabel}</p>
      <ol className="space-y-3">
        {phases.map((phase, idx) => {
          const done = idx < activeIdx;
          const active = idx === activeIdx;
          return (
            <li
              key={phase.key}
              className="flex items-start gap-3 rounded-2xl border px-3 py-3 transition-colors"
              style={{
                borderColor: done ? "rgba(16, 185, 129, 0.35)" : active ? "rgba(15, 118, 110, 0.35)" : "rgba(226, 232, 240, 0.9)",
                background: done ? "rgba(16, 185, 129, 0.06)" : active ? "rgba(15, 118, 110, 0.05)" : "white",
              }}
            >
              <div
                className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
                style={{
                  background: done ? "#10b981" : active ? "white" : "#f1f5f9",
                  color: done ? "white" : active ? "#0f766e" : "#94a3b8",
                  border: active ? "2px solid #0f766e" : "none",
                }}
              >
                {done ? "✓" : active ? (
                  <span className="zkdsp-spinner h-4 w-4 block" />
                ) : (
                  idx + 1
                )}
              </div>
              <div className="flex-1">
                <p className={`text-sm font-medium ${done || active ? "text-slate-900" : "text-slate-500"}`}>
                  {phase.label}
                </p>
                <p className="text-xs text-slate-500 mt-0.5 leading-5">{phase.subtitle}</p>
                {active && (stage === "permit-sign" || stage === "deposit-sign") && (
                  <p className="mt-1 text-xs font-medium text-emerald-700">Awaiting MetaMask confirmation...</p>
                )}
                {active && stage === "deposit-wait" && (
                  <p className="mt-1 text-xs font-medium text-emerald-700">Waiting for on-chain confirmation...</p>
                )}
                {active && stage === "crediting" && (
                  <p className="mt-1 text-xs font-medium text-emerald-700">Backend verifying + crediting...</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function DepositSuccessArt() {
  return (
    <div className="flex flex-col items-center py-3">
      <div className="relative flex h-24 w-24 items-center justify-center">
        <span
          className="zkdsp-ring-pulse absolute inset-0 rounded-full"
          style={{ background: "rgba(16, 185, 129, 0.35)" }}
        />
        <span
          className="zkdsp-ring-pulse absolute inset-0 rounded-full"
          style={{ background: "rgba(16, 185, 129, 0.2)", animationDelay: "0.4s" }}
        />
        <div
          className="zkdsp-pop-in relative flex h-20 w-20 items-center justify-center rounded-full"
          style={{ background: "#10b981", boxShadow: "0 10px 30px rgba(16, 185, 129, 0.45)" }}
        >
          <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
            <path
              d="M9 18.5 L15.5 25 L27 12"
              stroke="white"
              strokeWidth="3.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="zkdsp-draw-check"
            />
          </svg>
        </div>
      </div>
      <p className="zkdsp-fade-up mt-5 text-lg font-semibold text-slate-900">Top-up credited!</p>
      <p className="zkdsp-fade-up mt-1 text-center text-sm text-slate-500 leading-6" style={{ animationDelay: "0.32s" }}>
        Your spendable balance has been updated. You can start spending it on audits, generation, and bids.
      </p>
    </div>
  );
}

function DepositErrorArt({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center py-3">
      <div
        className="zkdsp-pop-in flex h-16 w-16 items-center justify-center rounded-full text-3xl"
        style={{ background: "rgba(220, 38, 38, 0.12)", color: "#dc2626" }}
      >
        ×
      </div>
      <p className="zkdsp-fade-up mt-4 text-base font-semibold text-slate-900">Deposit could not be completed</p>
      <p
        className="zkdsp-fade-up mt-2 max-h-32 overflow-auto text-center text-xs leading-6 text-slate-500"
        style={{ animationDelay: "0.3s" }}
      >
        {message}
      </p>
    </div>
  );
}

function shortenHash(hash: string) {
  if (!hash) return "";
  if (hash.length <= 14) return hash;
  return `${hash.slice(0, 8)}...${hash.slice(-6)}`;
}
