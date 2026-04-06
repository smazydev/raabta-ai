import type { TokenUsageSlice } from "@/lib/billing/pricing";

export type VoiceLanguage = "ur" | "sd" | "ps" | "en";

export type SupportedIntent =
  | "general_inquiry"
  | "support_request"
  | "complaint"
  | "billing_question"
  | "sales_inquiry"
  | "callback_request"
  | "office_hours_location"
  | /** Candidate job / interview application progress (voice may run a workflow tool). */
  "hiring_interview_status"
  | "status_check"
  | "human_transfer"
  | "spam_abusive"
  /** Caller declines further help (e.g. "nahi") after intake — end call. */
  | "conversation_complete";

export type CaptureState = {
  callerName?: string;
  phoneNumber?: string;
  preferredLanguage?: VoiceLanguage;
  reasonForCall?: string;
  customerReference?: string;
  urgencyLevel?: "low" | "medium" | "high";
  callbackRequested?: boolean;
  /** Next caller turn should be treated as the job-application mobile number (voice hiring flow). */
  hiringInterviewAwaitingPhone?: boolean;
};

export type SessionSnapshot = {
  id: string;
  tenantId: string;
  conversationId: string | null;
  callId: string | null;
  customerId: string | null;
  language: VoiceLanguage;
  languageLocked: boolean;
  detectedIntent: SupportedIntent | null;
  ambiguityCount: number;
  capture: CaptureState;
};

export type TurnResult = {
  responseText: string;
  language: VoiceLanguage;
  intent: SupportedIntent;
  shouldEscalate: boolean;
  /** When true, Twilio should play response and hang up (no further Gather). */
  shouldEndCall?: boolean;
  escalationReason?: string;
  updatedCapture: CaptureState;
  transferSummary?: string;
  disposition?: Record<string, unknown>;
  toolCalls: { name: string; ok: boolean; ref?: string; error?: string }[];
  /** OpenAI chat usage for this turn (billing). */
  openAiUsages?: TokenUsageSlice[];
};
