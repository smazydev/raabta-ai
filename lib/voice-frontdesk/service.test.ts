import { describe, expect, it, vi } from "vitest";
import { processFrontdeskTurn } from "./service";
import type { FrontdeskToolset } from "./tools";
import type { SessionSnapshot } from "./types";

vi.mock("@/lib/ai/pipelines", () => ({
  generateHandoffSummary: vi.fn(async () => ({ text: "handoff summary", usage: null })),
}));

vi.mock("@/lib/orchestration/workflows", () => ({
  appendLiveEvent: vi.fn(async () => {}),
}));

vi.mock("@/lib/voice-frontdesk/conversational-intake", () => ({
  generateConversationalIntakeReply: vi.fn(async ({ kbSnippet }: { kbSnippet: string | null }) => ({
    text: kbSnippet
      ? `${kbSnippet} برائے مہربانی اپنا نام بتائیں۔`
      : "برائے مہربانی اپنا نام بتائیں۔",
    usage: null,
  })),
}));

vi.mock("@/lib/ai/openai", () => ({
  getOpenAI: () => ({
    chat: {
      completions: {
        create: vi.fn(async () => ({
          choices: [{ message: { content: "Mock voice reply about your interview stage." } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        })),
      },
    },
  }),
}));

function mockTools(): FrontdeskToolset {
  return {
    createTicket: vi.fn(async () => ({ id: "1", ref: "CMP-1" })),
    requestCallback: vi.fn(async () => ({ id: "cb-1" })),
    createLead: vi.fn(async () => ({ id: "lead-1" })),
    lookupCustomerByPhone: vi.fn(async () => null),
    lookupCustomerById: vi.fn(async () => null),
    getBusinessHours: vi.fn(async () => "9-6"),
    getOfficeLocations: vi.fn(async () => "Main office"),
    getFaqAnswer: vi.fn(async () => "approved answer"),
    transferToHuman: vi.fn(async () => ({ ok: true })),
    saveDisposition: vi.fn(async () => ({ ok: true })),
    sendSmsConfirmation: vi.fn(async () => ({ ok: true, providerRef: "sms-1" })),
    runMockInterviewProgressWorkflow: vi.fn(async () => ({
      workflowKey: "candidate_interview_status_v1",
      mockWorkflowRunId: "mock-test",
      candidateName: "Test",
      roleTitle: "Teller",
      currentStageLabel: "Docs",
      summaryLine: "Summary",
      stuckAt: "Wait",
      pendingFromCandidate: ["A"],
      completedSteps: ["B"],
      nextStepHint: "Next",
    })),
  };
}

const snapshot: SessionSnapshot = {
  id: "s1",
  tenantId: "t1",
  conversationId: null,
  callId: null,
  customerId: "cust-1",
  language: "ur",
  languageLocked: true,
  detectedIntent: null,
  ambiguityCount: 0,
  capture: {
    preferredLanguage: "ur",
    callerName: "Ali",
    phoneNumber: "03001234567",
    reasonForCall: "General inquiry",
  },
};

const mockSupabase = {
  from: vi.fn(() => ({
    insert: vi.fn(async () => ({ data: null, error: null })),
  })),
} as never;

describe("voice frontdesk service", () => {
  it("escalates after repeated low-confidence recognition", async () => {
    const tools = mockTools();
    const r = await processFrontdeskTurn({
      supabase: {} as never,
      tenantId: "t1",
      snapshot: { ...snapshot, ambiguityCount: 1 },
      utterance: "???",
      asrConfidence: 0.2,
      tools,
    });
    expect(r.shouldEscalate).toBe(true);
    expect(tools.transferToHuman).toHaveBeenCalled();
  });

  it("saves disposition for callback request", async () => {
    const tools = mockTools();
    await processFrontdeskTurn({
      supabase: mockSupabase,
      tenantId: "t1",
      snapshot,
      utterance: "Please callback me for billing issue",
      asrConfidence: 0.8,
      tools,
      generateReply: async () => "ok",
    });
    expect(tools.requestCallback).toHaveBeenCalled();
    expect(tools.saveDisposition).toHaveBeenCalled();
  });

  it("falls back when tool fails but still returns response", async () => {
    const tools = mockTools();
    tools.requestCallback = vi.fn(async () => {
      throw new Error("provider down");
    });
    const r = await processFrontdeskTurn({
      supabase: mockSupabase,
      tenantId: "t1",
      snapshot,
      utterance: "Please callback me urgently",
      asrConfidence: 0.9,
      tools,
      generateReply: async () => "fallback reply",
    });
    expect(r.responseText.length).toBeGreaterThan(0);
    expect(r.toolCalls.some((c) => c.name === "requestCallback" && !c.ok)).toBe(true);
  });

  it("creates transfer summary for explicit human transfer", async () => {
    const tools = mockTools();
    const r = await processFrontdeskTurn({
      supabase: {} as never,
      tenantId: "t1",
      snapshot,
      utterance: "I need human agent now",
      asrConfidence: 0.9,
      tools,
    });
    expect(r.shouldEscalate).toBe(true);
    expect(r.transferSummary).toContain("handoff");
  });

  it("ends call when caller declines further help after intake", async () => {
    const tools = mockTools();
    const r = await processFrontdeskTurn({
      supabase: mockSupabase,
      tenantId: "t1",
      snapshot,
      utterance: "nai",
      asrConfidence: 0.9,
      tools,
    });
    expect(r.shouldEndCall).toBe(true);
    expect(r.intent).toBe("conversation_complete");
    expect(tools.saveDisposition).toHaveBeenCalled();
  });

  it("hiring status without number in utterance asks for application phone and keeps call open", async () => {
    const tools = mockTools();
    const r = await processFrontdeskTurn({
      supabase: mockSupabase,
      tenantId: "t1",
      snapshot,
      utterance: "I want to know my job interview progress please",
      asrConfidence: 0.9,
      tools,
      generateReply: async () => "stub",
    });
    expect(r.intent).toBe("hiring_interview_status");
    expect(r.shouldEndCall).toBe(false);
    expect(r.updatedCapture.hiringInterviewAwaitingPhone).toBe(true);
    expect(tools.runMockInterviewProgressWorkflow).not.toHaveBeenCalled();
    expect(tools.saveDisposition).not.toHaveBeenCalled();
  });

  it("hiring status with wrong PK mobile ends call and does not run workflow", async () => {
    const tools = mockTools();
    const r = await processFrontdeskTurn({
      supabase: mockSupabase,
      tenantId: "t1",
      snapshot,
      utterance: "My interview status, my number is 03001234567",
      asrConfidence: 0.9,
      tools,
      generateReply: async () => "stub",
    });
    expect(r.intent).toBe("hiring_interview_status");
    expect(r.shouldEndCall).toBe(true);
    expect(r.responseText).toMatch(/not have an application|موجود نہیں/i);
    expect(tools.runMockInterviewProgressWorkflow).not.toHaveBeenCalled();
    expect(tools.saveDisposition).toHaveBeenCalled();
  });

  it("hiring status with demo mobile runs mock workflow and ends call", async () => {
    const tools = mockTools();
    const r = await processFrontdeskTurn({
      supabase: mockSupabase,
      tenantId: "t1",
      snapshot,
      utterance: "Job application status for 03342056691",
      asrConfidence: 0.9,
      tools,
      generateReply: async () => "stub",
    });
    expect(r.intent).toBe("hiring_interview_status");
    expect(r.shouldEndCall).toBe(true);
    expect(tools.runMockInterviewProgressWorkflow).toHaveBeenCalled();
    expect(tools.saveDisposition).toHaveBeenCalled();
  });

  it("after hiring phone prompt, follow-up utterance with demo mobile resolves workflow", async () => {
    const tools = mockTools();
    const snapAwaiting: SessionSnapshot = {
      ...snapshot,
      capture: {
        ...snapshot.capture,
        hiringInterviewAwaitingPhone: true,
      },
    };
    const r = await processFrontdeskTurn({
      supabase: mockSupabase,
      tenantId: "t1",
      snapshot: snapAwaiting,
      utterance: "03342056691",
      asrConfidence: 0.9,
      tools,
      generateReply: async () => "stub",
    });
    expect(r.intent).toBe("hiring_interview_status");
    expect(r.shouldEndCall).toBe(true);
    expect(r.updatedCapture.hiringInterviewAwaitingPhone).toBeFalsy();
    expect(tools.runMockInterviewProgressWorkflow).toHaveBeenCalled();
  });

  it("prepends knowledge snippet while intake is incomplete", async () => {
    const tools = mockTools();
    const partial: SessionSnapshot = {
      ...snapshot,
      capture: { preferredLanguage: "ur" },
    };
    const r = await processFrontdeskTurn({
      supabase: mockSupabase,
      tenantId: "t1",
      snapshot: partial,
      utterance: "What are your branch timings?",
      asrConfidence: 0.9,
      tools,
    });
    expect(tools.getFaqAnswer).toHaveBeenCalled();
    expect(r.responseText).toContain("approved answer");
    expect(r.responseText).toContain("برائے");
  });
});
