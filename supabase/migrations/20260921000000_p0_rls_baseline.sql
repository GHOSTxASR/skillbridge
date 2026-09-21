-- P0 security baseline: row-level security on every known public table.
--
-- Verified before writing (2026-09-21, read-only probes with the publishable key):
--   * profiles was readable by the anon role (RLS off or a permissive select policy).
--   * profiles.id, assessments.user_id, user_skills.user_id, skill_gaps.user_id are uuid.
--   * Every app access to profiles filters on .eq("id", user.id) and the only insert
--     (app/setup-profile) writes id = auth user id, so ownership is auth.uid() = id.
--
-- Postgres ORs permissive policies together, so a leftover "using (true)" policy would
-- silently defeat the new ones. This migration therefore drops EVERY existing policy on
-- these tables before creating the intended set. Safe to re-run.

begin;

do $$
declare p record;
begin
  for p in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('profiles', 'assessments', 'user_skills', 'skill_gaps', 'skills', 'courses', 'jobs')
  loop
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- profiles: owner-only. Used by the app (select / insert at onboarding / update).
-- No delete policy, so profiles cannot be deleted through the API.
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
revoke all on table public.profiles from anon;
revoke truncate on table public.profiles from authenticated;

create policy profiles_select_own on public.profiles
  for select to authenticated
  using ((select auth.uid()) = id);

create policy profiles_insert_own on public.profiles
  for insert to authenticated
  with check ((select auth.uid()) = id);

-- with check stops a user re-pointing their row at another user's id.
create policy profiles_update_own on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- ---------------------------------------------------------------------------
-- Per-user tables that exist in the database but are not used by the app yet.
-- Deny-all (RLS on, no policies) until a later milestone wires them up.
-- ---------------------------------------------------------------------------
alter table public.assessments enable row level security;
alter table public.user_skills enable row level security;
alter table public.skill_gaps enable row level security;
revoke all on table public.assessments, public.user_skills, public.skill_gaps from anon;
revoke truncate on table public.assessments, public.user_skills, public.skill_gaps from authenticated;

-- ---------------------------------------------------------------------------
-- Reference data (seeded, not user-specific): public read, no API writes.
-- ---------------------------------------------------------------------------
alter table public.skills enable row level security;
alter table public.courses enable row level security;
alter table public.jobs enable row level security;
revoke insert, update, delete, truncate on table public.skills, public.courses, public.jobs from anon, authenticated;

create policy skills_read_all on public.skills for select to anon, authenticated using (true);
create policy courses_read_all on public.courses for select to anon, authenticated using (true);
create policy jobs_read_all on public.jobs for select to anon, authenticated using (true);

commit;
