import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getClientContext } from "@/lib/auth/context";
import { getLeadRepository } from "@/lib/integrations/data";
import { ClientHeader } from "../_components/ClientHeader";
import { MarkNoShowButton } from "../_components/MarkNoShowButton";
import { StatusBadge } from "../_components/StatusBadge";
import { Thread } from "../_components/Thread";

export const dynamic = "force-dynamic";

export default async function LeadThreadPage({
  params
}: {
  params: { leadId: string };
}) {
  const ctx = getClientContext();
  if (!ctx) redirect("/sign-in");

  const repo = getLeadRepository();
  const [client, lead] = await Promise.all([
    repo.getClient(ctx.clientId),
    repo.getLead(params.leadId)
  ]);

  if (!client) redirect("/sign-in");
  if (!lead || lead.clientId !== ctx.clientId) notFound();

  const history = await repo.getConversationHistory(lead.id);

  return (
    <main className="mx-auto max-w-3xl p-8">
      <ClientHeader clientName={client.name} />

      <Link
        href="/dashboard"
        className="text-xs text-slate-500 hover:underline"
      >
        ← Back to dashboard
      </Link>

      <header className="mt-2 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{lead.name}</h1>
          <p className="text-sm text-slate-500">
            {lead.company ? `${lead.company} · ` : ""}
            {lead.phone}
          </p>
          <div className="mt-2 flex items-center gap-3">
            <StatusBadge status={lead.status} />
            {lead.scheduledMeetingTime ? (
              <span className="text-xs text-slate-500">
                Meeting: {lead.scheduledMeetingTime.toLocaleString()}
              </span>
            ) : null}
          </div>
        </div>
        {lead.status === "scheduled" ? (
          <MarkNoShowButton leadId={lead.id} />
        ) : null}
      </header>

      <section className="mt-6 rounded-lg bg-slate-100 p-4">
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-500">
          Conversation
        </h2>
        <Thread messages={history} />
      </section>
    </main>
  );
}
