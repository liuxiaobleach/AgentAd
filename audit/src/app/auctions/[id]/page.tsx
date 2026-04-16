"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetch } from "@/lib/api";

export default function AuctionDetailPage() {
  const { id } = useParams();
  const [auction, setAuction] = useState<any>(null);

  useEffect(() => {
    let stopped = false;
    const load = () => {
      apiFetch(`/api/auctions/${id}`).then((r) => r.json()).then((data) => {
        if (stopped) return;
        setAuction(data);
        if (!data.result && !data.bids?.length) {
          setTimeout(load, 2000);
        }
      }).catch(() => { if (!stopped) setTimeout(load, 3000); });
    };
    load();
    return () => { stopped = true; };
  }, [id]);

  if (!auction) return <div className="text-center py-12 text-slate-400">Loading...</div>;

  const bids = auction.bids || [];
  const result = auction.result;
  const winnerBid = bids.find((b: any) => b.id === result?.winnerBidId);

  return (
    <div>
      <h2 className="text-2xl font-bold text-slate-900 mb-2">Auction Detail</h2>
      <p className="text-slate-500 mb-8">{auction.slotId} - {auction.slotType} ({auction.size})</p>

      {/* Bid Request Info */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
        <h3 className="font-semibold text-slate-900 mb-4">Bid Request</h3>
        <div className="grid grid-cols-4 gap-4 text-sm">
          <div>
            <span className="text-slate-500">Slot Type</span>
            <p className="font-medium">{auction.slotType}</p>
          </div>
          <div>
            <span className="text-slate-500">Size</span>
            <p className="font-medium">{auction.size}</p>
          </div>
          <div>
            <span className="text-slate-500">Floor CPM</span>
            <p className="font-medium">${auction.floorCpm}</p>
          </div>
          <div>
            <span className="text-slate-500">Category</span>
            <p className="font-medium">{auction.siteCategory || "-"}</p>
          </div>
        </div>
        {auction.userSegments?.length > 0 && (
          <div className="mt-3">
            <span className="text-slate-500 text-sm">User Segments: </span>
            <div className="flex gap-1 mt-1">
              {auction.userSegments.map((s: string) => (
                <span key={s} className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs">{s}</span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Bids */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
        <h3 className="font-semibold text-slate-900 mb-4">Bids ({bids.length})</h3>
        {bids.length === 0 ? (
          <p className="text-slate-400 text-sm">Waiting for bids...</p>
        ) : (
          <div className="space-y-3">
            {bids.map((bid: any) => {
              const isWinner = bid.id === result?.winnerBidId;
              return (
                <div
                  key={bid.id}
                  className={`border rounded-lg p-4 ${isWinner ? "border-green-300 bg-green-50" : "border-slate-200"}`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-900">{bid.agentName}</span>
                      {isWinner && <span className="badge-verified">Winner</span>}
                    </div>
                    {bid.bidCpm != null && (
                      <span className="text-lg font-bold text-slate-900">${bid.bidCpm?.toFixed(2)} CPM</span>
                    )}
                  </div>
                  <div className="grid grid-cols-4 gap-3 text-sm">
                    <div>
                      <span className="text-slate-500">Creative</span>
                      <p className="font-medium">{bid.creativeName || "-"}</p>
                    </div>
                    <div>
                      <span className="text-slate-500">Predicted CTR</span>
                      <p className="font-medium">{bid.predictedCtr ? (bid.predictedCtr * 100).toFixed(2) + "%" : "-"}</p>
                    </div>
                    <div>
                      <span className="text-slate-500">Confidence</span>
                      <p className="font-medium">{bid.confidence ? (bid.confidence * 100).toFixed(0) + "%" : "-"}</p>
                    </div>
                    <div>
                      <span className="text-slate-500">Bid CPM</span>
                      <p className="font-medium">{bid.bidCpm != null ? `$${bid.bidCpm?.toFixed(2)}` : "No bid"}</p>
                    </div>
                  </div>
                  {bid.reason && (
                    <div className="mt-3 p-3 bg-slate-50 rounded-lg">
                      <span className="text-xs text-slate-500 font-medium">Reason:</span>
                      <p className="text-sm text-slate-700 mt-1">{bid.reason}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Result */}
      {result && (
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h3 className="font-semibold text-slate-900 mb-4">Auction Result</h3>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div className="p-4 bg-green-50 rounded-lg">
              <span className="text-green-700 font-medium">Settlement Price</span>
              <p className="text-2xl font-bold text-green-800 mt-1">
                ${result.settlementPrice?.toFixed(2)} CPM
              </p>
            </div>
            <div className="p-4 bg-blue-50 rounded-lg">
              <span className="text-blue-700 font-medium">Shown Creative</span>
              <p className="font-semibold text-blue-800 mt-1">
                {winnerBid?.creativeName || result.shownCreativeId || "-"}
              </p>
            </div>
            <div className={`p-4 rounded-lg ${result.clicked ? "bg-emerald-50" : "bg-slate-50"}`}>
              <span className={`font-medium ${result.clicked ? "text-emerald-700" : "text-slate-500"}`}>
                Click Result
              </span>
              <p className={`text-2xl font-bold mt-1 ${result.clicked ? "text-emerald-800" : "text-slate-400"}`}>
                {result.clicked ? "Clicked!" : "No Click"}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
