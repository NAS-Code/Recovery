"use client";

import { useMemo, useState } from "react";

interface Message {
  id: string;
  direction: "inbound" | "outbound";
  text: string;
  timestamp: string;
  classification: any;
  messageType: string | null;
  leadId: string;
  leadName: string;
  leadCompany: string | null;
  leadStatus: string;
  eventName: string;
  eventId: string;
  teamName: string;
}

interface EventOption {
  id: string;
  label: string;
}

const STATUS_LABELS: Record<string, string> = {
  scheduled: "Scheduled",
  no_show: "No-show",
  in_reschedule_convo: "Rescheduling",
  confirmed_reschedule: "Reschedule Confirmed",
  in_virtual_convo: "Virtual Convo",
  confirmed_virtual: "Virtual Confirmed",
  context_question: "Context Question",
  not_interested: "Not Interested",
  uncategorized: "Uncategorized"
};

const STATUS_COLORS: Record<string, string> = {
  scheduled: "bg-slate-100 text-slate-700",
  no_show: "bg-red-100 text-red-700",
  in_reschedule_convo: "bg-amber-100 text-amber-700",
  confirmed_reschedule: "bg-green-100 text-green-700",
  in_virtual_convo: "bg-blue-100 text-blue-700",
  confirmed_virtual: "bg-green-100 text-green-700",
  context_question: "bg-purple-100 text-purple-700",
  not_interested: "bg-slate-100 text-slate-600",
  uncategorized: "bg-orange-100 text-orange-700"
};

const MESSAGE_TYPE_LABELS: Record<string, string> = {
  initial_outreach: "Initial Outreach",
  auto_reply: "Auto Reply",
  inbound_reply: "Inbound Reply",
  eod_checkin: "EOD Check-in",
  virtual_offer: "Virtual Offer"
};

const MESSAGE_TYPE_COLORS: Record<string, string> = {
  initial_outreach: "bg-indigo-100 text-indigo-700",
  auto_reply: "bg-cyan-100 text-cyan-700",
  inbound_reply: "bg-blue-100 text-blue-700",
  eod_checkin: "bg-amber-100 text-amber-700",
  virtual_offer: "bg-emerald-100 text-emerald-700"
};

function MessageTypeBadge({ type }: { type: string | null }) {
  if (!type) return null;
  const label = MESSAGE_TYPE_LABELS[type] ?? type.replace(/_/g, " ");
  const colors = MESSAGE_TYPE_COLORS[type] ?? "bg-slate-100 text-slate-600";
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${colors}`}>
      {label}
    </span>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });
}

function CategoryBadge({ classification }: { classification: any }) {
  if (!classification?.category) return null;
  const cat = classification.category as string;
  const label = cat.replace(/_/g, " ");
  return (
    <span className="rounded bg-brand-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-brand-primary">
      {label}
    </span>
  );
}

export function ActivityFeed({
  messages,
  events
}: {
  messages: Message[];
  events: EventOption[];
}) {
  const [eventFilter, setEventFilter] = useState<string>("all");
  const [directionFilter, setDirectionFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const filtered = useMemo(() => {
    let result = messages;

    if (eventFilter !== "all") {
      result = result.filter((m) => m.eventId === eventFilter);
    }

    if (directionFilter !== "all") {
      result = result.filter((m) => m.direction === directionFilter);
    }

    if (typeFilter !== "all") {
      result = result.filter((m) => m.messageType === typeFilter);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (m) =>
          m.text.toLowerCase().includes(q) ||
          m.leadName.toLowerCase().includes(q) ||
          (m.leadCompany && m.leadCompany.toLowerCase().includes(q)) ||
          m.teamName.toLowerCase().includes(q)
      );
    }

    return result;
  }, [messages, eventFilter, directionFilter, typeFilter, searchQuery]);

  return (
    <>
      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search messages, leads, companies…"
          className="w-full max-w-xs rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-accent focus:outline-none focus:ring-1 focus:ring-brand-accent"
        />

        <select
          value={eventFilter}
          onChange={(e) => setEventFilter(e.target.value)}
          className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-accent focus:outline-none focus:ring-1 focus:ring-brand-accent"
        >
          <option value="all">All events</option>
          {events.map((e) => (
            <option key={e.id} value={e.id}>
              {e.label}
            </option>
          ))}
        </select>

        <select
          value={directionFilter}
          onChange={(e) => setDirectionFilter(e.target.value)}
          className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-accent focus:outline-none focus:ring-1 focus:ring-brand-accent"
        >
          <option value="all">All directions</option>
          <option value="outbound">Outbound only</option>
          <option value="inbound">Inbound only</option>
        </select>

        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-accent focus:outline-none focus:ring-1 focus:ring-brand-accent"
        >
          <option value="all">All types</option>
          <option value="initial_outreach">Initial Outreach</option>
          <option value="auto_reply">Auto Reply</option>
          <option value="inbound_reply">Inbound Reply</option>
          <option value="eod_checkin">EOD Check-in</option>
          <option value="virtual_offer">Virtual Offer</option>
        </select>

        <span className="text-xs text-slate-500">
          {filtered.length === messages.length
            ? `${messages.length} total`
            : `${filtered.length} of ${messages.length}`}
        </span>
      </div>

      {/* Message list */}
      {filtered.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500">
          No messages match your filters.
        </p>
      ) : (
        <div className="space-y-2">
          {filtered.map((m) => (
            <div
              key={m.id}
              className={`rounded-lg border p-4 transition-colors ${
                m.direction === "outbound"
                  ? "border-slate-200 bg-white"
                  : "border-blue-200 bg-blue-50/50"
              }`}
            >
              {/* Top row: direction icon + lead info + time */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={`shrink-0 text-xs font-bold ${
                      m.direction === "outbound"
                        ? "text-brand-accent"
                        : "text-blue-600"
                    }`}
                    title={
                      m.direction === "outbound"
                        ? "Sent to lead"
                        : "Received from lead"
                    }
                  >
                    {m.direction === "outbound" ? "OUT →" : "← IN"}
                  </span>

                  <span className="font-medium text-sm text-slate-900 truncate">
                    {m.leadName}
                  </span>

                  {m.leadCompany && (
                    <span className="text-xs text-slate-500 truncate hidden sm:inline">
                      {m.leadCompany}
                    </span>
                  )}
                </div>

                <span className="shrink-0 text-[11px] text-slate-500">
                  {formatTime(m.timestamp)}
                </span>
              </div>

              {/* Message text */}
              <p className="mt-2 text-sm text-slate-700 whitespace-pre-wrap break-words">
                {m.text}
              </p>

              {/* Bottom row: event + status + classification */}
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <span className="rounded bg-brand-surface px-2 py-0.5 text-[10px] font-medium text-slate-600">
                  {m.teamName} — {m.eventName}
                </span>

                <span
                  className={`rounded px-2 py-0.5 text-[10px] font-medium ${
                    STATUS_COLORS[m.leadStatus] ?? "bg-slate-100 text-slate-600"
                  }`}
                >
                  {STATUS_LABELS[m.leadStatus] ?? m.leadStatus}
                </span>

                <MessageTypeBadge type={m.messageType} />

                {m.direction === "inbound" && m.classification && (
                  <CategoryBadge classification={m.classification} />
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
