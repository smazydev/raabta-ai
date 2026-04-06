-- profiles.id must reference public.app_users (app login + seed). If it still points at
-- auth.users, inserts from scripts/seed.ts fail: new UUIDs exist in app_users only.

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES public.app_users (id) ON DELETE CASCADE;
