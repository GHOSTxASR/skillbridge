-- =============================================================================
-- P0 RLS verification for the SkillBridge Supabase database
-- =============================================================================
-- Run the WHOLE script at once in the Supabase SQL Editor (do not run a selection).
--
-- What it does:
--   * Checks structure: the 16 reviewed tables (the 8 from P0 plus learning_roadmaps,
--     reviewed in P1, career_analyses, reviewed in P1.7, ai_rate_limits, reviewed in
--     P1.8, skill_progress / skill_evidence, reviewed with the skill progress migration,
--     skill_aliases, reviewed with the skill catalog migration, and
--     learning_roadmap_versions / learning_roadmap_version_steps, reviewed with the roadmap
--     learning evidence migration: owner SELECT only, written by no API role), no unexpected public
--     tables, RLS on, the exact policy set, and the exact
--     anon/authenticated privileges; for learning_roadmaps and career_analyses also their
--     owner-only policy rules, primary key and ON DELETE CASCADE foreign key (and
--     service_role/postgres access for learning_roadmaps). Owner behaviour of
--     career_analyses is exercised in p1_career_analyses_verification.sql.
--   * ai_rate_limits has no policies and no anon/authenticated privileges at all, and anon
--     cannot execute consume_ai_generation(); the limiter itself is exercised in
--     p1_ai_rate_limits_verification.sql.
--   * skill_progress and skill_evidence: owner SELECT only; every write goes through
--     SECURITY DEFINER functions anon may not run. Owner behaviour, validation and
--     authority are exercised in skill_progress_evidence_verification.sql.
--   * skill_aliases is public reference data like skills: anon and authenticated may
--     read every row and write nothing. See skill_catalog_verification.sql.
--   * Creates TEMPORARY test profiles with random ids, then impersonates the anon
--     and authenticated roles exactly as the Supabase Data API does
--     (SET ROLE + request.jwt.claims) and tries every allowed/forbidden action.
--   * Fingerprints the real profile rows and catalog row counts before the tests and
--     proves afterwards that nothing real was changed.
--
-- It NEVER keeps any change: the script always ends in an error, so everything rolls back.
--   Success: the error message starts with  "P0 RLS VERIFICATION PASSED"
--   Failure: the error message starts with  "FAIL:"  and names the failing check
--   Setup problem (not a security result):  "SETUP ERROR:"
--
-- Not covered (needs a real account): an end-to-end sign-in through Supabase Auth
-- and the app UI. That is a separate manual check after the migration.
-- =============================================================================

begin;

-- 0. Baselines, captured as the table owner (reads only) ------------------------
select set_config('p0.a', gen_random_uuid()::text, true),   -- test user A (has a profile)
       set_config('p0.b', gen_random_uuid()::text, true),   -- test user B (has a profile)
       set_config('p0.c', gen_random_uuid()::text, true),   -- an id nobody owns
       set_config('p0.d', gen_random_uuid()::text, true);   -- test user D (no profile yet)

select set_config('p0.real_profiles', (select md5(coalesce(string_agg(p::text, '|' order by p.id), '')) from public.profiles p), true),
       set_config('p0.n_skills',  (select count(*)::text from public.skills),  true),
       set_config('p0.n_skill_aliases', (select count(*)::text from public.skill_aliases), true),
       set_config('p0.n_courses', (select count(*)::text from public.courses), true),
       set_config('p0.n_jobs',    (select count(*)::text from public.jobs),    true);

do $$
begin
  if to_regclass('public.learning_roadmaps') is null then
    raise exception 'FAIL: reviewed table(s) missing: learning_roadmaps';
  end if;
  perform set_config('p0.real_roadmaps',
    (select md5(coalesce(string_agg(r::text, '|' order by r.user_id), '')) from public.learning_roadmaps r), true);
end $$;

-- 1. Structure: tables, RLS, policies, privileges ---------------------------------
do $$
declare
  reviewed constant text[] := array['profiles', 'assessments', 'user_skills', 'skill_gaps',
                                    'job_readiness', 'skills', 'courses', 'jobs',
                                    'learning_roadmaps', 'career_analyses', 'ai_rate_limits',
                                    'skill_progress', 'skill_evidence', 'skill_aliases',
                                    'learning_roadmap_versions', 'learning_roadmap_version_steps'];
  bad text;
begin
  select string_agg(t, ', ') into bad from unnest(reviewed) t
  where not exists (select 1 from pg_class c where c.relnamespace = 'public'::regnamespace
                    and c.relname::text = t and c.relkind in ('r', 'p'));
  if bad is not null then raise exception 'FAIL: reviewed table(s) missing: %', bad; end if;
  raise notice 'PASS: all 16 reviewed tables exist';

  select string_agg(c.relname::text, ', ') into bad from pg_class c
  where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
    and c.relname::text <> all (reviewed);
  if bad is not null then raise exception 'FAIL: unexpected public base table(s) need review: %', bad; end if;
  raise notice 'PASS: no unexpected public base tables';

  select string_agg(c.relname::text, ', ') into bad from pg_class c
  where c.relnamespace = 'public'::regnamespace and c.relname::text = any (reviewed) and not c.relrowsecurity;
  if bad is not null then raise exception 'FAIL: RLS disabled on %', bad; end if;
  raise notice 'PASS: RLS enabled on all 16 tables';

  select string_agg(tablename || '.' || policyname, ', ') into bad from pg_policies
  where schemaname = 'public' and policyname like 'dev\_%\_all';
  if bad is not null then raise exception 'FAIL: dev_*_all policies still present: %', bad; end if;
  raise notice 'PASS: no dev_*_all policy remains';

  select string_agg(tablename || '.' || policyname, ', ') into bad from pg_policies
  where schemaname = 'public' and (cmd = 'ALL' or 'public' = any (roles::text[]));
  if bad is not null then raise exception 'FAIL: policies for ALL commands or the public role remain: %', bad; end if;
  raise notice 'PASS: no ALL-command or public-role policy remains';

  with expected(tablename, policyname, cmd, roles, qual_true) as (
    values ('profiles', 'profiles_select_own', 'SELECT', 'authenticated',      false),
           ('profiles', 'profiles_insert_own', 'INSERT', 'authenticated',      false),
           ('profiles', 'profiles_update_own', 'UPDATE', 'authenticated',      false),
           ('skills',   'skills_read_all',     'SELECT', 'anon,authenticated', true),
           ('skill_aliases', 'skill_aliases_read_all', 'SELECT', 'anon,authenticated', true),
           ('courses',  'courses_read_all',    'SELECT', 'anon,authenticated', true),
           ('jobs',     'jobs_read_all',       'SELECT', 'anon,authenticated', true),
           ('learning_roadmaps', 'learning_roadmaps_select_own', 'SELECT', 'authenticated', false),
           ('learning_roadmaps', 'learning_roadmaps_insert_own', 'INSERT', 'authenticated', false),
           ('learning_roadmaps', 'learning_roadmaps_update_own', 'UPDATE', 'authenticated', false),
           ('career_analyses', 'career_analyses_select_own', 'SELECT', 'authenticated', false),
           ('career_analyses', 'career_analyses_insert_own', 'INSERT', 'authenticated', false),
           ('career_analyses', 'career_analyses_update_own', 'UPDATE', 'authenticated', false),
           ('skill_progress', 'skill_progress_select_own', 'SELECT', 'authenticated', false),
           ('skill_evidence', 'skill_evidence_select_own', 'SELECT', 'authenticated', false),
           ('learning_roadmap_versions', 'learning_roadmap_versions_select_own', 'SELECT', 'authenticated', false),
           ('learning_roadmap_version_steps', 'learning_roadmap_version_steps_select_own', 'SELECT', 'authenticated', false)
  ),
  actual as (
    select tablename::text as tablename, policyname::text as policyname, cmd::text as cmd,
           (select string_agg(r::text, ',' order by r::text) from unnest(roles) r) as roles,
           coalesce(qual, '') = 'true' as qual_true
    from pg_policies
    where schemaname = 'public' and tablename::text = any (reviewed) and permissive = 'PERMISSIVE'
  )
  select string_agg(d, '; ') into bad from (
    (select 'unexpected ' || tablename || '.' || policyname as d from (select * from actual except select * from expected) x)
    union all
    (select 'missing ' || tablename || '.' || policyname from (select * from expected except select * from actual) y)
    union all
    (select 'restrictive ' || tablename || '.' || policyname from pg_policies
     where schemaname = 'public' and tablename::text = any (reviewed) and permissive <> 'PERMISSIVE')
  ) z;
  if bad is not null then raise exception 'FAIL: policy set differs from the final model: %', bad; end if;
  raise notice 'PASS: profiles has exactly its 3 own-row policies, skills/courses/jobs exactly 1 SELECT policy each, the 4 unused user tables have none';
  raise notice 'PASS: learning_roadmaps and career_analyses each have exactly their 3 own-row policies (select / insert / update), no delete policy';
  raise notice 'PASS: ai_rate_limits has no policies';
  raise notice 'PASS: skill_progress and skill_evidence each have exactly one owner SELECT policy, no write policy';

  select string_agg(policyname, ', ') into bad from pg_policies
  where schemaname = 'public' and tablename in ('skill_progress', 'skill_evidence',
                                                'learning_roadmap_versions', 'learning_roadmap_version_steps')
    and regexp_replace(coalesce(qual, ''), '\s', '', 'g')
        not in ('((SELECTauth.uid()ASuid)=user_id)', '(auth.uid()=user_id)',
                '(user_id=(SELECTauth.uid()ASuid))', '(user_id=auth.uid())');
  if bad is not null then raise exception 'FAIL: skill progress/evidence policy is not exactly auth.uid() = user_id: %', bad; end if;
  raise notice 'PASS: every skill_progress / skill_evidence / learning roadmap version policy is exactly auth.uid() = user_id';

  select string_agg(policyname, ', ') into bad from pg_policies
  where schemaname = 'public' and tablename = 'profiles'
    and (coalesce(qual, '') !~ 'auth\.uid\(\)' and coalesce(with_check, '') !~ 'auth\.uid\(\)');
  if bad is not null then raise exception 'FAIL: profiles policy without an auth.uid() ownership rule: %', bad; end if;
  raise notice 'PASS: every profiles policy is tied to auth.uid()';

  -- Each learning_roadmaps clause the command uses must be exactly "auth.uid() = user_id"
  -- (either operand order, with or without the (select ...) wrapper); no other clause is set.
  select string_agg(policyname || ' (' || cmd || ')', ', ') into bad
  from (
    select policyname::text, cmd::text,
           regexp_replace(coalesce(qual, ''), '\s', '', 'g') as q,
           regexp_replace(coalesce(with_check, ''), '\s', '', 'g') as w
    from pg_policies
    where schemaname = 'public' and tablename = 'learning_roadmaps'
  ) p
  where not (
    case cmd
      when 'SELECT' then q in ('((SELECTauth.uid()ASuid)=user_id)', '(auth.uid()=user_id)',
                               '(user_id=(SELECTauth.uid()ASuid))', '(user_id=auth.uid())') and w = ''
      when 'INSERT' then w in ('((SELECTauth.uid()ASuid)=user_id)', '(auth.uid()=user_id)',
                               '(user_id=(SELECTauth.uid()ASuid))', '(user_id=auth.uid())') and q = ''
      when 'UPDATE' then q in ('((SELECTauth.uid()ASuid)=user_id)', '(auth.uid()=user_id)',
                               '(user_id=(SELECTauth.uid()ASuid))', '(user_id=auth.uid())')
                     and w in ('((SELECTauth.uid()ASuid)=user_id)', '(auth.uid()=user_id)',
                               '(user_id=(SELECTauth.uid()ASuid))', '(user_id=auth.uid())')
      else false
    end);
  if bad is not null then raise exception 'FAIL: learning_roadmaps policy is not exactly an auth.uid() = user_id ownership rule: %', bad; end if;
  raise notice 'PASS: every learning_roadmaps policy is exactly auth.uid() = user_id (select: using; insert: with check; update: both)';

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.learning_roadmaps'::regclass and contype = 'p'
      and conkey = array[(select attnum from pg_attribute
                          where attrelid = 'public.learning_roadmaps'::regclass and attname = 'user_id')]::int2[]
  ) then
    raise exception 'FAIL: learning_roadmaps.user_id is not the primary key';
  end if;
  raise notice 'PASS: learning_roadmaps.user_id is the primary key';

  -- Exactly one foreign key: user_id -> profiles(id) ON DELETE CASCADE.
  select string_agg(conname::text || ': ' || pg_get_constraintdef(oid), '; ') into bad
  from pg_constraint
  where conrelid = 'public.learning_roadmaps'::regclass and contype = 'f'
    and not (confrelid = 'public.profiles'::regclass
             and confdeltype = 'c'
             and conkey = array[(select attnum from pg_attribute
                                 where attrelid = 'public.learning_roadmaps'::regclass and attname = 'user_id')]::int2[]
             and confkey = array[(select attnum from pg_attribute
                                  where attrelid = 'public.profiles'::regclass and attname = 'id')]::int2[]);
  if bad is not null then raise exception 'FAIL: unexpected learning_roadmaps foreign key: %', bad; end if;
  if (select count(*) from pg_constraint
      where conrelid = 'public.learning_roadmaps'::regclass and contype = 'f') <> 1 then
    raise exception 'FAIL: learning_roadmaps needs exactly one foreign key: user_id -> profiles(id) ON DELETE CASCADE';
  end if;
  raise notice 'PASS: learning_roadmaps.user_id references profiles(id) ON DELETE CASCADE (its only foreign key)';

  -- career_analyses (reviewed in P1.7): the same owner-only model as learning_roadmaps.
  select string_agg(policyname || ' (' || cmd || ')', ', ') into bad
  from (
    select policyname::text, cmd::text,
           regexp_replace(coalesce(qual, ''), '\s', '', 'g') as q,
           regexp_replace(coalesce(with_check, ''), '\s', '', 'g') as w
    from pg_policies
    where schemaname = 'public' and tablename = 'career_analyses'
  ) p
  where not (
    case cmd
      when 'SELECT' then q in ('((SELECTauth.uid()ASuid)=user_id)', '(auth.uid()=user_id)',
                               '(user_id=(SELECTauth.uid()ASuid))', '(user_id=auth.uid())') and w = ''
      when 'INSERT' then w in ('((SELECTauth.uid()ASuid)=user_id)', '(auth.uid()=user_id)',
                               '(user_id=(SELECTauth.uid()ASuid))', '(user_id=auth.uid())') and q = ''
      when 'UPDATE' then q in ('((SELECTauth.uid()ASuid)=user_id)', '(auth.uid()=user_id)',
                               '(user_id=(SELECTauth.uid()ASuid))', '(user_id=auth.uid())')
                     and w in ('((SELECTauth.uid()ASuid)=user_id)', '(auth.uid()=user_id)',
                               '(user_id=(SELECTauth.uid()ASuid))', '(user_id=auth.uid())')
      else false
    end);
  if bad is not null then raise exception 'FAIL: career_analyses policy is not exactly an auth.uid() = user_id ownership rule: %', bad; end if;
  raise notice 'PASS: every career_analyses policy is exactly auth.uid() = user_id (select: using; insert: with check; update: both)';

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.career_analyses'::regclass and contype = 'p'
      and conkey = array[(select attnum from pg_attribute
                          where attrelid = 'public.career_analyses'::regclass and attname = 'user_id')]::int2[]
  ) then
    raise exception 'FAIL: career_analyses.user_id is not the primary key';
  end if;

  select string_agg(conname::text || ': ' || pg_get_constraintdef(oid), '; ') into bad
  from pg_constraint
  where conrelid = 'public.career_analyses'::regclass and contype = 'f'
    and not (confrelid = 'public.profiles'::regclass
             and confdeltype = 'c'
             and conkey = array[(select attnum from pg_attribute
                                 where attrelid = 'public.career_analyses'::regclass and attname = 'user_id')]::int2[]
             and confkey = array[(select attnum from pg_attribute
                                  where attrelid = 'public.profiles'::regclass and attname = 'id')]::int2[]);
  if bad is not null then raise exception 'FAIL: unexpected career_analyses foreign key: %', bad; end if;
  if (select count(*) from pg_constraint
      where conrelid = 'public.career_analyses'::regclass and contype = 'f') <> 1 then
    raise exception 'FAIL: career_analyses needs exactly one foreign key: user_id -> profiles(id) ON DELETE CASCADE';
  end if;
  raise notice 'PASS: career_analyses.user_id is the primary key and references profiles(id) ON DELETE CASCADE (its only foreign key)';

  with expected(tbl, grantee, priv) as (
    values ('profiles', 'authenticated', 'SELECT'), ('profiles', 'authenticated', 'INSERT'),
           ('profiles', 'authenticated', 'UPDATE'),
           ('skills',  'anon', 'SELECT'), ('skills',  'authenticated', 'SELECT'),
           ('skill_aliases', 'anon', 'SELECT'), ('skill_aliases', 'authenticated', 'SELECT'),
           ('courses', 'anon', 'SELECT'), ('courses', 'authenticated', 'SELECT'),
           ('jobs',    'anon', 'SELECT'), ('jobs',    'authenticated', 'SELECT'),
           ('learning_roadmaps', 'authenticated', 'SELECT'), ('learning_roadmaps', 'authenticated', 'INSERT'),
           ('learning_roadmaps', 'authenticated', 'UPDATE'),
           ('career_analyses', 'authenticated', 'SELECT'), ('career_analyses', 'authenticated', 'INSERT'),
           ('career_analyses', 'authenticated', 'UPDATE'),
           ('skill_progress', 'authenticated', 'SELECT'), ('skill_evidence', 'authenticated', 'SELECT'),
           ('learning_roadmap_versions', 'authenticated', 'SELECT'), ('learning_roadmap_version_steps', 'authenticated', 'SELECT')
  ),
  actual as (
    select c.relname::text as tbl,
           case when a.grantee = 0 then 'PUBLIC' else r.rolname::text end as grantee,
           a.privilege_type::text as priv
    from pg_class c
    cross join lateral aclexplode(c.relacl) a
    left join pg_roles r on r.oid = a.grantee
    where c.relnamespace = 'public'::regnamespace and c.relname::text = any (reviewed)
      and (a.grantee = 0 or r.rolname in ('anon', 'authenticated'))
  )
  select string_agg(d, '; ') into bad from (
    (select 'unexpected ' || grantee || ' ' || priv || ' on ' || tbl as d from (select * from actual except select * from expected) x)
    union all
    (select 'missing ' || grantee || ' ' || priv || ' on ' || tbl from (select * from expected except select * from actual) y)
  ) z;
  if bad is not null then raise exception 'FAIL: privileges differ from the final model: %', bad; end if;
  raise notice 'PASS: anon/authenticated/PUBLIC privileges are exactly the intended minimum';

  select string_agg(format('%s on %s', ro, t), '; ') into bad
  from unnest(reviewed) t, unnest(array['anon', 'authenticated']) ro
  where (t in ('assessments', 'user_skills', 'skill_gaps', 'job_readiness')
           and has_table_privilege(ro, format('public.%I', t), 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'))
     or (t in ('skills', 'courses', 'jobs', 'skill_aliases')
           and has_table_privilege(ro, format('public.%I', t), 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'))
     or (t = 'profiles' and ro = 'anon'
           and has_table_privilege(ro, 'public.profiles', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'))
     or (t = 'profiles' and ro = 'authenticated'
           and has_table_privilege(ro, 'public.profiles', 'DELETE, TRUNCATE, REFERENCES, TRIGGER'))
     or (t = 'learning_roadmaps' and ro = 'anon'
           and has_table_privilege(ro, 'public.learning_roadmaps', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'))
     or (t = 'learning_roadmaps' and ro = 'authenticated'
           and has_table_privilege(ro, 'public.learning_roadmaps', 'DELETE, TRUNCATE, REFERENCES, TRIGGER'))
     or (t = 'career_analyses' and ro = 'anon'
           and has_table_privilege(ro, 'public.career_analyses', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'))
     or (t = 'career_analyses' and ro = 'authenticated'
           and has_table_privilege(ro, 'public.career_analyses', 'DELETE, TRUNCATE, REFERENCES, TRIGGER'))
     or (t = 'ai_rate_limits'
           and has_table_privilege(ro, 'public.ai_rate_limits', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'))
     or (t in ('skill_progress', 'skill_evidence') and ro = 'anon'
           and has_table_privilege(ro, format('public.%I', t), 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'))
     or (t in ('skill_progress', 'skill_evidence') and ro = 'authenticated'
           and has_table_privilege(ro, format('public.%I', t), 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'))
     or (t in ('learning_roadmap_versions', 'learning_roadmap_version_steps') and ro = 'anon'
           and has_table_privilege(ro, format('public.%I', t), 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'))
     or (t in ('learning_roadmap_versions', 'learning_roadmap_version_steps') and ro = 'authenticated'
           and has_table_privilege(ro, format('public.%I', t), 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'));
  if bad is not null then raise exception 'FAIL: effective privilege that should be absent: %', bad; end if;
  raise notice 'PASS: no forbidden effective privileges (including inherited ones)';

  -- skill_progress / skill_evidence are written only through these functions, which anon may not run.
  select string_agg(f, ', ') into bad
  from unnest(array['public.set_skill_progress_status(uuid,text)',
                    'public.add_skill_evidence(uuid[],text,text,text,text,jsonb,timestamp with time zone)',
                    'public.update_skill_evidence(uuid,text,text,text,jsonb)',
                    'public.retract_skill_evidence(uuid)']) f
  where to_regprocedure(f) is null
     or has_function_privilege('anon', f, 'EXECUTE')
     or not has_function_privilege('authenticated', f, 'EXECUTE')
     or exists (select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
                where p.oid = to_regprocedure(f) and a.grantee = 0);
  if bad is not null then raise exception 'FAIL: skill write function missing or executable by anon/PUBLIC: %', bad; end if;
  raise notice 'PASS: the 4 skill write functions exist; authenticated may run them, anon and PUBLIC may not';

  -- ai_rate_limits is reached only through consume_ai_generation(), which anon may not run.
  if to_regprocedure('public.consume_ai_generation(text)') is null then
    raise exception 'FAIL: function public.consume_ai_generation(text) is missing';
  end if;
  if has_function_privilege('anon', 'public.consume_ai_generation(text)', 'EXECUTE')
     or exists (select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
                where p.oid = 'public.consume_ai_generation(text)'::regprocedure and a.grantee = 0) then
    raise exception 'FAIL: anon or PUBLIC can execute consume_ai_generation()';
  end if;
  raise notice 'PASS: anon and PUBLIC cannot execute consume_ai_generation()';

  -- The P1 migration did not touch the server-side roles; they keep full row access.
  select string_agg(format('%s %s', ro, pr), ', ') into bad
  from unnest(array['service_role', 'postgres']) ro, unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) pr
  where exists (select 1 from pg_roles where rolname = ro)
    and not has_table_privilege(ro, 'public.learning_roadmaps', pr);
  if bad is not null then raise exception 'FAIL: server-side role lost access to learning_roadmaps: %', bad; end if;
  raise notice 'PASS: service_role and postgres keep SELECT/INSERT/UPDATE/DELETE on learning_roadmaps';

  -- Trusted roadmap versions are immutable evidence provenance: no API role writes them
  -- directly, service_role included; service_role may only run the creation function.
  select string_agg(format('%s %s on %s', ro, pr, t), ', ') into bad
  from unnest(array['learning_roadmap_versions', 'learning_roadmap_version_steps']) t,
       unnest(array['anon', 'authenticated', 'service_role']) ro,
       unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) pr
  where exists (select 1 from pg_roles where rolname = ro)
    and has_table_privilege(ro, format('public.%I', t), pr);
  if bad is not null then raise exception 'FAIL: an API role can write trusted roadmap versions: %', bad; end if;
  if to_regprocedure('public.create_learning_roadmap_version(uuid,text,text,text,timestamp with time zone,jsonb)') is null
     or to_regprocedure('public.complete_roadmap_learning_step(uuid,integer)') is null then
    raise exception 'FAIL: roadmap version functions are missing';
  end if;
  if not has_function_privilege('service_role', 'public.create_learning_roadmap_version(uuid,text,text,text,timestamp with time zone,jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.create_learning_roadmap_version(uuid,text,text,text,timestamp with time zone,jsonb)', 'EXECUTE')
     or has_function_privilege('anon', 'public.create_learning_roadmap_version(uuid,text,text,text,timestamp with time zone,jsonb)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.complete_roadmap_learning_step(uuid,integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.complete_roadmap_learning_step(uuid,integer)', 'EXECUTE')
     or exists (select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
                where p.oid in ('public.create_learning_roadmap_version(uuid,text,text,text,timestamp with time zone,jsonb)'::regprocedure,
                                'public.complete_roadmap_learning_step(uuid,integer)'::regprocedure)
                  and a.grantee = 0) then
    raise exception 'FAIL: roadmap version function privileges differ: create = service_role only, complete = authenticated only, never PUBLIC';
  end if;
  raise notice 'PASS: no API role (service_role included) can write trusted roadmap versions; create = service_role only, complete = authenticated only';
end $$;

-- 2. Temporary test profiles A and B, and B's roadmap (rolled back at the end) -------
-- Same columns the app writes at onboarding (app/setup-profile/page.tsx).
do $$
begin
  insert into public.profiles
    (id, name, target_role, experience_level, job_readiness, skills_mastered, skill_gaps, learning_progress)
  values
    (current_setting('p0.a')::uuid, 'P0 Test A', 'Tester', 'Beginner', 0, 0, 0, 0),
    (current_setting('p0.b')::uuid, 'P0 Test B', 'Tester', 'Beginner', 0, 0, 0, 0);

  insert into public.learning_roadmaps (user_id, input_hash, roadmap, ai_summary, model, prompt_version)
  values (current_setting('p0.b')::uuid, 'p0-hash-b', '[{"skill":"P0 Test B"}]', 'P0 Test B', 'p0-test', 'p0-test');
exception when others then
  raise exception 'SETUP ERROR: could not create temporary test data (%). This is not a security result.', sqlerrm;
end $$;

-- 3. Anonymous (Data API "anon" role) -----------------------------------------------
select set_config('request.jwt.claims', '{"role":"anon"}', true),
       set_config('request.jwt.claim.sub', '', true);
set local role anon;

do $$
declare
  stmt text; t text; n bigint; ok boolean; err text;
  must_deny text[];
begin
  must_deny := array[
    'select count(*) from public.profiles',
    format('insert into public.profiles (id, name) values (%L, %L)', current_setting('p0.c'), 'anon'),
    format('update public.profiles set name = %L where id = %L', 'anon', current_setting('p0.b')),
    format('delete from public.profiles where id = %L', current_setting('p0.b')),
    'select count(*) from public.learning_roadmaps',
    format('insert into public.learning_roadmaps (user_id, input_hash, roadmap, model, prompt_version) values (%L, %L, %L, %L, %L)',
           current_setting('p0.a'), 'anon', '[]', 'm', 'v'),
    format('update public.learning_roadmaps set input_hash = %L where user_id = %L', 'anon', current_setting('p0.b')),
    format('delete from public.learning_roadmaps where user_id = %L', current_setting('p0.b')),
    'select count(*) from public.career_analyses',
    format('insert into public.career_analyses (user_id, input_hash, analysis, model, prompt_version) values (%L, %L, %L, %L, %L)',
           current_setting('p0.a'), 'anon', '{}', 'm', 'v'),
    format('update public.career_analyses set input_hash = %L where user_id = %L', 'anon', current_setting('p0.b')),
    format('delete from public.career_analyses where user_id = %L', current_setting('p0.b')),
    'select count(*) from public.ai_rate_limits',
    format('insert into public.ai_rate_limits (user_id, operation, window_start, hour_start) values (%L, %L, now(), now())',
           current_setting('p0.a'), 'chat'),
    'update public.ai_rate_limits set window_count = 0',
    'delete from public.ai_rate_limits',
    'select public.consume_ai_generation(''chat'')',
    'select count(*) from public.skill_progress',
    'select count(*) from public.skill_evidence',
    format('insert into public.skill_progress (user_id, skill_id) values (%L, gen_random_uuid())', current_setting('p0.a')),
    format('insert into public.skill_evidence (user_id, skill_id, evidence_type, title) values (%L, gen_random_uuid(), %L, %L)',
           current_setting('p0.a'), 'project', 'anon'),
    'update public.skill_progress set confidence_score = 99',
    'update public.skill_evidence set title = ''anon''',
    'delete from public.skill_progress',
    'delete from public.skill_evidence',
    'select public.set_skill_progress_status(gen_random_uuid(), ''learning'')',
    'select public.add_skill_evidence(array[gen_random_uuid()], ''project'', ''anon'')',
    'insert into public.skill_aliases (alias_key, alias, skill_id) values (''anon alias'', ''anon alias'', gen_random_uuid())',
    'update public.skill_aliases set alias_key = alias_key where false',
    'delete from public.skill_aliases where false',
    'select count(*) from public.learning_roadmap_versions',
    'select count(*) from public.learning_roadmap_version_steps',
    format('insert into public.learning_roadmap_versions (user_id, version_number, input_hash, model, prompt_version, generated_at, step_count) values (%L, 1, %L, %L, %L, now(), 1)',
           current_setting('p0.a'), 'anon', 'm', 'v'),
    'update public.learning_roadmap_versions set model = model where false',
    'delete from public.learning_roadmap_versions where false',
    'update public.learning_roadmap_version_steps set skill_text = skill_text where false',
    'delete from public.learning_roadmap_version_steps where false',
    format('select public.create_learning_roadmap_version(%L, %L, %L, %L, now(), %L)', current_setting('p0.a'), 'h', 'm', 'v', '[{"order":1,"skill":"x"}]'),
    'select public.complete_roadmap_learning_step(gen_random_uuid(), 1)'];
  foreach t in array array['assessments', 'user_skills', 'skill_gaps', 'job_readiness'] loop
    must_deny := must_deny || array[
      format('select count(*) from public.%I', t),
      format('insert into public.%I default values', t),
      format('update public.%I set user_id = user_id where false', t),
      format('delete from public.%I where false', t)];
  end loop;
  foreach t in array array['skills', 'courses', 'jobs'] loop
    must_deny := must_deny || array[
      format('insert into public.%I default values', t),
      format('update public.%I set id = id where false', t),
      format('delete from public.%I where false', t)];
  end loop;

  foreach stmt in array must_deny loop
    ok := false; err := 'it succeeded';
    begin
      execute stmt;
    exception
      when insufficient_privilege then ok := true;
      when others then err := sqlstate || ' ' || sqlerrm;
    end;
    if not ok then raise exception 'FAIL: anon should be denied [%] but %', stmt, err; end if;
  end loop;
  raise notice 'PASS: anon denied on profiles, learning_roadmaps, career_analyses and ai_rate_limits (select/insert/update/delete), on consume_ai_generation(), on all 4 unused user tables (select/insert/update/delete), and on catalog writes (insert/update/delete)';
  raise notice 'PASS: anon denied on skill_progress and skill_evidence (select/insert/update/delete) and on the skill write functions';

  foreach t in array array['skills', 'courses', 'jobs', 'skill_aliases'] loop
    begin
      execute format('select count(*) from public.%I', t) into n;
    exception when others then
      raise exception 'FAIL: anon should be able to read % but got %', t, sqlerrm;
    end;
    if n <> current_setting('p0.n_' || t)::bigint then
      raise exception 'FAIL: anon sees % rows in %, expected all %', n, t, current_setting('p0.n_' || t);
    end if;
  end loop;
  raise notice 'PASS: anon can read every row of skills, courses, jobs and skill_aliases, and cannot write skill_aliases';
end $$;

reset role;

-- 4. Authenticated user A (Data API "authenticated" role, JWT sub = A) --------------
select set_config('request.jwt.claims', json_build_object('sub', current_setting('p0.a'), 'role', 'authenticated')::text, true),
       set_config('request.jwt.claim.sub', current_setting('p0.a'), true);
set local role authenticated;

do $$
declare
  a uuid := current_setting('p0.a')::uuid;
  b uuid := current_setting('p0.b')::uuid;
  c uuid := current_setting('p0.c')::uuid;
  stmt text; t text; n bigint; ok boolean; err text;
  must_deny text[];
begin
  if (select auth.uid()) is distinct from a then
    raise exception 'SETUP ERROR: auth.uid() does not return test user A; role impersonation is not working';
  end if;

  select count(*) into n from public.profiles where id = a;
  if n <> 1 then raise exception 'FAIL: A cannot read own profile (% rows)', n; end if;
  raise notice 'PASS: A can read own profile';

  select count(*) into n from public.profiles;
  if n <> 1 then raise exception 'FAIL: A can see % profiles, expected only its own', n; end if;
  raise notice 'PASS: A sees only its own profile (no real user rows visible)';

  select count(*) into n from public.profiles where id = b;
  if n <> 0 then raise exception 'FAIL: A can read B''s profile'; end if;
  raise notice 'PASS: A cannot read B';

  update public.profiles set name = 'P0 Test A updated' where id = a;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: A cannot update own profile (% rows)', n; end if;
  raise notice 'PASS: A can update own profile';

  update public.profiles set name = 'hijacked' where id = b;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: A updated B''s profile'; end if;
  raise notice 'PASS: A cannot update B';

  must_deny := array[
    format('insert into public.profiles (id, name) values (%L, %L)', b, 'spoof'),
    format('insert into public.profiles (id, name) values (%L, %L)', c, 'spoof'),
    format('update public.profiles set id = %L where id = %L', c, a),
    format('delete from public.profiles where id = %L', b),
    format('delete from public.profiles where id = %L', a),
    'select count(*) from public.ai_rate_limits',
    format('insert into public.ai_rate_limits (user_id, operation, window_start, hour_start) values (%L, %L, now(), now())', a, 'chat'),
    'update public.ai_rate_limits set window_count = 0',
    'delete from public.ai_rate_limits',
    'truncate public.ai_rate_limits',
    format('insert into public.skill_progress (user_id, skill_id, status) values (%L, gen_random_uuid(), %L)', a, 'proven'),
    format('insert into public.skill_evidence (user_id, skill_id, evidence_type, title) values (%L, gen_random_uuid(), %L, %L)', b, 'project', 'spoof'),
    'update public.skill_progress set confidence_score = 99',
    'update public.skill_evidence set score = 100',
    'delete from public.skill_progress',
    'delete from public.skill_evidence',
    'truncate public.skill_evidence',
    'insert into public.skill_aliases (alias_key, alias, skill_id) values (''a alias'', ''a alias'', gen_random_uuid())',
    'update public.skill_aliases set alias_key = alias_key where false',
    'delete from public.skill_aliases where false',
    'truncate public.skill_aliases'];
  foreach t in array array['assessments', 'user_skills', 'skill_gaps', 'job_readiness'] loop
    must_deny := must_deny || array[
      format('select count(*) from public.%I', t),
      format('insert into public.%I default values', t),
      format('update public.%I set user_id = user_id where false', t),
      format('delete from public.%I where false', t)];
  end loop;
  foreach t in array array['skills', 'courses', 'jobs'] loop
    must_deny := must_deny || array[
      format('insert into public.%I default values', t),
      format('update public.%I set id = id where false', t),
      format('delete from public.%I where false', t)];
  end loop;

  foreach stmt in array must_deny loop
    ok := false; err := 'it succeeded';
    begin
      execute stmt;
    exception
      when insufficient_privilege then ok := true;
      when others then err := sqlstate || ' ' || sqlerrm;
    end;
    if not ok then raise exception 'FAIL: A should be denied [%] but %', stmt, err; end if;
  end loop;
  raise notice 'PASS: A cannot insert with B''s id or an unowned id, cannot change own id, cannot delete B or itself';
  raise notice 'PASS: A denied on all 4 unused user tables (select/insert/update/delete) and on catalog writes';
  raise notice 'PASS: A cannot read, insert, update, delete or truncate ai_rate_limits directly';
  raise notice 'PASS: A cannot insert, update, delete or truncate skill_progress / skill_evidence directly';

  foreach t in array array['skills', 'courses', 'jobs', 'skill_aliases'] loop
    begin
      execute format('select count(*) from public.%I', t) into n;
    exception when others then
      raise exception 'FAIL: A should be able to read % but got %', t, sqlerrm;
    end;
    if n <> current_setting('p0.n_' || t)::bigint then
      raise exception 'FAIL: A sees % rows in %, expected all %', n, t, current_setting('p0.n_' || t);
    end if;
  end loop;
  raise notice 'PASS: A can read every row of skills, courses, jobs and skill_aliases, and cannot write skill_aliases';
end $$;

-- 4b. learning_roadmaps as authenticated user A ---------------------------------------
do $$
declare
  a uuid := current_setting('p0.a')::uuid;
  b uuid := current_setting('p0.b')::uuid;
  c uuid := current_setting('p0.c')::uuid;
  stmt text; n bigint; ok boolean; err text;
  must_deny text[];
begin
  begin
    insert into public.learning_roadmaps (user_id, input_hash, roadmap, ai_summary, model, prompt_version)
    values (a, 'p0-hash-a1', '[{"skill":"P0 Test A1"}]', 'P0 Test A', 'p0-test', 'p0-test');
  exception when others then
    raise exception 'FAIL: A cannot insert its own roadmap: %', sqlerrm;
  end;
  raise notice 'PASS: A can insert its own roadmap';

  select count(*) into n from public.learning_roadmaps where user_id = a;
  if n <> 1 then raise exception 'FAIL: A cannot read its own roadmap (% rows)', n; end if;
  select count(*) into n from public.learning_roadmaps;
  if n <> 1 then raise exception 'FAIL: A can see % roadmaps, expected only its own', n; end if;
  select count(*) into n from public.learning_roadmaps where user_id = b;
  if n <> 0 then raise exception 'FAIL: A can read B''s roadmap'; end if;
  raise notice 'PASS: A reads only its own roadmap (B''s and real users'' rows invisible)';

  update public.learning_roadmaps
     set input_hash = 'p0-hash-a2', roadmap = '[{"skill":"P0 Test A2"}]', generated_at = now()
   where user_id = a;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: A cannot update its own roadmap (% rows)', n; end if;

  begin
    insert into public.learning_roadmaps (user_id, input_hash, roadmap, ai_summary, model, prompt_version)
    values (a, 'p0-hash-a3', '[{"skill":"P0 Test A3"}]', 'P0 Test A', 'p0-test', 'p0-test')
    on conflict (user_id) do update
      set input_hash = excluded.input_hash, roadmap = excluded.roadmap, generated_at = now();
  exception when others then
    raise exception 'FAIL: A cannot upsert its own roadmap: %', sqlerrm;
  end;
  select count(*) into n from public.learning_roadmaps where user_id = a and input_hash = 'p0-hash-a3';
  if n <> 1 then raise exception 'FAIL: A''s roadmap upsert did not take effect'; end if;
  raise notice 'PASS: A can update and upsert its own roadmap';

  update public.learning_roadmaps set input_hash = 'hijacked' where user_id = b;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: A updated B''s roadmap'; end if;
  raise notice 'PASS: A cannot update B''s roadmap';

  must_deny := array[
    format('insert into public.learning_roadmaps (user_id, input_hash, roadmap, model, prompt_version) values (%L, %L, %L, %L, %L)',
           b, 'spoof', '[]', 'm', 'v'),
    format('insert into public.learning_roadmaps (user_id, input_hash, roadmap, model, prompt_version) values (%L, %L, %L, %L, %L)',
           c, 'spoof', '[]', 'm', 'v'),
    format('insert into public.learning_roadmaps (user_id, input_hash, roadmap, model, prompt_version) values (%L, %L, %L, %L, %L) '
           || 'on conflict (user_id) do update set input_hash = excluded.input_hash', b, 'spoof', '[]', 'm', 'v'),
    format('update public.learning_roadmaps set user_id = %L where user_id = %L', c, a),
    format('delete from public.learning_roadmaps where user_id = %L', a),
    format('delete from public.learning_roadmaps where user_id = %L', b),
    'truncate public.learning_roadmaps'];
  foreach stmt in array must_deny loop
    ok := false; err := 'it succeeded';
    begin
      execute stmt;
    exception
      when insufficient_privilege then ok := true;
      when others then err := sqlstate || ' ' || sqlerrm;
    end;
    if not ok then raise exception 'FAIL: A should be denied [%] but %', stmt, err; end if;
  end loop;
  raise notice 'PASS: A cannot insert/upsert a roadmap for B or an unowned id, re-point its own row, delete any roadmap, or truncate';
end $$;

reset role;

-- 5. Authenticated user D, who has no profile yet: own INSERT (onboarding) ----------
select set_config('request.jwt.claims', json_build_object('sub', current_setting('p0.d'), 'role', 'authenticated')::text, true),
       set_config('request.jwt.claim.sub', current_setting('p0.d'), true);
set local role authenticated;

do $$
declare
  d uuid := current_setting('p0.d')::uuid;
  n bigint;
begin
  begin
    insert into public.profiles
      (id, name, target_role, experience_level, job_readiness, skills_mastered, skill_gaps, learning_progress)
    values (d, 'P0 Test D', 'Tester', 'Beginner', 0, 0, 0, 0);
  exception when others then
    raise exception 'FAIL: D cannot create its own profile: %', sqlerrm;
  end;
  select count(*) into n from public.profiles where id = d;
  if n <> 1 then raise exception 'FAIL: D cannot read the profile it just created'; end if;
  raise notice 'PASS: a signed-in user can create and read their own profile (onboarding)';
end $$;

reset role;

-- 6. Integrity, as the table owner: nothing real changed -----------------------------
do $$
declare n bigint;
begin
  select count(*) into n from public.profiles where id = current_setting('p0.b')::uuid and name = 'P0 Test B';
  if n <> 1 then raise exception 'FAIL: B''s profile was modified or deleted'; end if;
  select count(*) into n from public.profiles where id = current_setting('p0.a')::uuid and name = 'P0 Test A updated';
  if n <> 1 then raise exception 'FAIL: A''s own update did not persist'; end if;
  select count(*) into n from public.profiles where id = current_setting('p0.c')::uuid;
  if n <> 0 then raise exception 'FAIL: a profile was created under an id nobody owns'; end if;

  if (select md5(coalesce(string_agg(p::text, '|' order by p.id), ''))
      from public.profiles p
      where p.id not in (current_setting('p0.a')::uuid, current_setting('p0.b')::uuid, current_setting('p0.d')::uuid))
     is distinct from current_setting('p0.real_profiles') then
    raise exception 'FAIL: real (non-test) profile rows changed during the test';
  end if;
  if (select count(*) from public.skills)::text <> current_setting('p0.n_skills')
     or (select count(*) from public.skill_aliases)::text <> current_setting('p0.n_skill_aliases')
     or (select count(*) from public.courses)::text <> current_setting('p0.n_courses')
     or (select count(*) from public.jobs)::text <> current_setting('p0.n_jobs') then
    raise exception 'FAIL: catalog row counts changed during the test';
  end if;
  raise notice 'PASS: real profiles and catalog rows untouched; test rows behaved as expected';

  select count(*) into n from public.learning_roadmaps where user_id = current_setting('p0.b')::uuid and input_hash = 'p0-hash-b';
  if n <> 1 then raise exception 'FAIL: B''s roadmap was modified or deleted'; end if;
  select count(*) into n from public.learning_roadmaps where user_id = current_setting('p0.a')::uuid and input_hash = 'p0-hash-a3';
  if n <> 1 then raise exception 'FAIL: A''s own roadmap upsert did not persist'; end if;
  select count(*) into n from public.learning_roadmaps where user_id = current_setting('p0.c')::uuid;
  if n <> 0 then raise exception 'FAIL: a roadmap was created under an id nobody owns'; end if;
  if (select md5(coalesce(string_agg(r::text, '|' order by r.user_id), ''))
      from public.learning_roadmaps r
      where r.user_id not in (current_setting('p0.a')::uuid, current_setting('p0.b')::uuid))
     is distinct from current_setting('p0.real_roadmaps') then
    raise exception 'FAIL: real (non-test) roadmap rows changed during the test';
  end if;
  raise notice 'PASS: real roadmaps untouched; B''s roadmap unchanged, A''s own writes persisted';

  delete from public.profiles where id = current_setting('p0.a')::uuid;
  select count(*) into n from public.learning_roadmaps where user_id = current_setting('p0.a')::uuid;
  if n <> 0 then raise exception 'FAIL: deleting a profile did not cascade to its roadmap'; end if;
  raise notice 'PASS: deleting a profile deletes its roadmap (ON DELETE CASCADE)';

  raise exception 'P0 RLS VERIFICATION PASSED: all checks passed. This error is intentional: it rolls back every temporary test row.';
end $$;

rollback;
