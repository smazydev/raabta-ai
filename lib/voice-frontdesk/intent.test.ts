import { describe, expect, it } from "vitest";
import { classifyIntent, isConversationCompleteUtterance, resolveVoiceIntent } from "./intent";

describe("isConversationCompleteUtterance", () => {
  it("detects Roman Urdu and English short negatives", () => {
    expect(isConversationCompleteUtterance("nahi")).toBe(true);
    expect(isConversationCompleteUtterance("nai")).toBe(true);
    expect(isConversationCompleteUtterance("Nahi.")).toBe(true);
    expect(isConversationCompleteUtterance("no")).toBe(true);
    expect(isConversationCompleteUtterance("nope")).toBe(true);
    expect(isConversationCompleteUtterance("kuch nahi")).toBe(true);
    expect(isConversationCompleteUtterance("shukriya bas")).toBe(true);
    expect(isConversationCompleteUtterance("no thanks")).toBe(true);
  });

  it("rejects longer or substantive utterances", () => {
    expect(isConversationCompleteUtterance("nahi main billing ke liye phone kar raha tha")).toBe(false);
    expect(isConversationCompleteUtterance("")).toBe(false);
  });
});

describe("classifyIntent", () => {
  it("labels conversation_complete before general inquiry", () => {
    expect(classifyIntent("nai").intent).toBe("conversation_complete");
    expect(classifyIntent("nahi shukriya").intent).toBe("conversation_complete");
  });

  it("detects hiring / interview progress in English and Roman Urdu", () => {
    expect(classifyIntent("I want my job interview progress").intent).toBe("hiring_interview_status");
    expect(classifyIntent("mujhe interview ke baare mein status chahiye").intent).toBe(
      "hiring_interview_status"
    );
    expect(classifyIntent("application status for hiring").intent).toBe("hiring_interview_status");
  });

  it("detects Urdu script interview/application status and common interview→ائرن STT errors", () => {
    expect(classifyIntent("مجھے اپنا ائرن اسٹیٹس معلوم کرنا ہے").intent).toBe("hiring_interview_status");
    expect(classifyIntent("مجھے انٹرویو کا اسٹیٹس معلوم کرنا ہے").intent).toBe("hiring_interview_status");
    expect(classifyIntent("درخواست کی حالت بتائیں").intent).toBe("hiring_interview_status");
  });
});

describe("resolveVoiceIntent", () => {
  it("uses earlier caller lines so a short reply still counts as hiring", () => {
    const transcript = `Caller: I want to know about my job application\nAssistant: When did you apply?`;
    expect(resolveVoiceIntent("last month", transcript).intent).toBe("hiring_interview_status");
  });

  it("routes short replies after assistant hiring follow-up into hiring flow", () => {
    const transcript = `Caller: hello\nAssistant: When did you submit your job application?`;
    expect(resolveVoiceIntent("January", transcript).intent).toBe("hiring_interview_status");
  });

  it("routes after I am checking your hiring style filler", () => {
    const transcript = `Caller: status please\nAssistant: I am checking your hiring status now.`;
    expect(resolveVoiceIntent("okay", transcript).intent).toBe("hiring_interview_status");
  });

  it("does not override explicit human transfer", () => {
    const transcript = `Assistant: When did you apply?`;
    expect(resolveVoiceIntent("I need a human agent", transcript).intent).toBe("human_transfer");
  });
});
