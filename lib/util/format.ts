/**
 * Format a meeting time for display. Always renders in the event's timezone
 * (e.g. "May 4, 4:00 PM PDT") so the dashboard reads the same regardless of
 * where the FDE viewing it is sitting.
 */
export function formatMeetingTime(
  d: Date | null | undefined,
  timezone?: string
): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(d);
}

/** Parse an ISO 8601 string into a Date, or return null if it's not a valid date. */
export function tryParseIsoDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
