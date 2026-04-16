"use client";

import { apiFetch } from "@/lib/api";

import { useEffect, useState } from "react";

interface CertificateRecord {
  id: string;
  attestationId?: string;
  chainId?: number;
  status?: string;
  issuedAt?: string | null;
  expiresAt?: string | null;
  auditCase?: {
    creative?: {
      creativeName?: string | null;
      projectName?: string | null;
    } | null;
  } | null;
}

export default function CertificatesPage() {
  const [certs, setCerts] = useState<CertificateRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div>
      <h2 className="text-2xl font-bold text-slate-900 mb-8">Certificates</h2>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 uppercase">
                Creative
              </th>
              <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 uppercase">
                Attestation ID
              </th>
              <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 uppercase">
                Chain
              </th>
              <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 uppercase">
                Status
              </th>
              <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 uppercase">
                Issued
              </th>
              <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 uppercase">
                Expires
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-6 py-12 text-center text-slate-400"
                >
                  Loading certificates...
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-6 py-12 text-center text-red-500"
                >
                  {error}
                </td>
              </tr>
            ) : certs.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-6 py-12 text-center text-slate-400"
                >
                  No certificates issued yet.
                </td>
              </tr>
            ) : (
              certs.map((cert) => (
                <tr
                  key={cert.id}
                  className="hover:bg-slate-50 transition-colors"
                >
                  <td className="px-6 py-4">
                    <p className="font-medium text-slate-900">
                      {cert.auditCase?.creative?.creativeName || "-"}
                    </p>
                    <p className="text-xs text-slate-400">
                      {cert.auditCase?.creative?.projectName || "-"}
                    </p>
                  </td>
                  <td className="px-6 py-4 font-mono text-xs text-slate-600 max-w-[200px] truncate">
                    {cert.attestationId || "-"}
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600">
                    {cert.chainId ? `Base Sepolia (${cert.chainId})` : "Base Sepolia"}
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={
                        cert.status === "ACTIVE"
                          ? "badge-verified"
                          : cert.status === "REVOKED"
                          ? "badge-rejected"
                          : "badge-pending"
                      }
                    >
                      {cert.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-400">
                    {cert.issuedAt
                      ? new Date(cert.issuedAt).toLocaleDateString()
                      : "-"}
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-400">
                    {cert.expiresAt
                      ? new Date(cert.expiresAt).toLocaleDateString()
                      : "-"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
