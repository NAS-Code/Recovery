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
          className="w-full max-w-md rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-vdx-coral focus:outline-none focus:ring-1 focus:ring-vdx-coral"
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
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-vdx-cream text-left text-[11px] uppercase tracking-wider text-slate-600">
              <tr>
                <th className="px-5 py-3 font-semibold">Team</th>
                <th className="px-5 py-3 font-semibold">Event</th>
                <th className="px-5 py-3 font-semibold">Dates</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {filtered.map((c) => (
                <tr
                  key={`${c.teamId}_${c.eventId}`}
                  className="transition-colors hover:bg-vdx-cream/40"
                >
                  <td className="px-5 py-3.5 font-medium text-slate-900">
                    {c.teamName}
                  </td>
                  <td className="px-5 py-3.5">
                    <Link
                      href={`/campaigns/${encodeURIComponent(c.teamId)}/${encodeURIComponent(c.eventId)}`}
                      className="font-medium text-vdx-plum hover:text-vdx-coral hover:underline"
                    >
                      {c.eventName}
                    </Link>
                  </td>
                  <td className="px-5 py-3.5 text-xs text-slate-500">
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
