import type { LeadStatus } from "@/lib/core/types";

const styles: Record<LeadStatus, string> = {
  scheduled: "bg-slate-100 text-slate-700 ring-slate-200",
  no_show: "bg-red-100 text-red-700 ring-red-200",
  in_reschedule_convo: "bg-amber-100 text-amber-800 ring-amber-200",
  confirmed_reschedule: "bg-emerald-100 text-emerald-700 ring-emerald-200",
  in_virtual_convo: "bg-amber-100 text-amber-800 ring-amber-200",
  confirmed_virtual: "bg-emerald-100 text-emerald-700 ring-emerald-200",
  context_question: "bg-purple-100 text-purple-700 ring-purple-200",
  not_interested: "bg-slate-200 text-slate-700 ring-slate-300",
  uncategorized: "bg-orange-100 text-orange-800 ring-orange-200"
};

const labels: Record<LeadStatus, string> = {
  scheduled: "Scheduled",
  no_show: "No-show",
  in_reschedule_convo: "Reschedule (active)",
  confirmed_reschedule: "Reschedule confirmed",
  in_virtual_convo: "Virtual (active)",
  confirmed_virtual: "Virtual confirmed",
  context_question: "Needs context",
  not_interested: "Not interested",
  uncategorized: "Uncategorized"
};

export function StatusBadge({ status }: { status: LeadStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${styles[status]}`}
    >
      {labels[status]}
    </span>
  );
}
