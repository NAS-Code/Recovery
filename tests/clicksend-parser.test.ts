import { describe, expect, it } from "vitest";
import {
  ClicksendError,
  parseInboundWebhook
} from "@/lib/integrations/clicksend";

describe("parseInboundWebhook — valid payloads", () => {
  it("parses a standard JSON inbound payload", () => {
    const result = parseInboundWebhook({
      from: "+15555550101",
      to: "+15551234567",
      body: "Yes 3pm works",
      message_id: "msg_abc",
      customstring: "lead_1",
      timestamp: 1714400000
    });

    expect(result).toMatchObject({
      from: "+15555550101",
      to: "+15551234567",
      text: "Yes 3pm works",
      messageId: "msg_abc",
      customString: "lead_1"
    });
    expect(result.timestamp).toBeInstanceOf(Date);
    expect(result.timestamp.getTime()).toBe(1714400000 * 1000);
  });

  it("accepts string-encoded numeric timestamps", () => {
    const result = parseInboundWebhook({
      from: "+15555550101",
      body: "ok",
      timestamp: "1714400000"
    });
    expect(result.timestamp.getTime()).toBe(1714400000 * 1000);
  });

  it("interprets large numbers as milliseconds, small as seconds", () => {
    const ms = parseInboundWebhook({
      from: "+15555550101",
      body: "ok",
      timestamp: 1_714_400_000_000
    });
    expect(ms.timestamp.getTime()).toBe(1_714_400_000_000);
  });

  it("falls back to current time when timestamp is missing", () => {
    const before = Date.now();
    const result = parseInboundWebhook({ from: "+15555550101", body: "ok" });
    const after = Date.now();
    expect(result.timestamp.getTime()).toBeGreaterThanOrEqual(before);
    expect(result.timestamp.getTime()).toBeLessThanOrEqual(after);
  });

  it("falls back to current time when timestamp is not parseable", () => {
    const result = parseInboundWebhook({
      from: "+15555550101",
      body: "ok",
      timestamp: "not-a-number"
    });
    expect(result.timestamp).toBeInstanceOf(Date);
    expect(Number.isNaN(result.timestamp.getTime())).toBe(false);
  });

  it("accepts custom_string in addition to customstring", () => {
    const result = parseInboundWebhook({
      from: "+15555550101",
      body: "ok",
      custom_string: "lead_2"
    });
    expect(result.customString).toBe("lead_2");
  });

  it("ignores extra unknown fields", () => {
    const result = parseInboundWebhook({
      from: "+15555550101",
      body: "ok",
      subaccount_id: "sub_1",
      originalsenderid: "+15555550101",
      something_new: { nested: true }
    });
    expect(result.from).toBe("+15555550101");
  });
});

describe("parseInboundWebhook — form-encoded payloads (Clicksend URL action)", () => {
  it("parses an object reconstructed from URLSearchParams", () => {
    const formText =
      "from=%2B15555550101&to=%2B18335184857&body=TEST+4pm+works&message_id=msg_xyz&timestamp=1714400000";
    const obj = Object.fromEntries(new URLSearchParams(formText));
    const result = parseInboundWebhook(obj);
    expect(result.from).toBe("+15555550101");
    expect(result.to).toBe("+18335184857");
    expect(result.text).toBe("TEST 4pm works");
    expect(result.messageId).toBe("msg_xyz");
    expect(result.timestamp.getTime()).toBe(1714400000 * 1000);
  });
});

describe("parseInboundWebhook — invalid payloads", () => {
  it("throws when from is missing", () => {
    expect(() =>
      parseInboundWebhook({ body: "hello" })
    ).toThrow(ClicksendError);
  });

  it("throws when from is empty", () => {
    expect(() =>
      parseInboundWebhook({ from: "", body: "hello" })
    ).toThrow(ClicksendError);
  });

  it("throws when body is missing", () => {
    expect(() =>
      parseInboundWebhook({ from: "+15555550101" })
    ).toThrow(ClicksendError);
  });

  it("throws on null or non-object payloads", () => {
    expect(() => parseInboundWebhook(null)).toThrow(ClicksendError);
    expect(() => parseInboundWebhook("string")).toThrow(ClicksendError);
    expect(() => parseInboundWebhook(42)).toThrow(ClicksendError);
  });
});
