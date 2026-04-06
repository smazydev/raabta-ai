import { describe, expect, it } from "vitest";
import { detectLanguageFromText, resolveLanguage } from "./language";

describe("voice language detection and locking", () => {
  it("detects Urdu script with stronger confidence", () => {
    const r = detectLanguageFromText("میرا اکاؤنٹ بلاک ہوگیا ہے");
    expect(r.language).toBe("ur");
    expect(r.confidence).toBeGreaterThan(0.7);
  });

  it("falls back to Urdu when Sindhi flag is disabled", () => {
    const r = resolveLanguage("sd", {
      urduEnabled: true,
      sindhiEnabled: false,
      pashtoEnabled: false,
    });
    expect(r.language).toBe("ur");
    expect(r.degraded).toBe(true);
  });

  it("falls back Sindhi when Pashto requested but Pashto disabled", () => {
    const r = resolveLanguage("ps", {
      urduEnabled: true,
      sindhiEnabled: true,
      pashtoEnabled: false,
    });
    expect(r.language).toBe("sd");
    expect(r.degraded).toBe(true);
  });

  it("defaults ambiguous Latin transcript to Urdu for voice", () => {
    const r = detectLanguageFromText("card block ho gaya");
    expect(r.language).toBe("ur");
  });
});
