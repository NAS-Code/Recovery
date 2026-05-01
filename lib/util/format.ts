const meetingTimeFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit"
});

export function formatMeetingTime(d: Date | null | undefined): string {
  if (!d) return "—";
  return meetingTimeFormatter.format(d);
}

/** Parse an ISO 8601 string into a Date, or return null if it's not a valid date. */
export function tryParseIsoDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
