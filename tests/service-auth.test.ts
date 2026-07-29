import { describe, expect, it } from "vitest";
import { verifyServiceToken } from "@/lib/util/service-auth";

const TOKEN = "s3rvice-token-abcdefghijklmnop";

describe("verifyServiceToken", () => {
  it("accepts the exact token", () => {
    expect(verifyServiceToken(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
  });

  it("rejects a wrong token of the same length", () => {
    const wrong = "s3rvice-token-abcdefghijklmnoq";
    expect(wrong).toHaveLength(TOKEN.length);
    expect(verifyServiceToken(`Bearer ${wrong}`, TOKEN)).toBe(false);
  });

  it("rejects a token of a different length without throwing", () => {
    // timingSafeEqual throws on length mismatch, so this asserts the digest
    // comparison is actually in place rather than a raw buffer compare.
    expect(() => verifyServiceToken("Bearer short", TOKEN)).not.toThrow();
    expect(verifyServiceToken("Bearer short", TOKEN)).toBe(false);
  });

  it("rejects a correct token without the Bearer prefix", () => {
    expect(verifyServiceToken(TOKEN, TOKEN)).toBe(false);
  });

  it("rejects the wrong scheme", () => {
    expect(verifyServiceToken(`Basic ${TOKEN}`, TOKEN)).toBe(false);
  });

  it("rejects an empty token after the prefix", () => {
    expect(verifyServiceToken("Bearer ", TOKEN)).toBe(false);
  });

  it("rejects a missing header", () => {
    expect(verifyServiceToken(null, TOKEN)).toBe(false);
    expect(verifyServiceToken("", TOKEN)).toBe(false);
  });

  it("fails closed when the expected token is unset", () => {
    // The important one: a deploy missing LOOKOUT_API_TOKEN must reject
    // everything, not accept everything.
    expect(verifyServiceToken(`Bearer ${TOKEN}`, undefined)).toBe(false);
    expect(verifyServiceToken("Bearer ", undefined)).toBe(false);
    expect(verifyServiceToken(null, undefined)).toBe(false);
  });

  it("is case-sensitive on the token", () => {
    expect(verifyServiceToken(`Bearer ${TOKEN.toUpperCase()}`, TOKEN)).toBe(false);
  });
});
