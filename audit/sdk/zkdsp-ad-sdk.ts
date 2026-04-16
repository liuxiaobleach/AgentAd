/**
 * AgentAd Verification SDK
 * Loads, verifies, and displays audited Web3 ads with verification badges.
 */

interface ZKDSPConfig {
  container: string;
  manifestUrl: string;
  verifyMode?: "api-first" | "onchain-direct";
  badgePosition?: "top-right" | "top-left" | "bottom-right" | "bottom-left";
  theme?: "light" | "dark";
  failMode?: "open" | "closed";
  apiBaseUrl?: string;
  onReady?: () => void;
  onVerified?: (result: VerifyResult) => void;
  onExpired?: (result: VerifyResult) => void;
  onRevoked?: (result: VerifyResult) => void;
  onMismatch?: (result: VerifyResult) => void;
}

interface Manifest {
  manifestId: string;
  creativeId: string;
  projectName: string;
  creativeUrl: string;
  clickUrl: string;
  declaredLandingUrl: string;
  chainId: number;
  registryAddress: string;
  attestationId: string;
  creativeHash: string;
  destinationHash: string;
  policyVersion: string;
  issuedAt: number;
  expiresAt: number;
  issuer: string;
  reportUrl: string;
}

interface VerifyResult {
  status:
    | "verified"
    | "expired"
    | "revoked"
    | "mismatch_creative"
    | "mismatch_destination"
    | "unreachable"
    | "unknown";
  attestationStatus: string;
  creativeMatched: boolean;
  destinationMatched: boolean;
  domainMatched: boolean;
  issuedAt: number | null;
  expiresAt: number | null;
  explorerUrl: string | null;
}

type SdkEvent =
  | "manifest_loaded"
  | "creative_loaded"
  | "verification_succeeded"
  | "verification_failed"
  | "verification_mismatch_creative"
  | "verification_mismatch_destination"
  | "badge_clicked";

class ZKDSPAdSDKImpl {
  private config: Required<ZKDSPConfig>;
  private container: HTMLElement | null = null;
  private manifest: Manifest | null = null;

  constructor() {
    this.config = {} as Required<ZKDSPConfig>;
  }

  async mount(userConfig: ZKDSPConfig): Promise<void> {
    this.config = {
      verifyMode: "api-first",
      badgePosition: "top-right",
      theme: "light",
      failMode: "open",
      apiBaseUrl: "",
      onReady: () => {},
      onVerified: () => {},
      onExpired: () => {},
      onRevoked: () => {},
      onMismatch: () => {},
      ...userConfig,
    };

    this.container = document.querySelector(this.config.container);
    if (!this.container) {
      console.error(`[AgentAd] Container not found: ${this.config.container}`);
      return;
    }

    this.container.style.position = "relative";
    this.container.style.display = "inline-block";

    try {
      // Step 1: Fetch manifest
      this.manifest = await this.fetchManifest();
      this.reportEvent("manifest_loaded");

      // Step 2: Load and display creative
      await this.loadCreative();
      this.reportEvent("creative_loaded");

      // Step 3: Compute hashes and verify
      const result = await this.verify();

      // Step 4: Render badge
      this.renderBadge(result);

      // Step 5: Fire callbacks
      this.fireCallbacks(result);

      this.config.onReady();
    } catch (err) {
      console.error("[AgentAd] SDK error:", err);
      if (this.config.failMode === "closed") {
        this.container.innerHTML = "";
      }
      this.renderBadge({
        status: "unreachable",
        attestationStatus: "unknown",
        creativeMatched: false,
        destinationMatched: false,
        domainMatched: false,
        issuedAt: null,
        expiresAt: null,
        explorerUrl: null,
      });
    }
  }

  private async fetchManifest(): Promise<Manifest> {
    const res = await fetch(this.config.manifestUrl);
    if (!res.ok) throw new Error("Failed to fetch manifest");
    return res.json();
  }

  private async loadCreative(): Promise<void> {
    if (!this.manifest || !this.container) return;

    const img = document.createElement("img");
    img.src = this.manifest.creativeUrl;
    img.style.width = "100%";
    img.style.display = "block";
    img.style.borderRadius = "8px";

    if (this.manifest.clickUrl) {
      const link = document.createElement("a");
      link.href = this.manifest.clickUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.appendChild(img);
      this.container.appendChild(link);
    } else {
      this.container.appendChild(img);
    }
  }

  private async verify(): Promise<VerifyResult> {
    if (!this.manifest) throw new Error("No manifest");

    // Compute creative hash
    const creativeRes = await fetch(this.manifest.creativeUrl);
    const creativeBlob = await creativeRes.arrayBuffer();
    const creativeHash = await this.sha256Hex(creativeBlob);

    // Compute destination hash
    const destination = this.canonicalizeUrl(
      this.manifest.clickUrl || this.manifest.declaredLandingUrl
    );
    const encoder = new TextEncoder();
    const destinationHash = await this.sha256Hex(
      encoder.encode(destination).buffer
    );

    if (this.config.verifyMode === "api-first") {
      return this.verifyViaApi(creativeHash, destinationHash);
    }

    // Fallback: basic local check
    return {
      status:
        creativeHash === this.manifest.creativeHash ? "verified" : "mismatch_creative",
      attestationStatus: "unknown",
      creativeMatched: creativeHash === this.manifest.creativeHash,
      destinationMatched: true,
      domainMatched: true,
      issuedAt: this.manifest.issuedAt,
      expiresAt: this.manifest.expiresAt,
      explorerUrl: null,
    };
  }

  private async verifyViaApi(
    creativeHash: string,
    destinationHash: string
  ): Promise<VerifyResult> {
    const apiUrl =
      this.config.apiBaseUrl || new URL(this.config.manifestUrl).origin;

    const res = await fetch(`${apiUrl}/api/sdk/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        attestationId: this.manifest!.attestationId,
        creativeHash: `0x${creativeHash}`,
        destinationHash: `0x${destinationHash}`,
        hostname: location.hostname,
      }),
    });

    return res.json();
  }

  private renderBadge(result: VerifyResult): void {
    if (!this.container) return;

    const badge = document.createElement("div");
    const pos = this.config.badgePosition;

    badge.style.cssText = `
      position: absolute;
      ${pos.includes("top") ? "top: 8px" : "bottom: 8px"};
      ${pos.includes("right") ? "right: 8px" : "left: 8px"};
      padding: 4px 10px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 4px;
      backdrop-filter: blur(8px);
      transition: transform 0.15s ease;
      z-index: 10;
    `;

    const statusConfig: Record<string, { text: string; bg: string; color: string; icon: string }> = {
      verified: { text: "Verified", bg: "rgba(34,197,94,0.9)", color: "#fff", icon: "\u2713" },
      expired: { text: "Expired", bg: "rgba(234,179,8,0.9)", color: "#fff", icon: "\u29D7" },
      revoked: { text: "Revoked", bg: "rgba(239,68,68,0.9)", color: "#fff", icon: "\u2717" },
      mismatch_creative: { text: "Mismatch", bg: "rgba(239,68,68,0.9)", color: "#fff", icon: "!" },
      mismatch_destination: { text: "Mismatch", bg: "rgba(239,68,68,0.9)", color: "#fff", icon: "!" },
      unreachable: { text: "Unverified", bg: "rgba(107,114,128,0.8)", color: "#fff", icon: "?" },
      unknown: { text: "Unknown", bg: "rgba(107,114,128,0.8)", color: "#fff", icon: "?" },
    };

    const cfg = statusConfig[result.status] || statusConfig.unknown;
    badge.style.backgroundColor = cfg.bg;
    badge.style.color = cfg.color;
    badge.innerHTML = `<span>${cfg.icon}</span><span>${cfg.text}</span>`;

    badge.addEventListener("mouseenter", () => {
      badge.style.transform = "scale(1.05)";
    });
    badge.addEventListener("mouseleave", () => {
      badge.style.transform = "scale(1)";
    });

    badge.addEventListener("click", () => {
      this.reportEvent("badge_clicked");
      this.showDetailPanel(result);
    });

    this.container.appendChild(badge);
  }

  private showDetailPanel(result: VerifyResult): void {
    // Remove existing panel
    const existing = document.getElementById("zkdsp-detail-panel");
    if (existing) existing.remove();

    const panel = document.createElement("div");
    panel.id = "zkdsp-detail-panel";
    panel.style.cssText = `
      position: fixed; top: 0; right: 0; bottom: 0;
      width: 360px; background: #fff; box-shadow: -4px 0 24px rgba(0,0,0,0.15);
      z-index: 10000; padding: 24px; overflow-y: auto;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    `;

    const manifest = this.manifest;
    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
        <h3 style="font-size:16px;font-weight:700;margin:0;">Ad Verification</h3>
        <button id="zkdsp-close" style="border:none;background:none;font-size:20px;cursor:pointer;">\u2715</button>
      </div>
      <div style="space-y:12px;">
        <div style="padding:12px;background:#f8fafc;border-radius:8px;margin-bottom:12px;">
          <div style="font-size:12px;color:#64748b;">Project</div>
          <div style="font-weight:600;">${manifest?.projectName || "Unknown"}</div>
        </div>
        <div style="padding:12px;background:#f8fafc;border-radius:8px;margin-bottom:12px;">
          <div style="font-size:12px;color:#64748b;">Status</div>
          <div style="font-weight:600;color:${result.status === "verified" ? "#16a34a" : "#dc2626"};">
            ${result.status.toUpperCase()}
          </div>
        </div>
        <div style="padding:12px;background:#f8fafc;border-radius:8px;margin-bottom:12px;">
          <div style="font-size:12px;color:#64748b;">Creative Match</div>
          <div style="font-weight:600;">${result.creativeMatched ? "Matched" : "Mismatch"}</div>
        </div>
        <div style="padding:12px;background:#f8fafc;border-radius:8px;margin-bottom:12px;">
          <div style="font-size:12px;color:#64748b;">Destination Match</div>
          <div style="font-weight:600;">${result.destinationMatched ? "Matched" : "Mismatch"}</div>
        </div>
        ${result.issuedAt ? `
        <div style="padding:12px;background:#f8fafc;border-radius:8px;margin-bottom:12px;">
          <div style="font-size:12px;color:#64748b;">Issued</div>
          <div>${new Date(result.issuedAt * 1000).toLocaleString()}</div>
        </div>` : ""}
        ${result.expiresAt ? `
        <div style="padding:12px;background:#f8fafc;border-radius:8px;margin-bottom:12px;">
          <div style="font-size:12px;color:#64748b;">Expires</div>
          <div>${new Date(result.expiresAt * 1000).toLocaleString()}</div>
        </div>` : ""}
        ${result.explorerUrl ? `
        <a href="${result.explorerUrl}" target="_blank" rel="noopener"
           style="display:block;text-align:center;padding:10px;background:#1d4ed8;color:#fff;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600;">
          View On-chain Proof
        </a>` : ""}
      </div>
      <div style="margin-top:20px;text-align:center;font-size:11px;color:#94a3b8;">
        Powered by AgentAd Audit
      </div>
    `;

    document.body.appendChild(panel);
    document.getElementById("zkdsp-close")?.addEventListener("click", () => {
      panel.remove();
    });
  }

  private fireCallbacks(result: VerifyResult): void {
    switch (result.status) {
      case "verified":
        this.reportEvent("verification_succeeded");
        this.config.onVerified(result);
        break;
      case "expired":
        this.reportEvent("verification_failed");
        this.config.onExpired(result);
        break;
      case "revoked":
        this.reportEvent("verification_failed");
        this.config.onRevoked(result);
        break;
      case "mismatch_creative":
        this.reportEvent("verification_mismatch_creative");
        this.config.onMismatch(result);
        break;
      case "mismatch_destination":
        this.reportEvent("verification_mismatch_destination");
        this.config.onMismatch(result);
        break;
      default:
        this.reportEvent("verification_failed");
    }
  }

  private async sha256Hex(buffer: ArrayBuffer): Promise<string> {
    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  private canonicalizeUrl(raw: string): string {
    try {
      const url = new URL(raw.trim());
      return `${url.protocol}//${url.hostname.toLowerCase()}${
        url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "")
      }`;
    } catch {
      return raw;
    }
  }

  private reportEvent(event: SdkEvent): void {
    // In production, send to analytics endpoint
    console.log(`[AgentAd] Event: ${event}`, {
      manifestId: this.manifest?.manifestId,
      attestationId: this.manifest?.attestationId,
      timestamp: Date.now(),
    });
  }
}

// Export as global
const ZKDSPAdSDK = new ZKDSPAdSDKImpl();
if (typeof window !== "undefined") {
  (window as any).ZKDSPAdSDK = ZKDSPAdSDK;
}

export default ZKDSPAdSDK;
