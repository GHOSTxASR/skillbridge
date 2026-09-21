-- =============================================================================
-- P0 RLS verification for the SkillBridge Supabase database
-- =============================================================================
-- Run the WHOLE script at once in the Supabase SQL Editor (do not run a selection).
--
-- What it does:
--   * Checks structure: the 8 tables, no unexpected public tables, RLS on,
--     the exact policy set, and the exact anon/authenticated privileges.
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
       set_config('p0.n_courses', (select count(*)::text from public.courses), true),
       set_config('p0.n_jobs',    (select count(*)::text from public.jobs),    true);

-- 1. Structure: tables, RLS, policies, privileges ---------------------------------
do $$
declare
  reviewed constant text[] := array['profiles', 'assessments', 'user_skills', 'skill_gaps',
                                    'job_readiness', 'skills', 'courses', 'jobs'];
  bad text;
begin
  select string_agg(t, ', ') into bad from unnest(reviewed) t
  where not exists (select 1 from pg_class c where c.relnamespace = 'public'::regnamespace
                    and c.relname::text = t and c.relkind in ('r', 'p'));
  if bad is not null then raise exception 'FAIL: reviewed table(s) missing: %', bad; end if;
  raise notice 'PASS: all 8 reviewed tables exist';

  select string_agg(c.relname::text, ', ') into bad from pg_class c
  where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
    and c.relname::text <> all (reviewed);
  if bad is not null then raise exception 'FAIL: unexpected public base table(s) need review: %', bad; end if;
  raise notice 'PASS: no unexpected public base tables';

  select string_agg(c.relname::text, ', ') into bad from pg_class c
  where c.relnamespace = 'public'::regnamespace and c.relname::text = any (reviewed) and not c.relrowsecurity;
  if bad is not null then raise exception 'FAIL: RLS disabled on %', bad; end if;
  raise notice 'PASS: RLS enabled on all 8 tables';

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
           ('courses',  'courses_read_all',    'SELECT', 'anon,authenticated', true),
           ('jobs',     'jobs_read_all',       'SELECT', 'anon,authenticated', true)
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

  select string_agg(policyname, ', ') into bad from pg_policies
  where schemaname = 'public' and tablename = 'profiles'
    and (coalesce(qual, '') !~ 'auth\.uid\(\)' and coalesce(with_check, '') !~ 'auth\.uid\(\)');
  if bad is not null then raise exception 'FAIL: profiles policy without an auth.uid() ownership rule: %', bad; end if;
  raise notice 'PASS: every profiles policy is tied to auth.uid()';

  with expected(tbl, grantee, priv) as (
    values ('profiles', 'authenticated', 'SELECT'), ('profiles', 'authenticated', 'INSERT'),
           ('profiles', 'authenticated', 'UPDATE'),
           ('skills',  'anon', 'SELECT'), ('skills',  'authenticated', 'SELECT'),
           ('courses', 'anon', 'SELECT'), ('courses', 'authenticated', 'SELECT'),
           ('jobs',    'anon', 'SELECT'), ('jobs',    'authenticated', 'SELECT')
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
     or (t in ('skills', 'courses', 'jobs')
           and has_table_privilege(ro, format('public.%I', t), 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'))
     or (t = 'profiles' and ro = 'anon'
           and has_table_privilege(ro, 'public.profiles', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'))
     or (t = 'profiles' and ro = 'authenticated'
           and has_table_privilege(ro, 'public.profiles', 'DELETE, TRUNCATE, REFERENCES, TRIGGER'));
  if bad is not null then raise exception 'FAIL: effective privilege that should be absent: %', bad; end if;
  raise notice 'PASS: no forbidden effective privileges (including inherited ones)';
end $$;

-- 2. Temporary test profiles A and B (rolled back at the end) -----------------------
-- Same columns the app writes at onboarding (app/setup-profile/page.tsx).
do $$
begin
  insert into public.profiles
    (id, name, target_role, experience_level, job_readiness, skills_mastered, skill_gaps, learning_progress)
  values
    (current_setting('p0.a')::uuid, 'P0 Test A', 'Tester', 'Beginner', 0, 0, 0, 0),
    (current_setting('p0.b')::uuid, 'P0 Test B', 'Tester', 'Beginner', 0, 0, 0, 0);
exception when others then
  raise exception 'SETUP ERROR: could not create temporary test profiles (%). This is not a security result.', sqlerrm;
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
    format('delete from public.profiles where id = %L', current_setting('p0.b'))];
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
  raise notice 'PASS: anon denied on profiles (select/insert/update/delete), on all 4 unused user tables (select/insert/update/delete), and on catalog writes (insert/update/delete)';

  foreach t in array array['skills', 'courses', 'jobs'] loop
    begin
      execute format('select count(*) from public.%I', t) into n;
    exception when others then
      raise exception 'FAIL: anon should be able to read % but got %', t, sqlerrm;
    end;
    if n <> current_setting('p0.n_' || t)::bigint then
      raise exception 'FAIL: anon sees % rows in %, expected all %', n, t, current_setting('p0.n_' || t);
    end if;
  end loop;
  raise notice 'PASS: anon can read every row of skills, courses and jobs';
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
    format('delete from public.profiles where id = %L', a)];
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

  foreach t in array array['skills', 'courses', 'jobs'] loop
    begin
      execute format('select count(*) from public.%I', t) into n;
    exception when others then
      raise exception 'FAIL: A should be able to read % but got %', t, sqlerrm;
    end;
    if n <> current_setting('p0.n_' || t)::bigint then
      raise exception 'FAIL: A sees % rows in %, expected all %', n, t, current_setting('p0.n_' || t);
    end if;
  end loop;
  raise notice 'PASS: A can read every row of skills, courses and jobs';
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
     or (select count(*) from public.courses)::text <> current_setting('p0.n_courses')
     or (select count(*) from public.jobs)::text <> current_setting('p0.n_jobs') then
    raise exception 'FAIL: catalog row counts changed during the test';
  end if;
  raise notice 'PASS: real profiles and catalog rows untouched; test rows behaved as expected';

  raise exception 'P0 RLS VERIFICATION PASSED: all checks passed. This error is intentional: it rolls back every temporary test row.';
end $$;

rollback;
