"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

export interface CampaignRowData {
  teamId: string;
  teamName: string;
  eventId: string;
  eventName: string;
  dateRange: string;
  clientUsername: string | null;
  clientPassword: string | null;
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="rounded bg-brand-primary/10 px-2 py-0.5 text-[11px] font-medium text-brand-primary transition-colors hover:bg-brand-accent/20 hover:text-brand-accent"
      title={`Copy ${label}`}
    >
      {copied ? "Copied!" : `Copy ${label}`}
    </button>
  );
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
          className="w-full max-w-md rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-accent focus:outline-none focus:ring-1 focus:ring-brand-accent"
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
        <>
          {/* ---- Desktop table (hidden on mobile) ---- */}
          <div className="hidden md:block overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-brand-surface text-left text-[11px] uppercase tracking-wider text-slate-600">
                <tr>
                  <th className="px-5 py-3 font-semibold">Team</th>
                  <th className="px-5 py-3 font-semibold">Event</th>
                  <th className="px-5 py-3 font-semibold">Dates</th>
                  <th className="px-5 py-3 font-semibold">Client Login</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filtered.map((c) => {
                  const dashboardUrl = `/customer/${encodeURIComponent(c.teamId)}/${encodeURIComponent(c.eventId)}`;

                  return (
                    <tr
                      key={`${c.teamId}_${c.eventId}`}
                      className="transition-colors hover:bg-brand-surface/40"
                    >
                      <td className="px-5 py-3.5 font-medium text-slate-900">
                        {c.teamName}
                      </td>
                      <td className="px-5 py-3.5">
                        <Link
                          href={dashboardUrl}
                          className="font-medium text-brand-primary hover:text-brand-accent hover:underline"
                        >
                          {c.eventName}
                        </Link>
                      </td>
                      <td className="px-5 py-3.5 text-xs text-slate-500">
                        {c.dateRange}
                      </td>
                      <td className="px-5 py-3.5">
                        {c.clientUsername && c.clientPassword ? (
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700">
                                {c.clientUsername}
                              </code>
                            </div>
                            <div className="flex items-center gap-2">
                              <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700">
                                {c.clientPassword}
                              </code>
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        {c.clientUsername && c.clientPassword && (
                          <div className="flex items-center gap-1.5">
                            <CopyButton
                              text={`Username: ${c.clientUsername}\nPassword: ${c.clientPassword}`}
                              label="credentials"
                            />
                            <CopyButton
                              text={typeof window !== "undefined"
                                ? `${window.location.origin}${dashboardUrl}`
                                : dashboardUrl}
                              label="link"
                            />
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ---- Mobile cards (hidden on desktop) ---- */}
          <div className="md:hidden space-y-3">
            {filtered.map((c) => {
              const dashboardUrl = `/customer/${encodeURIComponent(c.teamId)}/${encodeURIComponent(c.eventId)}`;

              return (
                <div
                  key={`${c.teamId}_${c.eventId}`}
                  className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
                >
                  {/* Team + date */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-medium text-slate-900">
                      {c.teamName}
                    </div>
                    <div className="shrink-0 text-[11px] text-slate-500">
                      {c.dateRange}
                    </div>
                  </div>

                  {/* Event link */}
                  <Link
                    href={dashboardUrl}
                    className="mt-1 block font-medium text-brand-primary hover:text-brand-accent hover:underline"
                  >
                    {c.eventName}
                  </Link>

                  {/* Client credentials */}
                  {c.clientUsername && c.clientPassword && (
                    <div className="mt-3 rounded-md bg-slate-50 p-3">
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                        Client Login
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] text-slate-500">User</span>
                          <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700">
                            {c.clientUsername}
                          </code>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] text-slate-500">Pass</span>
                          <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700">
                            {c.clientPassword}
                          </code>
                        </div>
                      </div>
                      <div className="mt-2.5 flex gap-2">
                        <CopyButton
                          text={`Username: ${c.clientUsername}\nPassword: ${c.clientPassword}`}
                          label="credentials"
                        />
                        <CopyButton
                          text={typeof window !== "undefined"
                            ? `${window.location.origin}${dashboardUrl}`
                            : dashboardUrl}
                          label="link"
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
