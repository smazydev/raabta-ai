-- Assistant platform: pgvector chunks, HR hiring lookup, surveys, courses, assistant transcripts

CREATE EXTENSION IF NOT EXISTS vector;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.user_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role = 'admin'::public.app_role
  );
$$;

-- ---------------------------------------------------------------------------
-- Knowledge embeddings (chunked articles / future files)
-- ---------------------------------------------------------------------------

CREATE TABLE public.knowledge_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  source_kind text NOT NULL CHECK (source_kind IN ('article', 'document')),
  source_id uuid NOT NULL,
  chunk_index int NOT NULL,
  content text NOT NULL,
  embedding vector(1536),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, source_kind, source_id, chunk_index)
);

CREATE INDEX knowledge_chunks_tenant_idx ON public.knowledge_chunks (tenant_id);
CREATE INDEX knowledge_chunks_embedding_hnsw ON public.knowledge_chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Optional: extracted text documents (MVP: metadata + body text; binary files later)
CREATE TABLE public.stored_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL,
  mime_type text NOT NULL DEFAULT 'text/plain',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX stored_documents_tenant_idx ON public.stored_documents (tenant_id);

-- ---------------------------------------------------------------------------
-- Employee personalization (for surveys / learning paths)
-- ---------------------------------------------------------------------------

CREATE TABLE public.employee_attributes (
  profile_id uuid PRIMARY KEY REFERENCES public.profiles (id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  department text,
  work_nature text,
  areas_of_interest text[] NOT NULL DEFAULT '{}',
  personality_notes text,
  performance_summary text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX employee_attributes_tenant_idx ON public.employee_attributes (tenant_id);

-- ---------------------------------------------------------------------------
-- Surveys
-- ---------------------------------------------------------------------------

CREATE TABLE public.survey_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  personalization_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.app_users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX survey_templates_tenant_idx ON public.survey_templates (tenant_id);

CREATE TABLE public.survey_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES public.survey_templates (id) ON DELETE CASCADE,
  assigned_profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed')),
  due_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX survey_assignments_profile_idx ON public.survey_assignments (assigned_profile_id);
CREATE INDEX survey_assignments_tenant_idx ON public.survey_assignments (tenant_id);

CREATE TABLE public.survey_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  assignment_id uuid NOT NULL REFERENCES public.survey_assignments (id) ON DELETE CASCADE,
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (assignment_id)
);

CREATE INDEX survey_responses_tenant_idx ON public.survey_responses (tenant_id);

-- ---------------------------------------------------------------------------
-- Courses / MCQ activities
-- ---------------------------------------------------------------------------

CREATE TABLE public.course_modules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  activities jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX course_modules_tenant_idx ON public.course_modules (tenant_id);

CREATE TABLE public.course_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  module_id uuid NOT NULL REFERENCES public.course_modules (id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'in_progress', 'completed')),
  progress jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (module_id, profile_id)
);

CREATE INDEX course_assignments_profile_idx ON public.course_assignments (profile_id);

-- ---------------------------------------------------------------------------
-- Hiring applications (reference + secure token for public lookup)
-- ---------------------------------------------------------------------------

CREATE TABLE public.hiring_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  reference_code text NOT NULL,
  secure_token uuid NOT NULL DEFAULT gen_random_uuid(),
  candidate_name text NOT NULL,
  candidate_email text,
  stage text NOT NULL DEFAULT 'applied',
  document_discrepancy text,
  offer_issued boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, reference_code)
);

CREATE INDEX hiring_applications_tenant_idx ON public.hiring_applications (tenant_id);
CREATE INDEX hiring_applications_token_idx ON public.hiring_applications (secure_token);

-- ---------------------------------------------------------------------------
-- Assistant sessions (audit / resume)
-- ---------------------------------------------------------------------------

CREATE TABLE public.assistant_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.app_users (id) ON DELETE CASCADE,
  title text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX assistant_sessions_user_idx ON public.assistant_sessions (user_id);

CREATE TABLE public.assistant_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.assistant_sessions (id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  content text,
  tool_name text,
  tool_payload jsonb,
  artifact_markdown text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX assistant_messages_session_idx ON public.assistant_messages (session_id);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.knowledge_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stored_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_attributes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.survey_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.survey_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.survey_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hiring_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assistant_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assistant_messages ENABLE ROW LEVEL SECURITY;

-- knowledge_chunks
CREATE POLICY knowledge_chunks_all ON public.knowledge_chunks
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

-- stored_documents
CREATE POLICY stored_documents_all ON public.stored_documents
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

-- employee_attributes: own row read; admin all
CREATE POLICY employee_attributes_select_own ON public.employee_attributes
  FOR SELECT TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (profile_id = auth.uid() OR public.user_is_admin())
  );

CREATE POLICY employee_attributes_admin_write ON public.employee_attributes
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.user_is_admin())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.user_is_admin());

-- survey_templates
CREATE POLICY survey_templates_select ON public.survey_templates
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY survey_templates_admin_write ON public.survey_templates
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.user_is_admin());

CREATE POLICY survey_templates_admin_update ON public.survey_templates
  FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.user_is_admin())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.user_is_admin());

CREATE POLICY survey_templates_admin_delete ON public.survey_templates
  FOR DELETE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.user_is_admin());

-- survey_assignments
CREATE POLICY survey_assignments_select ON public.survey_assignments
  FOR SELECT TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (assigned_profile_id = auth.uid() OR public.user_is_admin())
  );

CREATE POLICY survey_assignments_admin_write ON public.survey_assignments
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.user_is_admin())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.user_is_admin());

CREATE POLICY survey_assignments_own_update ON public.survey_assignments
  FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND assigned_profile_id = auth.uid())
  WITH CHECK (tenant_id = public.current_tenant_id() AND assigned_profile_id = auth.uid());

-- survey_responses
CREATE POLICY survey_responses_select ON public.survey_responses
  FOR SELECT TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (
      public.user_is_admin()
      OR EXISTS (
        SELECT 1 FROM public.survey_assignments sa
        WHERE sa.id = survey_responses.assignment_id AND sa.assigned_profile_id = auth.uid()
      )
    )
  );

CREATE POLICY survey_responses_insert ON public.survey_responses
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.survey_assignments sa
      WHERE sa.id = assignment_id AND sa.assigned_profile_id = auth.uid()
    )
  );

CREATE POLICY survey_responses_admin_all ON public.survey_responses
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.user_is_admin())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.user_is_admin());

-- course_modules
CREATE POLICY course_modules_select ON public.course_modules
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY course_modules_admin_write ON public.course_modules
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.user_is_admin())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.user_is_admin());

-- course_assignments
CREATE POLICY course_assignments_select ON public.course_assignments
  FOR SELECT TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (profile_id = auth.uid() OR public.user_is_admin())
  );

CREATE POLICY course_assignments_admin_write ON public.course_assignments
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.user_is_admin())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.user_is_admin());

CREATE POLICY course_assignments_own_update ON public.course_assignments
  FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND profile_id = auth.uid())
  WITH CHECK (tenant_id = public.current_tenant_id() AND profile_id = auth.uid());

-- hiring: tenant staff read; admin write
CREATE POLICY hiring_applications_select ON public.hiring_applications
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY hiring_applications_admin_write ON public.hiring_applications
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.user_is_admin())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.user_is_admin());

-- assistant
CREATE POLICY assistant_sessions_own ON public.assistant_sessions
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND user_id = auth.uid())
  WITH CHECK (tenant_id = public.current_tenant_id() AND user_id = auth.uid());

CREATE POLICY assistant_messages_own ON public.assistant_messages
  FOR ALL TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.assistant_sessions s
      WHERE s.id = assistant_messages.session_id AND s.user_id = auth.uid()
    )
  )
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.assistant_sessions s
      WHERE s.id = assistant_messages.session_id AND s.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Public hiring lookup (no auth): returns minimal JSON only on exact match
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.lookup_hiring_application(
  p_tenant_slug text,
  p_reference_code text,
  p_secure_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t_id uuid;
  r jsonb;
BEGIN
  SELECT t.id INTO t_id FROM public.tenants t WHERE t.slug = p_tenant_slug LIMIT 1;
  IF t_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'candidate_name', h.candidate_name,
    'stage', h.stage,
    'document_discrepancy', h.document_discrepancy,
    'offer_issued', h.offer_issued,
    'reference_code', h.reference_code
  )
  INTO r
  FROM public.hiring_applications h
  WHERE h.tenant_id = t_id
    AND h.reference_code = p_reference_code
    AND h.secure_token = p_secure_token
  LIMIT 1;

  RETURN r;
END;
$$;

REVOKE ALL ON FUNCTION public.lookup_hiring_application(text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lookup_hiring_application(text, text, uuid) TO anon, authenticated;

-- Vector similarity (authenticated; tenant must match session)
CREATE OR REPLACE FUNCTION public.match_knowledge_chunks(
  p_tenant_id uuid,
  query_embedding vector(1536),
  match_count int DEFAULT 8
)
RETURNS TABLE (
  chunk_id uuid,
  content text,
  source_kind text,
  source_id uuid,
  similarity double precision
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT k.id, k.content, k.source_kind, k.source_id,
    (1 - (k.embedding <=> query_embedding))::double precision
  FROM public.knowledge_chunks k
  WHERE k.tenant_id = p_tenant_id
    AND k.embedding IS NOT NULL
    AND public.user_has_tenant_access(p_tenant_id)
  ORDER BY k.embedding <=> query_embedding
  LIMIT match_count;
$$;

REVOKE ALL ON FUNCTION public.match_knowledge_chunks(uuid, vector, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_knowledge_chunks(uuid, vector, int) TO authenticated;
