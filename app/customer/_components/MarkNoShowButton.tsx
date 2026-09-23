"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function MarkNoShowButton({
  teamId,
  eventId,
  sourceLeadId
}: {
  teamId: string;
  eventId: string;
  sourceLeadId: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setPending(true);
    setError(null);
    try {
      const url = `/api/campaigns/${encodeURIComponent(teamId)}/${encodeURIComponent(eventId)}/leads/${encodeURIComponent(sourceLeadId)}/noshow`;
      const res = await fetch(url, { method: "POST" });
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
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1 md:items-end">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="w-full md:w-auto rounded-md bg-brand-primary px-3 py-2 md:py-1.5 text-xs font-medium text-white hover:bg-brand-accent disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Sending…" : "Mark no-show"}
      </button>
      {error ? <span className="text-[11px] text-red-600">{error}</span> : null}
    </div>
  );
}
