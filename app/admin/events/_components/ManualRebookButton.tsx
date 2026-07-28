"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Caller manually rebooked a no-show lead (phone outreach). Native-scheduler
 * bookings confirm immediately; external-calendar bookings go to the client's
 * approval popup, same as an SMS reschedule.
 */
export function ManualRebookButton({
  leadId,
  disabledReason
}: {
  leadId: string | null;
  /** Non-null → button renders grayed out with this tooltip. */
  disabledReason?: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"native" | "external">("native");
  const [when, setWhen] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!when) {
      setError("Pick the new meeting date/time");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/leads/${leadId}/manual-rebook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          meetingTime: new Date(when).toISOString()
        })
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as {
          error?: string;
          detail?: string;
        };
        setError(json.detail ?? json.error ?? `HTTP ${res.status}`);
        return;
      }
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "request failed");
    } finally {
      setPending(false);
    }
  }

  if (disabledReason || !leadId) {
    return (
      <button
        type="button"
        disabled
        title={disabledReason ?? undefined}
        className="cursor-not-allowed rounded-md bg-slate-200 px-3 py-1.5 text-xs font-medium text-slate-400"
      >
        Mark rebooked
      </button>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md bg-vdx-plum px-3 py-1.5 text-xs font-medium text-white hover:bg-vdx-coral"
      >
        Mark rebooked
      </button>
    );
  }

  return (
    <div className="w-64 rounded-lg border border-slate-200 bg-white p-3 text-left shadow-lg">
      <div className="mb-2 text-xs font-semibold text-slate-700">
        How was the meeting rebooked?
      </div>
      <div className="mb-2 flex flex-col gap-1 text-xs text-slate-700">
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name={`mode-${leadId}`}
            checked={mode === "native"}
            onChange={() => setMode("native")}
          />
          Native Vendelux scheduler
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name={`mode-${leadId}`}
            checked={mode === "external"}
            onChange={() => setMode("external")}
          />
          Client&apos;s external calendar
        </label>
      </div>
      <label className="mb-2 block text-xs text-slate-700">
        New meeting time
        <input
          type="datetime-local"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-xs"
        />
      </label>
      {mode === "external" ? (
        <p className="mb-2 text-[11px] text-slate-500">
          The onsite contact will confirm this time on their dashboard before
          it&apos;s finalized.
        </p>
      ) : null}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={pending}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          Cancel
        </button>
      </div>
      {error ? (
        <div className="mt-2 text-[11px] text-red-600">{error}</div>
      ) : null}
    </div>
  );
}
