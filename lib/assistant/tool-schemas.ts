import type { ChatCompletionTool } from "openai/resources/chat/completions";

export const ASSISTANT_TOOLS: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "search_knowledge_base",
      description:
        "PostgreSQL pgvector search over embedded knowledge chunks (policies, SOPs). Requires indexed chunks; if nothing returns, try different keywords. Roman Urdu / mixed queries: pass user wording; optional second call with English HR terms if the first pass is empty.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query: user wording and/or concise English HR/policy keywords",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_operations_digest",
      description:
        "Summarized counts from the operations dashboard: complaints, conversations, customers, recent live events. Use for 'how are we doing' style questions.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "lookup_hiring_by_reference",
      description:
        "Look up a hiring application by internal reference code for this tenant (staff only). Returns stage, document issues, offer status.",
      parameters: {
        type: "object",
        properties: {
          reference_code: { type: "string" },
        },
        required: ["reference_code"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "present_markdown_report",
      description:
        "Show a structured markdown report in the side panel (metrics, checklists, mini-dashboards). Use after computing or summarizing data.",
      parameters: {
        type: "object",
        properties: {
          markdown: { type: "string", description: "GitHub-flavored markdown body" },
        },
        required: ["markdown"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_my_personalization_profile",
      description:
        "Returns this user's HR personalization row (department, work nature, interests, performance summary) if configured. Use before drafting tailored surveys or learning paths.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "draft_survey_questions",
      description:
        "Generate a draft survey (JSON questions) from topic and employee context. Admin only. Does not save until save_survey_template is called.",
      parameters: {
        type: "object",
        properties: {
          topic: { type: "string" },
          audience_notes: {
            type: "string",
            description: "Role, work nature, interests, performance themes to personalize",
          },
        },
        required: ["topic"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_survey_template",
      description: "Persist a survey template. Admin only.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          questions_json: { type: "string", description: "Stringified JSON array of question objects" },
        },
        required: ["title", "questions_json"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "assign_survey",
      description: "Assign a survey template to an employee profile. Admin only.",
      parameters: {
        type: "object",
        properties: {
          template_id: { type: "string" },
          profile_id: { type: "string" },
        },
        required: ["template_id", "profile_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_my_survey_assignments",
      description: "List surveys assigned to the current user and completion status.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "submit_survey_answers",
      description: "Submit answers for a survey assignment owned by the current user.",
      parameters: {
        type: "object",
        properties: {
          assignment_id: { type: "string" },
          answers_json: { type: "string", description: "Stringified JSON object map questionId -> answer" },
        },
        required: ["assignment_id", "answers_json"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_my_courses",
      description: "List assigned training modules and progress.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_course_mcq",
      description: "Get one MCQ activity by module and index for the current user.",
      parameters: {
        type: "object",
        properties: {
          module_id: { type: "string" },
          activity_index: { type: "integer", minimum: 0 },
        },
        required: ["module_id", "activity_index"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "submit_mcq_answer",
      description: "Submit selected option index for an MCQ; updates progress.",
      parameters: {
        type: "object",
        properties: {
          module_id: { type: "string" },
          activity_index: { type: "integer", minimum: 0 },
          selected_index: { type: "integer", minimum: 0 },
        },
        required: ["module_id", "activity_index", "selected_index"],
      },
    },
  },
];
