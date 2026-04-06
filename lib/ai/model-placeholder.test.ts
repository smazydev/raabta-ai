import { describe, expect, it } from "vitest";
import { openAiModelIdFromPlaceholder } from "./model-placeholder";

describe("openAiModelIdFromPlaceholder", () => {
  it("accepts typical OpenAI ids", () => {
    expect(openAiModelIdFromPlaceholder("gpt-5.4-mini")).toBe("gpt-5.4-mini");
    expect(openAiModelIdFromPlaceholder("gpt-4o-mini")).toBe("gpt-4o-mini");
    expect(openAiModelIdFromPlaceholder(" o1-preview ")).toBe("o1-preview");
  });

  it("rejects human labels and invalid tokens", () => {
    expect(openAiModelIdFromPlaceholder("Tenant default — controlled route")).toBeNull();
    expect(openAiModelIdFromPlaceholder("")).toBeNull();
    expect(openAiModelIdFromPlaceholder("gpt bad")).toBeNull();
    expect(openAiModelIdFromPlaceholder("a".repeat(65))).toBeNull();
  });
});
