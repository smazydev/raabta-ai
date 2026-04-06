import type { AppDbClient } from "@/lib/db/types";
import { dbRows } from "@/lib/db/rows";
import type { TokenUsageSlice } from "@/lib/billing/pricing";
import { searchKnowledge } from "@/lib/knowledge/retrieve";
import { draftSurveyQuestionsWithAi } from "@/lib/assistant/draft-survey";

export type ToolContext = {
  supabase: AppDbClient;
  tenantId: string;
  userId: string;
  openAiChatModel: string;
  /** When set, search_knowledge_base only considers these article IDs (governed agent scope). */
  allowedKnowledgeArticleIds?: string[] | undefined;
  /** Collect per-completion usage for one billed assistant turn. */
  accumulateUsage?: (usage: TokenUsageSlice | null) => void;
};

export type ToolRunResult = {
  content: string;
  artifactMarkdown?: string;
};

export async function executeAssistantTool(
  ctx: ToolContext,
  name: string,
  args: Record<string, unknown>
): Promise<ToolRunResult> {
  const { supabase, tenantId, userId } = ctx;

  switch (name) {
    case "search_knowledge_base": {
      const query = String(args.query ?? "").trim();
      if (!query) return { content: "Missing query." };
      const hits = await searchKnowledge(supabase, tenantId, query, 6, {
        allowedArticleIds: ctx.allowedKnowledgeArticleIds,
      });
      if (!hits.length) return { content: "No matching knowledge articles found." };
      const text = hits
        .map((h) => `### ${h.title}\n${h.body.slice(0, 1200)}${h.body.length > 1200 ? "…" : ""}`)
        .join("\n\n");
      return { content: text };
    }

    case "get_operations_digest": {
      const [complaints, conversations, customers, events] = await Promise.all([
        supabase
          .from("complaints")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .in("status", ["new", "in_review", "awaiting_customer", "escalated"]),
        supabase
          .from("conversations")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .eq("status", "active"),
        supabase.from("customers").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId),
        supabase
          .from("live_events")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .gte("created_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString()),
      ]);
      const openComplaints = complaints.count ?? 0;
      const activeConv = conversations.count ?? 0;
      const cust = customers.count ?? 0;
      const ev24 = events.count ?? 0;
      const lines = [
        `Open complaints (not resolved/closed): ${openComplaints}`,
        `Active conversations: ${activeConv}`,
        `Customers on file: ${cust}`,
        `Live events (last 24h): ${ev24}`,
      ].join("\n");
      return { content: lines };
    }

    case "lookup_hiring_by_reference": {
      const ref = String(args.reference_code ?? "").trim();
      if (!ref) return { content: "Missing reference_code." };
      const { data, error } = await supabase
        .from("hiring_applications")
        .select(
          "candidate_name, candidate_email, stage, document_discrepancy, offer_issued, reference_code, updated_at"
        )
        .eq("tenant_id", tenantId)
        .eq("reference_code", ref)
        .maybeSingle();
      if (error) return { content: `Lookup failed: ${error.message}` };
      if (!data) return { content: "No application found for that reference code in this tenant." };
      return {
        content: JSON.stringify(data, null, 2),
      };
    }

    case "present_markdown_report": {
      const md = String(args.markdown ?? "");
      if (!md) return { content: "Empty markdown." };
      return {
        content: "Report rendered in the side panel for the user.",
        artifactMarkdown: md,
      };
    }

    case "get_my_personalization_profile": {
      const { data, error } = await supabase
        .from("employee_attributes")
        .select(
          "department, work_nature, areas_of_interest, personality_notes, performance_summary, updated_at"
        )
        .eq("tenant_id", tenantId)
        .eq("profile_id", userId)
        .maybeSingle();
      if (error) return { content: error.message };
      if (!data) {
        return {
          content:
            "No personalization profile on file. Ask an admin to add employee attributes in HR tooling or seed data.",
        };
      }
      return { content: JSON.stringify(data, null, 2) };
    }

    case "draft_survey_questions": {
      const topic = String(args.topic ?? "").trim();
      if (!topic) return { content: "Missing topic." };
      const audience_notes = args.audience_notes != null ? String(args.audience_notes) : undefined;
      const questions = await draftSurveyQuestionsWithAi({
        topic,
        audienceNotes: audience_notes,
        model: ctx.openAiChatModel,
        onUsage: ctx.accumulateUsage,
      });
      return { content: JSON.stringify({ questions }, null, 2) };
    }

    case "save_survey_template": {
      const title = String(args.title ?? "").trim();
      const description = args.description != null ? String(args.description) : null;
      const qRaw = String(args.questions_json ?? "").trim();
      if (!title || !qRaw) return { content: "title and questions_json required." };
      let questions: unknown;
      try {
        questions = JSON.parse(qRaw);
      } catch {
        return { content: "questions_json must be valid JSON." };
      }
      const { data, error } = await supabase
        .from("survey_templates")
        .insert({
          tenant_id: tenantId,
          title,
          description,
          questions: questions as never,
          personalization_context: {},
          created_by: userId,
        })
        .select("id")
        .single();
      if (error) return { content: error.message };
      if (!data || typeof data.id !== "string") return { content: "Save failed." };
      return { content: `Saved survey template id=${data.id}` };
    }

    case "assign_survey": {
      const template_id = String(args.template_id ?? "");
      const profile_id = String(args.profile_id ?? "");
      if (!template_id || !profile_id) return { content: "template_id and profile_id required." };
      const { error } = await supabase.from("survey_assignments").insert({
        tenant_id: tenantId,
        template_id,
        assigned_profile_id: profile_id,
        status: "pending",
      });
      if (error) return { content: error.message };
      return { content: "Survey assigned." };
    }

    case "list_my_survey_assignments": {
      const { data: asgRaw, error } = await supabase
        .from("survey_assignments")
        .select("id, status, due_at, template_id")
        .eq("tenant_id", tenantId)
        .eq("assigned_profile_id", userId);
      if (error) return { content: error.message };
      const asg = dbRows<{ id: string; status: string; due_at: string | null; template_id: string }>(asgRaw);
      const ids = [...new Set(asg.map((a) => a.template_id))];
      let titles: Record<string, string> = {};
      if (ids.length) {
        const { data: tplRaw } = await supabase.from("survey_templates").select("id, title").in("id", ids);
        const tpl = dbRows<{ id: string; title: string }>(tplRaw);
        titles = Object.fromEntries(tpl.map((t) => [t.id, t.title]));
      }
      const enriched = asg.map((a) => ({
        ...a,
        template_title: titles[a.template_id] ?? null,
      }));
      return { content: JSON.stringify(enriched, null, 2) };
    }

    case "submit_survey_answers": {
      const assignment_id = String(args.assignment_id ?? "");
      const answersRaw = String(args.answers_json ?? "").trim();
      if (!assignment_id || !answersRaw) return { content: "assignment_id and answers_json required." };
      let answers: Record<string, unknown>;
      try {
        answers = JSON.parse(answersRaw) as Record<string, unknown>;
      } catch {
        return { content: "answers_json invalid." };
      }
      const { data: asg, error: e1 } = await supabase
        .from("survey_assignments")
        .select("id")
        .eq("id", assignment_id)
        .eq("tenant_id", tenantId)
        .eq("assigned_profile_id", userId)
        .maybeSingle();
      if (e1 || !asg) return { content: "Assignment not found or not yours." };

      const { error: e2 } = await supabase.from("survey_responses").insert({
        tenant_id: tenantId,
        assignment_id,
        answers,
      });
      if (e2) {
        if (e2.code === "23505") {
          return { content: "You already submitted this survey." };
        }
        return { content: e2.message };
      }
      await supabase.from("survey_assignments").update({ status: "completed" }).eq("id", assignment_id);
      return { content: "Survey submitted. Thank you." };
    }

    case "list_my_courses": {
      const { data: rowsRaw, error } = await supabase
        .from("course_assignments")
        .select("id, status, progress, module_id")
        .eq("tenant_id", tenantId)
        .eq("profile_id", userId);
      if (error) return { content: error.message };
      const rows = dbRows<{
        id: string;
        status: string;
        progress: unknown;
        module_id: string;
      }>(rowsRaw);
      const mids = [...new Set(rows.map((r) => r.module_id))];
      let modMap: Record<string, { title: string; description: string | null }> = {};
      if (mids.length) {
        const { data: modsRaw } = await supabase
          .from("course_modules")
          .select("id, title, description")
          .in("id", mids);
        const mods = dbRows<{ id: string; title: string; description: string | null }>(modsRaw);
        modMap = Object.fromEntries(
          mods.map((m) => [m.id, { title: m.title, description: m.description ?? null }])
        );
      }
      const enriched = rows.map((r) => ({
        ...r,
        module: modMap[r.module_id] ?? null,
      }));
      return { content: JSON.stringify(enriched, null, 2) };
    }

    case "get_course_mcq": {
      const module_id = String(args.module_id ?? "");
      const activity_index = Number(args.activity_index);
      if (!module_id || Number.isNaN(activity_index)) return { content: "Invalid module or index." };
      const { data: mod, error: e1 } = await supabase
        .from("course_modules")
        .select("activities")
        .eq("id", module_id)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (e1 || !mod) return { content: "Module not found." };
      const activities = (mod.activities ?? []) as unknown[];
      const act = activities[activity_index];
      if (!act || typeof act !== "object") return { content: "No activity at that index." };
      const a = act as { type?: string; prompt?: string; options?: string[] };
      if (a.type !== "mcq") return { content: "That activity is not an MCQ." };
      return {
        content: JSON.stringify(
          {
            activity_index,
            prompt: a.prompt,
            options: a.options ?? [],
          },
          null,
          2
        ),
      };
    }

    case "submit_mcq_answer": {
      const module_id = String(args.module_id ?? "");
      const activity_index = Number(args.activity_index);
      const selected_index = Number(args.selected_index);
      if (!module_id || Number.isNaN(activity_index) || Number.isNaN(selected_index)) {
        return { content: "Invalid parameters." };
      }
      const { data: asg, error: e1 } = await supabase
        .from("course_assignments")
        .select("id, progress, status")
        .eq("tenant_id", tenantId)
        .eq("profile_id", userId)
        .eq("module_id", module_id)
        .maybeSingle();
      if (e1 || !asg) return { content: "You are not assigned this module." };

      const { data: mod, error: e2 } = await supabase
        .from("course_modules")
        .select("activities")
        .eq("id", module_id)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (e2 || !mod) return { content: "Module not found." };
      const activities = (mod.activities ?? []) as unknown[];
      const act = activities[activity_index] as { type?: string; correctIndex?: number } | undefined;
      if (!act || act.type !== "mcq" || typeof act.correctIndex !== "number") {
        return { content: "Invalid MCQ." };
      }
      const correct = selected_index === act.correctIndex;
      const progress = (asg.progress && typeof asg.progress === "object" ? asg.progress : {}) as Record<
        string,
        unknown
      >;
      const answers = (progress.answers && typeof progress.answers === "object"
        ? progress.answers
        : {}) as Record<string, unknown>;
      answers[String(activity_index)] = { selected_index, correct, at: new Date().toISOString() };
      progress.answers = answers;

      let status = asg.status as string;
      if (status === "not_started") status = "in_progress";
      const allMcq = activities.every(
        (x) => typeof x === "object" && x && (x as { type?: string }).type === "mcq"
      );
      const answeredCount = Object.keys(answers).length;
      if (allMcq && answeredCount >= activities.length) status = "completed";

      const asgId = typeof asg.id === "string" ? asg.id : String(asg.id);
      const { error: e3 } = await supabase
        .from("course_assignments")
        .update({ progress, status })
        .eq("id", asgId);
      if (e3) return { content: e3.message };
      return {
        content: JSON.stringify(
          { correct, feedback: correct ? "Correct." : "Incorrect — review the material and try again." },
          null,
          2
        ),
      };
    }

    default:
      return { content: `Unknown tool: ${name}` };
  }
}
