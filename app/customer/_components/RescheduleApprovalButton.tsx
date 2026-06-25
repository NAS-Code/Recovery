"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function RescheduleApprovalButton({
  teamId,
  eventId,
  vendeluxLeadId,
  proposedLabel
}: {
  teamId: string;
  eventId: string;
  vendeluxLeadId: string;
  /** Human-readable proposed time, e.g. "Jun 18, 11:45 AM PDT". */
  proposedLabel: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: "approve" | "reject") {
    setPending(decision);
    setError(null);
    try {
      const url = `/api/campaigns/${encodeURIComponent(teamId)}/${encodeURIComponent(eventId)}/leads/${encodeURIComponent(vendeluxLeadId)}/reschedule-approval`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision })
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as {
          error?: string;
          detail?: string;
        };
        setError(json.detail ?? json.error ?? `HTTP ${res.status}`);
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "request failed");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="text-[11px] text-slate-500">
        Proposed: <span className="font-medium text-slate-700">{proposedLabel}</span>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => decide("approve")}
          disabled={pending !== null}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending === "approve" ? "Saving…" : "Works"}
        </button>
        <button
          type="button"
          onClick={() => decide("reject")}
          disabled={pending !== null}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending === "reject" ? "Saving…" : "Doesn't work"}
        </button>
      </div>
      {error ? <span className="text-[11px] text-red-600">{error}</span> : null}
    </div>
  );
}
