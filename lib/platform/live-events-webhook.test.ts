import { describe, expect, it } from "vitest";
import { signLiveEventWebhookBody } from "./live-events-webhook";

describe("signLiveEventWebhookBody", () => {
  it("matches HMAC-SHA256 hex of UTF-8 body", () => {
    const body = JSON.stringify({ type: "live_event", event_type: "test" });
    const sig = signLiveEventWebhookBody("secret", body);
    expect(sig).toMatch(/^[a-f0-9]{64}$/);
    expect(signLiveEventWebhookBody("secret", body)).toBe(sig);
    expect(signLiveEventWebhookBody("other", body)).not.toBe(sig);
  });
});
