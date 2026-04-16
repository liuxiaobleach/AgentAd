"use client";

import { apiFetch } from "@/lib/api";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function NewCreativePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);

    const form = e.currentTarget;
    const formData = new FormData(form);

    try {
      const res = await apiFetch("/api/creatives", {
        method: "POST",
        body: formData,
      });

      if (res.ok) {
        const creative = await res.json();
        router.push(`/creatives/${creative.id}`);
      } else {
        const err = await res.json();
        alert(err.error || "Failed to create creative");
      }
    } catch {
      alert("Network error");
    } finally {
      setLoading(false);
    }
  }

  function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setPreview(url);
    }
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-slate-900 mb-8">
        Create New Creative
      </h2>

      <form onSubmit={handleSubmit} className="max-w-2xl space-y-6">
        <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-5">
          <h3 className="font-semibold text-slate-900 border-b pb-3">
            Basic Info
          </h3>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Creative Name *
              </label>
              <input
                name="creativeName"
                required
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="e.g. Spring Campaign Banner"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Project Name *
              </label>
              <input
                name="projectName"
                required
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="e.g. MyDeFi Protocol"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Landing URL *
            </label>
            <input
              name="landingUrl"
              type="url"
              required
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="https://example.com/campaign"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Click URL
            </label>
            <input
              name="clickUrl"
              type="url"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="https://jump.example.com/abc"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Telegram URL
            </label>
            <input
              name="telegramUrl"
              type="url"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="https://t.me/myproject"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Chain ID
              </label>
              <input
                name="chainId"
                type="number"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="8453"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Contract Address
              </label>
              <input
                name="contractAddress"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="0x..."
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Placement Domains
            </label>
            <input
              name="placementDomains"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="domain1.com, domain2.com"
            />
            <p className="text-xs text-slate-400 mt-1">
              Comma-separated list of domains where this ad will be placed
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Notes
            </label>
            <textarea
              name="notes"
              rows={3}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Additional notes..."
            />
          </div>
        </div>

        {/* Image Upload */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
          <h3 className="font-semibold text-slate-900 border-b pb-3">
            Ad Creative Image
          </h3>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Upload Image (PNG/JPG/WebP) *
            </label>
            <input
              name="imageFile"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              required
              onChange={handleImageChange}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm file:mr-4 file:py-1 file:px-3 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
            />
          </div>

          {preview && (
            <div className="mt-4">
              <p className="text-sm font-medium text-slate-700 mb-2">
                Preview:
              </p>
              <img
                src={preview}
                alt="Preview"
                className="max-w-md rounded-lg border border-slate-200 shadow-sm"
              />
            </div>
          )}
        </div>

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={loading}
            className="px-6 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? "Creating..." : "Create Creative"}
          </button>
          <button
            type="button"
            onClick={() => router.back()}
            className="px-6 py-2.5 bg-slate-100 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-200 transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
