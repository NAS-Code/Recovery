import type { Lead } from "@/lib/core/types";

/** Context about the sender identity, threaded through from the client/campaign data. */
export interface SenderContext {
  /** The agent persona name, e.g. "Sloane Royale". */
  agentName?: string | null;
  /** The client company operating the booth, e.g. "Vendelux". */
  clientName?: string | null;
}

function firstName(fullName: string): string {
  const trimmed = fullName.trim();
  if (!trimmed) return "there";
  return trimmed.split(/\s+/)[0];
}

function senderIntro(ctx?: SenderContext): string {
  const agentFull = ctx?.agentName?.trim();
  const agentFirst = agentFull ? agentFull.split(/\s+/)[0] : null;
  const company = ctx?.clientName?.trim();
  if (agentFirst && company) return `This is ${agentFirst} from ${company}. `;
  if (company) return `This is the team at ${company}. `;
  if (agentFirst) return `This is ${agentFirst}. `;
  return "";
}

export function buildFirstNoShowSms(lead: Lead, ctx?: SenderContext): string {
  const first = firstName(lead.name);
  const intro = senderIntro(ctx);
  if (lead.nativeSchedulingLink) {
    return `Hi ${first}, ${intro}Sorry we missed you for our meeting earlier today. Happy to find another slot — grab a time that works for you: ${lead.nativeSchedulingLink}`;
  }
  return `Hi ${first}, ${intro}Sorry we missed you for our meeting earlier today. Want to try another time? Let me know what works and I'll get it on the books.`;
}

export function buildEodCheckinSms(lead: Lead, ctx?: SenderContext): string {
  const first = firstName(lead.name);
  const intro = senderIntro(ctx);
  return `Hi ${first}, ${intro}Just wanted to circle back — are you still around the event today? Happy to find another time if so.`;
}

export function buildVirtualOfferSms(lead: Lead, ctx?: SenderContext): string {
  const first = firstName(lead.name);
  const intro = senderIntro(ctx);
  return `Hi ${first}, ${intro}Looks like we didn't get to connect at the event. Would you be up for a quick virtual meeting next week instead?`;
}
