import { languageFlagsFromEnv } from "@/lib/voice-frontdesk/language";

/** Spoken-output and multilingual behavior for Realtime voice (same tools as text). */
export function voiceRealtimeLanguageInstructions(): string {
  const f = languageFlagsFromEnv();
  const parts = [
    "[Voice — languages]",
    "- Infer the user’s language from their speech each turn (Urdu including اردو and Roman Urdu, English).",
    "- **Reply in the same language** they are using when you can; if they mix, follow the dominant language.",
  ];
  if (f.sindhiEnabled) {
    parts.push("- Sindhi (سنڌي) is in scope when they are clearly speaking Sindhi.");
  } else {
    parts.push(
      "- If they speak Sindhi but Sindhi is disabled for this deployment, continue helpfully in Urdu or English and offer to continue in those languages."
    );
  }
  if (f.pashtoEnabled) {
    parts.push("- Pashto (پښتو) is in scope when they are clearly speaking Pashto.");
  } else {
    parts.push(
      "- If they speak Pashto but Pashto is disabled for this deployment, continue helpfully in Urdu or English."
    );
  }
  parts.push(
    "- Keep spoken answers concise unless they ask for more detail.",
    "- After using a tool, summarize what matters aloud in their language; do not read raw JSON or long tables verbatim."
  );
  return parts.join("\n");
}

export function voiceRealtimeToolsInstructions(): string {
  return `[Voice — tools — required behavior]
- For **any** question about policies, HR, leaves, ATM/banking limits, benefits, procedures, or “what does our company say about…”, you **must** call \`search_knowledge_base\` **before** saying the information is not available. Pass the user’s words (Roman Urdu is fine); if the first search is empty, call again with tighter English keywords (e.g. “annual leave”, “ATM withdrawal limit”).
- Use other tools (operations digest, hiring lookup, surveys, training, markdown reports) whenever they fit, same as text chat.
- **Never** claim there is no documentation until you have actually run \`search_knowledge_base\` for that topic.
- After tools return, summarize aloud in the user’s language; do not read raw JSON verbatim.
- For \`present_markdown_report\`, mention the side panel and give a short spoken summary.

[Voice — ending the call]
- If the user signals they are **done** (goodbye, thanks that’s all, no more questions, stop, we’re done, “bas”, “theek hai”, not interested in anything else), call \`end_voice_session\` **first**, then say **one short** closing phrase in their language (e.g. “You’re welcome, goodbye” / “Khuda hafiz” / “Take care”). Do **not** start a new topic or ask follow-up questions after that.
- The user can always tap **End voice** in the app to hang up immediately; your job is to recognize verbal goodbyes and use the tool.`;
}
