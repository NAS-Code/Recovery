import { describe, expect, it } from "vitest";
import { hasConflict } from "@/lib/core/availability";

const at = (iso: string) => new Date(iso);

describe("hasConflict", () => {
  it("no conflict against an empty list", () => {
    expect(hasConflict([], at("2026-06-18T18:00:00Z"))).toBe(false);
  });

  it("exact same time conflicts", () => {
    expect(
      hasConflict([at("2026-06-18T18:00:00Z")], at("2026-06-18T18:00:00Z"))
    ).toBe(true);
  });

  it("conflicts just inside the 30-min window", () => {
    expect(
      hasConflict([at("2026-06-18T18:00:00Z")], at("2026-06-18T18:29:00Z"))
    ).toBe(true);
  });

  it("no conflict exactly 30 min apart (back-to-back slots)", () => {
    expect(
      hasConflict([at("2026-06-18T18:00:00Z")], at("2026-06-18T18:30:00Z"))
    ).toBe(false);
  });

  it("no conflict well outside the window", () => {
    expect(
      hasConflict(
        [at("2026-06-18T18:00:00Z"), at("2026-06-18T20:00:00Z")],
        at("2026-06-18T19:00:00Z")
      )
    ).toBe(false);
  });

  it("conflicts if any one existing time overlaps", () => {
    expect(
      hasConflict(
        [at("2026-06-18T18:00:00Z"), at("2026-06-18T19:00:00Z")],
        at("2026-06-18T19:15:00Z")
      )
    ).toBe(true);
  });
});
