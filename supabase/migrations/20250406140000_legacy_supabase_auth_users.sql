-- Optional: migrate existing Supabase projects that still have profiles → auth.users.
-- Safe no-op when already on app_users-only schema.

CREATE TABLE IF NOT EXISTS public.app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Copy GoTrue users into app_users (password hashes remain compatible with bcrypt verify)
INSERT INTO public.app_users (id, email, password_hash)
SELECT u.id, u.email::text, u.encrypted_password
FROM auth.users u
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'auth' AND table_name = 'users')
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES public.app_users (id) ON DELETE CASCADE;
