import type { Lead } from "@/lib/core/types";

function firstName(fullName: string): string {
  const trimmed = fullName.trim();
  if (!trimmed) return "there";
  return trimmed.split(/\s+/)[0];
}

export function buildFirstNoShowSms(lead: Lead): string {
  const first = firstName(lead.name);
  if (lead.nativeSchedulingLink) {
    return `Hi ${first}, sorry we missed you for our meeting earlier today. Happy to find another slot — grab a time that works for you: ${lead.nativeSchedulingLink}`;
  }
  return `Hi ${first}, sorry we missed you for our meeting earlier today. Want to try another time? Let me know what works and I'll get it on the books.`;
}

export function buildEodCheckinSms(lead: Lead): string {
  const first = firstName(lead.name);
  return `Hi ${first}, just wanted to circle back — are you still around the event today? Happy to find another time if so.`;
}

export function buildVirtualOfferSms(lead: Lead): string {
  const first = firstName(lead.name);
  return `Hi ${first}, looks like we didn't get to connect at the event. Would you be up for a quick virtual meeting next week instead?`;
}
