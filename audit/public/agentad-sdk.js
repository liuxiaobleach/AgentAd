/*
 * AgentAd Verification SDK (v0)
 * ---------------------------------
 * Publishers embed this script to display verified ads in their pages.
 * The SDK fetches a signed manifest, validates it against the platform's
 * verify endpoint (which in turn checks on-chain state), renders the
 * creative, and overlays a tamper-evident badge.
 *
 * Usage:
 *   <div id="agentad-ad-slot"></div>
 *   <script src="https://<platform>/agentad-sdk.js"></script>
 *   <script>
 *     AgentAdSDK.mount({
 *       container: "#agentad-ad-slot",
 *       manifestUrl: "https://<platform>/api/manifests/<id>",
 *       verifyMode: "api-first",
 *       badgePosition: "top-right",
 *       failMode: "closed",
 *       onVerified: r => console.log("verified", r),
 *       onMismatch: r => console.warn("mismatch", r),
 *       onExpired:  r => console.warn("expired", r),
 *     });
 *   </script>
 */
(function (global) {
  "use strict";

  var STYLE_ID = "agentad-sdk-styles";
  var STYLES = [
    ".agentad-root{position:relative;display:block;line-height:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;}",
    ".agentad-root a.agentad-link{display:block;line-height:0;}",
    ".agentad-root img.agentad-creative{max-width:100%;height:auto;display:block;}",
    ".agentad-badge{position:absolute;padding:4px 10px;border-radius:12px;font-size:11px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:4px;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);transition:transform .15s;z-index:10;line-height:1;user-select:none;}",
    ".agentad-badge:hover{transform:scale(1.05);}",
    ".agentad-badge.verified{background:rgba(34,197,94,0.92);color:#fff;}",
    ".agentad-badge.pending{background:rgba(234,179,8,0.85);color:#fff;}",
    ".agentad-badge.error{background:rgba(239,68,68,0.9);color:#fff;}",
    ".agentad-badge.top-right{top:8px;right:8px;}",
    ".agentad-badge.top-left{top:8px;left:8px;}",
    ".agentad-badge.bottom-right{bottom:8px;right:8px;}",
    ".agentad-badge.bottom-left{bottom:8px;left:8px;}",
    ".agentad-loading{display:flex;align-items:center;justify-content:center;min-height:120px;color:#94a3b8;font-size:13px;background:#f8fafc;}",
    ".agentad-panel{position:fixed;top:0;right:0;bottom:0;width:360px;max-width:92vw;background:#fff;box-shadow:-4px 0 24px rgba(0,0,0,0.15);z-index:2147483647;padding:22px;overflow-y:auto;color:#0f172a;line-height:1.5;}",
    ".agentad-panel h3{font-size:15px;font-weight:700;margin:0 0 14px 0;}",
    ".agentad-panel .row{padding:10px 12px;background:#f8fafc;border-radius:8px;margin-bottom:10px;font-size:12px;}",
    ".agentad-panel .row .k{font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;}",
    ".agentad-panel .row .v{font-weight:600;word-break:break-all;}",
    ".agentad-panel .row.ok{background:#f0fdf4;border:1px solid #bbf7d0;color:#166534;}",
    ".agentad-panel .row.bad{background:#fef2f2;border:1px solid #fecaca;color:#991b1b;}",
    ".agentad-panel .close{position:absolute;top:12px;right:12px;border:none;background:none;font-size:20px;cursor:pointer;color:#475569;}",
    ".agentad-panel a{color:#2563eb;text-decoration:none;}",
    ".agentad-panel a:hover{text-decoration:underline;}",
  ].join("");

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var el = document.createElement("style");
    el.id = STYLE_ID;
    el.appendChild(document.createTextNode(STYLES));
    document.head.appendChild(el);
  }

  function resolveContainer(sel) {
    if (!sel) throw new Error("AgentAdSDK: `container` is required");
    if (typeof sel === "string") {
      var el = document.querySelector(sel);
      if (!el) throw new Error("AgentAdSDK: container `" + sel + "` not found");
      return el;
    }
    if (sel instanceof Element) return sel;
    throw new Error("AgentAdSDK: `container` must be a selector or Element");
  }

  function originOf(url) {
    try { return new URL(url, window.location.href).origin; }
    catch (e) { return ""; }
  }

  function absoluteAssetURL(raw, manifestOrigin) {
    if (!raw) return "";
    if (/^https?:\/\//i.test(raw) || /^data:/i.test(raw)) return raw;
    if (raw.charAt(0) === "/") return manifestOrigin + raw;
    return manifestOrigin + "/" + raw;
  }

  function noop() {}

  /**
   * Main entry point. Returns a handle with { destroy(), refresh() }.
   */
  function mount(opts) {
    opts = opts || {};
    ensureStyles();
    var container = resolveContainer(opts.container);
    var manifestUrl = opts.manifestUrl;
    if (!manifestUrl) throw new Error("AgentAdSDK: `manifestUrl` is required");

    var badgePosition = opts.badgePosition || "top-right";
    var verifyMode = opts.verifyMode || "api-first";
    var failMode = opts.failMode || "closed"; // "open" renders on mismatch
    var onVerified = typeof opts.onVerified === "function" ? opts.onVerified : noop;
    var onMismatch = typeof opts.onMismatch === "function" ? opts.onMismatch : noop;
    var onExpired  = typeof opts.onExpired  === "function" ? opts.onExpired  : noop;

    var platformOrigin = originOf(manifestUrl);
    var destroyed = false;
    var abortController = (typeof AbortController !== "undefined") ? new AbortController() : null;

    container.classList.add("agentad-root");
    container.innerHTML = '<div class="agentad-loading">Verifying ad…</div>';

    function render(state) {
      if (destroyed) return;
      container.innerHTML = "";

      var manifest = state.manifest;
      var verify = state.verify || {};
      var decision = state.decision;

      if (decision === "skip") {
        container.innerHTML =
          '<div class="agentad-loading" style="color:#dc2626;">Ad verification failed</div>';
        return;
      }

      var imageUrl = absoluteAssetURL(manifest.creativeUrl, platformOrigin);
      var clickUrl = manifest.clickUrl || manifest.declaredLandingUrl || "#";

      var link = document.createElement("a");
      link.className = "agentad-link";
      link.href = clickUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer sponsored";

      var img = document.createElement("img");
      img.className = "agentad-creative";
      img.src = imageUrl;
      img.alt = manifest.projectName || "Sponsored";
      link.appendChild(img);
      container.appendChild(link);

      var badgeClass = "verified";
      var badgeText = "\u2713 Verified";
      if (decision === "expired") { badgeClass = "error"; badgeText = "\u26a0 Expired"; }
      else if (decision === "mismatch") { badgeClass = "error"; badgeText = "\u26a0 Unverified"; }
      else if (decision === "pending") { badgeClass = "pending"; badgeText = "\u2026 Pending"; }

      var badge = document.createElement("div");
      badge.className = "agentad-badge " + badgeClass + " " + badgePosition;
      badge.textContent = badgeText;
      badge.title = "Click for verification details";
      badge.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        openPanel(manifest, verify, decision);
      });
      container.appendChild(badge);
    }

    function openPanel(manifest, verify, decision) {
      var existing = document.getElementById("agentad-panel-instance");
      if (existing) { existing.remove(); return; }

      var panel = document.createElement("div");
      panel.id = "agentad-panel-instance";
      panel.className = "agentad-panel";

      var statusRowClass = decision === "verified" ? "ok" : "bad";
      var statusText = ({
        verified: "\u2713 Verified by AgentAd",
        mismatch: "\u26a0 Creative does not match attestation",
        expired:  "\u26a0 Attestation expired",
        pending:  "\u2026 Attestation not yet on-chain",
        skip:     "\u26a0 Verification failed",
      })[decision] || "Unknown status";

      var rows = [];
      rows.push('<div class="row ' + statusRowClass + '"><div class="v">' + statusText + "</div></div>");
      rows.push(row("Project", manifest.projectName));
      rows.push(row("Landing page", manifest.declaredLandingUrl));
      rows.push(row("Attestation ID", manifest.attestationId));
      rows.push(row("Creative hash", manifest.creativeHash));
      rows.push(row("Policy version", manifest.policyVersion));
      if (verify.explorerUrl) {
        rows.push(
          '<div class="row"><div class="k">On-chain tx</div>' +
          '<div class="v"><a href="' + verify.explorerUrl + '" target="_blank" rel="noreferrer">View on Etherscan \u2197</a></div></div>'
        );
      }
      if (verify.issuedAt) rows.push(row("Issued", new Date(verify.issuedAt * 1000).toLocaleString()));
      if (verify.expiresAt) rows.push(row("Expires", new Date(verify.expiresAt * 1000).toLocaleString()));

      panel.innerHTML =
        '<button class="close" aria-label="Close">\u2715</button>' +
        "<h3>Ad verification</h3>" +
        rows.join("") +
        '<div style="margin-top:18px;text-align:center;font-size:10px;color:#94a3b8;">Powered by AgentAd</div>';

      panel.querySelector(".close").addEventListener("click", function () { panel.remove(); });
      document.body.appendChild(panel);
    }

    function row(k, v) {
      if (!v) return "";
      return '<div class="row"><div class="k">' + escapeHTML(k) + '</div><div class="v">' + escapeHTML(v) + "</div></div>";
    }

    function escapeHTML(s) {
      return String(s).replace(/[&<>"]/g, function (c) {
        return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c];
      });
    }

    function classify(verify) {
      var status = verify && verify.status;
      if (status === "verified") return "verified";
      if (status === "EXPIRED") return "expired";
      if (status === "REVOKED") return "expired";
      if (status === "mismatch_creative" || status === "mismatch_destination") return "mismatch";
      if (status === "not_found" || status === "unknown") return "pending";
      return "pending";
    }

    function run() {
      var fetchOpts = abortController ? { signal: abortController.signal } : {};

      fetch(manifestUrl, fetchOpts)
        .then(function (r) {
          if (!r.ok) throw new Error("manifest HTTP " + r.status);
          return r.json();
        })
        .then(function (manifest) {
          if (verifyMode === "onchain-direct") {
            // Not yet implemented — fall back to api-first so the UX still works.
            console.warn("[AgentAdSDK] onchain-direct mode is not yet available, using api-first");
          }
          return fetch(platformOrigin + "/api/sdk/verify", Object.assign({
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              attestationId: manifest.attestationId,
              creativeHash: manifest.creativeHash,
              destinationHash: manifest.destinationHash,
              hostname: window.location.hostname,
            }),
          }, fetchOpts))
            .then(function (r) { return r.json(); })
            .then(function (verify) { return { manifest: manifest, verify: verify }; });
        })
        .then(function (state) {
          if (destroyed) return;
          var decision = classify(state.verify);
          var shouldRender = decision === "verified" || (failMode === "open" && decision !== "skip");

          var result = {
            manifest: state.manifest,
            verify: state.verify,
            decision: decision,
          };

          if (decision === "verified") onVerified(result);
          else if (decision === "expired") onExpired(result);
          else if (decision === "mismatch") onMismatch(result);

          state.decision = shouldRender ? decision : "skip";
          render(state);
        })
        .catch(function (err) {
          if (destroyed) return;
          console.error("[AgentAdSDK] verification failed:", err);
          container.innerHTML =
            '<div class="agentad-loading" style="color:#dc2626;">Ad unavailable</div>';
        });
    }

    run();

    return {
      destroy: function () {
        destroyed = true;
        if (abortController) {
          try { abortController.abort(); } catch (_) {}
        }
        container.innerHTML = "";
        container.classList.remove("agentad-root");
      },
      refresh: function () {
        container.innerHTML = '<div class="agentad-loading">Verifying ad…</div>';
        run();
      },
    };
  }

  global.AgentAdSDK = { mount: mount, version: "0.1.0" };
})(typeof window !== "undefined" ? window : this);
