import { describe, expect, it } from "vitest";
import { effectiveRomanUrduForTts, textContainsArabicScript } from "./chat-language";

describe("effectiveRomanUrduForTts", () => {
  it("forces Arabic-script mode when text includes Urdu script", () => {
    expect(effectiveRomanUrduForTts("آپ کا شکریہ", true)).toBe(false);
    expect(effectiveRomanUrduForTts("mix card اور بلاک", true)).toBe(false);
  });

  it("respects tenant Roman Urdu when text is Latin-only", () => {
    expect(effectiveRomanUrduForTts("aap ka shukriya", true)).toBe(true);
    expect(effectiveRomanUrduForTts("aap ka shukriya", false)).toBe(false);
  });
});

describe("textContainsArabicScript", () => {
  it("detects common Arabic blocks", () => {
    expect(textContainsArabicScript("hello")).toBe(false);
    expect(textContainsArabicScript("\u0628")).toBe(true); // ب
  });
});
