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
  const [tutorialOpen, setTutorialOpen] = useState(false);

  useEffect(() => {
    if (!tutorialOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTutorialOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [tutorialOpen]);

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

  const appOrigin =
    typeof window !== "undefined" ? window.location.origin : "";
  const apiOrigin =
    typeof process !== "undefined" &&
    process.env &&
    process.env.NEXT_PUBLIC_API_URL
      ? process.env.NEXT_PUBLIC_API_URL
      : appOrigin.replace(":3000", ":8080");

  const sdkCode = activeCert
    ? `<div id="agentad-ad-slot"></div>
<script src="${appOrigin}/agentad-sdk.js"></script>
<script>
  AgentAdSDK.mount({
    container: "#agentad-ad-slot",
    manifestUrl: "${apiOrigin}/api/manifests/${activeCert.id}",
    verifyMode: "api-first",
    badgePosition: "top-right",
    failMode: "closed",
    onVerified: function(result) {
      console.log("Ad verified", result);
    },
    onMismatch: function(result) {
      console.warn("Ad mismatch", result);
    },
    onExpired: function(result) {
      console.warn("Ad expired", result);
    }
  });
</script>`
    : "// No active certificates found. Submit a creative for audit first.";

  const activeManifestUrl = activeCert
    ? `${apiOrigin}/api/manifests/${activeCert.id}`
    : `${apiOrigin}/api/manifests/<MANIFEST_ID>`;
  const sdkScriptUrl = `${appOrigin}/agentad-sdk.js`;

  return (
    <div>
      <h2 className="text-2xl font-bold text-slate-900 mb-6">
        Integration / SDK
      </h2>

      <button
        onClick={() => setTutorialOpen(true)}
        className="group w-full max-w-3xl mb-8 text-left rounded-2xl overflow-hidden relative bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-900 hover:from-slate-800 hover:via-slate-700 hover:to-indigo-800 transition-all shadow-lg hover:shadow-xl ring-1 ring-white/10"
      >
        <div
          aria-hidden
          className="absolute inset-0 opacity-30 pointer-events-none"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 20%, rgba(34,211,238,0.25), transparent 40%), radial-gradient(circle at 80% 80%, rgba(168,85,247,0.25), transparent 45%)",
          }}
        />
        <div className="relative flex items-center justify-between gap-6 px-6 py-5">
          <div className="flex items-center gap-4">
            <div className="w-11 h-11 rounded-xl bg-white/10 backdrop-blur flex items-center justify-center ring-1 ring-white/20">
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-cyan-300"
              >
                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
              </svg>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-semibold tracking-widest uppercase text-cyan-300">
                  For Publishers
                </span>
                <span className="text-[10px] font-semibold tracking-widest uppercase text-white/40">
                  · 5 min read
                </span>
              </div>
              <h3 className="text-lg font-bold text-white mt-0.5">
                Publisher Integration Guide
              </h3>
              <p className="text-sm text-white/70 mt-0.5">
                Quick start, badge states, configuration, testing, FAQ —
                everything to ship a verified ad slot today.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-white/80 group-hover:text-white transition-colors">
            <span className="text-sm font-medium">Open guide</span>
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="group-hover:translate-x-0.5 transition-transform"
            >
              <path d="M5 12h14" />
              <path d="m12 5 7 7-7 7" />
            </svg>
          </div>
        </div>
      </button>

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

      {tutorialOpen && (
        <PublisherTutorialModal
          onClose={() => setTutorialOpen(false)}
          sdkScriptUrl={sdkScriptUrl}
          manifestUrl={activeManifestUrl}
          hasActiveCert={!!activeCert}
        />
      )}
    </div>
  );
}

function PublisherTutorialModal({
  onClose,
  sdkScriptUrl,
  manifestUrl,
  hasActiveCert,
}: {
  onClose: () => void;
  sdkScriptUrl: string;
  manifestUrl: string;
  hasActiveCert: boolean;
}) {
  const [section, setSection] = useState<
    "quickstart" | "states" | "config" | "testing" | "faq"
  >("quickstart");

  const sections: { id: typeof section; label: string }[] = [
    { id: "quickstart", label: "Quick Start" },
    { id: "states", label: "Badge States" },
    { id: "config", label: "Configuration" },
    { id: "testing", label: "Testing" },
    { id: "faq", label: "FAQ" },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[88vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">
              Publisher Integration Guide
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Embed a verified ad in under 5 minutes
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          <aside className="w-48 border-r border-slate-200 bg-slate-50 py-3">
            {sections.map((s) => (
              <button
                key={s.id}
                onClick={() => setSection(s.id)}
                className={`w-full text-left px-5 py-2 text-sm transition-colors ${
                  section === s.id
                    ? "bg-white text-slate-900 font-semibold border-l-2 border-slate-900"
                    : "text-slate-600 hover:text-slate-900 hover:bg-white"
                }`}
              >
                {s.label}
              </button>
            ))}
          </aside>

          <div className="flex-1 overflow-y-auto px-8 py-6 text-sm text-slate-700 leading-relaxed">
            {section === "quickstart" && (
              <QuickStart
                sdkScriptUrl={sdkScriptUrl}
                manifestUrl={manifestUrl}
                hasActiveCert={hasActiveCert}
              />
            )}
            {section === "states" && <BadgeStates />}
            {section === "config" && <ConfigGuide />}
            {section === "testing" && <TestingGuide />}
            {section === "faq" && <FAQ />}
          </div>
        </div>
      </div>
    </div>
  );
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="bg-slate-900 text-green-400 p-4 rounded-lg text-xs overflow-x-auto my-3 whitespace-pre">
      {children}
    </pre>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="text-base font-semibold text-slate-900 mt-6 mb-2 first:mt-0">
      {children}
    </h4>
  );
}

function QuickStart({
  sdkScriptUrl,
  manifestUrl,
  hasActiveCert,
}: {
  sdkScriptUrl: string;
  manifestUrl: string;
  hasActiveCert: boolean;
}) {
  const snippetStep1 = `<div id="agentad-ad-slot" style="min-width:300px;min-height:250px;"></div>`;
  const snippetStep2 = `<script src="${sdkScriptUrl}"></script>`;
  const snippetStep3 = `<script>
  AgentAdSDK.mount({
    container: "#agentad-ad-slot",
    manifestUrl: "${manifestUrl}",
    verifyMode: "api-first",
    badgePosition: "top-right",
    failMode: "closed",
    onVerified: (r) => console.log("impression", r.manifest.attestationId),
  });
</script>`;

  return (
    <div>
      <p className="mb-4">
        The SDK is a single, dependency-free JavaScript file. Drop three tags
        into any HTML page — no build tooling required.
      </p>

      {!hasActiveCert && (
        <div className="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs">
          No active certificate found on your account. Ask the advertiser for
          a manifest URL, or replace{" "}
          <code className="font-mono bg-amber-100 px-1 rounded">
            &lt;MANIFEST_ID&gt;
          </code>{" "}
          below with a real one.
        </div>
      )}

      <SectionTitle>1. Add the container</SectionTitle>
      <p>Pick a spot on your page and size it to your ad slot.</p>
      <CodeBlock>{snippetStep1}</CodeBlock>

      <SectionTitle>2. Load the SDK</SectionTitle>
      <p>
        Put the script tag once per page — typically in <code>&lt;head&gt;</code>{" "}
        or right before <code>&lt;/body&gt;</code>.
      </p>
      <CodeBlock>{snippetStep2}</CodeBlock>

      <SectionTitle>3. Mount the ad</SectionTitle>
      <p>
        Call <code className="font-mono">AgentAdSDK.mount(...)</code> with the
        manifest URL the advertiser gave you.
      </p>
      <CodeBlock>{snippetStep3}</CodeBlock>

      <div className="mt-6 p-4 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs">
        <strong>That&rsquo;s it.</strong> The SDK will fetch the manifest, call
        the verify API, render the creative with click-through, and overlay a
        tamper-evident badge. If verification fails the slot stays empty (or
        shows a warning badge if you set <code>failMode: &quot;open&quot;</code>).
      </div>
    </div>
  );
}

function BadgeStates() {
  const rows = [
    {
      badge: "✓ Verified",
      color: "bg-emerald-500",
      state: "verified",
      meaning:
        "On-chain attestation valid, creative hash matches. Safe to monetize.",
      action: "Show the ad.",
    },
    {
      badge: "⚠ Unverified",
      color: "bg-red-500",
      state: "mismatch",
      meaning:
        "The creative hash at render time doesn't match what was attested. Possible tampering or a stale cached asset.",
      action:
        "Blocked by default (failMode: closed). With failMode: open the ad still renders but with a warning badge.",
    },
    {
      badge: "⚠ Expired",
      color: "bg-red-500",
      state: "expired",
      meaning:
        "The attestation is past its expiresAt timestamp. The advertiser must re-submit the creative for audit.",
      action: "Don't monetize. Contact the advertiser.",
    },
    {
      badge: "… Pending",
      color: "bg-amber-500",
      state: "pending",
      meaning:
        "Attestation row exists but hasn't been mined on-chain yet, or the API lookup returned not_found.",
      action:
        "Usually resolves in under a minute. Safe to retry after a short delay.",
    },
  ];

  return (
    <div>
      <p className="mb-4">
        The badge in the corner of every slot reflects one of four states. Your{" "}
        <code>onVerified</code> / <code>onMismatch</code> / <code>onExpired</code>{" "}
        callbacks let you track these in analytics.
      </p>
      <div className="space-y-3">
        {rows.map((r) => (
          <div
            key={r.state}
            className="border border-slate-200 rounded-lg p-4 flex gap-4"
          >
            <span
              className={`${r.color} text-white text-xs font-semibold px-2 py-1 rounded h-min whitespace-nowrap`}
            >
              {r.badge}
            </span>
            <div className="text-xs">
              <p className="font-semibold text-slate-900 mb-1">
                state: <code>{r.state}</code>
              </p>
              <p className="text-slate-600 mb-1">{r.meaning}</p>
              <p className="text-slate-500">
                <strong>Action:</strong> {r.action}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ConfigGuide() {
  return (
    <div>
      <SectionTitle>failMode</SectionTitle>
      <p>
        Controls what the SDK does when verification fails (mismatch, expired,
        or unknown).
      </p>
      <ul className="list-disc ml-6 my-2 space-y-1 text-xs">
        <li>
          <code className="font-mono">&quot;closed&quot;</code> (default) —
          safe. Hides the creative entirely when anything goes wrong. Use this
          in production.
        </li>
        <li>
          <code className="font-mono">&quot;open&quot;</code> — show the ad
          anyway with a red warning badge. Use only for debugging or internal
          dashboards.
        </li>
      </ul>

      <SectionTitle>badgePosition</SectionTitle>
      <p>
        Corner of the slot where the verification badge overlays. One of{" "}
        <code>top-right</code> (default), <code>top-left</code>,{" "}
        <code>bottom-right</code>, <code>bottom-left</code>. The badge is{" "}
        <code>position: absolute</code> inside the container, so give the
        container <code>min-height</code>/<code>min-width</code> if you want
        the badge to land reliably.
      </p>

      <SectionTitle>Callbacks</SectionTitle>
      <p>
        All three receive one argument:{" "}
        <code>{`{ manifest, verify, decision }`}</code>.
      </p>
      <CodeBlock>{`onVerified: (r) => analytics.track("impression", {
  attestationId: r.manifest.attestationId,
  project: r.manifest.projectName,
});

onMismatch: (r) => analytics.track("ad_tamper", {
  status: r.verify.status,
});`}</CodeBlock>
      <p className="text-xs text-slate-500 mt-2">
        <strong>Tip:</strong> <code>onVerified</code> is your trusted
        impression signal — it fires exactly once when the ad genuinely passed
        verification. Use it instead of <code>img.onload</code>.
      </p>

      <SectionTitle>Return handle</SectionTitle>
      <p>
        <code>mount()</code> returns <code>{`{ destroy(), refresh() }`}</code>.
        Call <code>destroy()</code> when removing the slot (e.g., in a SPA
        route change) to cancel in-flight fetches and clear the DOM.
      </p>
    </div>
  );
}

function TestingGuide() {
  return (
    <div>
      <SectionTitle>Before you ship</SectionTitle>

      <p className="mb-3">Three things to check:</p>
      <ol className="list-decimal ml-6 space-y-3 text-xs">
        <li>
          <strong>Happy path:</strong> Open the SDK test page at{" "}
          <a
            href="/sdk-test.html"
            target="_blank"
            rel="noreferrer"
            className="text-blue-600 hover:underline"
          >
            /sdk-test.html
          </a>{" "}
          to confirm the SDK can reach your platform and render a real
          verified ad.
        </li>
        <li>
          <strong>Failure UI:</strong> Temporarily set{" "}
          <code>failMode: &quot;open&quot;</code> to see what the
          &quot;Unverified&quot; state looks like. Then flip back to{" "}
          <code>&quot;closed&quot;</code> for production.
        </li>
        <li>
          <strong>Missing ad:</strong> Pass a bogus manifest ID (e.g.,{" "}
          <code>/api/manifests/does-not-exist</code>) to confirm your layout
          handles the empty-slot state cleanly — the SDK renders a thin{" "}
          &quot;Ad unavailable&quot; row.
        </li>
      </ol>

      <SectionTitle>What a real impression looks like</SectionTitle>
      <p className="text-xs">Open the browser devtools Network tab and look for:</p>
      <ul className="list-disc ml-6 my-2 space-y-1 text-xs">
        <li>
          <code>GET /api/manifests/&lt;id&gt;</code> — 200, returns JSON
        </li>
        <li>
          <code>POST /api/sdk/verify</code> — 200, returns{" "}
          <code>{`{ status: "verified", ... }`}</code>
        </li>
        <li>
          <code>GET /uploads/&lt;creative&gt;.png</code> — 200, the actual
          image
        </li>
      </ul>
      <p className="text-xs text-slate-500 mt-2">
        If you don&rsquo;t see all three, check the Console panel — the SDK
        logs every failure with <code>[AgentAdSDK]</code> prefix.
      </p>
    </div>
  );
}

function FAQ() {
  const items: { q: string; a: React.ReactNode }[] = [
    {
      q: "Do I need to configure CORS on my side?",
      a: (
        <>
          No. The platform&rsquo;s backend echoes the <code>Origin</code>{" "}
          header, so cross-origin requests from any publisher domain work out
          of the box. You may need to adjust your site&rsquo;s{" "}
          <code>Content-Security-Policy</code> to allow{" "}
          <code>script-src</code> and <code>img-src</code> from the platform
          domain.
        </>
      ),
    },
    {
      q: "Do my visitors need a crypto wallet?",
      a: (
        <>
          No. Default <code>verifyMode: &quot;api-first&quot;</code> uses the
          platform&rsquo;s verify API which reads on-chain state for you. The{" "}
          <code>onchain-direct</code> mode (coming soon) would connect to an
          RPC from the browser.
        </>
      ),
    },
    {
      q: "How do I measure impressions and clicks?",
      a: (
        <>
          <p>
            <strong>Impressions:</strong> wire your analytics call inside{" "}
            <code>onVerified</code>. It fires exactly once, only when the ad
            has genuinely passed verification — no spoofing.
          </p>
          <p className="mt-2">
            <strong>Clicks:</strong> the SDK renders a standard{" "}
            <code>&lt;a&gt;</code> element with <code>target=&quot;_blank&quot;</code>.
            Attach your own delegated click listener on the container, or
            enable UTM parameters on the advertiser&rsquo;s landing URL.
          </p>
        </>
      ),
    },
    {
      q: "Can I style the badge or hide it?",
      a: (
        <>
          The badge is part of the trust signal — hiding it defeats the point.
          But you can move it with <code>badgePosition</code>. To restyle,
          override the <code>.agentad-badge</code> CSS class on your page{" "}
          (loaded after the SDK).
        </>
      ),
    },
    {
      q: "What if the network fails?",
      a: (
        <>
          The SDK shows a small &quot;Ad unavailable&quot; placeholder and
          logs to the browser console. No callbacks fire. Your layout never
          sees a broken image.
        </>
      ),
    },
    {
      q: "Can I load multiple ads on one page?",
      a: (
        <>
          Yes. Call <code>AgentAdSDK.mount()</code> once per container. Each
          returns an independent handle. Use unique container IDs.
        </>
      ),
    },
    {
      q: "Is the creative image cached?",
      a: (
        <>
          The image is served from the platform&rsquo;s upload host with
          standard HTTP caching. The hash of the bytes is what gets verified,
          so a cache hit doesn&rsquo;t bypass the trust check — the on-chain
          attestation is the source of truth.
        </>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {items.map((it) => (
        <details
          key={it.q}
          className="border border-slate-200 rounded-lg px-4 py-3 group"
        >
          <summary className="cursor-pointer text-sm font-medium text-slate-900 list-none flex items-center justify-between">
            <span>{it.q}</span>
            <span className="text-slate-400 group-open:rotate-45 transition-transform">
              +
            </span>
          </summary>
          <div className="mt-3 text-xs text-slate-600 leading-relaxed">
            {it.a}
          </div>
        </details>
      ))}
    </div>
  );
}
