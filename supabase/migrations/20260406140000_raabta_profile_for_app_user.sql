-- Server-side profile read for app_users JWT auth. RLS policies on `profiles` are scoped to
-- Supabase's `authenticated` role; the Next.js pool typically connects as `postgres`, which can
-- hit default-deny RLS and see zero rows. This definer function reads by app user id only.

CREATE OR REPLACE FUNCTION public.raabta_profile_for_app_user(_user_id uuid)
RETURNS TABLE (
  tenant_id uuid,
  role public.app_role,
  display_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.tenant_id, p.role, p.display_name
  FROM public.profiles p
  WHERE p.id = _user_id;
$$;

REVOKE ALL ON FUNCTION public.raabta_profile_for_app_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.raabta_profile_for_app_user(uuid) TO postgres;
