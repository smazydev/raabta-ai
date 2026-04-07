import { ASSISTANT_TOOLS } from "@/lib/assistant/tool-schemas";

/** Shape expected inside OpenAI Realtime `session` for `/v1/realtime/calls`. */
export type RealtimeSessionFunctionTool = {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

/**
 * OpenAI Realtime is strict about JSON Schema for tools: object schemas should set
 * `additionalProperties: false`, and empty objects need explicit `required: []`.
 * Some gateways reject `integer`; use `number` with `minimum` instead.
 */
function normalizeParameterProperty(prop: unknown): unknown {
  if (!prop || typeof prop !== "object" || Array.isArray(prop)) return prop;
  const p = prop as Record<string, unknown>;
  if (p.type === "integer") {
    return { ...p, type: "number" };
  }
  if (
    p.type === "object" &&
    p.properties &&
    typeof p.properties === "object" &&
    !Array.isArray(p.properties)
  ) {
    return normalizeParametersRoot(p as Record<string, unknown>);
  }
  return prop;
}

function normalizeParametersRoot(params: Record<string, unknown>): Record<string, unknown> {
  const rawProps = params.properties;
  const properties =
    rawProps && typeof rawProps === "object" && !Array.isArray(rawProps)
      ? (rawProps as Record<string, unknown>)
      : {};
  const required = Array.isArray(params.required)
    ? (params.required.filter((x) => typeof x === "string") as string[])
    : [];

  const outProps: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(properties)) {
    outProps[key] = normalizeParameterProperty(prop);
  }

  return {
    type: "object",
    properties: outProps,
    required,
    additionalProperties: false,
  };
}

/** Voice-only: model calls this when the user is done (goodbye, no more questions, stop, thanks that’s all). */
export const END_VOICE_SESSION_TOOL_NAME = "end_voice_session";

const END_VOICE_SESSION_TOOL: RealtimeSessionFunctionTool = {
  type: "function" as const,
  name: END_VOICE_SESSION_TOOL_NAME,
  description:
    "End the live voice call from the user’s side. Use when they clearly want to stop: goodbye, thanks that’s all, no more questions, stop, we’re done, bas (Urdu), etc. Call this **before** your very short closing line; the app hangs up after you finish that line.",
  parameters: normalizeParametersRoot({
    type: "object",
    properties: {
      reason: {
        type: "string",
        description: "Optional short note for logs (e.g. user_said_goodbye)",
      },
    },
    required: [],
  }),
};

export function assistantToolsForRealtimeSession(): RealtimeSessionFunctionTool[] {
  const base = ASSISTANT_TOOLS.map((t) => {
    if (t.type !== "function") {
      throw new Error("ASSISTANT_TOOLS must be function tools for Realtime");
    }
    const raw = (t.function.parameters ?? { type: "object", properties: {} }) as Record<string, unknown>;
    return {
      type: "function" as const,
      name: t.function.name,
      description: t.function.description ?? "",
      parameters: normalizeParametersRoot(raw),
    };
  });
  return [...base, END_VOICE_SESSION_TOOL];
}

export const ASSISTANT_TOOL_NAMES: ReadonlySet<string> = new Set(
  ASSISTANT_TOOLS.map((t) => {
    if (t.type !== "function") {
      throw new Error("ASSISTANT_TOOLS must be function tools");
    }
    return t.function.name;
  })
);
