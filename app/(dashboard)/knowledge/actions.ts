"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { dbRows } from "@/lib/db/rows";

export async function createKnowledgeArticleAction(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const tagsRaw = String(formData.get("tags") ?? "").trim();

  if (!title) throw new Error("Title is required");
  if (!body) throw new Error("Body is required");

  const tags = tagsRaw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const source = String(formData.get("source") ?? "").trim() || "internal_policy";
  const department_team = String(formData.get("department_team") ?? "").trim() || null;
  const access_scope = String(formData.get("access_scope") ?? "").trim() || "tenant_wide";
  const kbPick = String(formData.get("knowledge_base_id") ?? "").trim();
  const knowledge_base_id = kbPick.length > 0 ? kbPick : null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const { data: profile } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", user.id)
    .single();
  if (!profile?.tenant_id || typeof profile.tenant_id !== "string") throw new Error("No tenant");
  const tenantId = profile.tenant_id;

  const { data: inserted, error } = await supabase
    .from("knowledge_articles")
    .insert({
      tenant_id: tenantId,
      title,
      body,
      tags,
      source,
      department_team,
      access_scope,
      knowledge_base_id,
      readiness: "indexed",
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message || "Could not save article");
  if (!inserted || typeof inserted.id !== "string") throw new Error("Could not save article");

  try {
    const { reindexKnowledgeArticle } = await import("@/lib/knowledge/reindex-article");
    await reindexKnowledgeArticle(supabase, tenantId, inserted.id, title, body);
  } catch (e) {
    console.error("Knowledge embedding reindex failed:", e);
  }

  revalidatePath("/knowledge");
}

export async function reindexAllKnowledgeArticlesAction() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const { data: profile } = await supabase
    .from("profiles")
    .select("tenant_id, role")
    .eq("id", user.id)
    .single();
  if (!profile?.tenant_id || typeof profile.tenant_id !== "string" || profile.role !== "admin") {
    throw new Error("Admin only");
  }
  const tenantId = profile.tenant_id;

  const { data: articlesRaw, error } = await supabase
    .from("knowledge_articles")
    .select("id, title, body")
    .eq("tenant_id", tenantId);
  if (error) throw new Error(error.message);
  const articles = dbRows<{ id: string; title: string; body: string }>(articlesRaw);

  const { reindexKnowledgeArticle } = await import("@/lib/knowledge/reindex-article");
  for (const a of articles) {
    try {
      await reindexKnowledgeArticle(supabase, tenantId, a.id, a.title, a.body);
    } catch (e) {
      console.error("Reindex failed for article", a.id, e);
    }
  }

  revalidatePath("/knowledge");
}
