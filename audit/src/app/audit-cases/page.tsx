"use client";

import { apiFetch } from "@/lib/api";

import { useEffect, useState } from "react";
import Link from "next/link";

export default function AuditCasesListPage() {
  const [cases, setCases] = useState<any[]>([]);

  useEffect(() => {
    apiFetch("/api/audit-cases")
      .then((r) => r.json())
      .then(setCases)
      .catch(() => {});
  }, []);

  return (
    <div>
      <h2 className="text-2xl font-bold text-slate-900 mb-8">Audit Cases</h2>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 uppercase">
                Creative
              </th>
              <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 uppercase">
                Status
              </th>
              <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 uppercase">
                Decision
              </th>
              <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 uppercase">
                Risk Score
              </th>
              <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 uppercase">
                Submitted
              </th>
              <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 uppercase">
                Attestation
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {cases.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-6 py-12 text-center text-slate-400"
                >
                  No audit cases yet.
                </td>
              </tr>
            ) : (
              cases.map((c: any) => (
                <tr
                  key={c.id}
                  className="hover:bg-slate-50 transition-colors"
                >
                  <td className="px-6 py-4">
                    <Link
                      href={`/audit-cases/${c.id}`}
                      className="font-medium text-blue-600 hover:underline"
                    >
                      {c.creative?.creativeName || "Untitled"}
                    </Link>
                    <p className="text-xs text-slate-400">
                      {c.creative?.projectName}
                    </p>
                  </td>
                  <td className="px-6 py-4">
                    <span className="badge-pending text-xs">{c.status}</span>
                  </td>
                  <td className="px-6 py-4">
                    {c.decision ? (
                      <span
                        className={
                          c.decision === "PASS"
                            ? "badge-verified"
                            : c.decision === "REJECT"
                            ? "badge-rejected"
                            : "badge-review"
                        }
                      >
                        {c.decision}
                      </span>
                    ) : (
                      <span className="text-slate-400 text-sm">-</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600">
                    {c.riskScore ?? "-"}
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-400">
                    {new Date(c.submittedAt).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4">
                    {c.attestation ? (
                      <span className="badge-verified">Issued</span>
                    ) : (
                      <span className="text-slate-400 text-sm">-</span>
                    )}
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
