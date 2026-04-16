"use client";

import { apiFetch } from "@/lib/api";

import { useEffect, useState } from "react";

interface CertificateRecord {
  id: string;
  status?: string;
}

export default function IntegrationsPage() {
  const [certs, setCerts] = useState<CertificateRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    apiFetch("/api/certificates")
      .then(async (r) => {
        const data = await r.json().catch(() => null);
        if (!r.ok) {
          throw new Error(
            (data && typeof data.error === "string" && data.error) ||
              "Failed to load certificates"
          );
        }
        return Array.isArray(data) ? data : [];
      })
      .then((data) => {
        if (cancelled) return;
        setCerts(data);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setCerts([]);
        setError(err instanceof Error ? err.message : "Failed to load certificates");
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const activeCert = certs.find((c) => c.status === "ACTIVE");

  async function handleCopyCode() {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      setCopyFeedback("Clipboard is not available in this browser.");
      return;
    }

    try {
      await navigator.clipboard.writeText(sdkCode);
      setCopyFeedback("Code copied.");
      setTimeout(() => setCopyFeedback(null), 2000);
    } catch {
      setCopyFeedback("Copy failed.");
    }
  }

  const sdkCode = activeCert
    ? `<div id="agentad-ad-slot"></div>
<script src="https://cdn.example.com/agentad-sdk.min.js"></script>
<script>
  AgentAdSDK.mount({
    container: "#agentad-ad-slot",
    manifestUrl: "${
      typeof window !== "undefined" ? window.location.origin : ""
    }/api/manifests/${activeCert.id}",
    verifyMode: "api-first",
    badgePosition: "top-right",
    onVerified: function(result) {
      console.log("Ad verified", result);
    },
    onMismatch: function(result) {
      console.warn("Ad mismatch", result);
    }
  });
</script>`
    : "// No active certificates found. Submit a creative for audit first.";

  return (
    <div>
      <h2 className="text-2xl font-bold text-slate-900 mb-8">
        Integration / SDK
      </h2>

      <div className="space-y-6 max-w-3xl">
        {/* SDK Info */}
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h3 className="font-semibold text-slate-900 mb-4">
            Ad Verification SDK
          </h3>
          <p className="text-sm text-slate-600 mb-4">
            Use this SDK to display verified ads on your website. The SDK
            loads the ad manifest, verifies the creative hash and
            attestation, and displays a verification badge.
          </p>

          <div className="space-y-3">
            <h4 className="text-sm font-medium text-slate-700">
              Integration Code
            </h4>
            {loading && (
              <p className="text-sm text-slate-400">Loading certificates...</p>
            )}
            {error && (
              <p className="text-sm text-red-500">{error}</p>
            )}
            <pre className="bg-slate-900 text-green-400 p-4 rounded-lg text-xs overflow-x-auto">
              {sdkCode}
            </pre>
            <button
              onClick={handleCopyCode}
              className="px-3 py-1.5 bg-slate-100 text-slate-700 rounded text-sm hover:bg-slate-200 transition-colors"
            >
              Copy Code
            </button>
            {copyFeedback && (
              <p className="text-xs text-slate-500">{copyFeedback}</p>
            )}
          </div>
        </div>

        {/* Verification Modes */}
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h3 className="font-semibold text-slate-900 mb-4">
            Verification Modes
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="border border-slate-200 rounded-lg p-4">
              <h4 className="font-medium text-slate-900 mb-2">
                API First (Recommended)
              </h4>
              <p className="text-sm text-slate-600">
                SDK calls the verification API, which checks on-chain state.
                Faster, works in all environments.
              </p>
              <span className="badge-verified mt-2">Default</span>
            </div>
            <div className="border border-slate-200 rounded-lg p-4">
              <h4 className="font-medium text-slate-900 mb-2">
                On-chain Direct
              </h4>
              <p className="text-sm text-slate-600">
                SDK connects directly to RPC and reads the attestation
                contract. More trustless, requires wallet provider.
              </p>
              <span className="badge-pending mt-2">Coming Soon</span>
            </div>
          </div>
        </div>

        {/* SDK Configuration */}
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h3 className="font-semibold text-slate-900 mb-4">
            SDK Configuration Options
          </h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 text-slate-500">Option</th>
                <th className="text-left py-2 text-slate-500">Type</th>
                <th className="text-left py-2 text-slate-500">
                  Description
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {[
                ["container", "string", "CSS selector for the ad slot"],
                ["manifestUrl", "string", "URL to fetch the ad manifest"],
                [
                  "verifyMode",
                  '"api-first" | "onchain-direct"',
                  "Verification strategy",
                ],
                [
                  "badgePosition",
                  "string",
                  "Badge position: top-right, top-left, bottom-right, bottom-left",
                ],
                [
                  "failMode",
                  '"open" | "closed"',
                  "Whether to show ad on verification failure",
                ],
                ["onVerified", "function", "Callback on successful verification"],
                ["onMismatch", "function", "Callback on hash mismatch"],
                ["onExpired", "function", "Callback on expired certificate"],
              ].map(([option, type, desc]) => (
                <tr key={option}>
                  <td className="py-2 font-mono text-xs text-slate-900">
                    {option}
                  </td>
                  <td className="py-2 font-mono text-xs text-slate-500">
                    {type}
                  </td>
                  <td className="py-2 text-slate-600">{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
