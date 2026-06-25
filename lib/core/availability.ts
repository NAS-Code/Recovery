// ponytail: fixed 30-min slots; add a per-campaign duration only if it ever varies.
export const MEETING_DURATION_MIN = 30;

/**
 * True if `proposed` overlaps any time in `existing`. Every meeting is the same
 * fixed length, so two slots [a, a+D) and [b, b+D) overlap iff |a-b| < D.
 */
export function hasConflict(existing: Date[], proposed: Date): boolean {
  const windowMs = MEETING_DURATION_MIN * 60 * 1000;
  const p = proposed.getTime();
  return existing.some((d) => Math.abs(d.getTime() - p) < windowMs);
}
