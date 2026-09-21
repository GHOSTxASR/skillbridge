-- =============================================================================
-- P0 security baseline: row-level security + API privileges for SkillBridge
-- =============================================================================
-- Live state reviewed 2026-09-21 (read-only inspection):
--   * 8 public base tables, all with RLS enabled, but each also carried a
--     dev_<table>_all policy (PERMISSIVE, FOR ALL, TO public, USING true,
--     WITH CHECK true). Permissive policies are OR-ed, so every table was
--     world-readable and world-writable through the Data API.
--   * anon and authenticated held every table privilege (arwdDxtm).
--   * No triggers, functions or views reference these tables.
--   * The app only touches public.profiles, always the signed-in user's own row
--     (verified across the code and all 43 commits). It reads the profiles
--     COLUMNS job_readiness and skill_gaps, never the tables of the same names.
--
-- Final model:
--   profiles       authenticated: select / insert / update own row (auth.uid() = id),
--                  no delete. anon: nothing.
--   assessments, user_skills, skill_gaps, job_readiness
--                  locked: no policies, no anon/authenticated privileges. Data kept.
--   skills, courses, jobs
--                  read-only for anon and authenticated. No API writes.
--   service_role and postgres privileges are not touched.
--   No data, table, column or foreign-key changes.
--
-- Safe to re-run: every policy on the 8 tables is dropped and the final set recreated.
-- Aborts, changing nothing, if a reviewed table is missing, if the public schema has a
-- base table that was not reviewed, or if the resulting state fails its own checks.
-- =============================================================================

begin;

-- 1. Preconditions ------------------------------------------------------------
do $$
declare
  reviewed   constant text[] := array['profiles', 'assessments', 'user_skills', 'skill_gaps',
                                      'job_readiness', 'skills', 'courses', 'jobs'];
  missing    text[];
  unexpected text[];
begin
  select coalesce(array_agg(t order by t), '{}') into missing
  from unnest(reviewed) as t
  where not exists (
    select 1 from pg_class c
    where c.relnamespace = 'public'::regnamespace
      and c.relname::text = t
      and c.relkind in ('r', 'p'));

  if cardinality(missing) > 0 then
    raise exception 'P0 migration aborted, nothing changed: reviewed table(s) missing from the public schema: %',
      array_to_string(missing, ', ');
  end if;

  -- Views are not base tables and are not flagged.
  select coalesce(array_agg(c.relname::text order by c.relname), '{}') into unexpected
  from pg_class c
  where c.relnamespace = 'public'::regnamespace
    and c.relkind in ('r', 'p')
    and c.relname::text <> all (reviewed);

  if cardinality(unexpected) > 0 then
    raise exception 'P0 migration aborted, nothing changed: unreviewed public base table(s): %. They need a separate security review before this migration can run; it only secures the 8 reviewed tables.',
      array_to_string(unexpected, ', ');
  end if;
end $$;

-- 2. Remove every existing policy on the 8 tables (logged for the audit trail) --
do $$
declare p record;
begin
  for p in
    select tablename, policyname, cmd, roles::text as roles,
           coalesce(qual, '-') as qual, coalesce(with_check, '-') as with_check
    from pg_policies
    where schemaname = 'public'
      and tablename in ('profiles', 'assessments', 'user_skills', 'skill_gaps',
                        'job_readiness', 'skills', 'courses', 'jobs')
    order by tablename, policyname
  loop
    raise notice 'dropping policy % on public.% (cmd=% roles=% using=% check=%)',
      p.policyname, p.tablename, p.cmd, p.roles, p.qual, p.with_check;
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

-- 3. RLS on for all 8 tables (already on live; kept explicit) -----------------
alter table public.profiles      enable row level security;
alter table public.assessments   enable row level security;
alter table public.user_skills   enable row level security;
alter table public.skill_gaps    enable row level security;
alter table public.job_readiness enable row level security;
alter table public.skills        enable row level security;
alter table public.courses       enable row level security;
alter table public.jobs          enable row level security;

-- 4. Minimum API privileges (explicit; does not rely on default grants) --------
-- PUBLIC is the pseudo-role every role inherits from; it held nothing here and is
-- cleared so anon/authenticated cannot regain access through it.
revoke all on table
  public.profiles, public.assessments, public.user_skills, public.skill_gaps,
  public.job_readiness, public.skills, public.courses, public.jobs
  from anon, authenticated, public;

grant select, insert, update on table public.profiles to authenticated;
grant select on table public.skills, public.courses, public.jobs to anon, authenticated;

-- 5. Final policy set -----------------------------------------------------------
create policy profiles_select_own on public.profiles
  as permissive for select to authenticated
  using ((select auth.uid()) = id);

create policy profiles_insert_own on public.profiles
  as permissive for insert to authenticated
  with check ((select auth.uid()) = id);

-- with check stops a user re-pointing their row at another id.
create policy profiles_update_own on public.profiles
  as permissive for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy skills_read_all  on public.skills  as permissive for select to anon, authenticated using (true);
create policy courses_read_all on public.courses as permissive for select to anon, authenticated using (true);
create policy jobs_read_all    on public.jobs    as permissive for select to anon, authenticated using (true);

-- 6. Self-check before commit: any mismatch aborts and rolls everything back ----
do $$
declare
  reviewed constant text[] := array['profiles', 'assessments', 'user_skills', 'skill_gaps',
                                    'job_readiness', 'skills', 'courses', 'jobs'];
  bad text;
begin
  select string_agg(c.relname::text, ', ') into bad
  from pg_class c
  where c.relnamespace = 'public'::regnamespace
    and c.relname::text = any (reviewed)
    and not c.relrowsecurity;
  if bad is not null then
    raise exception 'P0 self-check failed: RLS not enabled on %', bad;
  end if;

  with expected(tablename, policyname, cmd, roles) as (
    values ('profiles', 'profiles_select_own', 'SELECT', 'authenticated'),
           ('profiles', 'profiles_insert_own', 'INSERT', 'authenticated'),
           ('profiles', 'profiles_update_own', 'UPDATE', 'authenticated'),
           ('skills',   'skills_read_all',     'SELECT', 'anon,authenticated'),
           ('courses',  'courses_read_all',    'SELECT', 'anon,authenticated'),
           ('jobs',     'jobs_read_all',       'SELECT', 'anon,authenticated')
  ),
  actual as (
    select tablename::text, policyname::text, cmd::text,
           (select string_agg(r::text, ',' order by r::text) from unnest(roles) r) as roles
    from pg_policies
    where schemaname = 'public' and tablename::text = any (reviewed)
      and permissive = 'PERMISSIVE'
  ),
  diff as (
    (select 'unexpected ' || tablename || '.' || policyname || ' ' || cmd || ' to ' || roles as d
     from (select * from actual except select * from expected) x)
    union all
    (select 'missing ' || tablename || '.' || policyname as d
     from (select * from expected except select * from actual) y)
    union all
    (select 'restrictive ' || tablename || '.' || policyname
     from pg_policies
     where schemaname = 'public' and tablename::text = any (reviewed) and permissive <> 'PERMISSIVE')
  )
  select string_agg(d, '; ') into bad from diff;
  if bad is not null then
    raise exception 'P0 self-check failed: policy set differs from the final model: %', bad;
  end if;

  with expected(tbl, grantee, priv) as (
    values ('profiles', 'authenticated', 'SELECT'),
           ('profiles', 'authenticated', 'INSERT'),
           ('profiles', 'authenticated', 'UPDATE'),
           ('skills',   'anon', 'SELECT'), ('skills',   'authenticated', 'SELECT'),
           ('courses',  'anon', 'SELECT'), ('courses',  'authenticated', 'SELECT'),
           ('jobs',     'anon', 'SELECT'), ('jobs',     'authenticated', 'SELECT')
  ),
  actual as (
    select c.relname::text as tbl,
           case when a.grantee = 0 then 'PUBLIC' else r.rolname::text end as grantee,
           a.privilege_type::text as priv
    from pg_class c
    cross join lateral aclexplode(c.relacl) a
    left join pg_roles r on r.oid = a.grantee
    where c.relnamespace = 'public'::regnamespace
      and c.relname::text = any (reviewed)
      and (a.grantee = 0 or r.rolname in ('anon', 'authenticated'))
  ),
  diff as (
    (select 'unexpected ' || grantee || ' ' || priv || ' on ' || tbl as d
     from (select * from actual except select * from expected) x)
    union all
    (select 'missing ' || grantee || ' ' || priv || ' on ' || tbl as d
     from (select * from expected except select * from actual) y)
  )
  select string_agg(d, '; ') into bad from diff;
  if bad is not null then
    raise exception 'P0 self-check failed: privileges differ from the final model: %', bad;
  end if;

  -- Effective privileges, including anything inherited through role membership.
  select string_agg(format('%s on %s', ro, t), '; ') into bad
  from unnest(reviewed) t, unnest(array['anon', 'authenticated']) ro
  where (t in ('assessments', 'user_skills', 'skill_gaps', 'job_readiness')
           and has_table_privilege(ro, format('public.%I', t), 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'))
     or (t in ('skills', 'courses', 'jobs')
           and has_table_privilege(ro, format('public.%I', t), 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'))
     or (t = 'profiles' and ro = 'anon'
           and has_table_privilege(ro, 'public.profiles', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'))
     or (t = 'profiles' and ro = 'authenticated'
           and has_table_privilege(ro, 'public.profiles', 'DELETE, TRUNCATE, REFERENCES, TRIGGER'));
  if bad is not null then
    raise exception 'P0 self-check failed: role still has an effective privilege it should not: %', bad;
  end if;

  raise notice 'P0 self-check passed: RLS on, 6 intended policies, minimum privileges on all 8 tables';
end $$;

commit;
