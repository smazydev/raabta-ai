import { describe, expect, it } from "vitest";
import {
  extractCallerNameFromUtterance,
  isCaptureComplete,
  updateCaptureFromUtterance,
} from "./capture";

describe("caller name extraction", () => {
  it("parses Roman Urdu mera naam … hai", () => {
    expect(extractCallerNameFromUtterance("mera naam ali hai")).toBe("ali");
    expect(extractCallerNameFromUtterance("Mera Naam Syed Ali hai")).toBe("Syed Ali");
    expect(extractCallerNameFromUtterance("mera nam Ali hai")).toBe("Ali");
  });

  it("parses English and main … hoon", () => {
    expect(extractCallerNameFromUtterance("my name is Sara")).toBe("Sara");
    expect(extractCallerNameFromUtterance("main Omar hoon")).toBe("Omar");
  });

  it("accepts short name-only reply", () => {
    expect(extractCallerNameFromUtterance("Ali")).toBe("Ali");
    expect(extractCallerNameFromUtterance("  Ali  ")).toBe("Ali");
  });

  it("does not treat common words as names", () => {
    expect(extractCallerNameFromUtterance("hello")).toBeUndefined();
    expect(extractCallerNameFromUtterance("ji")).toBeUndefined();
  });
});

describe("structured detail capture", () => {
  it("captures phone and callback flag", () => {
    const s = updateCaptureFromUtterance(
      { preferredLanguage: "ur" },
      "Please callback on 03001234567 for billing issue"
    );
    expect(s.phoneNumber).toBe("03001234567");
    expect(s.callbackRequested).toBe(true);
  });

  it("captures caller name from Roman Urdu", () => {
    const s = updateCaptureFromUtterance({ preferredLanguage: "ur" }, "mera naam ali hai");
    expect(s.callerName).toBe("ali");
  });

  it("marks capture complete only with required fields", () => {
    expect(
      isCaptureComplete({
        preferredLanguage: "ur",
        phoneNumber: "03001234567",
        reasonForCall: "billing issue",
      })
    ).toBe(true);
    expect(
      isCaptureComplete({
        preferredLanguage: "ur",
        reasonForCall: "billing issue",
      })
    ).toBe(false);
  });
});
