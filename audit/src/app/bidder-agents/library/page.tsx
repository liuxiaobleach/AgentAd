"use client";

import { useState } from "react";
import Link from "next/link";
import { LibraryList, LibraryKind } from "@/components/BidderLibrary";

export default function BidderLibraryPage() {
  const [tab, setTab] = useState<LibraryKind>("templates");

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Strategy Library</h2>
          <p className="text-sm text-slate-500 mt-1">
            Save your own reusable strategy templates and agent skills. Pick them when configuring any bidder agent.
          </p>
        </div>
        <Link
          href="/bidder-agents"
          className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-200"
        >
          Back to Agents
        </Link>
      </div>

      <div className="flex gap-1 border-b border-slate-200 mb-6">
        {(["templates", "skills"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === k
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {k === "templates" ? "Strategy Templates" : "Agent Skills"}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <LibraryList kind={tab} mode="manage" />
      </div>
    </div>
  );
}
