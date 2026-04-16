"use client";

import { apiFetch } from "@/lib/api";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

export default function CreativeDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const [creative, setCreative] = useState<any>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    apiFetch(`/api/creatives/${id}`)
      .then((r) => r.json())
      .then(setCreative)
      .catch(() => {});
  }, [id]);

  async function handleSubmitAudit() {
    setSubmitting(true);
    try {
      const res = await apiFetch(`/api/creatives/${id}/submit-audit`, {
        method: "POST",
      });
      const result = await res.json();
      if (res.ok) {
        router.push(`/audit-cases/${result.auditCaseId}`);
      } else {
        alert(result.error || "Submit failed");
      }
    } catch {
      alert("Network error");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!confirm("Are you sure you want to delete this creative? This will also remove all related audit cases, certificates and profiles.")) {
      return;
    }
    try {
      const res = await apiFetch(`/api/creatives/${id}`, { method: "DELETE" });
      if (res.ok) {
        router.push("/creatives");
      } else {
        const err = await res.json();
        alert(err.error || "Delete failed");
      }
    } catch {
      alert("Network error");
    }
  }

  if (!creative) {
    return (
      <div className="text-center py-12 text-slate-400">Loading...</div>
    );
  }

  const latestCase = creative.auditCases?.[0];
  const manifest = creative.manifests?.[0];

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">
            {creative.creativeName}
          </h2>
          <p className="text-slate-500 mt-1">{creative.projectName}</p>
        </div>
        <div className="flex gap-3">
          {(creative.status === "DRAFT" ||
            creative.status === "REJECTED") && (
            <button
              onClick={handleSubmitAudit}
              disabled={submitting}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {submitting ? "Submitting..." : "Submit for Audit"}
            </button>
          )}
          <button
            onClick={handleDelete}
            className="px-4 py-2 bg-red-50 text-red-600 rounded-lg text-sm font-medium hover:bg-red-100 transition-colors"
          >
            Delete
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Left: Image & Info */}
        <div className="col-span-2 space-y-6">
          {/* Image Preview */}
          {creative.imageUrl && (
            <div className="bg-white rounded-xl border border-slate-200 p-6">
              <h3 className="font-semibold text-slate-900 mb-4">
                Ad Creative
              </h3>
              <img
                src={creative.imageUrl}
                alt={creative.creativeName}
                className="max-w-full rounded-lg border border-slate-200"
              />
            </div>
          )}

          {/* Detail Fields */}
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h3 className="font-semibold text-slate-900 mb-4">Details</h3>
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-slate-500">Landing URL</dt>
                <dd className="font-medium text-slate-900 break-all">
                  {creative.landingUrl}
                </dd>
              </div>
              {creative.clickUrl && (
                <div>
                  <dt className="text-slate-500">Click URL</dt>
                  <dd className="font-medium text-slate-900 break-all">
                    {creative.clickUrl}
                  </dd>
                </div>
              )}
              {creative.telegramUrl && (
                <div>
                  <dt className="text-slate-500">Telegram</dt>
                  <dd className="font-medium text-slate-900">
                    {creative.telegramUrl}
                  </dd>
                </div>
              )}
              {creative.chainId && (
                <div>
                  <dt className="text-slate-500">Chain ID</dt>
                  <dd className="font-medium text-slate-900">
                    {creative.chainId}
                  </dd>
                </div>
              )}
              {creative.contractAddress && (
                <div>
                  <dt className="text-slate-500">Contract</dt>
                  <dd className="font-mono text-xs text-slate-900 break-all">
                    {creative.contractAddress}
                  </dd>
                </div>
              )}
              {creative.creativeHash && (
                <div className="col-span-2">
                  <dt className="text-slate-500">Creative Hash (SHA256)</dt>
                  <dd className="font-mono text-xs text-slate-900 break-all">
                    {creative.creativeHash}
                  </dd>
                </div>
              )}
            </dl>
          </div>
        </div>

        {/* Right: Status & Actions */}
        <div className="space-y-6">
          {/* Status Card */}
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h3 className="font-semibold text-slate-900 mb-4">Status</h3>
            <span
              className={
                creative.status === "APPROVED"
                  ? "badge-verified"
                  : creative.status === "REJECTED"
                  ? "badge-rejected"
                  : creative.status === "AUDITING"
                  ? "badge-review"
                  : "badge-pending"
              }
            >
              {creative.status}
            </span>
          </div>

          {/* Latest Audit Case */}
          {latestCase && (
            <div className="bg-white rounded-xl border border-slate-200 p-6">
              <h3 className="font-semibold text-slate-900 mb-4">
                Latest Audit
              </h3>
              <div className="space-y-3 text-sm">
                <div>
                  <span className="text-slate-500">Decision: </span>
                  <span
                    className={
                      latestCase.decision === "PASS"
                        ? "text-green-600 font-medium"
                        : latestCase.decision === "REJECT"
                        ? "text-red-600 font-medium"
                        : "text-orange-600 font-medium"
                    }
                  >
                    {latestCase.decision || "Pending"}
                  </span>
                </div>
                {latestCase.riskScore !== null && (
                  <div>
                    <span className="text-slate-500">Risk Score: </span>
                    <span className="font-medium">
                      {latestCase.riskScore}
                    </span>
                  </div>
                )}
                <Link
                  href={`/audit-cases/${latestCase.id}`}
                  className="block text-blue-600 text-sm hover:underline"
                >
                  View Full Audit Report
                </Link>
              </div>
            </div>
          )}

          {/* Manifest */}
          {manifest && (
            <div className="bg-white rounded-xl border border-slate-200 p-6">
              <h3 className="font-semibold text-slate-900 mb-4">
                Manifest
              </h3>
              <div className="space-y-2 text-sm">
                <div>
                  <span className="text-slate-500">Manifest ID: </span>
                  <span className="font-mono text-xs">
                    {manifest.id}
                  </span>
                </div>
                <Link
                  href="/integrations"
                  className="block text-blue-600 text-sm hover:underline"
                >
                  View Integration Info
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
