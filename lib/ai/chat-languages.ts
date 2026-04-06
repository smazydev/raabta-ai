export const CHAT_LANGUAGE_CODES = ["en", "ur", "ps", "sd"] as const;
export type ChatLanguage = (typeof CHAT_LANGUAGE_CODES)[number];

export const CHAT_LANGUAGE_OPTIONS: { value: ChatLanguage; label: string }[] = [
  { value: "en", label: "English" },
  { value: "ur", label: "Urdu" },
  { value: "ps", label: "Pashto" },
  { value: "sd", label: "Sindhi" },
];
