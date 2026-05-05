"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

export interface CampaignRowData {
  teamId: string;
  teamName: string;
  eventId: string;
  eventName: string;
  dateRange: string;
}

export function CampaignsTable({
  campaigns
}: {
  campaigns: CampaignRowData[];
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return campaigns;
    return campaigns.filter(
      (c) =>
        c.teamName.toLowerCase().includes(q) ||
        c.eventName.toLowerCase().includes(q)
    );
  }, [campaigns, query]);

  return (
    <>
      <div className="mb-4 flex items-center gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by team or event…"
          className="w-full max-w-md rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
          autoFocus
        />
        <span className="text-xs text-slate-500">
          {filtered.length === campaigns.length
            ? `${campaigns.length} active`
            : `${filtered.length} of ${campaigns.length}`}
        </span>
      </div>

      {filtered.length === 0 ? (
        <p className="text-slate-600">No campaigns match.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Team</th>
                <th className="px-4 py-3 font-medium">Event</th>
                <th className="px-4 py-3 font-medium">Dates</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {filtered.map((c) => (
                <tr key={`${c.teamId}_${c.eventId}`}>
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {c.teamName}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/campaigns/${encodeURIComponent(c.teamId)}/${encodeURIComponent(c.eventId)}`}
                      className="text-slate-900 hover:underline"
                    >
                      {c.eventName}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {c.dateRange}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
